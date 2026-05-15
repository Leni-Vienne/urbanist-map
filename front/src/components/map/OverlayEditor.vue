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
import { updateOverlayInfo } from "@/services/overlay/overlayActions";
import { useUiStore, type OverlayEditTarget } from "@/stores/uiStore";
import type { OverlayObject } from "@/types/index";

const bodyElement = document.body;

const props = defineProps<{
  overlayObject?: OverlayObject | null;
}>();

const emit = defineEmits<(e: "update", overlayId: string, caption?: string) => void>();

const toast = useToast();
const { t } = useI18n();
const uiStore = useUiStore();

const localDialogVisible = ref(false);

// dialogVisible works with both store state (when overlay is set via store)
// and local state (when triggered via openDialog()).
const dialogVisible = computed({
  get: () => {
    if (uiStore.overlayEditDialog.overlay) {
      return uiStore.overlayEditDialog.visible;
    }
    // Otherwise use local state (triggered via openDialog())
    return localDialogVisible.value;
  },
  set: (value: boolean) => {
    if (uiStore.overlayEditDialog.overlay) {
      if (!value) {
        uiStore.closeOverlayEditDialog();
      }
    } else {
      localDialogVisible.value = value;
    }
  },
});

const currentOverlay = computed(() => {
  return uiStore.overlayEditDialog.overlay ?? props.overlayObject ?? null;
});

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

function openDialog() {
  if (!props.overlayObject) {
    console.warn("Cannot open overlay editor without overlayObject prop");
    return;
  }
  editingInfo.value = {
    caption: props.overlayObject.caption ?? "",
  };
  localDialogVisible.value = true;
}

function closeDialog() {
  dialogVisible.value = false;
}

function onDialogHide() {
  if (uiStore.overlayEditDialog.overlay) {
    uiStore.closeOverlayEditDialog();
  }
  localDialogVisible.value = false;
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

    emit("update", overlay.id, editingInfo.value.caption);

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

defineExpose({
  openDialog,
});
</script>
