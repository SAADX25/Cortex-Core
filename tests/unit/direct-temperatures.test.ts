import { describe, expect, it } from 'vitest';
import {
  formatCelsius,
  readDirectTemperatures,
} from '../../packages/application-ui/src/direct-temperatures';

describe('formatCelsius', () => {
  it('formats valid positive and negative numbers with 1 decimal place', () => {
    expect(formatCelsius(45.678)).toBe('45.7 °C');
    expect(formatCelsius(0)).toBe('0.0 °C');
    expect(formatCelsius(36.4)).toBe('36.4 °C');
    expect(formatCelsius(-12.34)).toBe('-12.3 °C');
  });

  it('returns "Not available" for null, undefined, NaN, and Infinity', () => {
    expect(formatCelsius(null)).toBe('Not available');
    expect(formatCelsius(undefined)).toBe('Not available');
    expect(formatCelsius(NaN)).toBe('Not available');
    expect(formatCelsius(Infinity)).toBe('Not available');
    expect(formatCelsius(-Infinity)).toBe('Not available');
  });
});

describe('readDirectTemperatures', () => {
  it('gracefully returns an empty structure in non-desktop environments', async () => {
    const data = await readDirectTemperatures();
    expect(data).toEqual({
      cpu: [],
      gpu: [],
      motherboard: [],
      storage: [],
      unavailable: [],
    });
  });
});
