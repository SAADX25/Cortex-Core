//! Independently authored read-only HTTP adapter. No hardware libraries or probing.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(test)]
const ENDPOINT: &str = "http://127.0.0.1:8085/data.json";
const ADDRESS: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8085);
const REQUEST: &[u8] = b"GET /data.json HTTP/1.1\r\nHost: 127.0.0.1:8085\r\nAccept: application/json\r\nAccept-Encoding: identity\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
const MAX_BODY: usize = 512 * 1024;
const DEADLINE: Duration = Duration::from_millis(1500);
const INTERVAL: Duration = Duration::from_secs(5);
pub const STALE_MS: u64 = 15_000;

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Cpu,
    Gpu,
    Motherboard,
    Storage,
    Memory,
    Unsupported,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Availability {
    Available,
    Missing,
    Unsupported,
    Ambiguous,
    Stale,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sensor {
    pub hardware_id: String,
    pub hardware_name: String,
    pub category: Category,
    pub sensor_id: String,
    pub sensor_name: String,
    pub kind: &'static str,
    pub unit: &'static str,
    pub value: Option<f64>,
    pub observed_at: u64,
    // data.json has no measurement timestamp; never invent one.
    pub measured_at: Option<u64>,
    pub availability: Availability,
    // Inventory contains no cross-provider identity. No name/index matching.
    pub device_match: &'static str,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema_version: u32,
    pub source: &'static str,
    pub status: String,
    pub observed_at: Option<u64>,
    pub stale_after_ms: u64,
    pub sensors: Vec<Sensor>,
}
impl Snapshot {
    pub fn unavailable(reason: &str) -> Self {
        Self {
            schema_version: 1,
            source: "librehardwaremonitor",
            status: reason.into(),
            observed_at: None,
            stale_after_ms: STALE_MS,
            sensors: vec![],
        }
    }
}

// Typed wire tree for the reviewed 0.9.5/0.9.6 contract. Unknown fields fail closed.
#[derive(Deserialize)]
#[serde(untagged)]
enum RawValue {
    Number(f64),
    Text(String),
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Node {
    id: u32,
    #[serde(rename = "Text")]
    text: String,
    #[serde(rename = "Min")]
    min: String,
    #[serde(rename = "Value")]
    value: String,
    #[serde(rename = "Max")]
    max: String,
    #[serde(rename = "ImageURL")]
    image_url: String,
    #[serde(rename = "Children")]
    children: Vec<Node>,
    #[serde(rename = "Version")]
    version: Option<String>,
    #[serde(rename = "HardwareId")]
    hardware_id: Option<String>,
    #[serde(rename = "SensorId")]
    sensor_id: Option<String>,
    #[serde(rename = "Type")]
    sensor_type: Option<String>,
    #[serde(rename = "RawValue")]
    raw_value: Option<RawValue>,
    #[serde(rename = "RawMin")]
    raw_min: Option<RawValue>,
    #[serde(rename = "RawMax")]
    raw_max: Option<RawValue>,
}
fn text_ok(value: &str, max: usize) -> bool {
    value.len() <= max && !value.chars().any(char::is_control)
}
fn identity_ok(value: &str) -> bool {
    value.starts_with('/')
        && value.len() <= 256
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/_-.".contains(&b))
        && !value.contains("..")
        && !value.contains("//")
}
fn category(id: &str, parent: Category) -> Category {
    match id.split('/').nth(1).unwrap_or("") {
        "intelcpu" | "amdcpu" => Category::Cpu,
        "gpu-nvidia" | "gpu-amd" | "gpu-intel" => Category::Gpu,
        "motherboard" => Category::Motherboard,
        "lpc" if parent == Category::Motherboard => Category::Motherboard,
        "hdd" | "ssd" | "nvme" | "storage" => Category::Storage,
        "ram" | "memory" => Category::Memory,
        _ => Category::Unsupported,
    }
}
fn temperature(raw: Option<&RawValue>) -> Result<Option<f64>, &'static str> {
    let number = match raw {
        None => return Ok(None),
        Some(RawValue::Number(n)) => *n,
        Some(RawValue::Text(s)) => {
            let s = s.trim();
            if ["", "NaN", "Infinity", "-Infinity"].contains(&s) {
                return Ok(None);
            }
            let (n, fahrenheit) = if let Some(n) = s.strip_suffix("°C") {
                (n.trim(), false)
            } else if let Some(n) = s.strip_suffix("°F") {
                (n.trim(), true)
            } else {
                return Err("Temperature unit is unsupported");
            };
            // Released exporters format null/nonfinite values with the unit suffix.
            if ["", "NaN", "Infinity", "-Infinity"].contains(&n) {
                return Ok(None);
            }
            // A single locale decimal separator is accepted; no thousands/exponents.
            let unsigned = n
                .strip_prefix('-')
                .or_else(|| n.strip_prefix('+'))
                .unwrap_or(n);
            if unsigned.is_empty()
                || unsigned
                    .bytes()
                    .any(|b| !b.is_ascii_digit() && b != b'.' && b != b',')
                || unsigned.matches(['.', ',']).count() > 1
                || !unsigned.bytes().any(|b| b.is_ascii_digit())
            {
                return Err("Malformed temperature");
            }
            let n: f64 = n
                .replace(',', ".")
                .parse()
                .map_err(|_| "Malformed temperature")?;
            if fahrenheit {
                (n - 32.0) * 5.0 / 9.0
            } else {
                n
            }
        }
    };
    Ok((number.is_finite() && (-100.0..=200.0).contains(&number)).then_some(number))
}
pub fn parse_json(bytes: &[u8], now: u64) -> Result<Snapshot, &'static str> {
    if bytes.len() > MAX_BODY || now == 0 {
        return Err("Sensor response exceeds limits");
    }
    let root: Node =
        serde_json::from_slice(bytes).map_err(|_| "Unsupported or malformed sensor JSON")?;
    if !matches!(root.version.as_deref(), Some("0.9.5" | "0.9.6"))
        || root.hardware_id.is_some()
        || root.sensor_id.is_some()
    {
        return Err("LibreHardwareMonitor schema/version has not been reviewed");
    }
    let mut sensors = vec![];
    let mut ids = HashSet::new();
    let mut hardware_ids = HashSet::new();
    fn walk(
        node: &Node,
        parent: Option<(&str, &str, Category)>,
        depth: usize,
        ids: &mut HashSet<u32>,
        hardware_ids: &mut HashSet<String>,
        sensors: &mut Vec<Sensor>,
        now: u64,
    ) -> Result<(), &'static str> {
        if depth > 16
            || ids.len() >= 4096
            || !ids.insert(node.id)
            || node.children.len() > 1024
            || !text_ok(&node.text, 256)
            || [&node.min, &node.value, &node.max, &node.image_url]
                .iter()
                .any(|s| !text_ok(s, 256))
            || (depth > 0 && node.version.is_some())
        {
            return Err("Sensor tree exceeds schema limits");
        }
        for raw in [&node.raw_min, &node.raw_max, &node.raw_value]
            .into_iter()
            .flatten()
        {
            if let RawValue::Text(s) = raw {
                if !text_ok(s, 128) {
                    return Err("Malformed raw sensor value");
                }
            }
        }
        let mut owner = parent;
        if let Some(id) = &node.hardware_id {
            if !identity_ok(id)
                || node.sensor_id.is_some()
                || node.sensor_type.is_some()
                || node.raw_value.is_some()
                || !hardware_ids.insert(id.clone())
            {
                return Err("Ambiguous hardware identity");
            }
            owner = Some((
                id,
                &node.text,
                category(id, parent.map_or(Category::Unsupported, |p| p.2)),
            ));
        }
        if let Some(id) = &node.sensor_id {
            let (hardware_id, hardware_name, category) =
                owner.ok_or("Sensor has no hardware identity")?;
            if !identity_ok(id)
                || !id.starts_with(&format!("{hardware_id}/"))
                || !node.children.is_empty()
            {
                return Err("Invalid sensor identity");
            }
            let sensor_type = node.sensor_type.as_deref().ok_or("Sensor has no type")?;
            if !text_ok(sensor_type, 64) {
                return Err("Invalid sensor type");
            }
            if sensor_type == "Temperature" {
                if !id.starts_with(&format!("{hardware_id}/temperature/")) {
                    return Err("Conflicting sensor type");
                }
                let value = temperature(node.raw_value.as_ref())?;
                // In 0.9.6 DIMM indices 1+ are static resolution/limits, not readings.
                let availability = if category == Category::Unsupported
                    || (hardware_id.starts_with("/memory/dimm/")
                        && id != &format!("{hardware_id}/temperature/0"))
                {
                    Availability::Unsupported
                } else if value.is_none() {
                    Availability::Missing
                } else {
                    Availability::Available
                };
                sensors.push(Sensor {
                    hardware_id: hardware_id.into(),
                    hardware_name: hardware_name.into(),
                    category,
                    sensor_id: id.clone(),
                    sensor_name: node.text.clone(),
                    kind: "temperature",
                    unit: "celsius",
                    value: if availability == Availability::Available {
                        value
                    } else {
                        None
                    },
                    observed_at: now,
                    measured_at: None,
                    availability,
                    device_match: "unmatched",
                });
            }
        } else if node.sensor_type.is_some()
            || node.raw_value.is_some()
            || node.raw_min.is_some()
            || node.raw_max.is_some()
        {
            return Err("Sensor fields on a grouping node");
        }
        for child in &node.children {
            walk(child, owner, depth + 1, ids, hardware_ids, sensors, now)?;
        }
        Ok(())
    }
    walk(
        &root,
        None,
        0,
        &mut ids,
        &mut hardware_ids,
        &mut sensors,
        now,
    )?;
    let mut seen = HashSet::new();
    let duplicate: HashSet<_> = sensors
        .iter()
        .filter_map(|s| (!seen.insert(s.sensor_id.clone())).then_some(s.sensor_id.clone()))
        .collect();
    for s in &mut sensors {
        if duplicate.contains(&s.sensor_id) {
            s.availability = Availability::Ambiguous;
            s.value = None;
        }
    }
    Ok(Snapshot {
        schema_version: 1,
        source: "librehardwaremonitor",
        status: "connected".into(),
        observed_at: Some(now),
        stale_after_ms: STALE_MS,
        sensors,
    })
}

#[derive(Clone, Debug, PartialEq)]
struct Listener {
    address: IpAddr,
    port: u16,
    owner: u32,
}
fn validate_listeners(listeners: &[Listener]) -> Result<u32, &'static str> {
    let matching: Vec<_> = listeners.iter().filter(|l| l.port == 8085).collect();
    let target = matching
        .iter()
        .find(|l| l.address == IpAddr::V4(Ipv4Addr::LOCALHOST))
        .ok_or("Cannot establish a loopback-only listener at port 8085")?;
    // HTTP.sys PID 4 multiplexes services; a TCP binding cannot prove URL isolation.
    if target.owner <= 4
        || matching
            .iter()
            .any(|l| !l.address.is_loopback() || l.owner != target.owner)
        || listeners
            .iter()
            .any(|l| l.owner == target.owner && !l.address.is_loopback())
    {
        return Err(
            "Server local-only access cannot be verified; wildcard, remote or shared HTTP.sys listeners are refused",
        );
    }
    Ok(target.owner)
}
#[cfg(all(windows, not(test)))]
fn listeners() -> Result<Vec<Listener>, &'static str> {
    // Documented networking inventory only. No shell, WMI, driver or hardware calls.
    #[link(name = "iphlpapi")]
    unsafe extern "system" {
        fn GetExtendedTcpTable(
            table: *mut std::ffi::c_void,
            size: *mut u32,
            order: i32,
            family: u32,
            class: u32,
            reserved: u32,
        ) -> u32;
    }
    let mut result = vec![];
    for (family, row_size) in [(2, 24usize), (23, 56usize)] {
        let mut size = 0;
        let code = unsafe { GetExtendedTcpTable(std::ptr::null_mut(), &mut size, 0, family, 3, 0) }; // OWNER_PID_LISTENER
        if code != 122 || !(4..=1_048_576).contains(&size) {
            return Err("Cannot verify local server bindings");
        }
        let mut bytes = vec![0u32; (size as usize).div_ceil(4)]; // DWORD alignment
        let capacity = bytes.len() * 4;
        let code =
            unsafe { GetExtendedTcpTable(bytes.as_mut_ptr().cast(), &mut size, 0, family, 3, 0) };
        if code != 0 || size as usize > capacity || size < 4 {
            return Err("Cannot verify local server bindings");
        }
        let bytes =
            unsafe { std::slice::from_raw_parts(bytes.as_ptr().cast::<u8>(), size as usize) };
        let u32_at = |offset| u32::from_ne_bytes(bytes[offset..offset + 4].try_into().unwrap());
        let count = u32_at(0) as usize;
        if count > (bytes.len() - 4) / row_size {
            return Err("Invalid local binding inventory");
        }
        for i in 0..count {
            let base = 4 + i * row_size;
            let (address, port_offset, owner_offset) = if family == 2 {
                (
                    IpAddr::V4(Ipv4Addr::from(
                        <[u8; 4]>::try_from(&bytes[base + 4..base + 8]).unwrap(),
                    )),
                    8,
                    20,
                )
            } else {
                (
                    IpAddr::V6(std::net::Ipv6Addr::from(
                        <[u8; 16]>::try_from(&bytes[base..base + 16]).unwrap(),
                    )),
                    20,
                    52,
                )
            };
            let port =
                u16::from_be_bytes([bytes[base + port_offset], bytes[base + port_offset + 1]]);
            result.push(Listener {
                address,
                port,
                owner: u32_at(base + owner_offset),
            });
        }
    }
    Ok(result)
}
#[cfg(all(not(windows), not(test)))]
fn listeners() -> Result<Vec<Listener>, &'static str> {
    Err("Local-only verification requires Windows")
}
#[cfg(test)]
fn listeners() -> Result<Vec<Listener>, &'static str> {
    Err("Test builds cannot inspect listeners or connect a real sensor source")
}

// HTTP deliberately supports only the server's fixed Content-Length JSON response.
// No URL parser, proxy, DNS, redirect, cookie, credential or compression machinery.
fn response_body(response: &[u8]) -> Result<&[u8], &'static str> {
    let end = response
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("Malformed HTTP response")?;
    if end > 8192 {
        return Err("HTTP headers exceed limits");
    }
    let header = std::str::from_utf8(&response[..end]).map_err(|_| "Invalid HTTP headers")?;
    let mut lines = header.split("\r\n");
    let status = lines.next().unwrap_or("");
    if !["HTTP/1.1 200", "HTTP/1.0 200"]
        .iter()
        .any(|prefix| status == *prefix || status.starts_with(&format!("{prefix} ")))
    {
        return Err("Server unavailable, authentication required or redirect refused");
    }
    let mut length = None;
    let mut json = false;
    for line in lines {
        let (name, value) = line.split_once(':').ok_or("Malformed HTTP header")?;
        let value = value.trim();
        match name.to_ascii_lowercase().as_str() {
            "content-length" => {
                if length.is_some() || !value.bytes().all(|b| b.is_ascii_digit()) {
                    return Err("Invalid HTTP framing");
                }
                length = Some(value.parse::<usize>().map_err(|_| "Invalid HTTP length")?);
            }
            "content-type" => {
                if json || value.split(';').next().unwrap_or("").trim() != "application/json" {
                    return Err("Expected JSON response");
                }
                json = true;
            }
            "transfer-encoding" | "content-encoding" => {
                return Err("Encoded HTTP responses are unsupported");
            }
            _ => {}
        }
    }
    let body = &response[end + 4..];
    if !json || length != Some(body.len()) || body.len() > MAX_BODY {
        return Err("Truncated or oversized JSON response");
    }
    Ok(body)
}

struct Session {
    generation: u64,
    enabled: bool,
    busy: bool,
    next_due: Instant,
    snapshot: Snapshot,
    received: Option<Instant>,
    socket: Option<TcpStream>,
}
pub struct Adapter {
    session: Mutex<Session>,
}
impl Default for Adapter {
    fn default() -> Self {
        Self {
            session: Mutex::new(Session {
                generation: 0,
                enabled: false,
                busy: false,
                next_due: Instant::now(),
                snapshot: Snapshot::unavailable("disabled"),
                received: None,
                socket: None,
            }),
        }
    }
}
impl Adapter {
    // Consent is session-only. Startup/restart/reload never restores it.
    pub fn configure(&self, consent: bool) -> Result<u64, String> {
        let mut s = self
            .session
            .lock()
            .map_err(|_| "Sensor state unavailable")?;
        s.generation = s
            .generation
            .checked_add(1)
            .ok_or("Sensor session exhausted")?;
        s.enabled = consent;
        s.snapshot = Snapshot::unavailable(if consent { "waiting" } else { "disabled" });
        s.received = None;
        if let Some(socket) = s.socket.take() {
            let _ = socket.shutdown(std::net::Shutdown::Both);
        }
        // Retain busy and next_due across toggles: no parallel/replacement workers.
        Ok(s.generation)
    }
    fn reserve(&self, generation: u64) -> Result<bool, String> {
        let mut s = self
            .session
            .lock()
            .map_err(|_| "Sensor state unavailable")?;
        if !s.enabled || generation != s.generation {
            return Ok(false);
        }
        if s.busy || Instant::now() < s.next_due {
            return Ok(false);
        }
        s.busy = true;
        Ok(true)
    }
    pub fn snapshot(&self, generation: u64) -> Snapshot {
        let Ok(s) = self.session.lock() else {
            return Snapshot::unavailable("Sensor state unavailable");
        };
        if generation != s.generation || !s.enabled {
            return Snapshot::unavailable("disabled");
        }
        let mut snapshot = s.snapshot.clone();
        if s.received
            .is_some_and(|t| t.elapsed().as_millis() > STALE_MS as u128)
        {
            snapshot.status = "stale".into();
            for sensor in &mut snapshot.sensors {
                sensor.value = None;
                sensor.availability = Availability::Stale;
            }
        }
        snapshot
    }
    fn fetch(&self, generation: u64) -> Result<Snapshot, &'static str> {
        let deadline = Instant::now() + DEADLINE;
        let owner = validate_listeners(&listeners()?)?; // Before any network request.
        let remaining = || {
            deadline
                .checked_duration_since(Instant::now())
                .filter(|d| !d.is_zero())
                .ok_or("Sensor request timed out")
        };
        let mut socket = TcpStream::connect_timeout(&ADDRESS, remaining()?)
            .map_err(|_| "LibreHardwareMonitor is unavailable")?;
        {
            let mut s = self
                .session
                .lock()
                .map_err(|_| "Sensor state unavailable")?;
            if !s.enabled || s.generation != generation {
                return Err("disabled");
            }
            s.socket = Some(
                socket
                    .try_clone()
                    .map_err(|_| "Sensor connection unavailable")?,
            );
        }
        if validate_listeners(&listeners()?)? != owner {
            return Err("Server bindings changed; connection refused");
        }
        socket
            .set_write_timeout(Some(remaining()?))
            .map_err(|_| "Sensor timeout unavailable")?;
        socket
            .write_all(REQUEST)
            .map_err(|_| "Sensor request failed")?;
        let mut response = Vec::new();
        loop {
            socket
                .set_read_timeout(Some(remaining()?))
                .map_err(|_| "Sensor timeout unavailable")?;
            let mut chunk = [0u8; 8192];
            let n = socket
                .read(&mut chunk)
                .map_err(|_| "Sensor server stopped or request timed out")?;
            if n == 0 {
                break;
            }
            if response.len() + n > MAX_BODY + 8196 {
                return Err("Sensor response exceeds limits");
            }
            response.extend_from_slice(&chunk[..n]);
        }
        remaining()?;
        if validate_listeners(&listeners()?)? != owner {
            return Err("Server bindings changed; data discarded");
        }
        remaining()?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "System time unavailable")?
            .as_millis() as u64;
        parse_json(response_body(&response)?, now)
    }
    // Caller reserves synchronously, then dispatches ONE blocking worker off UI thread.
    pub fn begin(&self, generation: u64) -> Result<bool, String> {
        self.reserve(generation)
    }
    pub fn complete(&self, generation: u64) -> Snapshot {
        let result = self.fetch(generation);
        self.finish(generation, result)
    }
    fn finish(&self, generation: u64, result: Result<Snapshot, &'static str>) -> Snapshot {
        if let Ok(mut s) = self.session.lock() {
            s.busy = false;
            s.socket = None;
            s.next_due = Instant::now() + INTERVAL;
            if s.enabled && s.generation == generation {
                s.received = result.as_ref().ok().map(|_| Instant::now());
                s.snapshot = result.unwrap_or_else(Snapshot::unavailable);
            }
        }
        self.snapshot(generation)
    }
}

#[cfg(test)]
#[path = "external_sensors_tests.rs"]
mod tests;
