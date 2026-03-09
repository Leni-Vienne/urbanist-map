<template>
  <div
    class="shape-editor-panel fixed bottom-6 left-1/2 -translate-x-1/2 z-1100 bg-content-background rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.14),0_2px_6px_rgba(0,0,0,0.06)] pointer-events-auto px-4 py-3 flex flex-col gap-3"
  >
    <p class="text-sm text-muted-color max-w-xs text-center">
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

      <!-- Clear all -->
      <Button
        :label="$t('shapes.clearAll')"
        icon="pi pi-trash"
        severity="secondary"
        outlined
        size="small"
        @click="handleClearAll"
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
import { map } from "@/services/core/map";

defineProps<{
  projectId: string;
}>();

const emit = defineEmits<{
  done: [geometry: GeoJSON.GeometryCollection];
  cancel: [];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);

function triggerFileInput() {
  fileInputRef.value?.click();
}

async function handleFileImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const { loadGeoJSONFile, addLayersFromGeometry } = await import("@/services/shape/shapeEditing");
  const geometry = await loadGeoJSONFile(file);
  addLayersFromGeometry(map.value, geometry);
  // Reset input so the same file can be re-imported
  if (fileInputRef.value) fileInputRef.value.value = "";
}

async function handleClearAll() {
  const { destroyShapeEditor, initShapeEditor } = await import("@/services/shape/shapeEditing");
  destroyShapeEditor(map.value);
  initShapeEditor(map.value);
}

async function handleSave() {
  const { getDrawnGeometry } = await import("@/services/shape/shapeEditing");
  const geometry = getDrawnGeometry(map.value);
  emit("done", geometry);
}
</script>
