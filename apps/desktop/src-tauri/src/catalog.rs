use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const BUNDLED: &str = include_str!("../resources/catalog-fixture.json");
const MAX_SNAPSHOT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub schema_version: u32,
    pub catalog_version: String,
    pub asset_manifest_version: u32,
    pub origin: String,
    pub published_at: String,
    pub parts: Vec<Value>,
}
pub fn parse_snapshot(text: &str) -> Result<Snapshot, String> {
    if text.len() > MAX_SNAPSHOT_BYTES {
        return Err("Catalog exceeds snapshot size limit".into());
    }
    let snapshot: Snapshot = serde_json::from_str(text).map_err(|_| "Invalid catalog envelope")?;
    if snapshot.schema_version != 1
        || snapshot.catalog_version.is_empty()
        || snapshot.parts.is_empty()
        || snapshot.parts.len() > 100
    {
        return Err("Unsupported catalog schema or record count".into());
    }
    // The first cache only accepts bundled fictional data. Full domain validation also runs in TypeScript.
    if snapshot.origin != "development-fixtures"
        || snapshot.parts.iter().any(|p| {
            p.get("isFixture") != Some(&Value::Bool(true))
                || p.get("status").and_then(Value::as_str) != Some("development")
        })
    {
        return Err("Only development fixtures are permitted in the initial cache".into());
    }
    Ok(snapshot)
}
pub fn load(connection: &mut Connection) -> Result<Snapshot, String> {
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| "Cannot read catalog schema")?;
    if version > 1 {
        return Err("Local catalog schema is newer than this application".into());
    }
    if version == 0 {
        let transaction = connection
            .transaction()
            .map_err(|_| "Cannot migrate catalog")?;
        transaction.execute_batch("CREATE TABLE snapshots (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL); PRAGMA user_version=1;").map_err(|_| "Cannot create catalog cache")?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit catalog migration")?;
    }
    let cached: Option<String> = connection
        .query_row("SELECT payload FROM snapshots WHERE id=1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|_| "Cannot read catalog cache")?;
    if let Some(payload) = cached {
        return parse_snapshot(&payload);
    }
    let bundled = parse_snapshot(BUNDLED)?;
    connection
        .execute(
            "INSERT INTO snapshots(id,payload) VALUES(1,?1)",
            params![BUNDLED],
        )
        .map_err(|_| "Cannot seed catalog cache")?;
    Ok(bundled)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrates_and_round_trips_bundled_fixture() {
        let mut db = Connection::open_in_memory().unwrap();
        let first = load(&mut db).unwrap();
        let second = load(&mut db).unwrap();
        assert_eq!(first.catalog_version, second.catalog_version);
        assert_eq!(first.parts.len(), 5);
    }
    #[test]
    fn refuses_future_schema_without_mutating_it() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA user_version=9;").unwrap();
        assert!(load(&mut db).is_err());
        let version: u32 = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 9);
    }
    #[test]
    fn rejects_invalid_cached_payload_without_overwriting() {
        let mut db = Connection::open_in_memory().unwrap();
        load(&mut db).unwrap();
        db.execute("UPDATE snapshots SET payload='invalid'", [])
            .unwrap();
        assert!(load(&mut db).is_err());
        let payload: String = db
            .query_row("SELECT payload FROM snapshots", [], |row| row.get(0))
            .unwrap();
        assert_eq!(payload, "invalid");
    }
    #[test]
    fn rejects_non_fixture_data_and_oversized_input() {
        let mut value: Value = serde_json::from_str(BUNDLED).unwrap();
        value["parts"][0]["isFixture"] = Value::Bool(false);
        assert!(parse_snapshot(&value.to_string()).is_err());
        assert!(parse_snapshot(&" ".repeat(MAX_SNAPSHOT_BYTES + 1)).is_err());
    }
}
