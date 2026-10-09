// The public startup check uses the same complete evidence and extended stability gate.
process.argv[2] = 'extended';
await import('./exit-investigation.mjs');
