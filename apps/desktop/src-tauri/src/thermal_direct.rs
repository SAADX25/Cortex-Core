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
    /// Celsius temperature reported by SMART counter, if available.
    pub celsius: Option<f64>,
    /// Drive health status (e.g. "OK", "Healthy").
    pub status: String,
    /// Media type (e.g. "SSD", "Fixed Disk").
    pub media_type: Option<String>,
    /// Drive capacity in gigabytes.
    pub size_gb: Option<u64>,
}

/// Only accept a physically reported storage temperature where both inventories
/// identify exactly one drive with the same model name. Never manufacture a value.
fn unique_storage_temperature(
    model: &str,
    disk_models: &[String],
    smart_temps: &[(String, f64)],
) -> Option<f64> {
    let matches_disk = disk_models
        .iter()
        .filter(|name| name.trim().eq_ignore_ascii_case(model.trim()))
        .count();
    if matches_disk != 1 {
        return None;
    }
    let readings: Vec<f64> = smart_temps
        .iter()
        .filter(|(name, temp)| {
            name.trim().eq_ignore_ascii_case(model.trim())
                && temp.is_finite()
                && (1.0..=120.0).contains(temp)
        })
        .map(|(_, temp)| *temp)
        .collect();
    (readings.len() == 1).then(|| readings[0])
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
    let mut disks: Vec<(String, String, Option<u64>, String)> = Vec::new();
    if let Some(c) = cimv2.as_ref() {
        if let Ok(rows) =
            c.raw_query::<Row>("SELECT Model, Status, Size, MediaType FROM Win32_DiskDrive")
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
                disks.push((model, status, size, media));
            }
        }
    }

    // Optional SMART temperatures via ROOT\Microsoft\Windows\Storage
    let mut smart_temps: Vec<(String, f64)> = Vec::new();
    if let Ok(storage_ns) = WMIConnection::with_namespace_path("ROOT\\Microsoft\\Windows\\Storage")
    {
        if let Ok(counters) = storage_ns
            .raw_query::<Row>("SELECT DeviceId, Temperature FROM MSFT_StorageReliabilityCounter")
        {
            let physical_disks: Vec<Row> = storage_ns
                .raw_query::<Row>("SELECT DeviceId, FriendlyName FROM MSFT_PhysicalDisk")
                .unwrap_or_default();
            for counter in counters {
                let dev_id = counter
                    .get("DeviceId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let temp = counter
                    .get("Temperature")
                    .and_then(|v| v.as_u64())
                    .filter(|t| *t > 0 && *t <= 120);
                if let Some(celsius) = temp {
                    let friendly = physical_disks
                        .iter()
                        .find(|d| d.get("DeviceId").and_then(|v| v.as_str()) == Some(dev_id))
                        .and_then(|d| d.get("FriendlyName").and_then(|v| v.as_str()))
                        .unwrap_or(dev_id);
                    smart_temps.push((friendly.to_string(), celsius as f64));
                }
            }
        }
    }

    let disk_models: Vec<String> = disks.iter().map(|(model, _, _, _)| model.clone()).collect();
    for (model, status, size_gb, media_type) in disks {
        // Exact, unique name match only. Duplicate models or missing SMART data
        // remain unavailable; ACPI offsets are not storage measurements.
        let celsius = unique_storage_temperature(&model, &disk_models, &smart_temps);
        result.storage.push(StorageThermal {
            name: model,
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
    fn storage_temperature_requires_an_exact_unique_match() {
        let disks = vec!["Model A".to_string(), "Model B".to_string()];
        let smart = vec![("model a".to_string(), 42.0)];
        assert_eq!(
            unique_storage_temperature("Model A", &disks, &smart),
            Some(42.0)
        );
        assert_eq!(unique_storage_temperature("Model B", &disks, &smart), None);
        assert_eq!(unique_storage_temperature("Model", &disks, &smart), None);
        let duplicates = vec!["Model A".to_string(), "model a".to_string()];
        assert_eq!(
            unique_storage_temperature("Model A", &duplicates, &smart),
            None
        );
        let ambiguous = vec![("Model A".to_string(), 42.0), ("model a".to_string(), 43.0)];
        assert_eq!(
            unique_storage_temperature("Model A", &disks, &ambiguous),
            None
        );
        assert_eq!(
            unique_storage_temperature("Model A", &disks, &[("Model A".into(), f64::NAN)]),
            None
        );
    }
}
