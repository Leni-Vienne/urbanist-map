<template>
  <Dialog
    :visible="true"
    :header="$t('overlay.overlayName')"
    :modal="true"
    :closable="true"
    :closeOnEscape="true"
    :dismissableMask="true"
    :draggable="false"
    :appendTo="bodyElement"
    @update:visible="handleVisibilityChange"
  >
    <div class="p-fluid" @keydown.stop @keyup.stop @keypress.stop>
      <div class="field mb-4">
        <FloatLabel class="w-full" variant="in">
          <!-- @vue-expect-error PrimeVue v-model type mismatch -->
          <InputText
            id="overlay-name-input"
            v-model="editingInfo.caption"
            class="w-full p-3"
            autocomplete="off"
            dir="auto"
          />
          <label for="overlay-name-input" class="text-(--p-text-color-secondary)">{{
            $t("common.name")
          }}</label>
        </FloatLabel>
      </div>
    </div>
    <template #footer>
      <Button
        :label="$t('common.cancel')"
        icon="pi pi-times"
        @click="closeDialog"
        class="p-button-text"
      />
      <Button
        :label="$t('forms.saveChanges')"
        icon="pi pi-check"
        @click="saveChanges"
        class="p-button-primary"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { toastInfo, toastError } from "@/services/core/toast";

import { ref, computed } from "vue";

import { useI18n } from "vue-i18n";
import { updateOverlayInfo } from "@/services/overlay/data";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/overlayStore";

const bodyElement = document.body;

const { t } = useI18n();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const overlayId = uiStore.overlayEditTargetId;
const initialCaption = overlayId ? overlayStore.liveOverlays[overlayId]?.caption : undefined;

const editingInfo = ref({
  caption: initialCaption ?? "",
});

function closeDialog() {
  uiStore.closeOverlayEditDialog();
}

function handleVisibilityChange(visible: boolean) {
  if (!visible) closeDialog();
}

const hasChanges = computed(() => {
  return editingInfo.value.caption !== (initialCaption ?? "");
});

function saveChanges() {
  if (!overlayId || !overlayStore.liveOverlays[overlayId]) {
    console.error("No overlay to save");
    return;
  }

  if (!hasChanges.value) {
    toastInfo(t("overlay.noChangesToSave"));
    closeDialog();
    return;
  }

  try {
    updateOverlayInfo(overlayId, {
      caption: editingInfo.value.caption ?? undefined,
    });

    closeDialog();
  } catch (error) {
    console.error("Error updating overlay:", error);
    toastError(error instanceof Error ? error.message : t("overlay.publishFailedDetail"));
  }
}
</script>
