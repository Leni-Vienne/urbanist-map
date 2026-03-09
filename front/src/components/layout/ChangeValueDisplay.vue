<template>
  <!-- Geometry field with preview buttons -->
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

  <!-- City field with clickable locations -->
  <div
    v-else-if="change.fieldName === 'cityId'"
    class="flex items-start gap-2 my-1 text-xs flex-wrap"
  >
    <span
      class="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 rounded-sm wrap-break-word max-w-37"
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

  <!-- Geometry (shapes) field -->
  <div
    v-else-if="change.fieldName === 'geometry'"
    class="flex items-start gap-2 my-1 text-xs flex-wrap"
  >
    <span
      class="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 rounded-sm"
      >{{ formatGeometrySummary(change.oldValue) }}</span
    >
    <i class="pi pi-arrow-right self-center"></i>
    <span class="text-tag-warn-color bg-tag-warn-background px-1 py-0.5 rounded-sm">{{
      formatGeometrySummary(change.newValue)
    }}</span>
  </div>

  <!-- Regular field with formatted values -->
  <div v-else class="flex items-start gap-2 my-1 text-xs flex-wrap">
    <span
      class="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 rounded-sm wrap-break-word max-w-37"
      >{{ formatValue(change.oldValue, change.fieldName, change) }}</span
    >
    <i class="pi pi-arrow-right self-center"></i>
    <span
      class="text-tag-warn-color bg-tag-warn-background px-1 py-0.5 rounded-sm wrap-break-word max-w-37"
      >{{ formatValue(change.newValue, change.fieldName, change) }}</span
    >
  </div>

  <!-- Change reason if provided -->
  <div v-if="change.changeReason" class="text-xs text-(--p-text-color-secondary) mt-1">
    <em>{{ $t("moderation.reason") }}: {{ change.changeReason }}</em>
  </div>

  <!-- Change date and contributor -->
  <div class="text-xs text-muted-color mt-1">
    <em>
      <ContributorInfo
        :date="change.createdAt"
        :contributor-id="change.requestedBy"
        :contributor-username="(change as any).requestedByUsername"
        :report-count="(change as any).requestedByReportCount ?? 0"
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

function formatGeometrySummary(value: unknown): string {
  if (!value || typeof value !== "object") return t("overlay.notSet");
  const geo = value as { geometries?: unknown[] };
  const count = geo.geometries?.length ?? 0;
  if (count === 0) return t("overlay.notSet");
  return t("shapes.geometrySummary", { count });
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
