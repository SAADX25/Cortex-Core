//! Safe Mode contains no HTTP client, listener enumeration or sensor parser.
pub type Snapshot = serde_json::Value;
#[derive(Default)]
pub struct Adapter;
pub struct Ticket;
impl Adapter {
    pub fn open_session(&self) -> Result<u64, String> {
        Err(crate::safe_mode::DENIED.into())
    }
    pub fn configure_owned(&self, _: u64, _: u64, consent: bool) -> Result<u64, String> {
        self.configure(consent)
    }
    pub fn configure(&self, consent: bool) -> Result<u64, String> {
        if consent {
            Err(crate::safe_mode::DENIED.into())
        } else {
            Ok(0)
        }
    }
    pub fn ticket(self: &std::sync::Arc<Self>, _: u64) -> Result<Option<Ticket>, String> {
        Err(crate::safe_mode::DENIED.into())
    }
    pub fn snapshot(&self, _: u64) -> Snapshot {
        serde_json::Value::Null
    }
    pub fn revoke_all(&self) -> Result<u64, String> {
        Ok(0)
    }
}
impl Ticket {
    pub fn complete(self) -> Snapshot {
        serde_json::Value::Null
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn every_sensor_entry_refuses_access_even_with_consent() {
        let adapter = std::sync::Arc::new(super::Adapter);
        assert!(adapter.open_session().is_err());
        assert!(adapter.configure(true).is_err());
        assert!(adapter.configure_owned(1, 1, true).is_err());
        assert!(adapter.ticket(1).is_err());
        assert_eq!(adapter.configure(false).unwrap(), 0);
        assert_eq!(adapter.revoke_all().unwrap(), 0);
        assert!(adapter.snapshot(1).is_null());
    }
}
