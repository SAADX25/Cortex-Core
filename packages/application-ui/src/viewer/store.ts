import { create } from 'zustand';
import {
  isComponentId,
  type CameraAction,
  type ComponentId,
  type QualityMode,
} from '@cortex/3d-engine';
interface ViewerState {
  selected: ComponentId | null;
  hovered: ComponentId | null;
  exploded: boolean;
  labels: boolean;
  quality: QualityMode;
  cameraCommand: { action: CameraAction; revision: number };
  select(id: string | null): void;
  hover(id: ComponentId | null): void;
  toggleExploded(): void;
  toggleLabels(): void;
  setQuality(quality: QualityMode): void;
  camera(action: CameraAction): void;
  clear(): void;
}
const initial = {
  selected: null,
  hovered: null,
  exploded: false,
  labels: false,
  quality: 'auto' as QualityMode,
  cameraCommand: { action: 'reset' as const, revision: 0 },
};
export const useViewerStore = create<ViewerState>((set) => ({
  ...initial,
  select(id) {
    if (id !== null && !isComponentId(id)) return;
    set({ selected: id });
  },
  hover(id) {
    set({ hovered: id });
  },
  toggleExploded() {
    set((state) => ({ exploded: !state.exploded }));
  },
  toggleLabels() {
    set((state) => ({ labels: !state.labels }));
  },
  setQuality(quality) {
    set({ quality });
  },
  camera(action) {
    set((state) => ({ cameraCommand: { action, revision: state.cameraCommand.revision + 1 } }));
  },
  clear() {
    set({ ...initial, cameraCommand: { ...initial.cameraCommand } });
  },
}));
