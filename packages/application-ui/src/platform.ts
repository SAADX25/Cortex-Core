import { isTauri, invoke } from '@tauri-apps/api/core';
export const isDesktop = isTauri();
export interface DesktopStatus {
  appVersion: string;
  catalogVersion: string;
  assetManifestVersion: number;
  catalogOrigin: string;
  cacheStatus: string;
  offlineReady: boolean;
  assetCacheBytes: number;
  fullscreen: boolean;
  scaleFactor: number;
  windowWidth: number;
  windowHeight: number;
  packaged: boolean;
}
export const loadDesktopSnapshot = () => invoke<unknown>('load_catalog_snapshot');
export const loadDesktopBuild = () => invoke<unknown>('load_development_build');
export const saveDesktopBuild = (build: unknown) =>
  invoke<void>('save_development_build', { build });
let rendererCatalogFallback = false;
export const markCatalogFallback = () => {
  rendererCatalogFallback = true;
};
export const getDesktopStatus = async () => {
  const status = await invoke<DesktopStatus>('desktop_status');
  if (rendererCatalogFallback) status.cacheStatus = 'bundled-fallback (domain validation)';
  return status;
};
export const setDesktopFullscreen = (enabled: boolean) =>
  invoke<boolean>('set_viewer_fullscreen', { enabled });
export function recordGraphicsFailure(
  code: 'unsupported-webgl2' | 'context-lost' | 'renderer-load-failed',
) {
  if (isDesktop) void invoke('record_graphics_failure', { code }).catch(() => undefined);
}
export function openDocumentation(key: 'tauri' | 'hardware-sources' | 'sensor-source') {
  if (isDesktop) return invoke<void>('open_documentation', { key });
  window.open(
    key === 'tauri'
      ? 'https://v2.tauri.app/'
      : key === 'sensor-source'
        ? 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases'
        : 'https://www.khronos.org/gltf/',
    '_blank',
    'noopener,noreferrer',
  );
  return Promise.resolve();
}
// Future file operations use native dialogs and versioned .cortexbuild validation.
// This renderer deliberately has no generic path/file/process API.
