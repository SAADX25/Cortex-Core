//! No discovery implementation is linked in this build.
pub use crate::hardware_types::Hardware;
pub fn scan() -> Result<Hardware, String> {
    Err(crate::safe_mode::DENIED.into())
}
pub fn restore(_: &rusqlite::Connection) -> Result<Option<Hardware>, String> {
    Err(crate::safe_mode::DENIED.into())
}
pub fn save(_: &rusqlite::Connection, _: &Hardware) -> Result<(), String> {
    Err(crate::safe_mode::DENIED.into())
}
#[cfg(test)]
mod tests {
    #[test]
    fn direct_scan_is_denied() {
        assert!(super::scan().is_err());
    }
    #[test]
    fn cache_restore_is_denied_without_sql() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        assert!(super::restore(&db).is_err());
        assert_eq!(
            db.query_row("SELECT count(*) FROM sqlite_master", [], |r| r
                .get::<_, u32>(0))
                .unwrap(),
            0
        );
    }
}
