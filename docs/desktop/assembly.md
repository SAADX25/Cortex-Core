# Phase 2 assembly

Open Motherboard Explorer and choose **Assembly**, or open **PC Builder**. Select a fictional CPU, memory kit or NVMe fixture from the embedded Hardware Library selector. The full Hardware Library also exposes Install and installed-part actions.

Choose **Install**, select or hover an available destination, and confirm **Install into …**. The transparent preview and muted slot highlight indicate the chosen position. Camera focus is optional; orbit remains available. The CPU socket is unique, DIMMs A1/A2/B1/B2 are independent, and the two M.2 positions have independent interface checks. Occupied slots cannot accept an ordinary install. Use Replace explicitly, or Remove to free a position. Clicking an installed part opens its assembly details.

The fixture memory record is a two-module kit with **16 GB per module**. Two placements therefore produce 32 GB. This milestone permits repeated fixture instances to exercise all slots; it is not an inventory/kit purchase tracker. CPU compatibility retains the BIOS support warning from the existing engine, rather than certifying fictional hardware as a real compatible PC.

All operations save through the native boundary before the displayed build changes. Close/reopen restores the build from the OS-local SQLite database. Reset Build requires confirmation and preserves catalog/settings. Invalid or newer saved data disables assembly without replacing the original data.

Run `pnpm test:desktop` for the existing native explorer smoke plus the new assembly smoke. The automated restart deliberately terminates the runner-owned native process after an awaited atomic save and starts a fresh instance; normal native-frame close is checked separately. Test CDP arguments are injected only by the runner. Normal launches do not enable debugging.

Only fictional CPU, RAM and M.2 2280 NVMe installation is supported. Named build collections, file export/import, GPU/PSU/case/cooling assembly and large real-product datasets remain later work.
