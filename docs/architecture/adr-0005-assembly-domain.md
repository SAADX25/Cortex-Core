# ADR 0005: Authoritative development build and bounded persistence

Status: accepted for Phase 2, 0.3.0.

`@cortex/build-domain` owns the selected motherboard and the part ID in each semantic socket, DIMM or M.2 slot. CPU, RAM and storage are derived category views of those installations. Occupancy, requirements, compatibility and totals are calculated from this record and the validated catalog. Meshes cannot modify installation truth. An immutable operation either returns a valid complete next build or throws, leaving the previous build intact.

Installation rules live in `@cortex/compatibility-engine`. Each destination checks its category, availability, occupancy and required specifications. CPU family support retains the existing BIOS warning. Warning destinations may be installed and their reasons remain visible; unknown and incompatible destinations are blocked. M.2 assembly currently supports only the generic 2280 NVMe template. Memory capacity is per installed DIMM: the fictional 16 GB, two-module kit may supply two independent module placements; each placement contributes 16 GB, not 32 GB. Reusing the same catalog record in several slots represents separate fixture instances.

The shared application controller coordinates selection, preview, installation and removal. It validates and awaits persistence before committing the authoritative state. Transient animation records are separate from persisted state, bounded by one operation, and cleared by a single timer. Reduced motion completes visual transitions immediately. The domain remains usable in diagram mode or after graphics failure.

The renderer samples reusable millimetre poses from semantic anchors. CPU and RAM descend; M.2 first inserts and then rotates around the connector end. Installed parts and ghost previews use small declarative box geometries, no textures and R3F-owned disposal. Animations invalidate frames only while active. Orbit input cancels camera assistance; installation never owns the orbit controls.

Native persistence adds exactly two reviewed application permissions: `allow-load-development-build` and `allow-save-development-build`. They read/write only the fixed OS application-data `development-build.sqlite3` database. The renderer cannot supply a path. The five pre-existing host commands retain their behavior; no filesystem, shell, updater or unrestricted opener permissions are added.

Database `user_version=1` and build envelope `schemaVersion=1` are independent of the catalog database. The sole row contains motherboard ID plus at most seven slot/part references. Rust checks the 4 KiB envelope, exact fields, supported version, known references, correct categories and unique supported slots. TypeScript additionally rechecks current compatibility. Saves use SQLite transactions; malformed payloads and future database/envelope versions prevent overwrites. Failed restore disables assembly and explains that original data is preserved. Reset is a confirmed ordinary save of an empty installation list; it retains the motherboard, catalog and application settings.

The browser test renderer uses a separate localStorage adapter with the same domain validation. It is a development/test adapter, not the desktop persistence implementation.
