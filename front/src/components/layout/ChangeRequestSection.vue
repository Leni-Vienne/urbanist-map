<template>
  <div :class="['mt-4', containerClass]">
    <div v-if="showHeader" class="mb-3">
      <div v-if="isOverlayChanges" class="flex items-center gap-2">
        <i class="pi pi-exclamation-triangle text-orange-500"></i>
        <span class="text-[0.8125rem] font-semibold text-orange-700">
          {{
            isMyContributions
              ? $t("moderation.yourPendingChanges")
              : $t("moderation.pendingChangesFor", { name: entityName })
          }}
        </span>
      </div>
      <h3 v-else class="m-0 mb-3 text-sm font-semibold text-surface-700">
        {{
          isMyContributions ? $t("moderation.yourPendingChanges") : $t("moderation.pendingChanges")
        }}
      </h3>
      <p v-if="isMyContributions" class="mt-2 text-xs text-surface-500 italic">
        {{ $t("moderation.moderatorReviewRequired") }}
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <!-- AI : Iterate over grouped changes -->
      <template
        v-for="group in groupedChanges"
        :key="
          group.type === 'single'
            ? group.change.id
            : `conflict-${group.entityId}-${group.fieldName}`
        "
      >
        <!-- AI : Single non-conflicting change -->
        <div
          v-if="group.type === 'single'"
          class="bg-surface-0 border border-surface-200 rounded p-2"
        >
          <div class="flex flex-row items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <strong class="text-surface-700 text-[0.8125rem]"
                  >{{ formatFieldName(group.change.fieldName) }}:</strong
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
            <div v-if="$slots['change-actions']" class="flex gap-1 justify-end flex-shrink-0">
              <slot name="change-actions" :change="group.change"></slot>
            </div>
          </div>
        </div>

        <!-- AI : Grouped conflicting changes -->
        <div v-else class="border-2 border-blue-300 bg-blue-50/30 rounded overflow-hidden">
          <div
            class="flex items-center gap-2 px-2 py-2 bg-blue-100 border-b border-blue-200 text-blue-700 font-semibold text-[0.8125rem]"
          >
            <i
              class="pi pi-info-circle text-blue-600 cursor-help text-base"
              v-tooltip.top="$t('moderation.resolveConflictsTooltip')"
            ></i>
            <span>{{ $t("moderation.conflictDetected") }}</span>
          </div>

          <!-- AI : List all competing changes -->
          <div
            v-for="change in group.changes"
            :key="change.id"
            class="bg-surface-0 rounded mx-2 px-3 py-2 my-2 border border-blue-200 first:mt-3 last:mb-2 hover:bg-blue-50/40 hover:border-blue-300 transition-colors duration-150"
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
              <div v-if="$slots['change-actions']" class="flex gap-1 justify-end flex-shrink-0">
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
import { setChangeRequestsForPreview } from "@/services/overlay/changeRequestPreviewState";
import type {
  ProjectForModeration,
  OverlayForModeration,
  PendingChangeRequest,
} from "@/types/index";
import ChangeValueDisplay from "@/components/layout/ChangeValueDisplay.vue";

interface Props {
  changes: PendingChangeRequest[];
  allChangeRequests: PendingChangeRequest[];
  projects: ProjectForModeration[];
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
const {
  isPreviewingChange,
  getPreviewType,
  previewGeometry: previewGeometryComposable,
} = useChangeRequestPreview();

// AI : Sync change requests for preview state tracking when navigating via markers
watchEffect(() => {
  setChangeRequestsForPreview(props.allChangeRequests);
});

// AI : Computed property to check if a specific preview is active
// AI : Preview state is now synced automatically when navigating to overlays via markers/selection
const isPreviewActive = computed(() => {
  return (changeId: string, type: "old" | "new") => {
    if (!isPreviewingChange(changeId)) return false;
    const previewType = getPreviewType(changeId);
    return (
      (type === "old" && previewType === "current") ||
      (type === "new" && previewType === "suggested")
    );
  };
});

// AI : Group changes - separate conflicting changes from non-conflicting ones
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
      // AI : Find all conflicting changes for the same field
      const conflictingChanges = props.changes.filter(
        (c) =>
          c.entityType === change.entityType &&
          c.entityId === change.entityId &&
          c.fieldName === change.fieldName,
      );

      // AI : Mark all as processed
      for (const c of conflictingChanges) {
        processedIds.add(c.id);
      }

      // AI : Add as conflict group
      groups.push({
        type: "conflict",
        fieldName: change.fieldName,
        entityType: change.entityType,
        entityId: change.entityId,
        changes: conflictingChanges,
      });
    } else {
      // AI : Single non-conflicting change
      processedIds.add(change.id);
      groups.push({
        type: "single",
        change,
      });
    }
  }

  return groups;
});

// AI : Handle contributor click from ContributorInfo component
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

// AI : Format field names for display using i18n
function formatFieldName(fieldName: string): string {
  const translationKey = `fields.${fieldName}`;
  const translated = t(translationKey);
  // AI : If translation exists, use it; otherwise fall back to field name
  return translated !== translationKey ? translated : fieldName;
}

// AI : Wrapper function to handle preview with proper error handling
async function previewGeometry(geometryValue: unknown, type: "old" | "new", changeId: string) {
  // AI : Find the change request
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

  // AI : Only handle overlay changes
  if (change.entityType !== "overlay") {
    return;
  }

  // AI : Find the overlay data
  let overlayForModeration: OverlayForModeration | null = null;
  for (const project of props.projects) {
    if (project.overlays) {
      overlayForModeration =
        project.overlays.find((o: OverlayForModeration) => o.id === change.entityId) ?? null;
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

  // AI : Delegate to composable
  await previewGeometryComposable({
    change,
    overlayForModeration,
    geometryValue,
    type,
  });
}
</script>
