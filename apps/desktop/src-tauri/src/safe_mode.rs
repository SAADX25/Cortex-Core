//! Immutable build policy. No environment variable, IPC or persisted setting can override it.
use serde::Serialize;

pub const SAFE: bool = cfg!(feature = "safe-mode") || !cfg!(feature = "hardware-discovery");
pub const DENIED: &str = "Safe Mode: hardware discovery and temperature sources are disabled";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub schema_version: u32,
    pub mode: &'static str,
    pub hardware_discovery: bool,
    pub thermal_sensors: bool,
}
pub fn policy() -> Policy {
    Policy {
        schema_version: 1,
        mode: if SAFE { "safe" } else { "normal" },
        hardware_discovery: !SAFE,
        thermal_sensors: !SAFE,
    }
}
pub fn require_access() -> Result<(), String> {
    if SAFE { Err(DENIED.into()) } else { Ok(()) }
}

#[cfg(all(test, feature = "safe-mode"))]
mod tests {
    #[test]
    fn immutable_policy_denies_access() {
        assert!(super::SAFE);
        assert!(super::require_access().is_err());
        let p = super::policy();
        assert_eq!(p.mode, "safe");
        assert!(!p.hardware_discovery && !p.thermal_sensors);
    }
}
