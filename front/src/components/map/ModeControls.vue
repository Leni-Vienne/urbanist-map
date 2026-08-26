<template>
  <div
    class="flex justify-center items-center pointer-events-none"
    :class="isMobile ? 'relative z-20' : ''"
    @dblclick.stop
  >
    <button
      type="button"
      class="group appearance-none flex items-center gap-2 px-4 py-2 backdrop-blur-sm rounded-3xl font-semibold text-[0.9rem] border-2 transition-all duration-200 pointer-events-auto cursor-pointer select-none hover:scale-105 active:scale-[0.98]"
      :class="[
        uiStore.mode === 'edit'
          ? 'bg-amber-500/95 border-amber-600 text-white shadow-[0_4px_12px_rgba(245,158,11,0.4)] hover:shadow-[0_6px_16px_rgba(245,158,11,0.5)]'
          : uiStore.mode === 'moderation'
            ? 'bg-blue-500/95 border-blue-600 text-white shadow-[0_4px_12px_rgba(59,130,246,0.4)] hover:shadow-[0_6px_16px_rgba(59,130,246,0.5)]'
            : 'bg-content-background/95 border-surface text-color shadow-[0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.25)]',
      ]"
      @click="handleModeSwitch"
      :aria-label="$t('map.switchMode')"
    >
      <i :class="['pi', getModeIcon(), 'text-base']"></i>
      <span>{{ getModeLabel() }}</span>
      <i
        class="pi pi-refresh ml-1 opacity-70 text-[0.85rem] transition-transform duration-300 group-hover:opacity-100 group-hover:rotate-180"
      ></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { toastInfo } from "@/services/core/toast";

import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";

import { useI18n } from "vue-i18n";
import type { AppMode } from "@shared/types";

defineProps<{
  isMobile?: boolean;
}>();

const uiStore = useUiStore();
const authStore = useAuthStore();

const { t } = useI18n();

let lastToastTime = 0;
const TOAST_THROTTLE_MS = 1000;

function getModeIcon(): string {
  switch (uiStore.mode) {
    case "view":
      return "pi-eye";
    case "edit":
      return "pi-pencil";
    case "moderation":
      return "pi-shield";
    default:
      return "pi-eye";
  }
}

function getModeLabel(): string {
  switch (uiStore.mode) {
    case "view":
      return t("map.viewMode");
    case "edit":
      return t("map.editMode");
    case "moderation":
      return t("moderation.title");
    default:
      return t("map.viewMode");
  }
}

function getModeTooltip(): string {
  switch (uiStore.mode) {
    case "view":
      return t("map.viewModeTooltip");
    case "edit":
      return t("map.editModeTooltip");
    case "moderation":
      return t("moderation.description");
    default:
      return t("map.viewModeTooltip");
  }
}

const MODE_SUMMARY_KEYS = {
  view: "moderation.switchedToViewMode",
  edit: "moderation.switchedToEditMode",
  moderation: "moderation.switchedToModerationMode",
} satisfies Record<AppMode, string>;

// Cycle through modes: view → edit → moderation for moderators, view ↔ edit for regular users.
function handleModeSwitch() {
  const currentMode = uiStore.mode;

  let newMode: AppMode = "view";

  if (authStore.isModerator) {
    switch (currentMode) {
      case "view":
        newMode = "edit";
        break;
      case "edit":
        newMode = "moderation";
        break;
      case "moderation":
        newMode = "view";
        break;
      default:
    }
  } else {
    newMode = currentMode === "edit" ? "view" : "edit";
  }

  uiStore.setMode(newMode);

  const now = Date.now();
  if (now - lastToastTime >= TOAST_THROTTLE_MS) {
    lastToastTime = now;

    toastInfo(getModeTooltip(), t(MODE_SUMMARY_KEYS[newMode]));
  }
}
</script>
