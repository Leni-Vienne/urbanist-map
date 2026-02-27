<template>
  <div>
    <!-- AI : Shared Edit Overlay Dialog - can be opened via store or via openDialog() method -->
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
            />
            <label for="overlay-name-input" class="text-gray-600">{{ $t("common.name") }}</label>
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

// AI : Define document.body as a variable to avoid TypeScript errors
const bodyElement = document.body;

// AI : Props for direct usage (e.g., from PopupContainer)
const props = defineProps<{
  overlayObject?: OverlayObject | null;
}>();

// AI : Define emits for the component
const emit = defineEmits<(e: "update", overlayId: string, caption?: string) => void>();

const toast = useToast();
const { t } = useI18n();
const uiStore = useUiStore();

// AI : Local dialog state for direct openDialog() usage
const localDialogVisible = ref(false);

// AI : Computed visibility that works with BOTH store state and local state
// AI : Store takes precedence when overlay is provided via store
const dialogVisible = computed({
  get: () => {
    // AI : If store has an overlay, use store visibility
    if (uiStore.overlayEditDialog.overlay) {
      return uiStore.overlayEditDialog.visible;
    }
    // AI : Otherwise use local state (triggered via openDialog())
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

// AI : Get current overlay from store or props
const currentOverlay = computed(() => {
  return uiStore.overlayEditDialog.overlay ?? props.overlayObject ?? null;
});

// AI : Local state for editing overlay information
const editingInfo = ref({
  caption: "",
});

// AI : Initialize editing state when overlay changes (from store)
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

// AI : Open the dialog for editing overlay information (legacy method for PopupContainer)
function openDialog() {
  if (!props.overlayObject) {
    console.warn("Cannot open overlay editor without overlayObject prop");
    return;
  }
  // AI : Reset form with current values from the prop overlay
  editingInfo.value = {
    caption: props.overlayObject.caption ?? "",
  };
  localDialogVisible.value = true;
}

// AI : Close dialog (handles both modes)
function closeDialog() {
  dialogVisible.value = false;
}

// AI : Handle dialog hide event
function onDialogHide() {
  // AI : Ensure store is cleaned up if used
  if (uiStore.overlayEditDialog.overlay) {
    uiStore.closeOverlayEditDialog();
  }
  localDialogVisible.value = false;
}

// AI : Check if there are actual changes to save
const hasChanges = computed(() => {
  const overlay = currentOverlay.value;
  if (!overlay) return false;
  return editingInfo.value.caption !== (overlay.caption ?? "");
});

// AI : Save changes to the overlay
// AI : Uses unified pendingModificationsStore for all caption changes
// AI : User clicks Save button on project card to submit to backend
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
    // AI : updateOverlayInfo handles both the in-memory update and pendingModsStore sync
    updateOverlayInfo(overlay.id, {
      caption: editingInfo.value.caption ?? undefined,
    });

    // AI : Emit update event for PopupContainer to update marker tooltip
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

// AI : Expose the openDialog function to parent components (for PopupContainer compatibility)
defineExpose({
  openDialog,
});
</script>
