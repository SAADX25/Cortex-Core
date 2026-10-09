//! Opt-in debug lifecycle evidence. No sensor calls, workers, timers, IPC commands or exit vetoes.
use serde_json::{Value, json};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    sync::{Mutex, OnceLock},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    RunEvent, Runtime, WindowEvent,
    plugin::{Builder, TauriPlugin},
};

struct Trace {
    file: File,
    began: Instant,
    records: usize,
}
static TRACE: OnceLock<Option<Mutex<Trace>>> = OnceLock::new();

pub fn enabled() -> bool {
    TRACE
        .get_or_init(|| {
            let path = std::env::var_os("CORTEX_LIFECYCLE_LOG")?;
            let file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path)
                .ok()?;
            Some(Mutex::new(Trace {
                file,
                began: Instant::now(),
                records: 0,
            }))
        })
        .is_some()
}

fn record(event: &str, details: Value) {
    let Some(Some(trace)) = TRACE.get() else {
        return;
    };
    let Ok(mut trace) = trace.lock() else { return };
    if trace.records >= 1024 {
        return;
    }
    trace.records += 1;
    let row = json!({
        "event": event, "details": details, "pid": std::process::id(),
        "elapsedMs": trace.began.elapsed().as_millis(),
        "unixMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
    });
    let _ = writeln!(trace.file, "{row}");
    let _ = trace.file.flush();
    // A departed observer/broken stderr pipe must never panic or change app lifetime.
    let _ = writeln!(std::io::stderr(), "CORTEX_LIFECYCLE {row}");
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    record(
        "trace-enabled",
        json!({"monitoring": "absent", "stderrWriteErrors": "ignored"}),
    );
    let prior = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record("rust-panic", json!({"message": info.to_string()}));
        prior(info);
    }));
    Builder::new("exit-diagnostics")
        .setup(|_, _| {
            record("application-setup", json!({}));
            Ok(())
        })
        .on_window_ready(|window| record("window-ready", json!({"label": window.label()})))
        .on_webview_ready(|webview| {
            record("webview-ready", json!({"label": webview.label()}));
            #[cfg(windows)]
            if let Err(error) = webview.with_webview(attach_webview_events) {
                record("webview-hooks-error", json!({"error": error.to_string()}));
            }
        })
        .on_event(|_, event| match event {
            RunEvent::Ready => record("application-ready", json!({})),
            RunEvent::Resumed => record("application-resumed", json!({})),
            RunEvent::ExitRequested { code, .. } => {
                record("application-exit-requested", json!({"code": code}))
            }
            RunEvent::Exit => record("application-exit", json!({})),
            RunEvent::WindowEvent { label, event, .. } => match event {
                WindowEvent::CloseRequested { .. } => {
                    record("window-close-requested", json!({"label": label}))
                }
                WindowEvent::Destroyed => record("window-destroyed", json!({"label": label})),
                WindowEvent::Focused(focused) => {
                    record("window-focus", json!({"label": label, "focused": focused}))
                }
                _ => {}
            },
            _ => {}
        })
        .on_drop(|_| record("plugin-dropped", json!({})))
        .build()
}

#[cfg(windows)]
fn attach_webview_events(webview: tauri::webview::PlatformWebview) {
    use webview2_com::{
        BrowserProcessExitedEventHandler, Microsoft::Web::WebView2::Win32::*,
        ProcessFailedEventHandler,
    };
    use windows::core::Interface;
    // These subscriptions observe the already-created WebView; they do not create a process.
    let result = (|| -> windows::core::Result<()> {
        unsafe {
            let core = webview.controller().CoreWebView2()?;
            let failed = ProcessFailedEventHandler::create(Box::new(|_, args| {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(0);
                let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON(0);
                let mut code = 0;
                let mut extended = false;
                let mut errors = Vec::new();
                let arguments_present = args.is_some();
                if let Some(args) = args {
                    if let Err(error) = args.ProcessFailedKind(&mut kind) {
                        errors.push(error.to_string());
                    }
                    if let Ok(args) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                        if let Err(error) = args.Reason(&mut reason) {
                            errors.push(error.to_string());
                        }
                        if let Err(error) = args.ExitCode(&mut code) {
                            errors.push(error.to_string());
                        }
                        extended = true;
                    }
                }
                record(
                    "webview-process-failed",
                    json!({"kind": kind.0, "reason": reason.0, "exitCode": code, "extendedDetails": extended, "argumentsPresent": arguments_present, "metadataErrors": errors}),
                );
                Ok(())
            }));
            let mut token = 0;
            core.add_ProcessFailed(&failed, &mut token)?;
            let environment = webview.environment().cast::<ICoreWebView2Environment5>()?;
            let exited = BrowserProcessExitedEventHandler::create(Box::new(|_, args| {
                let mut kind = COREWEBVIEW2_BROWSER_PROCESS_EXIT_KIND(0);
                let mut pid = 0;
                let mut errors = Vec::new();
                let arguments_present = args.is_some();
                if let Some(args) = args {
                    if let Err(error) = args.BrowserProcessExitKind(&mut kind) {
                        errors.push(error.to_string());
                    }
                    if let Err(error) = args.BrowserProcessId(&mut pid) {
                        errors.push(error.to_string());
                    }
                }
                record(
                    "webview-browser-process-exited",
                    json!({"kind": kind.0, "browserPid": pid, "argumentsPresent": arguments_present, "metadataErrors": errors}),
                );
                Ok(())
            }));
            environment.add_BrowserProcessExited(&exited, &mut token)?;
            let mut browser_pid = 0;
            core.BrowserProcessId(&mut browser_pid)?;
            record(
                "webview-process-hooks-attached",
                json!({"browserPid": browser_pid}),
            );
        }
        Ok(())
    })();
    if let Err(error) = result {
        record("webview-hooks-error", json!({"error": error.to_string()}));
    }
}
