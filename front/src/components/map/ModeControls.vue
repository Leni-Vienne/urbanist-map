<template>
  <!-- AI : Shared mode controls component - used in both desktop and mobile -->
  <div
    class="flex justify-center items-center pointer-events-none"
    :class="isMobile ? 'relative z-20' : ''"
    @dblclick.stop
  >
    <button
      type="button"
      class="group appearance-none font-[inherit] flex items-center gap-2 px-4 py-2 backdrop-blur-sm rounded-[1.5rem] font-semibold text-[0.9rem] border-2 transition-all duration-200 pointer-events-auto cursor-pointer select-none hover:scale-105 active:scale-[0.98]"
      :class="[
        overlayStore.mode === 'edit'
          ? 'bg-amber-500/95 border-amber-600 text-white shadow-[0_4px_12px_rgba(245,158,11,0.4)] hover:shadow-[0_6px_16px_rgba(245,158,11,0.5)]'
          : overlayStore.mode === 'moderation'
            ? 'bg-blue-500/95 border-blue-600 text-white shadow-[0_4px_12px_rgba(59,130,246,0.4)] hover:shadow-[0_6px_16px_rgba(59,130,246,0.5)]'
            : 'bg-white/95 border-[var(--p-surface-border)] text-[var(--p-text-color)] shadow-[0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.25)]',
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
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useToast } from "@/composables/ui/useToast";
import { switchMode } from "@/services/overlay/modeSwitching";
import { useI18n } from "vue-i18n";
import type { AppMode } from "@shared/types";

defineProps<{
  isMobile?: boolean;
}>();

const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const toast = useToast();
const { t } = useI18n();

// AI : Track last toast time to prevent spam
let lastToastTime = 0;
const TOAST_THROTTLE_MS = 1000;

// AI : Flag to prevent recursive mode switching
let isSwitchingMode = false;

// AI : Get mode display info
function getModeIcon(): string {
  switch (overlayStore.mode) {
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
  switch (overlayStore.mode) {
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
  switch (overlayStore.mode) {
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

// AI : Cycle through modes (view -> edit -> moderation -> view) for moderators
// AI : For regular users, just toggle between view and edit
function handleModeSwitch() {
  // AI : Prevent recursive calls
  if (isSwitchingMode) {
    return;
  }

  try {
    isSwitchingMode = true;
    const currentMode = overlayStore.mode;

    let newMode: AppMode;

    if (authStore.isModerator) {
      // AI : Moderators cycle through all 3 modes
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
          newMode = "view";
      }
    } else {
      // AI : Regular users toggle between view and edit only
      newMode = currentMode === "edit" ? "view" : "edit";
    }

    // AI : Don't do anything if mode hasn't changed
    if (currentMode === newMode) {
      isSwitchingMode = false;
      return;
    }

    // AI : Use unified switchMode for all mode transitions (view/edit/moderation)
    // AI : This ensures consistent behavior and proper data reloading
    switchMode(newMode);

    // AI : Only show toast if enough time has passed since last one
    const now = Date.now();
    if (now - lastToastTime >= TOAST_THROTTLE_MS) {
      lastToastTime = now;

      // AI : Get the correct i18n key based on which mode we switched to
      const modeSummaryKeys: Record<AppMode, string> = {
        view: "moderation.switchedToViewMode",
        edit: "moderation.switchedToEditMode",
        moderation: "moderation.switchedToModerationMode",
      };

      toast.add({
        severity: "info",
        summary: t(modeSummaryKeys[newMode]),
        detail: getModeTooltip(),
        life: 3000,
      });
    }
  } catch (error) {
    console.error("Error toggling mode:", error);
    toast.add({
      severity: "error",
      summary: t("moderation.modeSwitchError"),
      detail: t("moderation.modeSwitchErrorDetail"),
      life: 3000,
    });
  } finally {
    isSwitchingMode = false;
  }
}
</script>
