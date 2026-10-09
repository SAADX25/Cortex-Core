//! Sensor-free hardware data types.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
