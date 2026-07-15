// Single ordered entry point for map-mode changes.
//
// One watch on mapStore.mode drives an ordered hook list instead of several independently
// registered watchers. Hooks run in registration order; a synchronous hook runs inline, and an
// async hook is awaited before the next one starts, so a hook may rely on every earlier hook
// having finished. A throwing hook is logged and does not block the ones behind it.
import { watch } from "vue";
import { useMapStore } from "@/stores/mapStore";
import type { AppMode } from "@shared/types";

type ModeTransitionHook = (newMode: AppMode, oldMode: AppMode) => void | Promise<void>;

const hooks: { name: string; run: ModeTransitionHook }[] = [];

/** Register a mode-transition step. Call order defines run order. */
export function onModeTransition(name: string, run: ModeTransitionHook): () => void {
  const hook = { name, run };
  hooks.push(hook);

  return function unregisterModeTransition(): void {
    const index = hooks.indexOf(hook);
    if (index !== -1) hooks.splice(index, 1);
  };
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

export function watchModeTransitions(): () => void {
  const mapStore = useMapStore();
  return watch(
    () => mapStore.mode,
    (newMode, oldMode) => {
      void runModeTransition(newMode, oldMode);
    },
  );
}
