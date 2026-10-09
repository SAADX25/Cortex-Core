import { safetyArtifact } from './safety-artifact.mjs';
const artifact = safetyArtifact();
process.env.CORTEX_DESKTOP_EXE = artifact.executable;
// Original Update-10 test, unchanged; debug executable uses embedded local assets.
await import('./smoke.mjs');
