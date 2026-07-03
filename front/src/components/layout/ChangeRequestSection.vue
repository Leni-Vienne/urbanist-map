<template>
  <div :class="['mt-4', containerClass]">
    <div v-if="showHeader" class="mb-2.5">
      <div class="flex items-center gap-1.5">
        <i class="pi pi-info-circle text-amber-700 dark:text-amber-400 text-[11px]"></i>
        <span class="text-[13px] font-medium text-amber-800 dark:text-amber-400">
          {{
            isMyContributions
              ? $t("moderation.yourPendingChanges")
              : isOverlayChanges
                ? $t("moderation.pendingChangesFor", { name: entityName })
                : $t("moderation.pendingChanges")
          }}
        </span>
      </div>
      <p v-if="isMyContributions" class="mt-1.5 text-xs text-muted-color italic">
        {{ $t("moderation.moderatorReviewRequired") }}
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <!-- Iterate over grouped changes -->
      <template
        v-for="group in groupedChanges"
        :key="
          group.type === 'single'
            ? group.change.id
            : `conflict-${group.entityId}-${group.fieldName}`
        "
      >
        <!-- Single non-conflicting change -->
        <div
          v-if="group.type === 'single'"
          class="bg-content-background border border-surface rounded-lg p-2"
        >
          <div class="flex flex-row items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span
                  class="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-color"
                  >{{ formatFieldName(group.change.fieldName) }}</span
                >
              </div>
              <ChangeValueDisplay
                :change="group.change"
                :projects="projects"
                :is-preview-active="isPreviewActive"
                :show-user-stats-link="showUserStatsLink"
                @preview-geometry="previewGeometry"
                @click-contributor="handleClickContributor"
              />
            </div>
            <div v-if="$slots['change-actions']" class="flex gap-1 justify-end shrink-0">
              <slot name="change-actions" :change="group.change"></slot>
            </div>
          </div>
        </div>

        <!-- Grouped conflicting changes -->
        <div
          v-else
          class="border-2 border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-950/20 rounded-lg overflow-hidden"
        >
          <div
            class="flex items-center gap-2 px-2 py-2 bg-blue-100 dark:bg-blue-900/40 border-b border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-semibold text-[0.8125rem]"
          >
            <i
              class="pi pi-info-circle text-blue-600 dark:text-blue-400 cursor-help text-base"
              v-tooltip.top="$t('moderation.resolveConflictsTooltip')"
            ></i>
            <span>{{ $t("moderation.conflictDetected") }}</span>
          </div>

          <!-- List all competing changes -->
          <div
            v-for="change in group.changes"
            :key="change.id"
            class="bg-content-background rounded-lg mx-2 px-3 py-2 my-2 border border-blue-200 dark:border-blue-700 first:mt-3 last:mb-2 hover:bg-blue-50/40 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-600 transition-colors duration-150"
          >
            <div class="flex flex-row items-center gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1"></div>
                <ChangeValueDisplay
                  :change="change"
                  :projects="projects"
                  :is-preview-active="isPreviewActive"
                  :show-user-stats-link="showUserStatsLink"
                  @preview-geometry="previewGeometry"
                  @click-contributor="handleClickContributor"
                />
              </div>
              <div v-if="$slots['change-actions']" class="flex gap-1 justify-end shrink-0">
                <slot name="change-actions" :change="change"></slot>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";
import { useChangeRequestPreview } from "@/composables/overlay/useChangeRequestPreview";
import { useShapeChangeRequestPreview } from "@/composables/overlay/useShapeChangeRequestPreview";
import {
  syncPreviewStateOnNavigation,
  syncProjectShapePreviewState,
} from "@/services/overlay/changeRequestPreviewState";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import type { Project, Overlay, PendingChangeRequest } from "@/types/index";
import ChangeValueDisplay from "@/components/layout/ChangeValueDisplay.vue";

interface Props {
  changes: PendingChangeRequest[];
  allChangeRequests: PendingChangeRequest[];
  projects: Project[];
  isMyContributions?: boolean;
  isOverlayChanges?: boolean;
  entityName?: string;
  showHeader?: boolean;
  containerClass?: string;
  onNavigateToOverlay?: (overlayId: string) => Promise<void>;
  showUserStatsLink?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isMyContributions: false,
  isOverlayChanges: false,
  entityName: "",
  showHeader: true,
  containerClass: "",
  showUserStatsLink: false,
});

const emit = defineEmits<{
  "show-user-stats": [
    data: {
      userId: string;
      username?: string | null;
      approvedCount?: number | null;
      rejectedCount?: number | null;
      reportCount?: number;
    },
  ];
}>();

const { t } = useI18n();
const toast = useToast();
const overlayStore = useOverlayStore();
const focusStore = useFocusStore();
const {
  isPreviewingChange,
  getPreviewType,
  previewGeometry: previewGeometryComposable,
} = useChangeRequestPreview();
const { previewShapes } = useShapeChangeRequestPreview();

// Sync preview button state reactively. The sync functions read the mode's change request
// store internally, so this effect tracks both the focus selection and the store contents.
// IMPORTANT: do NOT read previewState inside this effect, it would create a read→write cycle.
watchEffect(() => {
  const selectedId = focusStore.selectedOverlayId;
  if (selectedId) {
    // Sync "view approved position" button for the currently selected overlay
    const sel = overlayStore.liveOverlays[selectedId];
    if (sel) {
      syncPreviewStateOnNavigation(selectedId, sel.isViewingApprovedPosition ?? true);
    }
  } else {
    // No overlay selected: sync "view current shapes" button for project geometry changes
    syncProjectShapePreviewState();
  }
});

function isPreviewActive(changeId: string, type: "old" | "new"): boolean {
  if (!isPreviewingChange(changeId)) return false;
  const previewType = getPreviewType(changeId);
  return (
    (type === "old" && previewType === "current") || (type === "new" && previewType === "suggested")
  );
}

// Group changes - separate conflicting changes from non-conflicting ones
type ChangeGroup =
  | {
      type: "single";
      change: PendingChangeRequest;
    }
  | {
      type: "conflict";
      fieldName: string;
      entityType: string;
      entityId: string;
      changes: PendingChangeRequest[];
    };

const groupedChanges = computed<ChangeGroup[]>(() => {
  const groups: ChangeGroup[] = [];
  const processedIds = new Set<string>();

  for (const change of props.changes) {
    if (processedIds.has(change.id)) continue;

    if (change.hasConflict) {
      // Find all conflicting changes for the same field
      const conflictingChanges = props.changes.filter(
        (c) =>
          c.entityType === change.entityType &&
          c.entityId === change.entityId &&
          c.fieldName === change.fieldName,
      );

      for (const c of conflictingChanges) {
        processedIds.add(c.id);
      }

      groups.push({
        type: "conflict",
        fieldName: change.fieldName,
        entityType: change.entityType,
        entityId: change.entityId,
        changes: conflictingChanges,
      });
    } else {
      // Single non-conflicting change
      processedIds.add(change.id);
      groups.push({
        type: "single",
        change,
      });
    }
  }

  return groups;
});

// Handle contributor click from ContributorInfo component
function handleClickContributor(data: {
  userId: string;
  username: string | null;
  reportCount: number;
}) {
  emit("show-user-stats", {
    userId: data.userId,
    username: data.username,
    approvedCount: 0, // Not available in change requests
    rejectedCount: 0, // Not available in change requests
    reportCount: data.reportCount,
  });
}

// Format field names for display using i18n
function formatFieldName(fieldName: string): string {
  const translationKey = `fields.${fieldName}`;
  const translated = t(translationKey);
  // If translation exists, use it; otherwise fall back to field name
  return translated !== translationKey ? translated : fieldName;
}

// Wrapper function to handle preview with proper error handling
async function previewGeometry(geometryValue: unknown, type: "old" | "new", changeId: string) {
  // Find the change request
  const change = props.allChangeRequests.find((c) => c.id === changeId);
  if (!change) {
    toast.add({
      severity: "error",
      summary: t("overlay.changeNotFound"),
      detail: t("overlay.couldNotFindChange"),
      life: 3000,
    });
    return;
  }

  if (change.entityType === "overlay") {
    // Find the overlay data
    let overlayForModeration: Overlay | null = null;
    for (const project of props.projects) {
      if (project.overlays) {
        overlayForModeration =
          project.overlays.find((o: Overlay) => o.id === change.entityId) ?? null;
        if (overlayForModeration) break;
      }
    }

    if (!overlayForModeration) {
      toast.add({
        severity: "error",
        summary: t("overlay.overlayNotFound"),
        detail: t("overlay.couldNotFindOverlay"),
        life: 3000,
      });
      return;
    }

    await previewGeometryComposable({
      change,
      overlayForModeration,
      geometryValue,
      type,
    });
  } else if (change.entityType === "project") {
    const project = props.projects.find((p) => p.id === change.entityId);
    if (!project) {
      toast.add({
        severity: "error",
        summary: t("overlay.changeNotFound"),
        detail: t("overlay.couldNotFindChange"),
        life: 3000,
      });
      return;
    }

    await previewShapes({ change, project, geometryValue, type });
  }
}
</script>
