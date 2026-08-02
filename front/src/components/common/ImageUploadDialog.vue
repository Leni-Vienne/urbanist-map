<template>
  <Dialog
    :visible="true"
    :header="dialogHeader"
    :modal="true"
    :closable="true"
    :closeOnEscape="true"
    :dismissableMask="true"
    :draggable="false"
    :style="{ width: '600px' }"
    @update:visible="handleVisibilityChange"
  >
    <!-- Step 1: choose which kind of image to add -->
    <div v-if="step === 'choose'" class="flex flex-col gap-3 py-2">
      <p class="text-sm text-(--p-text-color-secondary) leading-relaxed m-0">
        {{ $t("imageUpload.chooseDescription") }}
      </p>

      <button
        type="button"
        class="flex items-start gap-3 text-left p-3 rounded-lg border border-surface bg-content-background cursor-pointer transition-all duration-150 hover:border-primary-400 hover:bg-content-hover-background"
        @click="selectMode('overlay')"
      >
        <i class="pi pi-map text-xl text-primary-500 mt-0.5 shrink-0"></i>
        <span class="flex flex-col gap-0.5">
          <span class="text-sm font-semibold text-color">
            {{ $t("imageUpload.overlayOption.title") }}
          </span>
          <span class="text-xs text-muted-color leading-relaxed">
            {{ $t("imageUpload.overlayOption.description") }}
          </span>
        </span>
      </button>

      <button
        type="button"
        class="flex items-start gap-3 text-left p-3 rounded-lg border border-surface bg-content-background cursor-pointer transition-all duration-150 hover:border-primary-400 hover:bg-content-hover-background"
        @click="selectMode('render')"
      >
        <i class="pi pi-image text-xl text-primary-500 mt-0.5 shrink-0"></i>
        <span class="flex flex-col gap-0.5">
          <span class="text-sm font-semibold text-color">
            {{ $t("imageUpload.renderOption.title") }}
          </span>
          <span class="text-xs text-muted-color leading-relaxed">
            {{ $t("imageUpload.renderOption.description") }}
          </span>
        </span>
      </button>
    </div>

    <!-- Step 2: upload (shared UI between overlay and render) -->
    <div v-else class="flex flex-col gap-4 py-2">
      <p class="text-sm text-(--p-text-color-secondary) leading-relaxed m-0">
        {{
          step === "render"
            ? $t("imageUpload.renderUploadDescription")
            : $t("imageUpload.uploadDescription")
        }}
      </p>

      <!-- PDF Extraction Section (overlay only: renders need no alignment) -->
      <div v-if="step === 'overlay'" class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-color m-0">
          {{ $t("imageUpload.pdfExtraction") }}
        </h3>
        <i18n-t
          keypath="imageUpload.pdfExtractionDescription"
          tag="p"
          scope="global"
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

      <!-- Note when a render will replace the existing one -->
      <p
        v-if="step === 'render' && hasExistingRender"
        class="flex items-start gap-2 text-(--p-text-color-secondary) text-xs m-0"
      >
        <i class="pi pi-info-circle mt-0.5 shrink-0"></i>
        {{ $t("imageUpload.renderReplaceNote") }}
      </p>

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
        v-if="step !== 'choose' && !isReplacementMode"
        :label="$t('common.back')"
        icon="pi pi-arrow-left"
        @click="goBack"
        severity="secondary"
        text
      />
      <Button
        v-if="step !== 'choose' && selectedFile"
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
import { toastError, toastSuccess } from "@/services/core/toast";

import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";

import { addOverlay } from "@/services/overlay/editing";
import { setStagedRender } from "@/services/submission/stagedRenderState";
import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_MB } from "@shared/uploadLimits";

type UploadMode = "choose" | "overlay" | "render";

const { t } = useI18n();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const projectId = uiStore.imageUploadProjectId;

const fileInputRef = ref<HTMLInputElement>();
const selectedFile = ref<File | null>(null);
const selectedFileName = ref("");
const imagePreviewUrl = ref("");
const fileSizeError = ref("");

// Replacement is overlay-specific, so it skips the chooser.
const step = ref<UploadMode>(overlayStore.replacementOverlayId ? "overlay" : "choose");

const isReplacementMode = computed(() => Boolean(overlayStore.replacementOverlayId));

const dialogHeader = computed(() => {
  if (isReplacementMode.value) return t("imageUpload.replacementDialogTitle");
  if (step.value === "render") return t("imageUpload.renderDialogTitle");
  return t("imageUpload.dialogTitle");
});

const hasExistingRender = computed(() => {
  return Boolean(projectId && projectStore.projects[projectId]?.render);
});

function clearSelection() {
  selectedFile.value = null;
  selectedFileName.value = "";
  imagePreviewUrl.value = "";
  fileSizeError.value = "";
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
}

function selectMode(mode: Exclude<UploadMode, "choose">) {
  step.value = mode;
}

function goBack() {
  clearSelection();
  step.value = "choose";
}

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
      imagePreviewUrl.value = reader.result as string;
    });
    reader.readAsDataURL(file);
  } catch (error) {
    console.error("Error handling file selection:", error);
    toastError(t("overlay.uploadFailedDetail"));
  }
}

function handleConfirm() {
  if (!selectedFile.value || !imagePreviewUrl.value) return;

  if (!projectId) {
    toastError(t("errors.projectRequired"));
    return;
  }

  if (step.value === "render") {
    confirmRender(projectId, selectedFile.value);
  } else {
    confirmOverlay(projectId);
  }
}

function confirmOverlay(targetProjectId: string) {
  try {
    const replacementId = overlayStore.replacementOverlayId;

    addOverlay(imagePreviewUrl.value, targetProjectId, replacementId ?? undefined);

    if (replacementId) {
      toastSuccess(t("toasts.replacementOverlayDetail"), t("toasts.replacementOverlayCreated"));
      // Reset replacement state after creating the overlay
      overlayStore.resetReplacement();
    } else {
      toastSuccess(t("overlay.positionOverlayOnMap"), t("overlay.overlayCreated"));
    }

    uiStore.closeImageUploadDialog();
  } catch (error) {
    console.error("Error creating overlay:", error);
    toastError(t("overlay.uploadFailedDetail"), t("overlay.uploadFailed"));
  }
}

function confirmRender(targetProjectId: string, file: File) {
  try {
    // Stage the render exactly like the project form does, then mark the project modified so the
    // popup's "Submit change request" picks it up. It rides the same submission pipeline as every
    // other change; nothing uploads until the user confirms the submission.
    setStagedRender(targetProjectId, { file, previewUrl: imagePreviewUrl.value });
    projectStore.updateProject(targetProjectId, { isModified: true });
    toastSuccess(t("imageUpload.renderStagedDetail"), t("imageUpload.renderStaged"));
    uiStore.closeImageUploadDialog();
  } catch (error) {
    console.error("Error staging render:", error);
    toastError(
      error instanceof Error ? error.message : t("overlay.uploadFailedDetail"),
      t("overlay.uploadFailed"),
    );
  }
}

function handleClose() {
  uiStore.closeImageUploadDialog();
}

function handleVisibilityChange(visible: boolean) {
  if (!visible) handleClose();
}
</script>
