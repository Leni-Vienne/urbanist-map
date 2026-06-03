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

  <div
    v-else-if="change.fieldName === 'cityId'"
    class="flex items-start gap-2 my-1 text-xs flex-wrap"
  >
    <span
      class="text-tag-success-color bg-tag-success-background px-1 py-0.5 rounded-sm wrap-break-word max-w-37"
    >
      <ClickableLocation
        v-if="change.oldValue"
        :city-id="Number(change.oldValue)"
        :city-name="change.oldCityName"
        :country-code="change.oldCountryCode"
        :country-name="change.oldCountryName"
      />
      <template v-else>{{ $t("overlay.notSet") }}</template>
    </span>
    <i class="pi pi-arrow-right"></i>
    <span
      class="text-tag-warn-color bg-tag-warn-background px-1 py-0.5 rounded-sm wrap-break-word max-w-37"
    >
      <ClickableLocation
        v-if="change.newValue"
        :city-id="Number(change.newValue)"
        :city-name="change.newCityName"
        :country-code="change.newCountryCode"
        :country-name="change.newCountryName"
      />
      <template v-else>{{ $t("overlay.notSet") }}</template>
    </span>
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
      >{{ formatValue(change.oldValue, change.fieldName, change) }}</span
    >
    <i class="pi pi-arrow-right self-center"></i>
    <span
      class="text-tag-warn-color bg-tag-warn-background px-1 py-0.5 rounded-sm wrap-break-word max-w-37"
      >{{ formatValue(change.newValue, change.fieldName, change) }}</span
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
import type { ProjectForModeration, PendingChangeRequest } from "@/types/index";
import ClickableLocation from "@/components/common/ClickableLocation.vue";
import ContributorInfo from "@/components/common/ContributorInfo.vue";

interface Props {
  change: PendingChangeRequest;
  projects: ProjectForModeration[];
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

function formatValue(value: unknown, fieldName: string, change?: PendingChangeRequest): string {
  if (value === null || value === undefined || value === "") {
    return t("overlay.notSet");
  }

  // Handle cityId field using backend-enriched data
  if (fieldName === "cityId" && typeof value === "string" && change) {
    const isOldValue = change.oldValue === value;
    const cityName = isOldValue ? change.oldCityName : change.newCityName;
    const countryName = isOldValue ? change.oldCountryName : change.newCountryName;

    if (cityName && countryName) {
      return `${cityName}, ${countryName}`;
    } else if (cityName) {
      return cityName;
    }

    return `City (${value.slice(0, 8)}...)`;
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
