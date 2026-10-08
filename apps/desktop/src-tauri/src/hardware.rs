//! Local, allowlisted hardware discovery. Raw provider records never cross IPC or enter the cache.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

type Row = BTreeMap<String, Value>;
const UNKNOWN: &str = "Unknown";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Device {
    pub name: String,
    pub properties: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hardware {
    pub schema_version: u32,
    pub scanned_at: u64,
    pub cpu: Vec<Device>,
    pub gpu: Vec<Device>,
    pub motherboard: Vec<Device>,
    pub memory: Vec<Device>,
    pub total_memory_bytes: Option<u64>,
    pub storage: Vec<Device>,
    pub bios: Vec<Device>,
    pub os: Vec<Device>,
    pub unavailable: Vec<String>,
}
#[derive(Default)]
struct Raw {
    cpu: Vec<Row>,
    gpu: Vec<Row>,
    motherboard: Vec<Row>,
    memory: Vec<Row>,
    storage: Vec<Row>,
    disks: Vec<Row>,
    physical: Vec<Row>,
    bios: Vec<Row>,
    os: Vec<Row>,
    total: Option<u64>,
    unavailable: Vec<String>,
}
fn text(row: &Row, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| {
            !s.is_empty()
                && ![
                    "unknown",
                    "none",
                    "n/a",
                    "default string",
                    "to be filled by o.e.m.",
                ]
                .contains(&s.to_lowercase().as_str())
        })
        .map(|s| {
            s.chars()
                .filter(|c| !c.is_control())
                .take(256)
                .collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| UNKNOWN.into())
}
fn number(row: &Row, key: &str) -> Option<u64> {
    row.get(key)
        .and_then(|v| v.as_u64().or_else(|| v.as_str()?.trim().parse().ok()))
        .filter(|v| *v > 0 && *v <= 9_007_199_254_740_991)
}
fn numeric(row: &Row, key: &str) -> String {
    number(row, key)
        .map(|v| v.to_string())
        .unwrap_or_else(|| UNKNOWN.into())
}
fn mapped(row: &Row, key: &str, options: &[(u64, &str)]) -> String {
    number(row, key)
        .and_then(|n| options.iter().find(|(v, _)| *v == n))
        .map(|(_, s)| (*s).into())
        .unwrap_or_else(|| UNKNOWN.into())
}
fn device(row: &Row, name: &str, fields: &[(&str, &str)]) -> Device {
    Device {
        name: text(row, name),
        properties: fields
            .iter()
            .map(|(label, key)| ((*label).into(), text(row, key)))
            .collect(),
    }
}
fn normalize(raw: Raw, scanned_at: u64) -> Hardware {
    let cpu = raw
        .cpu
        .iter()
        .map(|r| {
            let mut d = device(r, "Name", &[("Manufacturer", "Manufacturer")]);
            for (label, key) in [
                ("Physical cores", "NumberOfCores"),
                ("Logical processors", "NumberOfLogicalProcessors"),
                ("Max clock (MHz)", "MaxClockSpeed"),
            ] {
                d.properties.insert(label.into(), numeric(r, key));
            }
            d.properties.insert(
                "Architecture".into(),
                mapped(
                    r,
                    "Architecture",
                    &[(9, "x64"), (12, "ARM64"), (5, "ARM"), (6, "Itanium")],
                ),
            );
            if r.get("Architecture").and_then(Value::as_u64) == Some(0) {
                d.properties.insert("Architecture".into(), "x86".into());
            }
            d
        })
        .collect();
    let gpu = raw
        .gpu
        .iter()
        .map(|r| {
            let mut d = device(
                r,
                "Name",
                &[
                    ("Vendor", "AdapterCompatibility"),
                    ("Driver version", "DriverVersion"),
                    ("Adapter class", "AdapterClass"),
                    ("Classification source", "ClassificationSource"),
                ],
            );
            // WMI AdapterRAM is a 32-bit value and is deliberately never used.
            d.properties.insert(
                "Dedicated VRAM (bytes)".into(),
                numeric(r, "DedicatedVideoMemory"),
            );
            let name = d.name.to_lowercase();
            if [
                "vmware",
                "virtualbox",
                "microsoft remote display",
                "parallels display",
                "hyper-v video",
            ]
            .iter()
            .any(|token| name.contains(token))
            {
                d.properties
                    .insert("Adapter class".into(), "Virtual".into());
                d.properties.insert(
                    "Classification source".into(),
                    "Recognized virtual display provider".into(),
                );
            }
            d
        })
        .collect();
    let memory = raw
        .memory
        .iter()
        .map(|r| {
            let mut d = device(
                r,
                "PartNumber",
                &[
                    ("Manufacturer", "Manufacturer"),
                    ("Part number", "PartNumber"),
                ],
            );
            d.properties
                .insert("Capacity (bytes)".into(), numeric(r, "Capacity"));
            d.properties.insert(
                "Configured speed (MT/s)".into(),
                numeric(r, "ConfiguredClockSpeed"),
            );
            d.properties.insert(
                "Memory type".into(),
                mapped(
                    r,
                    "SMBIOSMemoryType",
                    &[
                        (20, "DDR"),
                        (21, "DDR2"),
                        (24, "DDR3"),
                        (26, "DDR4"),
                        (34, "DDR5"),
                        (30, "LPDDR4"),
                        (35, "LPDDR5"),
                    ],
                ),
            );
            d
        })
        .collect();
    let total_memory_bytes = if !raw.memory.is_empty() {
        raw.memory
            .iter()
            .try_fold(0_u64, |sum, r| sum.checked_add(number(r, "Capacity")?))
    } else {
        None
    }
    .or(raw.total);
    let storage = raw
        .storage
        .iter()
        .map(|r| {
            let mut d = device(r, "Model", &[("Reported interface", "InterfaceType")]);
            d.properties
                .insert("Size (bytes)".into(), numeric(r, "Size"));
            // Provider numbering can differ (RAID/Storage Spaces). Only enrich an unambiguous model+size match.
            let matches: Vec<_> = raw
                .physical
                .iter()
                .filter(|p| {
                    text(p, "FriendlyName") == text(r, "Model")
                        && number(p, "Size").is_some()
                        && number(p, "Size") == number(r, "Size")
                })
                .collect();
            let peers = raw
                .storage
                .iter()
                .filter(|p| {
                    text(p, "Model") == text(r, "Model") && number(p, "Size") == number(r, "Size")
                })
                .count();
            let physical = if matches.len() == 1 && peers == 1 {
                Some(matches[0])
            } else {
                None
            };
            // Both classes use the OS physical disk number. Size must also agree in this scan.
            let index = r.get("Index").and_then(Value::as_u64);
            let disks: Vec<_> = raw
                .disks
                .iter()
                .filter(|p| {
                    index.is_some()
                        && p.get("Number").and_then(Value::as_u64) == index
                        && number(p, "Size").is_some()
                        && number(p, "Size") == number(r, "Size")
                })
                .collect();
            let disk = if disks.len() == 1 {
                Some(disks[0])
            } else {
                None
            };
            d.properties.insert(
                "Media type".into(),
                physical
                    .map(|p| mapped(p, "MediaType", &[(3, "HDD"), (4, "SSD"), (5, "SCM")]))
                    .unwrap_or_else(|| UNKNOWN.into()),
            );
            d.properties.insert(
                "Bus type".into(),
                disk.or(physical)
                    .map(|p| {
                        mapped(
                            p,
                            "BusType",
                            &[
                                (1, "SCSI"),
                                (2, "ATAPI"),
                                (3, "ATA"),
                                (4, "IEEE 1394"),
                                (7, "USB"),
                                (8, "RAID"),
                                (9, "iSCSI"),
                                (10, "SAS"),
                                (11, "SATA"),
                                (14, "Virtual"),
                                (15, "File backed virtual"),
                                (16, "Storage Spaces"),
                                (17, "NVMe"),
                                (18, "SCM"),
                                (19, "UFS"),
                            ],
                        )
                    })
                    .unwrap_or_else(|| UNKNOWN.into()),
            );
            d
        })
        .collect();
    let bios = raw
        .bios
        .iter()
        .map(|r| {
            let mut d = device(
                r,
                "SMBIOSBIOSVersion",
                &[
                    ("Manufacturer", "Manufacturer"),
                    ("Version", "SMBIOSBIOSVersion"),
                ],
            );
            let date = text(r, "ReleaseDate");
            let date = if date.len() >= 8 && date.as_bytes()[..8].iter().all(u8::is_ascii_digit) {
                let y = &date[..4];
                let m = date[4..6].parse::<u32>().unwrap_or(0);
                let day = date[6..8].parse::<u32>().unwrap_or(0);
                let year = y.parse::<u32>().unwrap_or(0);
                let leap = year.is_multiple_of(4)
                    && (!year.is_multiple_of(100) || year.is_multiple_of(400));
                let days = match m {
                    2 => {
                        if leap {
                            29
                        } else {
                            28
                        }
                    }
                    4 | 6 | 9 | 11 => 30,
                    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                    _ => 0,
                };
                if year > 0 && day > 0 && day <= days {
                    format!("{y}-{m:02}-{day:02}")
                } else {
                    UNKNOWN.into()
                }
            } else {
                UNKNOWN.into()
            };
            d.properties.insert("Release date".into(), date);
            d
        })
        .collect();
    let mut result = Hardware {
        schema_version: 1,
        scanned_at,
        cpu,
        gpu,
        memory,
        total_memory_bytes,
        storage,
        bios,
        motherboard: raw
            .motherboard
            .iter()
            .map(|r| {
                device(
                    r,
                    "Product",
                    &[
                        ("Manufacturer", "Manufacturer"),
                        ("Model", "Product"),
                        ("Version", "Version"),
                    ],
                )
            })
            .collect(),
        os: raw
            .os
            .iter()
            .map(|r| {
                device(
                    r,
                    "Caption",
                    &[
                        ("Edition", "Caption"),
                        ("Version", "Version"),
                        ("Build", "BuildNumber"),
                        ("Architecture", "OSArchitecture"),
                    ],
                )
            })
            .collect(),
        unavailable: raw.unavailable,
    };
    for devices in [
        &mut result.cpu,
        &mut result.gpu,
        &mut result.memory,
        &mut result.storage,
        &mut result.motherboard,
        &mut result.bios,
        &mut result.os,
    ] {
        devices.sort_by(|a, b| a.name.cmp(&b.name).then(a.properties.cmp(&b.properties)));
    }
    result.gpu.sort_by_key(|d| {
        std::cmp::Reverse(
            d.properties
                .get("Dedicated VRAM (bytes)")
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0),
        )
    });
    result
}

#[cfg(windows)]
fn collect() -> Raw {
    use wmi::WMIConnection;
    fn query(
        connection: Option<&WMIConnection>,
        sql: &str,
        category: &str,
        unavailable: &mut Vec<String>,
    ) -> Vec<Row> {
        match connection.and_then(|c| c.raw_query::<Row>(sql).ok()) {
            Some(rows) => rows,
            None => {
                unavailable.push(category.into());
                Vec::new()
            }
        }
    }
    let c = WMIConnection::new().ok();
    let c = c.as_ref();
    let mut raw = Raw::default();
    raw.cpu = query(
        c,
        "SELECT Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, Architecture FROM Win32_Processor",
        "CPU",
        &mut raw.unavailable,
    );
    raw.gpu = query(
        c,
        "SELECT Name, AdapterCompatibility, DriverVersion FROM Win32_VideoController",
        "GPU",
        &mut raw.unavailable,
    );
    raw.motherboard = query(
        c,
        "SELECT Manufacturer, Product, Version FROM Win32_BaseBoard",
        "Motherboard",
        &mut raw.unavailable,
    );
    raw.memory = query(
        c,
        "SELECT Capacity, ConfiguredClockSpeed, Manufacturer, PartNumber, SMBIOSMemoryType FROM Win32_PhysicalMemory",
        "Memory",
        &mut raw.unavailable,
    );
    let mut installed_kb = 0_u64;
    // Reports installed SMBIOS memory, rather than OS-usable memory after hardware reservations.
    if unsafe {
        windows::Win32::System::SystemInformation::GetPhysicallyInstalledSystemMemory(
            &mut installed_kb,
        )
    }
    .is_ok()
    {
        raw.total = installed_kb.checked_mul(1024).filter(|v| *v > 0);
    }
    raw.storage = query(
        c,
        "SELECT Index, Model, Size, InterfaceType FROM Win32_DiskDrive",
        "Storage",
        &mut raw.unavailable,
    );
    raw.bios = query(
        c,
        "SELECT Manufacturer, SMBIOSBIOSVersion, ReleaseDate FROM Win32_BIOS",
        "BIOS",
        &mut raw.unavailable,
    );
    raw.os = query(
        c,
        "SELECT Caption, Version, BuildNumber, OSArchitecture FROM Win32_OperatingSystem",
        "Operating system",
        &mut raw.unavailable,
    );
    let storage = WMIConnection::with_namespace_path("ROOT\\Microsoft\\Windows\\Storage").ok();
    raw.physical = query(
        storage.as_ref(),
        "SELECT FriendlyName, Size, MediaType, BusType FROM MSFT_PhysicalDisk",
        "Storage metadata",
        &mut raw.unavailable,
    );
    raw.disks = query(
        storage.as_ref(),
        "SELECT Number, Size, BusType FROM MSFT_Disk",
        "Disk bus metadata",
        &mut raw.unavailable,
    );
    match dxgi_memory() {
        Ok(adapters) => {
            let names: Vec<_> = raw.gpu.iter().map(|r| text(r, "Name")).collect();
            for r in &mut raw.gpu {
                let matches: Vec<_> = adapters
                    .iter()
                    .filter(|(name, _, _)| *name == text(r, "Name"))
                    .collect();
                let peers = matches.len();
                if peers == 1 && names.iter().filter(|n| **n == text(r, "Name")).count() == 1 {
                    r.insert("DedicatedVideoMemory".into(), Value::from(matches[0].1));
                    r.insert("AdapterClass".into(), Value::from(matches[0].2));
                    r.insert(
                        "ClassificationSource".into(),
                        Value::from(if matches[0].2 == "Unknown" {
                            "Unknown"
                        } else {
                            "DXGI / DXCore"
                        }),
                    );
                }
            }
        }
        Err(_) => raw.unavailable.push("GPU memory".into()),
    }
    raw
}
#[cfg(windows)]
struct DxCoreLibrary(windows::Win32::Foundation::HMODULE);
#[cfg(windows)]
impl Drop for DxCoreLibrary {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::FreeLibrary(self.0);
        }
    }
}
#[cfg(windows)]
fn optional_dxcore_factory() -> Option<(
    windows::Win32::Graphics::DXCore::IDXCoreAdapterFactory,
    DxCoreLibrary,
)> {
    use windows::Win32::Graphics::DXCore::IDXCoreAdapterFactory;
    use windows::Win32::System::LibraryLoader::{
        GetProcAddress, LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExW,
    };
    use windows::core::{GUID, HRESULT, Interface, s, w};
    // Older Windows releases may lack DXCore. Load only the fixed System32 DLL,
    // and retain it until the factory and all adapters have released their COM references.
    unsafe {
        let library = DxCoreLibrary(
            LoadLibraryExW(w!("dxcore.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32).ok()?,
        );
        let address = GetProcAddress(library.0, s!("DXCoreCreateAdapterFactory"))?;
        let create: unsafe extern "system" fn(*const GUID, *mut *mut std::ffi::c_void) -> HRESULT =
            std::mem::transmute(address);
        let mut pointer = std::ptr::null_mut();
        create(&IDXCoreAdapterFactory::IID, &mut pointer)
            .ok()
            .ok()?;
        if pointer.is_null() {
            return None;
        }
        Some((IDXCoreAdapterFactory::from_raw(pointer), library))
    }
}
#[cfg(windows)]
fn dxgi_memory() -> windows::core::Result<Vec<(String, u64, &'static str)>> {
    use windows::Win32::Graphics::DXCore::{IDXCoreAdapter, IsHardware, IsIntegrated};
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, DXGI_ERROR_NOT_FOUND, IDXGIFactory1,
    };
    // COM interface ownership is handled by windows-rs. No raw pointer escapes this function.
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
        let core = optional_dxcore_factory();
        let mut adapters = Vec::new();
        for i in 0..64 {
            let adapter = match factory.EnumAdapters1(i) {
                Ok(a) => a,
                Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(e) => return Err(e),
            };
            let d = adapter.GetDesc1()?;
            // Never infer integration from vendor, marketing name or VRAM size.
            // LUID is used only for this in-memory join and never crosses IPC.
            let class = if d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                "Software"
            } else {
                core.as_ref()
                    .and_then(|(factory, _library)| {
                        let adapter: IDXCoreAdapter =
                            factory.GetAdapterByLuid(&d.AdapterLuid).ok()?;
                        if !adapter.IsPropertySupported(IsHardware)
                            || !adapter.IsPropertySupported(IsIntegrated)
                        {
                            return None;
                        }
                        let mut hardware = false;
                        let mut integrated = false;
                        adapter
                            .GetProperty(
                                IsHardware,
                                size_of::<bool>(),
                                (&mut hardware as *mut bool).cast(),
                            )
                            .ok()?;
                        adapter
                            .GetProperty(
                                IsIntegrated,
                                size_of::<bool>(),
                                (&mut integrated as *mut bool).cast(),
                            )
                            .ok()?;
                        Some(if !hardware {
                            "Software"
                        } else if integrated {
                            "Integrated"
                        } else {
                            "Discrete"
                        })
                    })
                    .unwrap_or("Unknown")
            };
            let len = d
                .Description
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(d.Description.len());
            adapters.push((
                String::from_utf16_lossy(&d.Description[..len])
                    .trim()
                    .to_owned(),
                d.DedicatedVideoMemory as u64,
                class,
            ));
        }
        Ok(adapters)
    }
}
pub fn scan() -> Result<Hardware, String> {
    #[cfg(windows)]
    let raw = collect();
    #[cfg(not(windows))]
    let raw = Raw {
        unavailable: vec!["Windows scanner unavailable on this platform".into()],
        ..Raw::default()
    };
    let result = normalize(
        raw,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            * 1000,
    );
    if [
        &result.cpu,
        &result.gpu,
        &result.memory,
        &result.storage,
        &result.os,
        &result.motherboard,
    ]
    .iter()
    .all(|r| r.is_empty())
    {
        return Err("Windows hardware information is unavailable. Rescan to try again.".into());
    }
    Ok(result)
}
pub fn restore(db: &rusqlite::Connection) -> Result<Option<Hardware>, String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS hardware_scan (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)").map_err(|_| "Hardware cache unavailable")?;
    let payload: Option<String> = db
        .query_row("SELECT payload FROM hardware_scan WHERE id=1", [], |r| {
            r.get(0)
        })
        .ok();
    Ok(payload
        .and_then(|p| serde_json::from_str::<Hardware>(&p).ok())
        .filter(|s| s.schema_version == 1))
}
pub fn save(db: &rusqlite::Connection, scan: &Hardware) -> Result<(), String> {
    restore(db)?;
    let payload = serde_json::to_string(scan).map_err(|_| "Cannot encode hardware cache")?;
    db.execute("INSERT INTO hardware_scan VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",[payload]).map_err(|_| "Cannot save hardware cache")?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn row(v: Value) -> Row {
        serde_json::from_value(v).unwrap()
    }
    #[test]
    fn adapter_classification_is_not_inferred_from_vram_or_vendor() {
        let scan = normalize(
            Raw {
                gpu: vec![
                    row(
                        serde_json::json!({"Name":"NVIDIA named adapter", "DedicatedVideoMemory":17179869184_u64}),
                    ),
                    row(
                        serde_json::json!({"Name":"Intel named adapter", "AdapterClass":"Integrated", "ClassificationSource":"DXGI / DXCore"}),
                    ),
                    row(serde_json::json!({"Name":"VMware SVGA", "AdapterClass":"Discrete"})),
                ],
                ..Raw::default()
            },
            1,
        );
        for gpu in scan.gpu {
            assert_eq!(
                gpu.properties["Adapter class"],
                match gpu.name.as_str() {
                    "Intel named adapter" => "Integrated",
                    "VMware SVGA" => "Virtual",
                    _ => UNKNOWN,
                }
            );
        }
    }
    #[test]
    fn missing_and_malformed_fields() {
        let s = normalize(
            Raw {
                cpu: vec![row(
                    serde_json::json!({"Name":"  Test CPU  ","NumberOfCores":"8","NumberOfLogicalProcessors":16,"MaxClockSpeed":-1,"Architecture":9,"Manufacturer":null}),
                )],
                ..Raw::default()
            },
            1,
        );
        assert_eq!(s.cpu[0].name, "Test CPU");
        assert_eq!(s.cpu[0].properties["Physical cores"], "8");
        assert_eq!(s.cpu[0].properties["Max clock (MHz)"], UNKNOWN);
        assert_eq!(s.cpu[0].properties["Manufacturer"], UNKNOWN);
        for v in [
            Value::Null,
            serde_json::json!(-2),
            serde_json::json!(false),
            serde_json::json!(1.5),
            serde_json::json!("bad"),
            serde_json::json!(0),
        ] {
            assert_eq!(number(&row(serde_json::json!({"x":v})), "x"), None);
        }
    }
    #[test]
    fn multiple_modules_disks_and_adapters() {
        let s = normalize(
            Raw {
                memory: vec![
                    row(
                        serde_json::json!({"Capacity":"17179869184","ConfiguredClockSpeed":6000,"SMBIOSMemoryType":34})
                    );
                    2
                ],
                storage: vec![
                    row(serde_json::json!({"Index":0,"Model":"Disk A","Size":"2000000000000"})),
                    row(serde_json::json!({"Index":1,"Model":"Disk B","Size":500000000000_u64})),
                ],
                physical: vec![row(
                    serde_json::json!({"FriendlyName":"Disk A","Size":"2000000000000","MediaType":4,"BusType":17}),
                )],
                gpu: vec![
                    row(serde_json::json!({"Name":"Integrated","AdapterRAM":999})),
                    row(
                        serde_json::json!({"Name":"Discrete","DedicatedVideoMemory":17179869184_u64}),
                    ),
                ],
                ..Raw::default()
            },
            1,
        );
        assert_eq!(s.total_memory_bytes, Some(34359738368));
        assert_eq!(s.memory.len(), 2);
        assert_eq!(s.storage.len(), 2);
        assert_eq!(s.storage[0].properties["Bus type"], "NVMe");
        assert_eq!(s.storage[1].properties["Media type"], UNKNOWN);
        assert_eq!(s.gpu.len(), 2);
        assert_eq!(
            s.gpu
                .iter()
                .find(|g| g.name == "Integrated")
                .unwrap()
                .properties["Dedicated VRAM (bytes)"],
            UNKNOWN
        );
    }
    #[test]
    fn ambiguous_storage_and_installed_memory_fallback() {
        let disk = row(serde_json::json!({"Index":0,"Model":"Same disk","Size":"1000000000000"}));
        let s = normalize(
            Raw {
                storage: vec![disk.clone(), disk],
                physical: vec![row(
                    serde_json::json!({"FriendlyName":"Same disk","Size":"1000000000000","MediaType":4,"BusType":17}),
                )],
                disks: vec![row(
                    serde_json::json!({"Number":0,"Size":"1000000000000","BusType":11}),
                )],
                memory: vec![row(serde_json::json!({"Capacity":"malformed"}))],
                total: Some(17179869184),
                ..Raw::default()
            },
            1,
        );
        assert_eq!(s.total_memory_bytes, Some(17179869184));
        for d in s.storage {
            assert_eq!(d.properties["Media type"], UNKNOWN);
            assert_eq!(d.properties["Bus type"], "SATA");
        }
    }
    #[test]
    fn normalization_is_stable_across_provider_order() {
        let a = row(serde_json::json!({"Name":"Processor A","NumberOfCores":4}));
        let b = row(serde_json::json!({"Name":"Processor B","NumberOfCores":8}));
        assert_eq!(
            normalize(
                Raw {
                    cpu: vec![a.clone(), b.clone()],
                    ..Raw::default()
                },
                1
            ),
            normalize(
                Raw {
                    cpu: vec![b, a],
                    ..Raw::default()
                },
                1
            )
        );
        assert_eq!(
            number(&row(serde_json::json!({"n":18446744073709551615_u64})), "n"),
            None
        );
        let s = normalize(
            Raw {
                bios: vec![row(
                    serde_json::json!({"ReleaseDate":"20260231000000.000000+000"}),
                )],
                ..Raw::default()
            },
            1,
        );
        assert_eq!(s.bios[0].properties["Release date"], UNKNOWN);
    }
    #[test]
    fn partial_failure_and_privacy() {
        let s = normalize(
            Raw {
                cpu: vec![row(
                    serde_json::json!({"Name":"CPU","SerialNumber":"SECRET","MACAddress":"SECRET","ProductKey":"SECRET"}),
                )],
                unavailable: vec!["Motherboard".into()],
                ..Raw::default()
            },
            1,
        );
        assert_eq!(s.cpu.len(), 1);
        assert!(s.motherboard.is_empty());
        assert_eq!(s.unavailable, ["Motherboard"]);
        assert!(!serde_json::to_string(&s).unwrap().contains("SECRET"));
    }
    #[test]
    fn cache_restore_replace_corruption() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        assert!(restore(&db).unwrap().is_none());
        let mut s = normalize(Raw::default(), 1);
        save(&db, &s).unwrap();
        assert_eq!(restore(&db).unwrap(), Some(s.clone()));
        s.scanned_at = 2;
        s.cpu.push(Device {
            name: "Changed".into(),
            properties: BTreeMap::new(),
        });
        save(&db, &s).unwrap();
        assert_eq!(restore(&db).unwrap(), Some(s));
        db.execute("UPDATE hardware_scan SET payload='{}'", [])
            .unwrap();
        assert!(restore(&db).unwrap().is_none());
    }
    #[test]
    fn unknown_placeholders_and_date() {
        assert_eq!(
            text(&row(serde_json::json!({"x":"To be filled by O.E.M."})), "x"),
            UNKNOWN
        );
        let s = normalize(
            Raw {
                bios: vec![
                    row(serde_json::json!({"ReleaseDate":"20260304000000.000000+000"})),
                    row(serde_json::json!({"ReleaseDate":"bad"})),
                ],
                ..Raw::default()
            },
            1,
        );
        assert_eq!(s.bios[0].properties["Release date"], "2026-03-04");
        assert_eq!(s.bios[1].properties["Release date"], UNKNOWN);
    }
    #[cfg(windows)]
    #[test]
    fn real_windows_scan_structure() {
        let s = scan().expect("Windows WMI scan");
        assert_eq!(s.schema_version, 1);
        assert!(s.scanned_at > 0);
        assert!(!s.cpu.is_empty());
        assert!(!s.os.is_empty());
        let encoded = serde_json::to_string(&s).unwrap();
        for key in [
            "SerialNumber",
            "ProductKey",
            "MACAddress",
            "PNPDeviceID",
            "DeviceId",
        ] {
            assert!(!encoded.contains(key));
        }
        assert_eq!(serde_json::from_str::<Hardware>(&encoded).unwrap(), s);
    }
}
