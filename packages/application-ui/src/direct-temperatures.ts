/**
 * Types and polling logic for the direct Windows thermal readings.
 * Reads CPU, GPU, Motherboard and Storage temperatures/health directly via WMI/CIMV2 and vendor tools.
 * No LibreHardwareMonitor or manual setup required.
 */
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './platform';

export interface ThermalReading {
  name: string;
  celsius: number | null;
  detail?: string;
}

export interface StorageThermal {
  name: string;
  celsius: number | null;
  status: string;
  mediaType?: string;
  sizeGb?: number;
}

export interface DirectTemperatures {
  cpu: ThermalReading[];
  gpu: ThermalReading[];
  motherboard: ThermalReading[];
  storage: StorageThermal[];
  unavailable: string[];
}

const empty = (): DirectTemperatures => ({
  cpu: [],
  gpu: [],
  motherboard: [],
  storage: [],
  unavailable: [],
});

/**
 * Invoke the Tauri backend to read native Windows temperatures.
 * Returns an empty snapshot on browser / Safe-Mode.
 */
export async function readDirectTemperatures(): Promise<DirectTemperatures> {
  if (!isDesktop) return empty();
  try {
    return await invoke<DirectTemperatures>('read_direct_temperatures');
  } catch {
    return empty();
  }
}

/**
 * Format a Celsius value for display.
 * Returns "Not available" when the reading is null or absent.
 */
export function formatCelsius(celsius: number | null | undefined): string {
  if (celsius == null || !Number.isFinite(celsius)) return 'Not available';
  return `${celsius.toFixed(1)} °C`;
}
