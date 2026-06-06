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
      <p class="text-sm text-(--p-text-color-secondary) leading-relaxed m-0">
        {{ $t("imageUpload.uploadDescription") }}
      </p>

      <!-- PDF Extraction Section -->
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
            ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950 cursor-default'
            : 'border-surface bg-content-hover-background cursor-pointer hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950'
        "
        @drop.prevent="handleDrop"
        @dragover.prevent="handleDragOver"
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
            class="w-20 h-20 object-cover rounded-md border-2 border-green-200 dark:border-green-700 shrink-0 group-hover:opacity-90 transition-opacity"
          />
          <div class="flex-1 flex flex-col gap-2 items-start">
            <p
              class="text-sm font-medium text-green-900 dark:text-green-300 font-mono break-all m-0"
            >
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
      <p
        v-if="fileSizeError"
        class="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm font-medium m-0"
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
import { addOverlay } from "@/services/overlay/editing";
import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_MB } from "@shared/uploadLimits";

const { t } = useI18n();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const toast = useToast();

const fileInputRef = ref<HTMLInputElement>();
const selectedFile = ref<File | null>(null);
const selectedFileName = ref("");
const imagePreviewUrl = ref("");
const imageDataUrl = ref("");
const fileSizeError = ref("");

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

function triggerFileInput() {
  fileInputRef.value?.click();
}

function handleFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  processFile(file);
}

function handleDragOver(event: DragEvent) {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function handleDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  // Reset file input to allow re-selecting same file
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }

  processFile(file);
}

function processFile(file: File) {
  try {
    fileSizeError.value = "";

    // Validate file size (shared cap, matches the backend Zod guard)
    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      fileSizeError.value = t("upload.fileTooLarge", {
        maxSize: MAX_UPLOAD_FILE_SIZE_MB,
      });
      // Reset file input to allow re-selecting a different file
      if (fileInputRef.value) {
        fileInputRef.value.value = "";
      }
      return;
    }

    selectedFile.value = file;
    selectedFileName.value = file.name;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = reader.result as string;
      imageDataUrl.value = dataUrl;
      imagePreviewUrl.value = dataUrl;
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

async function handleConfirm() {
  if (!selectedFile.value || !imageDataUrl.value) return;

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
    const replacementId = overlayStore.replacementOverlayId;

    addOverlay(imageDataUrl.value, projectId, replacementId ?? undefined);

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

function handleClose() {
  uiStore.closeImageUploadDialog();
}
</script>
