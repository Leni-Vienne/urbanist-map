<template>
  <div
    class="absolute bottom-6 left-1/2 -translate-x-1/2 z-1100 bg-content-background rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.14),0_2px_6px_rgba(0,0,0,0.06)] pointer-events-auto px-4 py-3 flex flex-col gap-3 w-fit"
  >
    <!-- w-0 min-w-full: makes the paragraph match the container width without causing it to overflow -->
    <i18n-t
      keypath="shapes.editorInstructions"
      tag="p"
      class="text-sm text-muted-color w-0 min-w-full text-center"
    >
      <template #editButton>
        <span
          class="inline-flex items-center gap-1 align-middle whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[13px] font-medium text-color border-[color-mix(in_srgb,var(--p-primary-color)_35%,transparent)] bg-[color-mix(in_srgb,var(--p-primary-color)_12%,transparent)]"
        >
          <i class="pi pi-pencil text-xs" />
          {{ $t("shapes.editShapes") }}
        </span>
      </template>
    </i18n-t>
    <div class="flex gap-2 items-center justify-center">
      <!-- Draw tools -->
      <SelectButton
        v-model="activeMode"
        :options="drawModeOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        @update:model-value="handleModeChange"
      >
        <template #option="{ option }">
          <i :class="option.icon" />
          <span class="ml-1">{{ option.label }}</span>
        </template>
      </SelectButton>

      <span class="h-6 border-l border-surface" />

      <!-- Import GeoJSON (icon only, label on hover). Native title: a PrimeVue tooltip
           renders at z~1000 and is covered by this z-1100 panel. -->
      <Button
        :title="$t('shapes.importGeoJSONTooltip')"
        :aria-label="$t('shapes.importGeoJSONTooltip')"
        icon="pi pi-upload"
        severity="secondary"
        text
        rounded
        size="small"
        @click="triggerFileInput"
      />
      <input
        ref="fileInputRef"
        type="file"
        accept=".json,.geojson"
        class="hidden"
        @change="handleFileImport"
      />

      <span class="h-6 border-l border-surface" />

      <!-- Cancel -->
      <Button
        :label="$t('shapes.cancel')"
        severity="secondary"
        text
        size="small"
        class="whitespace-nowrap"
        @click="emit('cancel')"
      />

      <!-- Save -->
      <Button
        :label="$t('shapes.saveShapes')"
        icon="pi pi-check"
        severity="success"
        size="small"
        class="whitespace-nowrap"
        @click="handleSave"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";

import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import {
  addLayersFromGeometry,
  getDrawnGeometry,
  getLastDrawMode,
  loadGeoJSONFile,
  setDrawMode,
  type ShapeDrawMode,
} from "@/services/shape/shapeEditing";
import { extractTagsFromOsmProperties } from "@/config/projectTags";

const { t } = useI18n();
const toast = useToast();

const emit = defineEmits<{
  done: [geometry: GeoJSON.GeometryCollection];
  cancel: [];
  "suggest-tags": [tags: string[]];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);

// Terra Draw has no built-in toolbar, so the tool selection lives here.
// Restore the last tool the user picked (null on first ever open: no tool selected).
const activeMode = ref<ShapeDrawMode | null>(getLastDrawMode());

const drawModeOptions = [
  { value: "linestring" as const, label: t("shapes.drawLine"), icon: "pi pi-minus" },
  { value: "polygon" as const, label: t("shapes.drawPolygon"), icon: "pi pi-stop" },
  { value: "select" as const, label: t("shapes.editShapes"), icon: "pi pi-pencil" },
];

function handleModeChange(mode: ShapeDrawMode) {
  setDrawMode(mode);
}

function triggerFileInput() {
  fileInputRef.value?.click();
}

async function handleFileImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  // Reset input so the same file can be re-imported regardless of outcome
  if (fileInputRef.value) fileInputRef.value.value = "";
  try {
    const { geometry, skippedGeometryTypes, featureProperties } = await loadGeoJSONFile(file);

    if (featureProperties.length > 0) {
      const suggested = extractTagsFromOsmProperties(featureProperties);
      if (suggested.length > 0) emit("suggest-tags", suggested);
    }

    if (skippedGeometryTypes.length > 0) {
      toast.add({
        severity: "warn",
        summary: t("shapes.importGeoJSON"),
        detail: t("shapes.importSkippedGeometryTypes", {
          types: skippedGeometryTypes.join(", "),
        }),
        life: 4000,
      });
    }

    if (geometry.geometries.length === 0) return;

    const bounds = await addLayersFromGeometry(geometry);
    if (bounds) {
      mobileAwareFlyToBounds(bounds, { maxZoom: 17 });
    }
  } catch (error) {
    toast.add({
      severity: "error",
      summary: t("shapes.importError"),
      detail: error instanceof Error ? error.message : String(error),
      life: 6000,
    });
  }
}

async function handleSave() {
  const geometry = getDrawnGeometry();
  emit("done", geometry);
}
</script>
