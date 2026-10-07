import { create } from 'zustand';
import type { Part } from '@cortex/part-schema';
import {
  emptyBuild,
  parseBuild,
  install,
  remove,
  replace,
  type Build,
  type SlotId,
} from '@cortex/build-domain';
import { isDesktop, loadDesktopBuild, saveDesktopBuild } from './platform';

export interface VisualTransition {
  slotId: SlotId;
  partId: string;
  phase: 'installing' | 'removing';
  startedAt: number;
}
interface BuildWorkspace {
  build: Build | null;
  catalog: Part[];
  ready: boolean;
  blocked: boolean;
  busy: boolean;
  notice: string;
  chosenPartId: string | null;
  choosing: boolean;
  preview: SlotId | null;
  replacing: SlotId | null;
  transitions: VisualTransition[];
  initialize(catalog: Part[]): Promise<void>;
  choose(partId: string): void;
  begin(replacing?: SlotId): void;
  cancel(): void;
  setPreview(slotId: SlotId | null): void;
  commit(slotId: SlotId): Promise<void>;
  remove(slotId: SlotId): Promise<void>;
  reset(): Promise<void>;
}
const browserKey = 'cortex.development-build.v1';
let initialization: Promise<void> | null = null;
let animationTimer: ReturnType<typeof setTimeout> | undefined;
export const useBuildStore = create<BuildWorkspace>((set, get) => {
  const persist = async (next: Build, transitions: VisualTransition[]) => {
    if (get().blocked || get().busy) return;
    set({ busy: true, notice: 'Saving build…' });
    try {
      const validated = parseBuild(next, get().catalog);
      if (isDesktop) await saveDesktopBuild(validated);
      else localStorage.setItem(browserKey, JSON.stringify(validated));
      clearTimeout(animationTimer);
      set({
        build: validated,
        transitions: transitions.map((t) => ({ ...t, startedAt: performance.now() })),
        notice: 'Build saved locally.',
        choosing: false,
        preview: null,
        replacing: null,
      });
      animationTimer = setTimeout(
        () => {
          set({ transitions: [], busy: false });
          animationTimer = undefined;
        },
        transitions.length && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 1400 : 0,
      );
    } catch (error) {
      set({ busy: false, notice: `Build was not changed: ${String(error)}` });
    }
  };
  return {
    build: null,
    catalog: [],
    ready: false,
    blocked: false,
    busy: false,
    notice: '',
    chosenPartId: null,
    choosing: false,
    preview: null,
    replacing: null,
    transitions: [],
    async initialize(catalog) {
      if (initialization) return initialization;
      initialization = (async () => {
        try {
          const data: unknown = isDesktop
            ? await loadDesktopBuild()
            : JSON.parse(localStorage.getItem(browserKey) ?? 'null');
          const board = catalog.find((p) => p.category === 'motherboard');
          if (!board) throw new Error('No motherboard available.');
          const build = data === null ? emptyBuild(board.id) : parseBuild(data, catalog);
          set({
            build,
            catalog,
            ready: true,
            notice: data === null ? 'Empty development build.' : 'Development build restored.',
          });
        } catch {
          // Never turn invalid/newer data into an empty build that would overwrite the original.
          set({
            catalog,
            ready: true,
            blocked: true,
            notice:
              'The saved build is invalid, unavailable or newer than supported. Assembly is disabled; the original data is preserved.',
          });
        }
      })();
      return initialization;
    },
    choose(chosenPartId) {
      if (!get().busy) set({ chosenPartId, choosing: false, preview: null, replacing: null });
    },
    begin(replacing) {
      if (!get().busy)
        set({ choosing: true, preview: replacing ?? null, replacing: replacing ?? null });
    },
    cancel() {
      set({ choosing: false, preview: null, replacing: null });
    },
    setPreview(preview) {
      set({ preview });
    },
    async commit(slotId) {
      const { build, chosenPartId, catalog, replacing } = get();
      if (!build || !chosenPartId || get().busy) return;
      try {
        if (replacing && slotId !== replacing)
          throw new Error('Choose the explicit replacement slot.');
        const next = replacing
          ? replace(build, chosenPartId, slotId, catalog)
          : install(build, chosenPartId, slotId, catalog);
        await persist(next, [
          { slotId, partId: chosenPartId, phase: 'installing', startedAt: performance.now() },
        ]);
      } catch (error) {
        set({ notice: String(error) });
      }
    },
    async remove(slotId) {
      const { build, busy } = get();
      if (!build || busy) return;
      const item = build.installations.find((i) => i.slotId === slotId);
      if (!item) return;
      await persist(remove(build, slotId), [
        { ...item, phase: 'removing', startedAt: performance.now() },
      ]);
    },
    async reset() {
      if (get().build) await persist(emptyBuild(get().build!.motherboardId), []);
    },
  };
});
