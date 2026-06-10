<template>
  <div>
    <Dialog
      v-model:visible="dialogVisible"
      :header="$t('overlay.overlayInformation')"
      :modal="true"
      :closable="true"
      :closeOnEscape="true"
      :dismissableMask="true"
      :draggable="false"
      :resizable="false"
      :appendTo="bodyElement"
      :transitionOptions="{ disabled: true }"
      @keydown.stop
      @keyup.stop
      @keypress.stop
      @hide="onDialogHide"
    >
      <div class="p-fluid">
        <div class="field mb-4">
          <FloatLabel class="w-full" variant="in">
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useToast } from "@/composables/ui/useToast";
import { useI18n } from "vue-i18n";
import { updateOverlayInfo } from "@/services/overlay/actions";
import { useUiStore, type OverlayEditTarget } from "@/stores/uiStore";

const bodyElement = document.body;

const toast = useToast();
const { t } = useI18n();
const uiStore = useUiStore();

const dialogVisible = computed({
  get: () => uiStore.overlayEditDialog.visible,
  set: (value: boolean) => {
    if (!value) {
      uiStore.closeOverlayEditDialog();
    }
  },
});

const currentOverlay = computed(() => uiStore.overlayEditDialog.overlay);

const editingInfo = ref({
  caption: "",
});

watch(
  () => uiStore.overlayEditDialog.overlay,
  (overlay: OverlayEditTarget | null) => {
    if (overlay) {
      editingInfo.value = {
        caption: overlay.caption ?? "",
      };
    }
  },
  { immediate: true },
);

function closeDialog() {
  dialogVisible.value = false;
}

function onDialogHide() {
  uiStore.closeOverlayEditDialog();
}

const hasChanges = computed(() => {
  const overlay = currentOverlay.value;
  if (!overlay) return false;
  return editingInfo.value.caption !== (overlay.caption ?? "");
});

function saveChanges() {
  const overlay = currentOverlay.value;
  if (!overlay) {
    console.error("No overlay to save");
    return;
  }

  if (!hasChanges.value) {
    toast.add({
      severity: "info",
      summary: t("common.info"),
      detail: t("overlay.noChangesToSave"),
      life: 3000,
    });
    closeDialog();
    return;
  }

  try {
    updateOverlayInfo(overlay.id, {
      caption: editingInfo.value.caption ?? undefined,
    });

    closeDialog();
  } catch (error) {
    console.error("Error updating overlay:", error);
    toast.add({
      severity: "error",
      summary: t("common.error"),
      detail: error instanceof Error ? error.message : t("overlay.publishFailedDetail"),
      life: 3000,
    });
  }
}
</script>
