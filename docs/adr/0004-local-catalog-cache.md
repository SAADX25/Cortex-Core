# ADR 0004 — Local catalog snapshots, SQLite and offline assets

Status: accepted · 2026-10-07

PostgreSQL/Supabase remains the authoritative remote catalog. A native-owned SQLite database stores a versioned, validated last-known snapshot, not a second authoritative product database. SQLite fits atomic replacement, transactions and future indexed local queries; no generic SQL or filesystem command is exposed to React.

The desktop host seeds a bundled fictional snapshot when no supported cache exists. The renderer validates every snapshot using the existing runtime catalog schema plus an envelope (`schemaVersion`, `catalogVersion`, `assetManifestVersion`, `origin`, `publishedAt`). Invalid/unsupported caches fall back to the bundled fixtures with a visible status; no hardware specifications are invented. This first cache contains only development fixtures. Normal desktop operation requires no network.

SQLite schema uses `user_version` migrations. The supported version is checked before reading or mutating data; future versions must not be destructively downgraded. Configuration belongs in the OS app-config directory, catalog in app-local-data/catalog, assets in app-cache/assets, support logs in app-log and temporary files in a separate app-cache/temp directory. Never write data beside the executable. Settings shows cache/catalog state without a destructive user-data operation.

Future updates: a dedicated Rust download command restricted to configured HTTPS catalog endpoints fetches an independently versioned snapshot. Verify signature/hash/size, validate schemas/provenance, stage the new data, then atomically replace inside a transaction. Retain a rollback snapshot; failed updates keep the last-known catalog. Data publication and application signing/release are separate trust and version boundaries. No remote sync/updater is enabled in this milestone.

Assets use the existing licensed SHA-256 manifests. A native asset-cache interface will key content by hash, verify before rename, reuse unchanged bytes offline, lease in-use items and evict least-recently-used unleased assets within a quota. Catalog and saved builds are outside the asset-cache root. This milestone creates the correct cache directories and documents the contract; it does not download arbitrary models or implement an unchecked cache-clear command. The base installer contains essential procedural templates only.

Portable `.cortexbuild` files will contain schema/version and part identifiers/configuration, not embedded GLBs. Import/export and diagnostic export must use native dialogs, size bounds and format validation. They remain explicit later features; no unrestricted frontend file API is necessary now.
