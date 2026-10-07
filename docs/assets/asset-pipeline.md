# Asset pipeline

All shipped visuals are original procedural source with recorded MIT licensing in `originalManifest`. No third-party models, textures or fonts are downloaded at runtime. The hardware dataset references a versioned visual template, dimensions, materials, optional texture set, branding, connectors, LOD thresholds and an optional premium asset ID.

External assets need author, source, license URL, commercial/redistribution permission, modification status, hash and byte count. An unclear license is rejected; the manifest validator does not replace human license review. The initial manifest is code-backed and runtime-validated. An optional GLB must be a self-contained glTF 2.0 file and preserve stable `extras.semanticId` values for interaction mapping.

```sh
pnpm assets:optimize path/to/licensed.glb path/to/license-manifest.json
```

The input manifest uses the `glb` variant of `assetManifestEntrySchema`. The tool verifies source hash/size, then runs pinned glTF Transform with Meshopt and bounded KTX2 textures, preserving node structure (`flatten`, `join`, automatic instancing, palette merging and simplification disabled). This preserves semantic boundaries. Decorations that can safely be merged/instanced should pass through a separate deliberate authoring step, not automatic merging of selectable regions.

KTX2 conversion needs the official [KTX-Software tools](https://github.com/KhronosGroup/KTX-Software), version 4.4+ with `ktx` on PATH; they are not installed here. The wrapper detects texture-free GLBs and disables texture conversion, allowing Meshopt optimization without that encoder. This branch is executed by a test that verifies a hash-named output and preserved semantic anchor. The textured KTX2 branch requires the external encoder and is not executed here. Generate LOD0/1/2 as explicit reviewed variants; the first pipeline command does not automatically generate perceptually correct LODs. Output has SHA-256 filenames and a matching manifest. Upload them to Supabase Storage; configure immutable `Cache-Control` for hash-named files. Do not commit an asset library to Git.

The separate `@cortex/asset-runtime/glb-loader` entry integrates GLTFLoader, MeshoptDecoder, KTX2Loader and optional Draco. Before parsing it verifies response status, byte size and SHA-256. A caller provides locally hosted `/basis/` and `/draco/` decoder files copied from the pinned Three.js distribution if those codecs are used; this foundation does not eagerly ship decoders. Invalid/missing/network assets have distinct error codes. ResourceCache shares concurrent requests through active leases; releasing the last owner disposes shared geometry/material/texture resources. Decoder cleanup refuses active leases.

The generic board uses repeated instanced decoration boxes and no bitmap textures. Decorative instances are non-selectable; selectable slots remain separate semantic regions. Future selectable instances need an explicit instance-index → semantic-ID map. Persistent browser caching, model upload automation, downloaded model certification and texture-tier selection are later milestones.
