use super::*;
const INTEL: &[u8] = include_bytes!("../../../../tests/fixtures/sensors/intel-nvidia.json");
const AMD: &[u8] = include_bytes!("../../../../tests/fixtures/sensors/amd-integrated.json");
const ABSENT: &[u8] = include_bytes!("../../../../tests/fixtures/sensors/absent.json");
const DUPLICATE: &[u8] = include_bytes!("../../../../tests/fixtures/sensors/duplicate-names.json");
fn fixture(bytes: &[u8]) -> serde_json::Value {
    serde_json::from_slice(bytes).unwrap()
}
fn parsed(value: &serde_json::Value) -> Result<Snapshot, &'static str> {
    parse_json(&serde_json::to_vec(value).unwrap(), 100_000)
}
fn first_sensor(value: &mut serde_json::Value) -> &mut serde_json::Value {
    &mut value["Children"][0]["Children"][0]["Children"][0]["Children"][0]
}
fn enable(adapter: &Adapter) -> u64 {
    let owner = adapter.open_session().unwrap();
    adapter.configure_owned(owner, 1, true).unwrap()
}

#[test]
fn vendor_fixtures_preserve_identity_categories_units_and_observation() {
    let intel = parse_json(INTEL, 100_000).unwrap();
    let amd = parse_json(AMD, 100_000).unwrap();
    for category in [
        Category::Cpu,
        Category::Gpu,
        Category::Storage,
        Category::Motherboard,
        Category::Memory,
    ] {
        assert!(intel.sensors.iter().any(|s| s.category == category));
    }
    assert!(
        intel
            .sensors
            .iter()
            .any(|s| s.hardware_id == "/gpu-intel/0")
    );
    assert_eq!(
        intel
            .sensors
            .iter()
            .filter(|s| s.category == Category::Storage)
            .count(),
        3
    );
    assert!(amd.sensors.iter().any(|s| s.hardware_id == "/gpu-amd/0"));
    for s in intel.sensors.iter().chain(amd.sensors.iter()) {
        assert_eq!(s.observed_at, 100_000);
        assert_eq!(s.measured_at, None);
        assert_eq!(s.unit, "celsius");
        assert_eq!(s.device_match, "unmatched");
        assert!(!s.hardware_name.is_empty() && !s.sensor_name.is_empty());
    }
    assert_eq!(intel.sensors[0].value, Some(45.5)); // Locale decimal, explicit Celsius.
    assert_eq!(amd.sensors[0].value, Some(50.0)); // Explicit Fahrenheit conversion.
    assert!(intel.sensors.iter().any(|s| s.hardware_id == "/memory/dimm/0" && s.availability == Availability::Available));
    assert!(
        intel
            .sensors
            .iter()
            .any(|s| s.sensor_name == "Thermal Sensor High Limit"
                && s.availability == Availability::Unsupported
                && s.value.is_none())
    );
}
#[test]
fn absent_null_nonfinite_and_unsupported_are_unavailable() {
    assert!(parse_json(ABSENT, 100_000).unwrap().sensors.is_empty());
    for raw in [
        serde_json::Value::Null,
        "".into(),
        "NaN".into(),
        "NaN °C".into(),
        " °C".into(),
        "-Infinity °F".into(),
        300.0.into(),
    ] {
        let mut v = fixture(INTEL);
        first_sensor(&mut v)["RawValue"] = raw;
        let s = parsed(&v).unwrap();
        assert_eq!(s.sensors[0].availability, Availability::Missing);
        assert_eq!(s.sensors[0].value, None);
    }
    let mut v = fixture(INTEL);
    let hardware = &mut v["Children"][0]["Children"][0];
    hardware["HardwareId"] = "/unreviewed/0".into();
    hardware["Children"][0]["Children"][0]["SensorId"] = "/unreviewed/0/temperature/0".into();
    assert_eq!(
        parsed(&v).unwrap().sensors[0].availability,
        Availability::Unsupported
    );
}
#[test]
fn duplicate_names_never_map_to_detected_devices() {
    let s = parse_json(DUPLICATE, 100_000).unwrap();
    assert_eq!(s.sensors.len(), 2);
    assert_eq!(s.sensors[0].hardware_name, s.sensors[1].hardware_name);
    assert_ne!(s.sensors[0].hardware_id, s.sensors[1].hardware_id);
    assert!(s.sensors.iter().all(|s| s.device_match == "unmatched"));
}
#[test]
fn duplicate_sensor_ids_are_ambiguous_and_duplicate_hardware_ids_fail() {
    let mut v = fixture(INTEL);
    let mut duplicate = first_sensor(&mut v).clone();
    duplicate["id"] = 4000.into();
    v["Children"][0]["Children"][0]["Children"][0]["Children"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert!(
        parsed(&v).unwrap().sensors[..2]
            .iter()
            .all(|s| s.availability == Availability::Ambiguous && s.value.is_none())
    );
    let mut duplicate = v["Children"][0]["Children"][0].clone();
    duplicate["id"] = 4001.into();
    v["Children"][0]["Children"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert!(parsed(&v).is_err());
}
#[test]
fn malformed_wrong_type_units_versions_and_unexpected_fields_fail_closed() {
    let malformed = include_bytes!("../../../../tests/fixtures/sensors/malformed.json");
    assert!(parse_json(malformed, 100_000).is_err());
    for raw in [
        "45 °K".into(),
        "1,000.2 °C".into(),
        "45".into(),
        true.into(),
        serde_json::json!({"value":45}),
    ] {
        let mut v = fixture(INTEL);
        first_sensor(&mut v)["RawValue"] = raw;
        assert!(parsed(&v).is_err());
    }
    let mut v = fixture(INTEL);
    v["Version"] = "0.9.4".into();
    assert!(parsed(&v).is_err());
    let mut v = fixture(INTEL);
    v["url"] = "http://example.com".into();
    assert!(parsed(&v).is_err());
    let mut v = fixture(INTEL);
    first_sensor(&mut v)["SensorId"] = "/amdcpu/0/temperature/0".into();
    assert!(parsed(&v).is_err());
    assert!(parse_json(&vec![b' '; MAX_BODY + 1], 100_000).is_err());
}
#[test]
fn raw_numeric_schema_supported_without_using_formatted_display_value() {
    let mut v = fixture(INTEL);
    first_sensor(&mut v)["RawValue"] = 42.25.into();
    first_sensor(&mut v)["Value"] = "999 °F".into();
    assert_eq!(parsed(&v).unwrap().sensors[0].value, Some(42.25));
}
#[test]
fn loopback_verification_rejects_remote_ipv6_wildcard_shared_and_unknown() {
    let local = Listener {
        address: ADDRESS.ip(),
        port: 8085,
        owner: 100,
    };
    assert_eq!(validate_listeners(std::slice::from_ref(&local)), Ok(100));
    assert!(validate_listeners(&[]).is_err());
    for address in [
        "0.0.0.0",
        "192.168.1.2",
        "::",
        "2001:db8::1",
        "::ffff:127.0.0.1",
    ] {
        let extra = Listener {
            address: address.parse().unwrap(),
            ..local.clone()
        };
        assert!(validate_listeners(&[local.clone(), extra]).is_err());
    }
    assert!(
        validate_listeners(&[Listener {
            owner: 4,
            ..local.clone()
        }])
        .is_err()
    );
    assert!(
        validate_listeners(&[
            local.clone(),
            Listener {
                owner: 101,
                address: "::1".parse().unwrap(),
                ..local.clone()
            }
        ])
        .is_err()
    );
    assert!(
        validate_listeners(&[
            local.clone(),
            Listener {
                address: "0.0.0.0".parse().unwrap(),
                port: 9000,
                ..local
            }
        ])
        .is_err()
    );
    assert_eq!(ENDPOINT, "http://127.0.0.1:8085/data.json");
    assert!(
        std::str::from_utf8(REQUEST)
            .unwrap()
            .starts_with("GET /data.json HTTP/1.1\r\n")
    );
}
fn http(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
    let mut r = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{headers}\r\n", body.len()).into_bytes();
    r.extend_from_slice(body);
    r
}
#[test]
fn http_rejects_redirect_auth_encoding_html_and_bad_framing() {
    assert_eq!(response_body(&http("200 OK", "", INTEL)).unwrap(), INTEL);
    for status in ["302 Found", "401 Unauthorized", "500 Error", "2000 Bad"] {
        assert!(response_body(&http(status, "", INTEL)).is_err());
    }
    for headers in [
        "Content-Encoding: gzip\r\n",
        "Transfer-Encoding: chunked\r\n",
        "Content-Length: 10\r\n",
        "Content-Type: text/html\r\n",
    ] {
        assert!(response_body(&http("200 OK", headers, INTEL)).is_err());
    }
    let mut truncated = http("200 OK", "", INTEL);
    truncated.pop();
    assert!(response_body(&truncated).is_err());
}
#[test]
fn consent_rate_overlap_disable_late_results_and_shutdown_use_mock_state_only() {
    let adapter = Adapter::default();
    assert!(!adapter.begin(0).unwrap());
    let generation = enable(&adapter);
    assert!(adapter.begin(generation).unwrap());
    assert!(!adapter.begin(generation).unwrap());
    adapter.finish(generation, parse_json(INTEL, 100_000));
    assert!(!adapter.begin(generation).unwrap());
    assert_eq!(adapter.snapshot(generation).status, "connected");
    adapter.session.lock().unwrap().received = Some(Instant::now() - Duration::from_secs(16));
    assert!(
        adapter
            .snapshot(generation)
            .sensors
            .iter()
            .all(|s| s.value.is_none() && s.availability == Availability::Stale)
    );
    adapter.configure(false).unwrap();
    adapter.finish(generation, parse_json(INTEL, 100_000));
    assert_eq!(adapter.snapshot(generation).status, "disabled");
    let next = enable(&adapter);
    adapter.finish(next, Err("Sensor server stopped or request timed out"));
    assert!(adapter.snapshot(next).sensors.is_empty());
}
#[test]
fn toggling_consent_does_not_create_replacement_workers() {
    let adapter = Adapter::default();
    let first = enable(&adapter);
    assert!(adapter.begin(first).unwrap());
    adapter.configure(false).unwrap();
    let next = enable(&adapter);
    assert!(!adapter.begin(next).unwrap());
    adapter.finish(first, parse_json(INTEL, 100_000));
    assert!(adapter.snapshot(next).sensors.is_empty());
}

#[test]
fn test_builds_cannot_activate_a_real_sensor_source() {
    let adapter = Arc::new(Adapter::default());
    let generation = enable(&adapter);
    let snapshot = adapter.ticket(generation).unwrap().unwrap().complete();
    assert_eq!(
        snapshot.status,
        "Test builds cannot inspect listeners or connect a real sensor source"
    );
    assert!(snapshot.sensors.is_empty());
}

#[test]
fn reversed_enable_disable_commands_cannot_restore_consent() {
    let adapter = Adapter::default();
    assert!(adapter.configure(true).is_err());
    let owner = adapter.open_session().unwrap();
    assert!(!adapter.session.lock().unwrap().enabled);
    adapter.configure_owned(owner, 2, false).unwrap();
    assert!(adapter.configure_owned(owner, 1, true).is_err());
    assert!(adapter.configure_owned(owner, 2, true).is_err());
    assert!(adapter.configure_owned(owner, 0, true).is_err());
    assert!(
        adapter
            .configure_owned(owner, 9_007_199_254_740_992, true)
            .is_err()
    );
    assert!(!adapter.session.lock().unwrap().enabled);
}

#[test]
fn expired_owner_cleanup_cannot_disable_reconnection_and_lifecycle_invalidates_enable() {
    let adapter = Adapter::default();
    let old = adapter.open_session().unwrap();
    adapter.configure_owned(old, 1, true).unwrap();
    let new = adapter.open_session().unwrap();
    let generation = adapter.configure_owned(new, 1, true).unwrap();
    assert!(adapter.configure_owned(old, 2, false).is_err());
    assert_eq!(adapter.snapshot(generation).status, "waiting");
    for _ in 0..4 {
        // Native hide/focus, navigation/reload and close use the same revocation.
        adapter.revoke_all().unwrap();
        assert!(adapter.configure_owned(new, 2, true).is_err());
        assert!(!adapter.session.lock().unwrap().enabled);
    }
}

#[test]
fn dropped_or_panicked_worker_permit_releases_slot_and_preserves_cooldown() {
    let adapter = Arc::new(Adapter::default());
    let generation = enable(&adapter);
    let ticket = adapter.ticket(generation).unwrap().unwrap();
    assert!(adapter.ticket(generation).unwrap().is_none());
    drop(ticket);
    assert!(adapter.session.lock().unwrap().in_flight.is_none());
    assert!(adapter.ticket(generation).unwrap().is_none());
    adapter.session.lock().unwrap().next_due = Instant::now();
    let ticket = adapter.ticket(generation).unwrap().unwrap();
    let unwound = std::panic::catch_unwind(move || {
        let _owned = ticket;
        panic!("synthetic worker failure");
    });
    assert!(unwound.is_err());
    assert!(adapter.session.lock().unwrap().in_flight.is_none());
    assert!(adapter.snapshot(generation).sensors.is_empty());
}

#[test]
fn old_worker_cleanup_cannot_publish_or_release_another_generation() {
    let adapter = Arc::new(Adapter::default());
    let old = enable(&adapter);
    let ticket = adapter.ticket(old).unwrap().unwrap();
    adapter.revoke_all().unwrap();
    let new = enable(&adapter);
    assert!(adapter.ticket(new).unwrap().is_none());
    drop(ticket);
    assert_eq!(adapter.snapshot(new).status, "waiting");
    adapter.session.lock().unwrap().next_due = Instant::now();
    let next = adapter.ticket(new).unwrap().unwrap();
    adapter.finish(old, parse_json(INTEL, 100_000));
    assert_eq!(adapter.session.lock().unwrap().in_flight, Some(new));
    assert!(adapter.snapshot(new).sensors.is_empty());
    drop(next);
}
