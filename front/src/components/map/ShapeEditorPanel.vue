<template>
  <div
    class="fixed bottom-6 left-1/2 -translate-x-1/2 z-1100 bg-content-background rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.14),0_2px_6px_rgba(0,0,0,0.06)] pointer-events-auto px-4 py-3 flex flex-col gap-3 w-fit"
  >
    <!-- w-0 min-w-full: makes the paragraph match the container width without causing it to overflow -->
    <p class="text-sm text-muted-color w-0 min-w-full text-center">
      {{ $t("shapes.editorInstructions") }}
    </p>
    <div class="flex gap-2 items-center justify-center">
      <!-- Import GeoJSON -->
      <Button
        :label="$t('shapes.importGeoJSON')"
        icon="pi pi-upload"
        severity="secondary"
        outlined
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

      <!-- Cancel -->
      <Button
        :label="$t('shapes.cancel')"
        severity="secondary"
        size="small"
        @click="emit('cancel')"
      />

      <!-- Save -->
      <Button
        :label="$t('shapes.saveShapes')"
        icon="pi pi-check"
        severity="success"
        size="small"
        @click="handleSave"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";
import { map } from "@/services/core/map";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import {
  addLayersFromGeometry,
  getDrawnGeometry,
  loadGeoJSONFile,
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

    const bounds = await addLayersFromGeometry(map.value, geometry);
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
  const geometry = getDrawnGeometry(map.value);
  emit("done", geometry);
}
</script>
