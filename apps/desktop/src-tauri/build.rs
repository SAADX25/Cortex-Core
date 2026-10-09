fn main() {
    let _ = std::fs::create_dir_all("../../web/dist");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_runtime_policy",
            "scan_hardware",
            "load_hardware_scan",
            "load_catalog_snapshot",
            "desktop_status",
            "set_viewer_fullscreen",
            "record_graphics_failure",
            "open_documentation",
            "load_development_build",
            "save_development_build",
            "configure_external_sensors",
            "open_external_sensor_session",
            "read_external_sensors",
        ]),
    ))
    .expect("Tauri build configuration is invalid");
}
