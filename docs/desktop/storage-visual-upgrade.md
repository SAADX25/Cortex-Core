# Generic storage families

Detected physical disks now resolve through `packages/asset-runtime/src/storage-visuals.ts`. The Windows scanner remains the source of disk records; partitions are not added to the inventory. Names are used as labels, not evidence of protocol, physical form or an exact asset match.

| Reported evidence                                | Generic illustration                                              |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| HDD/rotating media or a positive spindle speed   | Thick 3.5-inch-style metal enclosure, top plate and screw regions |
| SSD and SATA interface                           | Thin 2.5-inch-style enclosure and connector hints                 |
| NVMe bus/interface                               | 2280-style board, gold contacts and controller/NAND hints         |
| Reported M.2 form without NVMe protocol evidence | Same module silhouette, with a generic M.2 notice                 |
| Missing, insufficient or contradictory evidence  | Neutral unknown storage enclosure                                 |

NVMe does not prove M.2 dimensions or motherboard mounting. The current scanner's disks stay in the inventory tray. Existing illustrative mounting requires consistent media evidence and explicitly reported M.2/NVMe; the inspector identifies it as illustrative. The tray spacing accommodates the different silhouettes without overlap.

Each disk uses a small local canvas decal for its full detected name and a generic visualization marking. Names wrap at word boundaries, with character wrapping for unusually long tokens. Labels retain their contrast under scene lighting; bodies keep their PBR materials. The texture survives geometry LOD changes and is disposed when its device or viewer unmounts. No static bitmap assets or remote requests are introduced. Inspector capacity, media and interface values remain the real scan values; the generic notice uses the same resolver as the model.

My PC, scanning, the optional Components chooser and the motion engine remain intact. The removed bottom grid is not restored.

## Validation

161 unit tests and all 17 Rust tests pass. Tests cover every family, ambiguous/contradictory metadata, no marketing-name guessing, M.2 versus protocol, nonoverlapping silhouettes, generated full model labels and texture disposal. Type checking, lint, production build and existing bundle budgets pass.

The browser storage fixture contains four physical disk records, including `KINGSTON SNVS500`. Mesh picking checks each exact detected inspector and generic notice. Quality replacement and repeated motion retain equal geometry/texture/material counts and zero settled idle draws. Screenshots and measurements are saved under `.artifacts/motion/`; packaged desktop results are under `.artifacts/desktop/`.

The final validation includes 29 passing desktop/mobile Chromium checks and one intentional desktop-only skip, with a timing-sensitive mobile orbit check passing on isolated rerun. Final storage label/focus tests and production/reconstruction harnesses pass. The final Windows package passes all 18 smoke checks, including real physical disk family/label matching, actual storage mesh inspection, four viewer reopen cycles and 25 animated motion cycles. Native resources remain 70 geometries, 7 textures and 52 materials before/after the cycles, with zero motion handles, zero settled idle draws, no page errors and no remote requests. The updated development executable, installer and checksum manifest are in `release/windows-x64/`.
