//! Dormant diagnostic architecture. This module has NO hardware imports or adapters.
//! The Update-10 host does not include it. Hardware implementations must eventually live
//! in reviewed, fixed-path helper processes, never on the host/UI or supervisor thread.
#![allow(dead_code)]
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    thread,
    time::Duration,
};

pub const SAMPLE_INTERVAL_MS: u64 = 1_000;
pub const START_TIMEOUT_MS: u64 = 2_000;
pub const READ_TIMEOUT_MS: u64 = 500;
pub const STOP_TIMEOUT_MS: u64 = 250;
const FAILURE_LIMIT: u8 = 3;
const PAYLOAD_LIMIT: usize = 65_536;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    Gpu,
    Storage,
    Cpu,
    Motherboard,
    Memory,
}
impl Category {
    pub const ALL: [Self; 5] = [
        Self::Gpu,
        Self::Storage,
        Self::Cpu,
        Self::Motherboard,
        Self::Memory,
    ];
    pub fn name(self) -> &'static str {
        match self {
            Self::Gpu => "gpu",
            Self::Storage => "storage",
            Self::Cpu => "cpu",
            Self::Motherboard => "motherboard",
            Self::Memory => "memory",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Start,
    Sample,
    Stop,
}
impl Operation {
    fn name(self) -> &'static str {
        match self {
            Self::Start => "START",
            Self::Sample => "SAMPLE",
            Self::Stop => "STOP",
        }
    }
    fn timeout(self) -> u64 {
        match self {
            Self::Start => START_TIMEOUT_MS,
            Self::Sample => READ_TIMEOUT_MS,
            Self::Stop => STOP_TIMEOUT_MS,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Unavailable,
    Busy,
    Timeout,
    Crashed,
    InvalidPayload,
    ReadFailed,
    Blacklisted,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Dormant,
    Starting,
    Ready,
    Sampling,
    Stopping,
    CircuitOpen,
}
#[derive(Clone, Debug)]
pub struct Health {
    pub category: Category,
    pub status: Status,
    pub failures: u8,
    pub error: Option<Failure>,
}
#[derive(Clone, Copy, Debug)]
struct Request {
    id: u64,
    operation: Operation,
}
pub struct Completion {
    id: u64,
    operation: Operation,
    result: Result<Vec<u8>, Failure>,
}

/// All methods dispatch or poll only; implementations may not perform blocking hardware
/// calls here. Cancellation is a nonblocking signal, not a synchronous destructor/join.
trait Transport: Send {
    fn dispatch(&mut self, request: Request) -> Result<(), Failure>;
    fn poll(&mut self) -> Option<Completion>;
    fn cancel(&mut self);
    fn quiescent(&self) -> bool;
}
struct Pending {
    request: Request,
    deadline: u64,
}
pub struct Provider {
    health: Health,
    transport: Option<Box<dyn Transport>>,
    pending: Option<Pending>,
    next_id: u64,
    next_sample: u64,
    payload: Option<Vec<u8>>,
    cancel_deadline: Option<u64>,
}
impl Provider {
    fn new(category: Category, transport: Option<Box<dyn Transport>>) -> Self {
        Self {
            health: Health {
                category,
                status: Status::Dormant,
                failures: 0,
                error: None,
            },
            transport,
            pending: None,
            next_id: 0,
            next_sample: 0,
            payload: None,
            cancel_deadline: None,
        }
    }
    pub fn health(&self) -> Health {
        self.health.clone()
    }
    fn quiescent(&self) -> bool {
        self.transport.as_ref().is_none_or(|t| t.quiescent())
    }
    fn send(&mut self, operation: Operation, time: u64) -> Result<(), Failure> {
        if self.pending.is_some() {
            return Err(Failure::Busy);
        }
        self.next_id += 1;
        let request = Request {
            id: self.next_id,
            operation,
        };
        let result = self
            .transport
            .as_mut()
            .ok_or(Failure::Unavailable)?
            .dispatch(request);
        if let Err(error) = result {
            self.trip(error);
            return Err(error);
        }
        self.pending = Some(Pending {
            request,
            deadline: time.saturating_add(operation.timeout()),
        });
        self.health.status = match operation {
            Operation::Start => Status::Starting,
            Operation::Sample => Status::Sampling,
            Operation::Stop => Status::Stopping,
        };
        Ok(())
    }
    pub fn start(&mut self, time: u64) -> Result<(), Failure> {
        if self.health.status == Status::CircuitOpen {
            return Err(Failure::Blacklisted);
        }
        if self.health.status != Status::Dormant || !self.quiescent() {
            return Err(Failure::Busy);
        }
        if self.transport.is_none() {
            self.health.error = Some(Failure::Unavailable);
            return Err(Failure::Unavailable);
        }
        self.send(Operation::Start, time)
    }
    pub fn sample(&mut self, time: u64) -> Result<(), Failure> {
        if self.health.status != Status::Ready {
            return Err(Failure::Busy);
        }
        self.send(Operation::Sample, time)
    }
    pub fn stop(&mut self, time: u64) {
        self.payload = None;
        if self.health.status == Status::CircuitOpen {
            return;
        }
        if self.pending.is_some() {
            // Never queue a stop behind a blocked read or overlap requests.
            self.pending = None;
            if let Some(t) = &mut self.transport {
                t.cancel();
            }
            self.health.status = Status::Stopping;
            self.cancel_deadline = Some(time.saturating_add(STOP_TIMEOUT_MS));
            return;
        }
        if self.health.status == Status::Ready {
            let _ = self.send(Operation::Stop, time);
        }
    }
    fn trip(&mut self, error: Failure) {
        self.pending = None;
        self.payload = None;
        self.cancel_deadline = None;
        self.health.status = Status::CircuitOpen;
        self.health.error = Some(error);
        if let Some(t) = &mut self.transport {
            t.cancel();
        }
    }
    fn advance(&mut self, time: u64) {
        // Check deadline before consuming a completion; late success is never accepted.
        if self.pending.as_ref().is_some_and(|p| time >= p.deadline) {
            self.trip(Failure::Timeout);
            return;
        }
        if self.health.status == Status::CircuitOpen {
            return;
        }
        if self.health.status == Status::Stopping && self.pending.is_none() {
            if self.quiescent() {
                self.health.status = Status::Dormant;
                self.cancel_deadline = None;
            } else if self
                .cancel_deadline
                .is_some_and(|deadline| time >= deadline)
            {
                self.trip(Failure::Timeout);
                return;
            }
        }
        let Some(completion) = self.transport.as_mut().and_then(|t| t.poll()) else {
            return;
        };
        let Some(pending) = &self.pending else {
            return;
        };
        if completion.id != pending.request.id || completion.operation != pending.request.operation
        {
            self.trip(Failure::InvalidPayload);
            return;
        }
        self.pending = None;
        match completion.result {
            Ok(payload) if payload.len() <= PAYLOAD_LIMIT => {
                self.health.error = None;
                match completion.operation {
                    Operation::Start => {
                        self.health.status = Status::Ready;
                        self.next_sample = time;
                    }
                    Operation::Sample => {
                        self.health.status = Status::Ready;
                        self.payload = Some(payload);
                        self.next_sample = time.saturating_add(SAMPLE_INTERVAL_MS);
                    }
                    Operation::Stop => {
                        if let Some(t) = &mut self.transport {
                            t.cancel();
                        }
                        self.health.status = Status::Stopping;
                        self.cancel_deadline = Some(time.saturating_add(STOP_TIMEOUT_MS));
                    }
                }
            }
            Err(Failure::ReadFailed) if completion.operation == Operation::Sample => {
                self.payload = None;
                self.health.failures += 1;
                if self.health.failures >= FAILURE_LIMIT {
                    self.trip(Failure::ReadFailed);
                } else {
                    self.health.status = Status::Ready;
                    self.health.error = Some(Failure::ReadFailed);
                    self.next_sample = time.saturating_add(SAMPLE_INTERVAL_MS);
                }
            }
            Ok(_) => self.trip(Failure::InvalidPayload),
            Err(error) => self.trip(error),
        }
    }
}
impl Drop for Provider {
    fn drop(&mut self) {
        if let Some(t) = &mut self.transport {
            t.cancel();
        }
    }
}

/// One-at-a-time development policy. The five slots are independent; no category
/// constructs another category. Current registry is deliberately EMPTY for all slots.
pub struct Diagnostic {
    providers: [Provider; 5],
    selected: Option<Category>,
}
impl Default for Diagnostic {
    fn default() -> Self {
        Self {
            providers: Category::ALL.map(|category| Provider::new(category, None)),
            selected: None,
        }
    }
}
impl Diagnostic {
    pub fn health(&self) -> Vec<Health> {
        self.providers.iter().map(Provider::health).collect()
    }
    pub fn selected(&self) -> Option<Category> {
        self.selected
    }
    pub fn enable(&mut self, category: Category, time: u64) -> Result<(), Failure> {
        if self.selected.is_some() || self.providers.iter().any(|p| !p.quiescent()) {
            return Err(Failure::Busy);
        }
        let provider = self
            .providers
            .iter_mut()
            .find(|p| p.health.category == category)
            .unwrap();
        provider.start(time)?;
        self.selected = Some(category);
        Ok(())
    }
    pub fn disable(&mut self, time: u64) {
        if let Some(category) = self.selected.take() {
            self.providers
                .iter_mut()
                .find(|p| p.health.category == category)
                .unwrap()
                .stop(time);
        }
    }
    pub fn tick(&mut self, time: u64) {
        for provider in &mut self.providers {
            provider.advance(time);
            if self.selected == Some(provider.health.category) {
                if provider.health.status == Status::CircuitOpen {
                    self.selected = None;
                } else if provider.health.status == Status::Ready && time >= provider.next_sample {
                    let _ = provider.sample(time);
                }
            }
        }
    }
}

// Fixed-path helper process transport. No registry entry points at this implementation
// yet. Constructors remain private, and the diagnostic CLI accepts no executable path.
// At most ONE actor + ONE reaper per provider lifetime; never replace stuck workers.
struct SharedProcess {
    child: Mutex<Option<Child>>,
    canceled: AtomicBool,
    worker_done: AtomicBool,
    reaped: AtomicBool,
}
struct IsolatedProcess {
    executable: PathBuf,
    category: Category,
    shared: Arc<SharedProcess>,
    commands: Option<SyncSender<Request>>,
    completions: Option<Receiver<Completion>>,
    attempted: bool,
    request: Option<Request>,
}
impl IsolatedProcess {
    fn fixed_helper(category: Category, executable: PathBuf) -> Self {
        Self {
            executable,
            category,
            shared: Arc::new(SharedProcess {
                child: Mutex::new(None),
                canceled: AtomicBool::new(false),
                worker_done: AtomicBool::new(false),
                reaped: AtomicBool::new(false),
            }),
            commands: None,
            completions: None,
            attempted: false,
            request: None,
        }
    }
    fn launch(&mut self) -> Result<(), Failure> {
        if self.attempted {
            return Err(Failure::Blacklisted);
        }
        self.attempted = true;
        let (commands, receiver) = mpsc::sync_channel::<Request>(1);
        let (sender, completions) = mpsc::sync_channel::<Completion>(1);
        let shared = self.shared.clone();
        let executable = self.executable.clone();
        let category = self.category;
        // Reserve the cancellation/reaping worker BEFORE starting any actor or child.
        // If the reservation fails there can be no orphan helper process.
        let reaper_shared = self.shared.clone();
        thread::Builder::new()
            .name(format!("sensor-{}-reaper", category.name()))
            .spawn(move || {
                loop {
                    if reaper_shared.canceled.load(Ordering::SeqCst) {
                        let mut child = reaper_shared.child.lock().unwrap();
                        if let Some(child) = child.as_mut() {
                            let _ = child.kill();
                            // If the OS cannot terminate/reap it, keep the slot leased forever.
                            if child.wait().is_ok() {
                                reaper_shared.reaped.store(true, Ordering::SeqCst);
                            }
                            break;
                        }
                        if reaper_shared.worker_done.load(Ordering::SeqCst) {
                            reaper_shared.reaped.store(true, Ordering::SeqCst);
                            break;
                        }
                    }
                    thread::sleep(Duration::from_millis(10));
                }
            })
            .map_err(|_| Failure::Unavailable)?;
        let actor = thread::Builder::new()
            .name(format!("sensor-{}-ipc", category.name()))
            .spawn(move || {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let mut command = Command::new(executable);
                    command
                        .arg(category.name())
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::null());
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        command.creation_flags(0x08000000);
                    }
                    // Process creation and pipe I/O occur only on this bounded actor thread.
                    let Ok(mut child) = command.spawn() else {
                        return;
                    };
                    let Some(mut input) = child.stdin.take() else {
                        let _ = child.kill();
                        let _ = child.wait();
                        return;
                    };
                    let Some(output) = child.stdout.take() else {
                        let _ = child.kill();
                        let _ = child.wait();
                        return;
                    };
                    *shared.child.lock().unwrap() = Some(child);
                    let mut output = BufReader::new(output);
                    while let Ok(request) = receiver.recv() {
                        if shared.canceled.load(Ordering::SeqCst) {
                            break;
                        }
                        let result = (|| {
                            writeln!(input, "{} {}", request.operation.name(), request.id)
                                .map_err(|_| Failure::Crashed)?;
                            input.flush().map_err(|_| Failure::Crashed)?;
                            let mut line = Vec::new();
                            // Bounded allocation even if the child produces an unterminated reply.
                            let bytes_read = (&mut output)
                                .take((PAYLOAD_LIMIT + 64) as u64)
                                .read_until(b'\n', &mut line)
                                .map_err(|_| Failure::Crashed)?;
                            if bytes_read == 0 {
                                return Err(Failure::Crashed);
                            }
                            if !line.ends_with(b"\n") || line.len() > PAYLOAD_LIMIT + 63 {
                                return Err(Failure::InvalidPayload);
                            }
                            let text = std::str::from_utf8(&line)
                                .map_err(|_| Failure::InvalidPayload)?
                                .trim_end_matches(['\r', '\n']);
                            let mut fields = text.splitn(3, ' ');
                            let status = fields.next().ok_or(Failure::InvalidPayload)?;
                            let id: u64 = fields
                                .next()
                                .ok_or(Failure::InvalidPayload)?
                                .parse()
                                .map_err(|_| Failure::InvalidPayload)?;
                            if id != request.id {
                                return Err(Failure::InvalidPayload);
                            }
                            let payload = fields.next().unwrap_or("").as_bytes().to_vec();
                            if payload.len() > PAYLOAD_LIMIT {
                                return Err(Failure::InvalidPayload);
                            }
                            match status {
                                "OK" => Ok(payload),
                                "ERROR" => Err(Failure::ReadFailed),
                                _ => Err(Failure::InvalidPayload),
                            }
                        })();
                        let terminal =
                            matches!(result, Err(Failure::Crashed | Failure::InvalidPayload));
                        if sender
                            .try_send(Completion {
                                id: request.id,
                                operation: request.operation,
                                result,
                            })
                            .is_err()
                            || terminal
                            || request.operation == Operation::Stop
                        {
                            break;
                        }
                    }
                }));
                shared.worker_done.store(true, Ordering::SeqCst);
                shared.canceled.store(true, Ordering::SeqCst);
            });
        if actor.is_err() {
            self.shared.worker_done.store(true, Ordering::SeqCst);
            self.shared.canceled.store(true, Ordering::SeqCst);
            return Err(Failure::Unavailable);
        }
        self.commands = Some(commands);
        self.completions = Some(completions);
        Ok(())
    }
}
impl Transport for IsolatedProcess {
    fn dispatch(&mut self, request: Request) -> Result<(), Failure> {
        if self.shared.canceled.load(Ordering::SeqCst) {
            return Err(Failure::Blacklisted);
        }
        if !self.attempted {
            self.launch()?;
        }
        self.commands
            .as_ref()
            .ok_or(Failure::Unavailable)?
            .try_send(request)
            .map_err(|_| Failure::Busy)?;
        self.request = Some(request);
        Ok(())
    }
    fn poll(&mut self) -> Option<Completion> {
        match self.completions.as_ref()?.try_recv() {
            Ok(completion) => {
                self.request = None;
                Some(completion)
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                self.request.take().map(|request| Completion {
                    id: request.id,
                    operation: request.operation,
                    result: Err(Failure::Crashed),
                })
            }
            Err(mpsc::TryRecvError::Empty) => None,
        }
    }
    fn cancel(&mut self) {
        self.shared.canceled.store(true, Ordering::SeqCst);
        self.commands.take();
    }
    fn quiescent(&self) -> bool {
        !self.attempted
            || (self.shared.worker_done.load(Ordering::SeqCst)
                && self.shared.reaped.load(Ordering::SeqCst))
    }
}
impl Drop for IsolatedProcess {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct FakeState {
        requests: Vec<Request>,
        replies: std::collections::VecDeque<Completion>,
        canceled: usize,
        reaped: bool,
    }
    struct Fake(Arc<Mutex<FakeState>>);
    impl Transport for Fake {
        fn dispatch(&mut self, request: Request) -> Result<(), Failure> {
            let mut s = self.0.lock().unwrap();
            s.reaped = false;
            s.requests.push(request);
            Ok(())
        }
        fn poll(&mut self) -> Option<Completion> {
            self.0.lock().unwrap().replies.pop_front()
        }
        fn cancel(&mut self) {
            self.0.lock().unwrap().canceled += 1;
        }
        fn quiescent(&self) -> bool {
            let s = self.0.lock().unwrap();
            s.requests.is_empty() || s.reaped
        }
    }
    fn fake(category: Category) -> (Provider, Arc<Mutex<FakeState>>) {
        let shared = Arc::new(Mutex::new(FakeState::default()));
        (
            Provider::new(category, Some(Box::new(Fake(shared.clone())))),
            shared,
        )
    }
    fn reply(shared: &Arc<Mutex<FakeState>>, result: Result<Vec<u8>, Failure>) {
        let mut s = shared.lock().unwrap();
        let request = *s.requests.last().unwrap();
        s.replies.push_back(Completion {
            id: request.id,
            operation: request.operation,
            result,
        });
    }
    #[test]
    fn default_registry_is_dormant_and_cannot_initialize_any_backend() {
        let mut d = Diagnostic::default();
        assert!(d.selected().is_none());
        for category in Category::ALL {
            assert_eq!(d.enable(category, 0), Err(Failure::Unavailable));
        }
        d.tick(100_000);
        assert!(d.health().iter().all(|h| h.status == Status::Dormant));
    }
    #[test]
    fn start_and_read_have_separate_strict_deadlines_and_no_overlap() {
        let (mut p, s) = fake(Category::Gpu);
        p.start(0).unwrap();
        assert_eq!(p.sample(0), Err(Failure::Busy));
        reply(&s, Ok(vec![]));
        p.advance(1);
        p.sample(1).unwrap();
        assert_eq!(p.sample(2), Err(Failure::Busy));
        p.advance(500);
        assert_eq!(p.health.status, Status::Sampling);
        reply(&s, Ok(b"late".to_vec()));
        p.advance(501);
        assert_eq!(p.health.error, Some(Failure::Timeout));
        assert!(p.payload.is_none());
        assert_eq!(p.start(502), Err(Failure::Blacklisted));
        assert_eq!(s.lock().unwrap().requests.len(), 2);
        assert_eq!(s.lock().unwrap().canceled, 1);
    }
    #[test]
    fn hung_start_is_disabled_without_retries() {
        let (mut p, s) = fake(Category::Gpu);
        p.start(0).unwrap();
        p.advance(START_TIMEOUT_MS);
        for i in 0..100 {
            p.advance(START_TIMEOUT_MS + i);
        }
        assert_eq!(p.health.error, Some(Failure::Timeout));
        assert_eq!(s.lock().unwrap().requests.len(), 1);
    }
    #[test]
    fn one_category_does_not_initialize_or_block_another() {
        let (mut gpu, g) = fake(Category::Gpu);
        let (mut disk, d) = fake(Category::Storage);
        gpu.start(0).unwrap();
        assert!(d.lock().unwrap().requests.is_empty());
        disk.start(0).unwrap();
        reply(&d, Ok(vec![]));
        disk.advance(1);
        disk.sample(1).unwrap();
        reply(&d, Ok(b"disk-only".to_vec()));
        disk.advance(2);
        gpu.advance(START_TIMEOUT_MS);
        assert_eq!(gpu.health.status, Status::CircuitOpen);
        assert_eq!(disk.payload.as_deref(), Some(b"disk-only".as_slice()));
        assert_eq!(g.lock().unwrap().canceled, 1);
    }
    #[test]
    fn diagnostic_never_enables_two_categories_or_replaces_unreaped_worker() {
        let (gpu, g) = fake(Category::Gpu);
        let (disk, d) = fake(Category::Storage);
        let mut diag = Diagnostic::default();
        diag.providers[0] = gpu;
        diag.providers[1] = disk;
        diag.enable(Category::Gpu, 0).unwrap();
        assert_eq!(diag.enable(Category::Storage, 1), Err(Failure::Busy));
        diag.tick(START_TIMEOUT_MS);
        assert!(diag.selected().is_none());
        assert_eq!(
            diag.enable(Category::Storage, START_TIMEOUT_MS),
            Err(Failure::Busy)
        );
        g.lock().unwrap().reaped = true;
        diag.enable(Category::Storage, START_TIMEOUT_MS + 1)
            .unwrap();
        assert_eq!(d.lock().unwrap().requests.len(), 1);
        assert_eq!(
            diag.enable(Category::Gpu, START_TIMEOUT_MS + 2),
            Err(Failure::Busy)
        );
    }
    #[test]
    fn stop_during_read_cancels_instead_of_queuing_an_overlapping_request() {
        let (mut p, s) = fake(Category::Gpu);
        p.start(0).unwrap();
        reply(&s, Ok(vec![]));
        p.advance(1);
        p.sample(1).unwrap();
        p.stop(2);
        assert_eq!(s.lock().unwrap().requests.len(), 2);
        assert_eq!(s.lock().unwrap().canceled, 1);
        assert!(p.pending.is_none());
        assert!(p.payload.is_none());
        assert_eq!(p.health.status, Status::Stopping);
        s.lock().unwrap().reaped = true;
        p.advance(3);
        assert_eq!(p.health.status, Status::Dormant);
    }
    #[test]
    fn stop_timeout_does_not_join_the_worker() {
        let (mut p, s) = fake(Category::Gpu);
        p.start(0).unwrap();
        reply(&s, Ok(vec![]));
        p.advance(1);
        p.stop(2);
        p.advance(2 + STOP_TIMEOUT_MS);
        assert_eq!(p.health.error, Some(Failure::Timeout));
        assert_eq!(s.lock().unwrap().canceled, 1);
    }
    #[test]
    fn canceled_read_cannot_leave_health_stopping_indefinitely() {
        let (mut p, s) = fake(Category::Gpu);
        p.start(0).unwrap();
        p.stop(1);
        p.advance(1 + STOP_TIMEOUT_MS);
        assert_eq!(p.health.status, Status::CircuitOpen);
        assert_eq!(p.health.error, Some(Failure::Timeout));
        assert!(!p.quiescent());
        assert_eq!(s.lock().unwrap().requests.len(), 1);
    }
    #[test]
    fn three_read_failures_trip_session_circuit_without_infinite_retry() {
        let (mut p, s) = fake(Category::Gpu);
        p.start(0).unwrap();
        reply(&s, Ok(vec![]));
        p.advance(1);
        for time in [2, 1003, 2004] {
            p.sample(time).unwrap();
            reply(&s, Err(Failure::ReadFailed));
            p.advance(time + 1);
        }
        assert_eq!(p.health.failures, 3);
        assert_eq!(p.health.status, Status::CircuitOpen);
        assert_eq!(p.start(9000), Err(Failure::Blacklisted));
        assert_eq!(s.lock().unwrap().requests.len(), 4);
    }
    #[test]
    fn stale_or_oversized_reply_is_terminal_and_clears_data() {
        let (mut p, s) = fake(Category::Gpu);
        p.start(0).unwrap();
        s.lock().unwrap().replies.push_back(Completion {
            id: 99,
            operation: Operation::Start,
            result: Ok(vec![]),
        });
        p.advance(1);
        assert_eq!(p.health.error, Some(Failure::InvalidPayload));
        let (mut p, s) = fake(Category::Storage);
        p.start(0).unwrap();
        reply(&s, Ok(vec![0; PAYLOAD_LIMIT + 1]));
        p.advance(1);
        assert_eq!(p.health.error, Some(Failure::InvalidPayload));
    }
    #[test]
    fn scheduler_uses_single_flight_at_one_second_intervals() {
        let (gpu, s) = fake(Category::Gpu);
        let mut diag = Diagnostic::default();
        diag.providers[0] = gpu;
        diag.enable(Category::Gpu, 0).unwrap();
        reply(&s, Ok(vec![]));
        diag.tick(1);
        reply(&s, Ok(b"mock".to_vec()));
        diag.tick(2);
        for time in 3..1002 {
            diag.tick(time);
        }
        assert_eq!(s.lock().unwrap().requests.len(), 2);
        diag.tick(1002);
        assert_eq!(s.lock().unwrap().requests.len(), 3);
        diag.disable(1003);
        assert!(diag.selected().is_none());
    }
    #[test]
    fn process_transport_times_out_and_reaps_only_a_mock_helper() {
        let Some(path) = option_env!("CORTEX_MOCK_HELPER") else {
            panic!("Run the mock-only test runner");
        };
        let mut p = Provider::new(
            Category::Gpu,
            Some(Box::new(IsolatedProcess::fixed_helper(
                Category::Gpu,
                PathBuf::from(path),
            ))),
        );
        let clock = std::time::Instant::now();
        p.start(0).unwrap();
        while p.health.status == Status::Starting && clock.elapsed().as_millis() < 3_000 {
            p.advance(clock.elapsed().as_millis() as u64);
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(p.health.status, Status::Ready);
        let began = clock.elapsed().as_millis() as u64;
        p.sample(began).unwrap();
        while p.health.status == Status::Sampling && clock.elapsed().as_millis() < 4_000 {
            p.advance(clock.elapsed().as_millis() as u64);
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(p.health.error, Some(Failure::Timeout));
        let reap_started = std::time::Instant::now();
        while !p.quiescent() && reap_started.elapsed().as_millis() < 3_000 {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(p.quiescent(), "Mock helper was not reaped");
        assert_eq!(p.start(began + 1000), Err(Failure::Blacklisted));
    }
    #[test]
    fn process_transport_handles_successful_stop_crash_and_oversized_mock_reply() {
        let path = option_env!("CORTEX_MOCK_HELPER").unwrap();
        for category in [Category::Storage, Category::Cpu, Category::Motherboard] {
            let mut p = Provider::new(
                category,
                Some(Box::new(IsolatedProcess::fixed_helper(
                    category,
                    PathBuf::from(path),
                ))),
            );
            let clock = std::time::Instant::now();
            p.start(0).unwrap();
            while p.health.status == Status::Starting && clock.elapsed().as_millis() < 3000 {
                p.advance(clock.elapsed().as_millis() as u64);
                thread::sleep(Duration::from_millis(5));
            }
            assert_eq!(p.health.status, Status::Ready);
            p.sample(clock.elapsed().as_millis() as u64).unwrap();
            while p.health.status == Status::Sampling && clock.elapsed().as_millis() < 4000 {
                p.advance(clock.elapsed().as_millis() as u64);
                thread::sleep(Duration::from_millis(5));
            }
            match category {
                Category::Storage => {
                    assert_eq!(p.payload.as_deref(), Some(b"mock-only".as_slice()));
                    p.stop(clock.elapsed().as_millis() as u64);
                }
                Category::Cpu => assert_eq!(p.health.error, Some(Failure::Crashed)),
                Category::Motherboard => assert_eq!(p.health.error, Some(Failure::InvalidPayload)),
                _ => unreachable!(),
            }
            let cleanup = std::time::Instant::now();
            while (p.health.status == Status::Stopping || !p.quiescent())
                && cleanup.elapsed().as_millis() < 3000
            {
                p.advance(clock.elapsed().as_millis() as u64);
                thread::sleep(Duration::from_millis(5));
            }
            assert!(p.quiescent());
            assert!(p.payload.is_none());
            if category == Category::Storage {
                assert_eq!(p.health.status, Status::Dormant);
            }
        }
    }
}
