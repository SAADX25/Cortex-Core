export type CpuFamily = 'intel' | 'amd' | 'unknown';

/** Identity only selects a generic template; it never proves a socket or exact asset. */
export function cpuIdentity(name: string, manufacturer = '') {
  const family: CpuFamily = /\bintel\b|GenuineIntel/i.test(name + ' ' + manufacturer)
    ? 'intel'
    : /\bAMD\b|\bRyzen\b|AuthenticAMD|Advanced Micro Devices/i.test(name + ' ' + manufacturer)
      ? 'amd'
      : 'unknown';
  return {
    family,
    name,
    template: `generic-${family}-desktop-cpu`,
    note:
      family === 'intel'
        ? 'Generic Intel CPU visualization'
        : family === 'amd'
          ? 'Generic AMD CPU visualization'
          : 'Generic CPU visualization',
  };
}
