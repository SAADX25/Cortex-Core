use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

const SLOTS: [&str; 7] = [
    "motherboard.cpuSocket",
    "motherboard.dimm.a1",
    "motherboard.dimm.a2",
    "motherboard.dimm.b1",
    "motherboard.dimm.b2",
    "motherboard.m2.slot1",
    "motherboard.m2.slot2",
];
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Installation {
    slot_id: String,
    part_id: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Build {
    schema_version: u32,
    motherboard_id: String,
    installations: Vec<Installation>,
}
fn validate(value: Value, catalog: &[Value]) -> Result<Build, String> {
    if value.to_string().len() > 4096 {
        return Err("Build exceeds size limit".into());
    }
    let build: Build = serde_json::from_value(value).map_err(|_| "Invalid build structure")?;
    if build.schema_version != 1 || build.installations.len() > 7 {
        return Err("Unsupported build version or component count".into());
    }
    let find = |id: &str, category: &str| {
        catalog
            .iter()
            .any(|p| p["id"].as_str() == Some(id) && p["category"].as_str() == Some(category))
    };
    if !find(&build.motherboard_id, "motherboard") {
        return Err("Unknown build motherboard".into());
    }
    let mut occupied = HashSet::new();
    for item in &build.installations {
        if !SLOTS.contains(&item.slot_id.as_str()) || !occupied.insert(&item.slot_id) {
            return Err("Invalid or duplicate build slot".into());
        }
        let category = if item.slot_id == SLOTS[0] {
            "cpu"
        } else if item.slot_id.contains(".dimm.") {
            "ram"
        } else {
            "storage"
        };
        if !find(&item.part_id, category) {
            return Err("Unknown part or incorrect slot category".into());
        }
    }
    Ok(build)
}
fn migrate(db: &mut Connection) -> Result<(), String> {
    let version: u32 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|_| "Cannot read build database version")?;
    if version > 1 {
        return Err("Build database is newer than supported; original data preserved".into());
    }
    if version == 0 {
        let tx = db
            .transaction()
            .map_err(|_| "Cannot migrate build database")?;
        tx.execute_batch("CREATE TABLE development_build (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); PRAGMA user_version=1;").map_err(|_| "Cannot create build database")?;
        tx.commit().map_err(|_| "Cannot commit build migration")?;
    }
    Ok(())
}
pub fn load(db: &mut Connection, catalog: &[Value]) -> Result<Option<Build>, String> {
    migrate(db)?;
    let payload: Option<String> = db
        .query_row(
            "SELECT payload FROM development_build WHERE id=1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "Cannot read saved build")?;
    payload
        .map(|text| {
            if text.len() > 4096 {
                return Err("Saved build exceeds size limit".into());
            }
            validate(
                serde_json::from_str(&text)
                    .map_err(|_| "Invalid saved build; original data preserved")?,
                catalog,
            )
        })
        .transpose()
}
pub fn save(db: &mut Connection, value: Value, catalog: &[Value]) -> Result<(), String> {
    let build = validate(value, catalog)?;
    // Refuse to overwrite invalid/newer existing state, including a future database version.
    load(db, catalog)?;
    let payload = serde_json::to_string(&build).map_err(|_| "Cannot serialize build")?;
    let tx = db.transaction().map_err(|_| "Cannot start build save")?;
    tx.execute("INSERT INTO development_build(id,payload) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", params![payload]).map_err(|_| "Cannot save build")?;
    tx.commit().map_err(|_| "Cannot commit build save")?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn catalog() -> Vec<Value> {
        crate::catalog::parse_snapshot(crate::catalog::BUNDLED)
            .unwrap()
            .parts
    }
    fn fixture() -> Value {
        serde_json::json!({"schemaVersion":1,"motherboardId":"fixture-board-atx","installations":[{"slotId":"motherboard.cpuSocket","partId":"fixture-cpu"}]})
    }
    #[test]
    fn round_trip_and_reset_keeps_catalog_separate() {
        let mut db = Connection::open_in_memory().unwrap();
        assert!(load(&mut db, &catalog()).unwrap().is_none());
        save(&mut db, fixture(), &catalog()).unwrap();
        assert_eq!(
            load(&mut db, &catalog())
                .unwrap()
                .unwrap()
                .installations
                .len(),
            1
        );
        let mut reset = fixture();
        reset["installations"] = serde_json::json!([]);
        save(&mut db, reset, &catalog()).unwrap();
        assert!(
            load(&mut db, &catalog())
                .unwrap()
                .unwrap()
                .installations
                .is_empty()
        );
        assert_eq!(catalog().len(), 5);
    }
    #[test]
    fn rejects_invalid_references_duplicates_and_oversize() {
        let mut value = fixture();
        value["installations"][0]["partId"] = "fixture-ram".into();
        assert!(validate(value, &catalog()).is_err());
        let mut value = fixture();
        let duplicate = value["installations"][0].clone();
        value["installations"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        assert!(validate(value, &catalog()).is_err());
        assert!(validate(serde_json::json!("x".repeat(4097)), &catalog()).is_err());
    }
    #[test]
    fn future_payload_cannot_be_overwritten() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        let mut future = fixture();
        future["schemaVersion"] = 9.into();
        db.execute(
            "INSERT INTO development_build VALUES(1,?1)",
            params![future.to_string()],
        )
        .unwrap();
        assert!(save(&mut db, fixture(), &catalog()).is_err());
        let stored: String = db
            .query_row("SELECT payload FROM development_build", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, future.to_string());
    }
    #[test]
    fn invalid_payload_and_future_database_are_preserved() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        db.execute("INSERT INTO development_build VALUES(1,'invalid')", [])
            .unwrap();
        assert!(save(&mut db, fixture(), &catalog()).is_err());
        assert_eq!(
            db.query_row("SELECT payload FROM development_build", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "invalid"
        );
        db.execute_batch("PRAGMA user_version=9;").unwrap();
        assert!(load(&mut db, &catalog()).is_err());
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                .unwrap(),
            9
        );
    }
}
