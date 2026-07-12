// Single ordered entry point for map-mode changes.
//
// One watch on mapStore.mode drives an ordered hook list instead of several independently
// registered watchers. Hooks run in registration order; a synchronous hook runs inline, and an
// async hook is awaited before the next one starts, so a hook may rely on every earlier hook
// having finished. A throwing hook is logged and does not block the ones behind it.
import { watch } from "vue";
import { useMapStore } from "@/stores/mapStore";
import { registerOnce } from "@/utils/registerOnce";
import type { AppMode } from "@shared/types";

type ModeTransitionHook = (newMode: AppMode, oldMode: AppMode) => void | Promise<void>;

const hooks: { name: string; run: ModeTransitionHook }[] = [];

/** Register a mode-transition step. Call order defines run order. */
export function onModeTransition(name: string, run: ModeTransitionHook): void {
  hooks.push({ name, run });
}

async function runModeTransition(newMode: AppMode, oldMode: AppMode): Promise<void> {
  for (const hook of hooks) {
    try {
      const result = hook.run(newMode, oldMode);
      if (result instanceof Promise) await result;
    } catch (error) {
      console.error(`Mode transition hook "${hook.name}" failed`, error);
    }
  }
}

function registerModeTransitionWatcher(): void {
  const mapStore = useMapStore();
  watch(
    () => mapStore.mode,
    (newMode, oldMode) => {
      void runModeTransition(newMode, oldMode);
    },
  );
}

/**
 * The single mapStore.mode watch. Register it ahead of any other mode-reactive watcher, so a
 * transition has run its hooks before those watchers observe the new mode.
 */
export const initializeModeTransitions = registerOnce(registerModeTransitionWatcher);
