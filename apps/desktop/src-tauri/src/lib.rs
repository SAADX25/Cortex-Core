mod build;
mod catalog;
#[cfg(debug_assertions)]
mod exit_diagnostics;
#[cfg(all(not(feature = "safe-mode"), feature = "hardware-discovery"))]
mod external_sensors;
#[cfg(any(feature = "safe-mode", not(feature = "hardware-discovery")))]
#[path = "external_sensors_disabled.rs"]
mod external_sensors;
#[cfg(all(not(feature = "safe-mode"), feature = "hardware-discovery"))]
mod hardware;
#[cfg(any(feature = "safe-mode", not(feature = "hardware-discovery")))]
#[path = "hardware_disabled.rs"]
mod hardware;
mod hardware_types;
mod safe_mode;
use serde::Serialize;
use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[tauri::command]
fn get_runtime_policy() -> safe_mode::Policy {
    safe_mode::policy()
}

#[tauri::command]
fn open_external_sensor_session(
    state: tauri::State<'_, std::sync::Arc<external_sensors::Adapter>>,
) -> Result<u64, String> {
    safe_mode::require_access()?;
    state.open_session()
}
#[tauri::command]
fn configure_external_sensors(
    consent: bool,
    owner: Option<u64>,
    revision: Option<u64>,
    state: tauri::State<'_, std::sync::Arc<external_sensors::Adapter>>,
) -> Result<u64, String> {
    if consent {
        safe_mode::require_access()?;
    }
    match (owner, revision) {
        (Some(owner), Some(revision)) => state.configure_owned(owner, revision, consent),
        (None, None) => state.configure(consent),
        _ => Err("Both sensor owner and revision are required".into()),
    }
}
#[tauri::command]
async fn read_external_sensors(
    session: u64,
    state: tauri::State<'_, std::sync::Arc<external_sensors::Adapter>>,
) -> Result<external_sensors::Snapshot, String> {
    safe_mode::require_access()?;
    let Some(ticket) = state.inner().ticket(session)? else {
        return Ok(state.snapshot(session));
    };
    tauri::async_runtime::spawn_blocking(move || ticket.complete())
        .await
        .map_err(|_| "Sensor worker unavailable".into())
}

struct DesktopState {
    hardware_path: PathBuf,
    hardware_lock: std::sync::Arc<Mutex<()>>,
    build_path: PathBuf,
    build_lock: Mutex<()>,
    snapshot: catalog::Snapshot,
    cache_status: String,
    log_dir: PathBuf,
    logged_failure: Mutex<bool>,
}
#[tauri::command]
async fn load_hardware_scan(
    state: tauri::State<'_, DesktopState>,
) -> Result<Option<hardware::Hardware>, String> {
    safe_mode::require_access()?;
    let path = state.hardware_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = rusqlite::Connection::open(path).map_err(|_| "Hardware cache unavailable")?;
        hardware::restore(&db)
    })
    .await
    .map_err(|_| "Hardware cache worker unavailable")?
}
#[tauri::command]
async fn scan_hardware(
    state: tauri::State<'_, DesktopState>,
) -> Result<hardware::Hardware, String> {
    safe_mode::require_access()?;
    let path = state.hardware_path.clone();
    let lock = state.hardware_lock.clone();
    let log = state.log_dir.join("hardware-support.log");
    tauri::async_runtime::spawn_blocking(move || {
        // Serialize native requests across webview reloads as well as ordinary rescans.
        let _guard = lock.lock().map_err(|_| "Hardware scan unavailable")?;
        let scan = hardware::scan();
        // Diagnostics contain only reviewed category codes, never raw provider values/errors.
        let codes = match &scan {
            Ok(s) => s.unavailable.join(", "),
            Err(_) => "scan-unavailable".into(),
        };
        let mut cache_failed = false;
        if let Ok(s) = &scan {
            cache_failed = rusqlite::Connection::open(path)
                .map_err(|_| "cache-unavailable".to_string())
                .and_then(|db| hardware::save(&db, s))
                .is_err();
        }
        let _ = fs::write(
            log,
            format!(
                "app={} unavailable={} cache={}\n",
                env!("CARGO_PKG_VERSION"),
                codes,
                if cache_failed { "unavailable" } else { "ok" }
            ),
        );
        scan
    })
    .await
    .map_err(|_| "Hardware scan worker unavailable")?
}
#[tauri::command]
fn load_development_build(
    state: tauri::State<DesktopState>,
) -> Result<Option<build::Build>, String> {
    let _lock = state
        .build_lock
        .lock()
        .map_err(|_| "Build storage unavailable")?;
    let mut db =
        rusqlite::Connection::open(&state.build_path).map_err(|_| "Cannot open build database")?;
    build::load(&mut db, &state.snapshot.parts)
}
#[tauri::command]
fn save_development_build(
    build: serde_json::Value,
    state: tauri::State<DesktopState>,
) -> Result<(), String> {
    let _lock = state
        .build_lock
        .lock()
        .map_err(|_| "Build storage unavailable")?;
    let mut db =
        rusqlite::Connection::open(&state.build_path).map_err(|_| "Cannot open build database")?;
    build::save(&mut db, build, &state.snapshot.parts)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    app_version: String,
    catalog_version: String,
    asset_manifest_version: u32,
    catalog_origin: String,
    cache_status: String,
    offline_ready: bool,
    asset_cache_bytes: u64,
    fullscreen: bool,
    scale_factor: f64,
    window_width: u32,
    window_height: u32,
    packaged: bool,
}
#[tauri::command]
fn load_catalog_snapshot(state: tauri::State<DesktopState>) -> catalog::Snapshot {
    state.snapshot.clone()
}
#[tauri::command]
fn desktop_status(
    window: tauri::WebviewWindow,
    state: tauri::State<DesktopState>,
) -> Result<DesktopStatus, String> {
    let size = window.inner_size().map_err(|_| "Window size unavailable")?;
    Ok(DesktopStatus {
        app_version: env!("CARGO_PKG_VERSION").into(),
        catalog_version: state.snapshot.catalog_version.clone(),
        asset_manifest_version: state.snapshot.asset_manifest_version,
        catalog_origin: state.snapshot.origin.clone(),
        cache_status: state.cache_status.clone(),
        offline_ready: true,
        asset_cache_bytes: 0,
        fullscreen: window.is_fullscreen().unwrap_or(false),
        scale_factor: window.scale_factor().unwrap_or(1.0),
        window_width: size.width,
        window_height: size.height,
        packaged: matches!(
            window
                .url()
                .map_err(|_| "Window URL unavailable")?
                .host_str(),
            Some("tauri.localhost")
        ) || window.url().map_err(|_| "Window URL unavailable")?.scheme() == "tauri",
    })
}
#[tauri::command]
fn set_viewer_fullscreen(window: tauri::WebviewWindow, enabled: bool) -> Result<bool, String> {
    window
        .set_fullscreen(enabled)
        .map_err(|_| "Fullscreen could not be changed")?;
    window.set_focus().map_err(|_| "Viewer focus unavailable")?;
    Ok(enabled)
}
#[tauri::command]
fn record_graphics_failure(code: &str, state: tauri::State<DesktopState>) -> Result<(), String> {
    if !["unsupported-webgl2", "context-lost", "renderer-load-failed"].contains(&code) {
        return Err("Unsupported diagnostic code".into());
    }
    let mut logged = state
        .logged_failure
        .lock()
        .map_err(|_| "Diagnostics unavailable")?;
    if *logged {
        return Ok(());
    }
    let path = state.log_dir.join("graphics-support.log");
    if fs::metadata(&path)
        .map(|m| m.len() > 65536)
        .unwrap_or(false)
    {
        fs::write(&path, b"").map_err(|_| "Cannot rotate support log")?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|_| "Cannot write support log")?;
    writeln!(
        file,
        "app={} platform={} graphics={} renderer=WebGL2",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        code
    )
    .map_err(|_| "Cannot write support log")?;
    *logged = true;
    Ok(())
}
#[tauri::command]
fn open_documentation(key: &str, app: tauri::AppHandle) -> Result<(), String> {
    let url = match key {
        "tauri" => "https://v2.tauri.app/",
        "hardware-sources" => "https://www.khronos.org/gltf/",
        "sensor-source" => "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases",
        _ => return Err("Unrecognized documentation key".into()),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Cannot open default browser".to_string())
}
pub fn run() {
    let flags = StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    let builder = if exit_diagnostics::enabled() {
        builder.plugin(exit_diagnostics::init())
    } else {
        builder
    };
    builder
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(flags)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Dormant state only: no networking inventory, HTTP or sensor access at startup.
            app.manage(std::sync::Arc::new(external_sensors::Adapter::default()));
            let config = app.path().app_config_dir()?;
            let data = app.path().app_local_data_dir()?.join("catalog");
            let cache = app.path().app_cache_dir()?;
            let log = app.path().app_log_dir()?;
            for directory in [
                &config,
                &data,
                &cache.join("assets"),
                &cache.join("temp"),
                &log,
            ] {
                fs::create_dir_all(directory)?;
            }
            let cached = rusqlite::Connection::open(data.join("catalog.sqlite3"))
                .map_err(|_| "Cannot open catalog cache".to_string())
                .and_then(|mut db| catalog::load(&mut db));
            let (snapshot, cache_status) = match cached {
                Ok(snapshot) => (snapshot, "local-snapshot".into()),
                Err(_) => (
                    catalog::parse_snapshot(catalog::BUNDLED)?,
                    "bundled-fallback".into(),
                ),
            };
            app.manage(DesktopState {
                hardware_path: app.path().app_local_data_dir()?.join("hardware.sqlite3"),
                hardware_lock: std::sync::Arc::new(Mutex::new(())),
                build_path: app
                    .path()
                    .app_local_data_dir()?
                    .join("development-build.sqlite3"),
                build_lock: Mutex::new(()),
                snapshot,
                cache_status,
                log_dir: log,
                logged_failure: Mutex::new(false),
            });
            let sensor_lifecycle = app.handle().clone();
            let window =
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .on_navigation(move |url| {
                        if let Some(adapter) = sensor_lifecycle
                            .try_state::<std::sync::Arc<external_sensors::Adapter>>()
                        {
                            let _ = adapter.revoke_all();
                        }
                        if cfg!(debug_assertions)
                            && url.host_str() == Some("127.0.0.1")
                            && url.port() == Some(5173)
                        {
                            return true;
                        }
                        url.scheme() == "tauri"
                            || (url.host_str() == Some("tauri.localhost")
                                && ["http", "https"].contains(&url.scheme()))
                    })
                    .build()?;
            // Restore is performed by the plugin on creation; recover a disconnected-monitor position.
            if let (Ok(position), Ok(monitors)) =
                (window.outer_position(), window.available_monitors())
            {
                let reachable = monitors.iter().any(|m| {
                    let p = m.position();
                    let s = m.size();
                    position.x + 100 > p.x
                        && position.y + 50 > p.y
                        && position.x < p.x + s.width as i32
                        && position.y < p.y + s.height as i32
                });
                if !reachable {
                    window.center()?;
                }
            }
            window.show()?;
            Ok(())
        })
        .on_window_event(move |window, event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. }
                    | tauri::WindowEvent::Destroyed
                    | tauri::WindowEvent::Focused(false)
            ) {
                if let Some(adapter) = window
                    .app_handle()
                    .try_state::<std::sync::Arc<external_sensors::Adapter>>()
                {
                    let _ = adapter.revoke_all();
                }
            }
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                // Persist normal/maximized geometry, never an accidental fullscreen launch state.
                let _ = window.set_fullscreen(false);
                let _ = window.app_handle().save_window_state(flags);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_policy,
            scan_hardware,
            load_hardware_scan,
            load_catalog_snapshot,
            desktop_status,
            set_viewer_fullscreen,
            record_graphics_failure,
            open_documentation,
            load_development_build,
            save_development_build,
            configure_external_sensors,
            open_external_sensor_session,
            read_external_sensors
        ])
        .run(tauri::generate_context!())
        .expect("Cortex Core desktop runtime could not start");
}
