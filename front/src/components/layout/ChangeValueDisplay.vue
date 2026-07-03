<template>
  <div v-if="isGeometryField(change.fieldName)" class="my-2">
    <div class="flex gap-2 flex-wrap">
      <Button
        icon="pi pi-map-marker"
        :label="$t('overlay.viewCurrentPosition')"
        @click.stop="$emit('preview-geometry', change.oldValue, 'old', change.id)"
        severity="success"
        :outlined="!isPreviewActive(change.id, 'old')"
        size="small"
      />
      <Button
        icon="pi pi-map-marker"
        :label="$t('overlay.viewSuggestedPosition')"
        @click.stop="$emit('preview-geometry', change.newValue, 'new', change.id)"
        severity="warn"
        :outlined="!isPreviewActive(change.id, 'new')"
        size="small"
      />
    </div>
  </div>

  <div v-else-if="change.fieldName === 'geometry'" class="my-2">
    <div class="flex gap-2 flex-wrap">
      <Button
        v-if="hasGeometry(change.oldValue)"
        icon="pi pi-map-marker"
        :label="$t('shapes.viewCurrentShapes')"
        @click.stop="$emit('preview-geometry', change.oldValue, 'old', change.id)"
        severity="success"
        :outlined="!isPreviewActive(change.id, 'old')"
        size="small"
      />
      <Button
        v-if="hasGeometry(change.newValue)"
        icon="pi pi-map-marker"
        :label="$t('shapes.viewSuggestedShapes')"
        @click.stop="$emit('preview-geometry', change.newValue, 'new', change.id)"
        severity="warn"
        :outlined="!isPreviewActive(change.id, 'new')"
        size="small"
      />
    </div>
  </div>

  <div v-else class="flex items-start gap-2 my-1 text-xs flex-wrap">
    <span
      class="text-tag-success-color bg-tag-success-background px-1 py-0.5 rounded-sm wrap-break-word max-w-37"
      >{{ formatValue(change.oldValue, change.fieldName) }}</span
    >
    <i class="pi pi-arrow-right self-center"></i>
    <span
      class="text-tag-warn-color bg-tag-warn-background px-1 py-0.5 rounded-sm wrap-break-word max-w-37"
      >{{ formatValue(change.newValue, change.fieldName) }}</span
    >
  </div>

  <div v-if="change.changeReason" class="text-xs text-(--p-text-color-secondary) mt-1">
    <em>{{ $t("moderation.reason") }}: {{ change.changeReason }}</em>
  </div>

  <div class="text-xs text-muted-color mt-1">
    <em>
      <ContributorInfo
        :date="change.createdAt"
        :contributor-id="change.requestedBy"
        :contributor-username="change.requestedByUsername"
        :report-count="change.requestedByReportCount ?? 0"
        :clickable="showUserStatsLink"
        @click-contributor="handleClickContributor"
      />
    </em>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { Project, PendingChangeRequest } from "@/types/index";
import ContributorInfo from "@/components/common/ContributorInfo.vue";

interface Props {
  change: PendingChangeRequest;
  projects: Project[];
  isPreviewActive: (changeId: string, type: "old" | "new") => boolean;
  showUserStatsLink?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showUserStatsLink: false,
});

const emit = defineEmits<{
  "preview-geometry": [geometryValue: unknown, type: "old" | "new", changeId: string];
  "click-contributor": [data: { userId: string; username: string | null; reportCount: number }];
}>();

function handleClickContributor(data: {
  userId: string;
  username: string | null;
  reportCount: number;
}) {
  emit("click-contributor", data);
}

const { t } = useI18n();

function isGeometryField(fieldName: string): boolean {
  return fieldName === "corners" || fieldName === "centroid";
}

function hasGeometry(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const geo = value as { geometries?: unknown[] };
  return (geo.geometries?.length ?? 0) > 0;
}

function formatValue(value: unknown, fieldName: string): string {
  if (value === null || value === undefined || value === "") {
    return t("overlay.notSet");
  }

  if (fieldName === "corners" || fieldName === "centroid") {
    return t("overlay.coordinatesViewOnMap");
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
</script>
