<template>
  <Dialog
    v-model:visible="isVisible"
    :header="$t('imageUpload.dialogTitle')"
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
      <!-- AI : Instructions Section - always visible -->
      <p class="text-sm text-[var(--p-surface-600)] leading-relaxed m-0">
        {{ $t("imageUpload.uploadDescription") }}
      </p>

      <!-- AI : PDF Extraction Section with TokenTool Link - always visible -->
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-[var(--p-surface-900)] m-0">
          {{ $t("imageUpload.pdfExtraction") }}
        </h3>
        <i18n-t
          keypath="imageUpload.pdfExtractionDescription"
          tag="p"
          class="text-sm text-[var(--p-surface-600)] leading-relaxed m-0"
        >
          <template #toolLink>
            <a
              href="https://www.rptools.net/toolbox/token-tool/"
              target="_blank"
              rel="noopener noreferrer"
              class="text-[var(--p-primary-500)] no-underline font-medium transition-colors duration-200 hover:text-[var(--p-primary-600)] hover:underline"
            >
              {{ $t("imageUpload.tokenToolLink") }}
            </a>
          </template>
        </i18n-t>
      </div>

      <!-- AI : File Upload Drop Zone - compact with integrated preview -->
      <div
        class="rounded-lg p-4 transition-all duration-200 min-h-[120px] flex items-center justify-center border-2 border-dashed"
        :class="
          selectedFile
            ? 'border-[var(--p-green-300)] bg-[var(--p-green-50)] cursor-default'
            : 'border-[var(--p-surface-300)] bg-[var(--p-surface-50)] cursor-pointer hover:border-[var(--p-primary-400)] hover:bg-[var(--p-primary-50)]'
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

        <!-- AI : Show preview and filename when file selected -->
        <div v-if="selectedFile" class="flex items-center gap-4 w-full cursor-pointer group">
          <img
            v-if="imagePreviewUrl"
            :src="imagePreviewUrl"
            alt="Preview"
            class="w-20 h-20 object-cover rounded-md border-2 border-[var(--p-green-200)] shrink-0 group-hover:opacity-90 transition-opacity"
          />
          <div class="flex-1 flex flex-col gap-2 items-start">
            <p class="text-sm font-medium text-[var(--p-green-900)] font-mono break-all m-0">
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

        <!-- AI : Show drop zone when no file selected -->
        <div
          v-else
          class="flex flex-col items-center gap-2 text-center w-full"
          @click="triggerFileInput"
        >
          <i class="pi pi-cloud-upload text-[2rem] text-[var(--p-primary-500)]"></i>
          <p class="text-sm font-medium text-[var(--p-surface-700)] m-0">
            {{ $t("imageUpload.dragDrop") }}
          </p>
          <p class="text-xs text-[var(--p-surface-500)] m-0">{{ $t("imageUpload.orClick") }}</p>
          <p class="text-[0.7rem] text-[var(--p-surface-400)] m-0">
            {{ $t("imageUpload.supportedFormats") }}
          </p>
        </div>
      </div>

      <!-- AI : Inline error message for file validation -->
      <p
        v-if="fileSizeError"
        class="flex items-center gap-2 text-[var(--p-red-600)] text-sm font-medium m-0"
      >
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
const fileSizeError = ref(""); // AI : Inline error message for file validation

// AI : Computed visibility from store
const isVisible = computed({
  get: () => uiStore.imageUploadDialog.visible,
  set: (value: boolean) => {
    if (!value) {
      uiStore.closeImageUploadDialog();
    }
  },
});

// AI : Reset state when dialog opens/closes
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

// AI : Trigger file input when drop zone is clicked
function triggerFileInput() {
  fileInputRef.value?.click();
}

// AI : Handle file selection from input
function handleFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  processFile(file);
}

// AI : Handle drag over event
function handleDragOver(event: DragEvent) {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

// AI : Handle drag leave event
function handleDragLeave(event: DragEvent) {
  // Optional: Could add visual feedback here
}

// AI : Handle drop event
function handleDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  // AI : Reset file input to allow re-selecting same file
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }

  processFile(file);
}

// AI : Process file (shared logic for input change and drop)
function processFile(file: File) {
  try {
    // AI : Clear any previous error
    fileSizeError.value = "";

    // AI : Validate file size before processing (10MB limit matches backend)
    const MAX_FILE_SIZE_MB = 10;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      // AI : Show inline error instead of toast
      fileSizeError.value = t("upload.fileTooLarge", { maxSize: MAX_FILE_SIZE_MB });
      // AI : Reset file input to allow re-selecting a different file
      if (fileInputRef.value) {
        fileInputRef.value.value = "";
      }
      return;
    }

    // AI : Store file and filename
    selectedFile.value = file;
    selectedFileName.value = file.name;

    // AI : Read file to create preview and data URL
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

// AI : Handle confirm - create overlay and close dialog
async function handleConfirm() {
  if (!selectedFile.value || !imageDataUrl.value) return;

  // AI : Get project ID from store
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
    // AI : Check if this is a replacement overlay
    const replacementId = overlayStore.replacementOverlayId;

    // AI : Create overlay for this project (with or without replacement)
    addOverlay(imageDataUrl.value, projectId, replacementId ?? undefined);

    // AI : Show appropriate success toast
    if (replacementId) {
      toast.add({
        severity: "success",
        summary: t("toasts.replacementOverlayCreated"),
        detail: t("toasts.replacementOverlayDetail"),
        life: 3000,
      });
      // AI : Reset replacement state after creating the overlay
      overlayStore.resetReplacement();
    } else {
      toast.add({
        severity: "success",
        summary: t("overlay.overlayCreated"),
        detail: t("overlay.positionOverlayOnMap"),
        life: 3000,
      });
    }

    // AI : Close dialog
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

// AI : Handle dialog close
function handleClose() {
  uiStore.closeImageUploadDialog();
}
</script>
