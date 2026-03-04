<template>
  <Dialog
    v-model:visible="isVisible"
    :header="
      isReplacementMode ? $t('imageUpload.replacementDialogTitle') : $t('imageUpload.dialogTitle')
    "
    :modal="true"
    :closable="true"
    :closeOnEscape="true"
    :dismissableMask="true"
    :draggable="false"
    :resizable="false"
    :style="{ width: '600px' }"
    @hide="handleClose"
  >
    <div class="flex flex-col gap-4 py-2">
      <!-- Instructions Section - always visible -->
      <p class="text-sm text-(--p-text-color-secondary) leading-relaxed m-0">
        {{ $t("imageUpload.uploadDescription") }}
      </p>

      <!-- PDF Extraction Section with TokenTool Link - always visible -->
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-color m-0">
          {{ $t("imageUpload.pdfExtraction") }}
        </h3>
        <i18n-t
          keypath="imageUpload.pdfExtractionDescription"
          tag="p"
          class="text-sm text-(--p-text-color-secondary) leading-relaxed m-0"
        >
          <template #toolLink>
            <a
              href="https://www.rptools.net/toolbox/token-tool/"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary-500 no-underline font-medium transition-colors duration-200 hover:text-primary-600 hover:underline"
            >
              {{ $t("imageUpload.tokenToolLink") }}
            </a>
          </template>
        </i18n-t>
      </div>

      <!-- File Upload Drop Zone - compact with integrated preview -->
      <div
        class="rounded-lg p-4 transition-all duration-200 min-h-30 flex items-center justify-center border-2 border-dashed"
        :class="
          selectedFile
            ? 'border-green-300 bg-green-50 cursor-default'
            : 'border-surface bg-content-hover-background cursor-pointer hover:border-primary-400 hover:bg-primary-50'
        "
        @drop.prevent="handleDrop"
        @dragover.prevent="handleDragOver"
        @dragleave="handleDragLeave"
      >
        <input
          ref="fileInputRef"
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          style="display: none"
          @change="handleFileInputChange"
        />

        <!-- Show preview and filename when file selected -->
        <div v-if="selectedFile" class="flex items-center gap-4 w-full cursor-pointer group">
          <img
            v-if="imagePreviewUrl"
            :src="imagePreviewUrl"
            alt="Preview"
            class="w-20 h-20 object-cover rounded-md border-2 border-green-200 shrink-0 group-hover:opacity-90 transition-opacity"
          />
          <div class="flex-1 flex flex-col gap-2 items-start">
            <p class="text-sm font-medium text-green-900 font-mono break-all m-0">
              {{ selectedFileName }}
            </p>
            <Button
              :label="$t('imageUpload.changeImage')"
              icon="pi pi-refresh"
              @click="triggerFileInput"
              severity="secondary"
              outlined
              size="small"
            />
          </div>
        </div>

        <!-- Show drop zone when no file selected -->
        <div
          v-else
          class="flex flex-col items-center gap-2 text-center w-full"
          @click="triggerFileInput"
        >
          <i class="pi pi-cloud-upload text-[2rem] text-primary-500"></i>
          <p class="text-sm font-medium text-color m-0">
            {{ $t("imageUpload.dragDrop") }}
          </p>
          <p class="text-xs text-muted-color m-0">
            {{ $t("imageUpload.orClick") }}
          </p>
          <p class="text-[0.7rem] text-muted-color m-0">
            {{ $t("imageUpload.supportedFormats") }}
          </p>
        </div>
      </div>

      <!-- Inline error message for file validation -->
      <p v-if="fileSizeError" class="flex items-center gap-2 text-red-600 text-sm font-medium m-0">
        <i class="pi pi-exclamation-triangle"></i>
        {{ fileSizeError }}
      </p>
    </div>

    <template #footer>
      <Button
        v-if="selectedFile"
        :label="$t('common.confirm')"
        icon="pi pi-check"
        @click="handleConfirm"
        severity="primary"
      />
      <Button
        v-else
        :label="$t('common.cancel')"
        icon="pi pi-times"
        @click="handleClose"
        severity="secondary"
        outlined
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useToast } from "@/composables/ui/useToast";

const { t } = useI18n();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const toast = useToast();

const fileInputRef = ref<HTMLInputElement>();
const selectedFile = ref<File | null>(null);
const selectedFileName = ref("");
const imagePreviewUrl = ref("");
const imageDataUrl = ref("");
const fileSizeError = ref(""); // Inline error message for file validation

const isReplacementMode = computed(() => Boolean(overlayStore.replacementOverlayId));

// Computed visibility from store
const isVisible = computed({
  get: () => uiStore.imageUploadDialog.visible,
  set: (value: boolean) => {
    if (!value) {
      uiStore.closeImageUploadDialog();
    }
  },
});

// Reset state when dialog opens/closes
watch(
  () => uiStore.imageUploadDialog.visible,
  (visible) => {
    if (!visible) {
      selectedFile.value = null;
      selectedFileName.value = "";
      imagePreviewUrl.value = "";
      imageDataUrl.value = "";
      if (fileInputRef.value) {
        fileInputRef.value.value = "";
      }
    }
  },
);

// Trigger file input when drop zone is clicked
function triggerFileInput() {
  fileInputRef.value?.click();
}

// Handle file selection from input
function handleFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  processFile(file);
}

// Handle drag over event
function handleDragOver(event: DragEvent) {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

// Handle drag leave event
function handleDragLeave(event: DragEvent) {
  // Optional: Could add visual feedback here
}

// Handle drop event
function handleDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  // Reset file input to allow re-selecting same file
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }

  processFile(file);
}

// Process file (shared logic for input change and drop)
function processFile(file: File) {
  try {
    // Clear any previous error
    fileSizeError.value = "";

    // Validate file size before processing (10MB limit matches backend)
    const MAX_FILE_SIZE_MB = 10;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      // Show inline error instead of toast
      fileSizeError.value = t("upload.fileTooLarge", {
        maxSize: MAX_FILE_SIZE_MB,
      });
      // Reset file input to allow re-selecting a different file
      if (fileInputRef.value) {
        fileInputRef.value.value = "";
      }
      return;
    }

    // Store file and filename
    selectedFile.value = file;
    selectedFileName.value = file.name;

    // Read file to create preview and data URL
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = reader.result as string;
      imageDataUrl.value = dataUrl;
      imagePreviewUrl.value = dataUrl; // Use same URL for preview
    });
    reader.readAsDataURL(file);
  } catch (error) {
    console.error("Error handling file selection:", error);
    toast.add({
      severity: "error",
      summary: t("common.error"),
      detail: t("overlay.uploadFailedDetail"),
      life: 3000,
    });
  }
}

// Handle confirm - create overlay and close dialog
async function handleConfirm() {
  if (!selectedFile.value || !imageDataUrl.value) return;

  // Get project ID from store
  const projectId = uiStore.imageUploadDialog.projectId;
  if (!projectId) {
    toast.add({
      severity: "error",
      summary: t("common.error"),
      detail: t("errors.projectRequired"),
      life: 3000,
    });
    return;
  }

  try {
    const { addOverlay } = await import("@/services/overlay/overlayEditing");
    // Check if this is a replacement overlay
    const replacementId = overlayStore.replacementOverlayId;

    // Create overlay for this project (with or without replacement)
    addOverlay(imageDataUrl.value, projectId, replacementId ?? undefined);

    // Show appropriate success toast
    if (replacementId) {
      toast.add({
        severity: "success",
        summary: t("toasts.replacementOverlayCreated"),
        detail: t("toasts.replacementOverlayDetail"),
        life: 3000,
      });
      // Reset replacement state after creating the overlay
      overlayStore.resetReplacement();
    } else {
      toast.add({
        severity: "success",
        summary: t("overlay.overlayCreated"),
        detail: t("overlay.positionOverlayOnMap"),
        life: 3000,
      });
    }

    // Close dialog
    uiStore.closeImageUploadDialog();
  } catch (error) {
    console.error("Error creating overlay:", error);
    toast.add({
      severity: "error",
      summary: t("overlay.uploadFailed"),
      detail: t("overlay.uploadFailedDetail"),
      life: 3000,
    });
  }
}

// Handle dialog close
function handleClose() {
  uiStore.closeImageUploadDialog();
}
</script>
