//! Direct Windows thermal readings via WMI, CIMV2, and vendor utilities (nvidia-smi).
//! Reads CPU, GPU, Motherboard and Storage hardware temperatures and health directly
//! without requiring LibreHardwareMonitor or external manual setup.
//! All temperature values are Celsius. Missing sensors return None, never 0.

use serde::Serialize;

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DirectTemperatures {
    /// CPU thermal readings in Celsius.
    pub cpu: Vec<ThermalReading>,
    /// Discrete GPU thermal readings in Celsius.
    pub gpu: Vec<ThermalReading>,
    /// Motherboard and ACPI system thermal readings in Celsius.
    pub motherboard: Vec<ThermalReading>,
    /// Storage drives with SMART temperatures / health status.
    pub storage: Vec<StorageThermal>,
    /// Any unavailable subsystems (for diagnostics).
    pub unavailable: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalReading {
    /// Human-readable device or zone name.
    pub name: String,
    /// Celsius value, or None if the hardware reading is absent.
    pub celsius: Option<f64>,
    /// Subsystem or sensor details.
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageThermal {
    /// Drive model or friendly name.
    pub name: String,
    /// Windows disk number, for disambiguating duplicate model names (not a serial).
    pub disk_index: Option<u64>,
    /// Celsius temperature reported by SMART counter, if available.
    pub celsius: Option<f64>,
    /// Drive health status (e.g. "OK", "Healthy").
    pub status: String,
    /// Media type (e.g. "SSD", "Fixed Disk").
    pub media_type: Option<String>,
    /// Drive capacity in gigabytes.
    pub size_gb: Option<u64>,
}

/// Normalize local-only device serials for cross-provider identity comparison.
/// These values must never be sent to the renderer or written to diagnostics.
fn serial_key(value: &str) -> Option<String> {
    let serial: String = value
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|character| character.to_ascii_uppercase())
        .collect();
    (serial.len() >= 6 && serial.len() <= 128).then_some(serial)
}

/// Reject missing or ambiguous counter data instead of inferring a temperature.
fn unique_counter_temperature(device_id: &str, counters: &[(String, f64)]) -> Option<f64> {
    let readings: Vec<f64> = counters
        .iter()
        .filter(|(id, value)| {
            id.as_str() == device_id && value.is_finite() && (1.0..=120.0).contains(value)
        })
        .map(|(_, value)| *value)
        .collect();
    (readings.len() == 1).then(|| readings[0])
}

/// Link Windows disks by unique manufacturer serial, not by model. Two A400s
/// have the same model but different serials. The optional Windows disk number
/// provides an independent fallback, *only* when its serial agrees as well.
fn verified_storage_temperature(
    serial: Option<&str>,
    index: Option<u64>,
    disk_serials: &[Option<String>],
    physical_disks: &[(String, String)],
    windows_disks: &[(u64, String)],
    counters: &[(String, f64)],
) -> Option<f64> {
    let key = serial_key(serial?)?;
    if disk_serials
        .iter()
        .filter(|candidate| candidate.as_deref().and_then(serial_key) == Some(key.clone()))
        .count()
        != 1
    {
        return None;
    }

    let physical_matches: Vec<&str> = physical_disks
        .iter()
        .filter(|(_, candidate)| serial_key(candidate) == Some(key.clone()))
        .map(|(id, _)| id.as_str())
        .collect();
    if physical_matches.len() > 1 {
        return None;
    }
    if let Some(id) = physical_matches.first() {
        if physical_disks
            .iter()
            .filter(|(other, _)| other.as_str() == *id)
            .count() != 1 {
            return None;
        }
        if let Some(temperature) = unique_counter_temperature(id, counters) {
            return Some(temperature);
        }
    }

    // MSFT_StorageReliabilityCounter.DeviceId can instead refer to an
    // MSFT_Disk.Number. Confirm both Windows disk number AND serial, and
    // refuse a numerical ID claimed by another physical disk.
    let number = index?;
    if windows_disks
        .iter()
        .filter(|(other, candidate)| {
            *other == number && serial_key(candidate) == Some(key.clone())
        })
        .count()
        != 1
        || windows_disks
            .iter()
            .filter(|(other, _)| *other == number)
            .count()
            != 1
    {
        return None;
    }
    let id = number.to_string();
    if physical_disks
        .iter()
        .any(|(other, candidate)| other == &id && serial_key(candidate) != Some(key.clone()))
    {
        return None;
    }
    unique_counter_temperature(&id, counters)
}

#[cfg(all(windows, feature = "hardware-discovery"))]
pub fn read() -> DirectTemperatures {
    use std::collections::BTreeMap;
    use std::process::Command;
    use wmi::WMIConnection;

    type Row = BTreeMap<String, serde_json::Value>;

    let mut result = DirectTemperatures::default();

    // ── 1. Connect to standard ROOT\CIMV2 (accessible without elevation) ─────
    let cimv2 = WMIConnection::new().ok();

    // ── 2. CPU Model Name from Win32_Processor ──────────────────────────────
    let cpu_model = cimv2
        .as_ref()
        .and_then(|c| c.raw_query::<Row>("SELECT Name FROM Win32_Processor").ok())
        .and_then(|rows| {
            rows.into_iter().next().and_then(|r| {
                r.get("Name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
            })
        })
        .unwrap_or_else(|| "CPU".to_string());

    // ACPI thermal zones do not identify the CPU package. Windows WMI
    // exposes no portable CPU die temperature, so do not infer one from load.
    result.cpu.push(ThermalReading {
        name: cpu_model,
        celsius: None,
        detail: Some("CPU package temperature requires a verified hardware sensor".into()),
    });

    // ── 4. Motherboard (Win32_BaseBoard) ────────────────────────────────────
    let mobo_name = cimv2
        .as_ref()
        .and_then(|c| {
            c.raw_query::<Row>("SELECT Manufacturer, Product FROM Win32_BaseBoard")
                .ok()
        })
        .and_then(|rows| {
            rows.into_iter().next().map(|r| {
                let m = r
                    .get("Manufacturer")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                let p = r
                    .get("Product")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                if m.is_empty() && p.is_empty() {
                    "Motherboard".to_string()
                } else if m.is_empty() {
                    p.to_string()
                } else if p.is_empty() {
                    m.to_string()
                } else {
                    format!("{m} {p}")
                }
            })
        })
        .unwrap_or_else(|| "Motherboard".to_string());

    // Neither a generic ACPI zone nor CPU utilization identifies the board/VRM sensor.
    result.motherboard.push(ThermalReading {
        name: mobo_name,
        celsius: None,
        detail: Some("Motherboard temperature requires a verified board sensor".into()),
    });

    // ── 5. GPU: Query nvidia-smi directly ────────────────────────────────────
    let mut found_gpu = false;
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("nvidia-smi");
        cmd.args([
            "--query-gpu=name,temperature.gpu",
            "--format=csv,noheader,nounits",
        ]);
        cmd.creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        // nvidia-smi is an external process: an unresponsive driver/utility must not
        // block this worker forever. Fail closed and reap timed-out children.
        if let Ok(mut child) = cmd.spawn() {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if status.success() {
                            if let Ok(output) = child.wait_with_output() {
                                // Also bound output processing; this is a tiny GPU inventory.
                                if output.stdout.len() <= 16 * 1024 {
                                    let text = String::from_utf8_lossy(&output.stdout);
                                    for line in text.lines() {
                                        let parts: Vec<&str> =
                                            line.split(',').map(str::trim).collect();
                                        if parts.len() >= 2 {
                                            if let Ok(temp) = parts[1].parse::<f64>() {
                                                if temp.is_finite() && (1.0..=150.0).contains(&temp)
                                                {
                                                    result.gpu.push(ThermalReading {
                                                        name: parts[0].to_string(),
                                                        celsius: Some(temp),
                                                        detail: Some(
                                                            "NVIDIA GPU sensor (nvidia-smi)".into(),
                                                        ),
                                                    });
                                                    found_gpu = true;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }
                    Ok(None) if std::time::Instant::now() >= deadline => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    Ok(None) => std::thread::sleep(std::time::Duration::from_millis(25)),
                    Err(_) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                }
            }
        }
    }

    // Fallback: Query Win32_VideoController if nvidia-smi was not present
    if !found_gpu {
        if let Some(c) = cimv2.as_ref() {
            if let Ok(rows) = c.raw_query::<Row>("SELECT Name FROM Win32_VideoController") {
                for row in rows {
                    if let Some(name) = row.get("Name").and_then(|v| v.as_str()) {
                        let name = name.trim().to_string();
                        let lower = name.to_lowercase();
                        if !lower.contains("basic display")
                            && !lower.contains("remote")
                            && !lower.contains("virtual")
                        {
                            result.gpu.push(ThermalReading {
                                name,
                                celsius: None,
                                detail: Some("Integrated / Discrete Controller".to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    // ── 6. Storage (Win32_DiskDrive + SMART Counters) ────────────────────────
    let mut disks: Vec<(String, String, Option<u64>, String, Option<u64>, Option<String>)> =
        Vec::new();
    if let Some(c) = cimv2.as_ref() {
        if let Ok(rows) =
            c.raw_query::<Row>(
                "SELECT Model, Status, Size, MediaType, Index, SerialNumber FROM Win32_DiskDrive",
            )
        {
            for row in rows {
                let model = row
                    .get("Model")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Storage Drive")
                    .trim()
                    .to_string();
                let status = row
                    .get("Status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("OK")
                    .trim()
                    .to_string();
                let size = row
                    .get("Size")
                    .and_then(|v| v.as_u64())
                    .map(|bytes| bytes / (1024 * 1024 * 1024));
                let media = row
                    .get("MediaType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Fixed Disk")
                    .trim()
                    .to_string();
                let index = row.get("Index").and_then(|value| value.as_u64());
                let serial = row
                    .get("SerialNumber")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .map(str::to_string);
                disks.push((model, status, size, media, index, serial));
            }
        }
    }

    // Read-only Windows storage reliability counters and their documented
    // identity tables; avoid vendor executables, elevated privileges and drivers.
    let mut counters: Vec<(String, f64)> = Vec::new();
    let mut physical_disks: Vec<(String, String)> = Vec::new();
    let mut windows_disks: Vec<(u64, String)> = Vec::new();
    if let Ok(storage_ns) = WMIConnection::with_namespace_path("ROOT\\Microsoft\\Windows\\Storage")
    {
        if let Ok(rows) = storage_ns.raw_query::<Row>(
            "SELECT DeviceId, Temperature FROM MSFT_StorageReliabilityCounter",
        ) {
            for row in rows {
                let device_id = row.get("DeviceId").and_then(|value| value.as_str());
                let temperature = row
                    .get("Temperature")
                    .and_then(|value| value.as_u64())
                    .filter(|value| (1..=120).contains(value));
                if let (Some(device_id), Some(temperature)) = (device_id, temperature) {
                    counters.push((device_id.trim().to_string(), temperature as f64));
                }
            }
        }
        if let Ok(rows) = storage_ns
            .raw_query::<Row>("SELECT DeviceId, SerialNumber FROM MSFT_PhysicalDisk")
        {
            for row in rows {
                if let (Some(id), Some(serial)) = (
                    row.get("DeviceId").and_then(|value| value.as_str()),
                    row.get("SerialNumber").and_then(|value| value.as_str()),
                ) {
                    physical_disks.push((id.trim().to_string(), serial.to_string()));
                }
            }
        }
        if let Ok(rows) =
            storage_ns.raw_query::<Row>("SELECT Number, SerialNumber FROM MSFT_Disk")
        {
            for row in rows {
                if let (Some(number), Some(serial)) = (
                    row.get("Number").and_then(|value| value.as_u64()),
                    row.get("SerialNumber").and_then(|value| value.as_str()),
                ) {
                    windows_disks.push((number, serial.to_string()));
                }
            }
        }
    }

    let disk_serials: Vec<Option<String>> = disks
        .iter()
        .map(|(_, _, _, _, _, serial)| serial.clone())
        .collect();
    for (model, status, size_gb, media_type, disk_index, serial) in disks {
        let celsius = verified_storage_temperature(
            serial.as_deref(),
            disk_index,
            &disk_serials,
            &physical_disks,
            &windows_disks,
            &counters,
        );
        result.storage.push(StorageThermal {
            name: model,
            disk_index,
            celsius,
            status,
            media_type: Some(media_type),
            size_gb,
        });
    }

    result
}

/// Stub for Safe Mode / non-Windows builds.
#[cfg(not(all(windows, feature = "hardware-discovery")))]
pub fn read() -> DirectTemperatures {
    DirectTemperatures {
        unavailable: vec![
            "Direct thermal access requires Windows with hardware-discovery enabled".into(),
        ],
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_model_drives_are_matched_by_distinct_serials() {
        let disks = vec![Some("SERIAL-A1".into()), Some("SERIAL-B2".into())];
        let physical = vec![
            ("1".into(), "SERIAL-A1".into()),
            ("2".into(), "SERIAL-B2".into()),
        ];
        let counters = vec![("1".into(), 26.0), ("2".into(), 28.0)];
        assert_eq!(
            verified_storage_temperature(
                Some("SERIAL-A1"),
                Some(1),
                &disks,
                &physical,
                &[],
                &counters,
            ),
            Some(26.0)
        );
        assert_eq!(
            verified_storage_temperature(
                Some("SERIAL-B2"),
                Some(2),
                &disks,
                &physical,
                &[],
                &counters,
            ),
            Some(28.0)
        );
    }

    #[test]
    fn disk_number_fallback_must_confirm_serial() {
        let disks = vec![Some("NVME-SERIAL3".into())];
        let provider = vec![(3, "NVME-SERIAL3".into())];
        let counters = vec![("3".into(), 39.0)];
        assert_eq!(
            verified_storage_temperature(
                Some("NVME-SERIAL3"),
                Some(3),
                &disks,
                &[],
                &provider,
                &counters,
            ),
            Some(39.0)
        );
        assert_eq!(
            verified_storage_temperature(
                Some("WRONG-SERIAL"),
                Some(3),
                &disks,
                &[],
                &provider,
                &counters,
            ),
            None
        );
    }

    #[test]
    fn ambiguous_and_missing_storage_sensor_data_fail_closed() {
        let disks = vec![Some("SERIAL-A1".into()), Some("SERIAL-A1".into())];
        let physical = vec![("1".into(), "SERIAL-A1".into())];
        let counters = vec![("1".into(), 42.0)];
        assert_eq!(
            verified_storage_temperature(
                Some("SERIAL-A1"),
                Some(1),
                &disks,
                &physical,
                &[],
                &counters,
            ),
            None
        );
        let unique = vec![Some("SERIAL-A1".into())];
        assert_eq!(
            verified_storage_temperature(
                None,
                Some(1),
                &unique,
                &physical,
                &[],
                &counters,
            ),
            None
        );
        assert_eq!(
            verified_storage_temperature(
                Some("SERIAL-A1"),
                Some(1),
                &unique,
                &physical,
                &[],
                &[("1".into(), f64::NAN)],
            ),
            None
        );
        assert_eq!(
            verified_storage_temperature(
                Some("SERIAL-A1"),
                Some(1),
                &unique,
                &physical,
                &[],
                &[("1".into(), 40.0), ("1".into(), 45.0)],
            ),
            None
        );
    }
}
