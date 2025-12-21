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
    <div class="upload-dialog-content">
      <!-- AI : Instructions Section - always visible -->
      <div class="instructions-section">
        <p class="section-description">{{ $t('imageUpload.uploadDescription') }}</p>
      </div>

      <!-- AI : PDF Extraction Section with TokenTool Link - always visible -->
      <div class="pdf-section">
        <h3 class="section-title">{{ $t('imageUpload.pdfExtraction') }}</h3>
        <i18n-t keypath="imageUpload.pdfExtractionDescription" tag="p" class="section-description">
          <template #toolLink>
            <a
              href="https://www.rptools.net/toolbox/token-tool/"
              target="_blank"
              rel="noopener noreferrer"
              class="tokentool-link"
            >
              {{ $t('imageUpload.tokenToolLink') }}
            </a>
          </template>
        </i18n-t>
      </div>

      <!-- AI : File Upload Drop Zone - compact with integrated preview -->
      <div
        class="upload-zone"
        :class="{ 'has-file': selectedFile }"
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
        <div v-if="selectedFile" class="file-preview-container">
          <img v-if="imagePreviewUrl" :src="imagePreviewUrl" alt="Preview" class="image-preview" />
          <div class="file-info-compact">
            <p class="filename-compact">{{ selectedFileName }}</p>
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
        <div v-else class="drop-zone-content" @click="triggerFileInput">
          <i class="pi pi-cloud-upload" style="font-size: 2rem; color: var(--p-primary-500);"></i>
          <p class="drop-zone-text">{{ $t('imageUpload.dragDrop') }}</p>
          <p class="drop-zone-subtext">{{ $t('imageUpload.orClick') }}</p>
          <p class="supported-formats">{{ $t('imageUpload.supportedFormats') }}</p>
        </div>
      </div>
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
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUiStore } from '@/stores/uiStore';
import { useToast } from '@/composables/ui/useToast';
import { addOverlay } from '@/composables/overlay/useOverlay';

const { t } = useI18n();
const uiStore = useUiStore();
const toast = useToast();

const fileInputRef = ref<HTMLInputElement>();
const selectedFile = ref<File | null>(null);
const selectedFileName = ref('');
const imagePreviewUrl = ref('');
const imageDataUrl = ref('');

// AI : Computed visibility from store
const isVisible = computed({
    get: () => uiStore.imageUploadDialog.visible,
    set: (value: boolean) => {
        if (!value) {
            uiStore.closeImageUploadDialog();
        }
    }
});

// AI : Reset state when dialog opens/closes
watch(() => uiStore.imageUploadDialog.visible, (visible) => {
    if (!visible) {
        selectedFile.value = null;
        selectedFileName.value = '';
        imagePreviewUrl.value = '';
        imageDataUrl.value = '';
        if (fileInputRef.value) {
            fileInputRef.value.value = '';
        }
    }
});

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
        event.dataTransfer.dropEffect = 'copy';
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
        fileInputRef.value.value = '';
    }

    processFile(file);
}

// AI : Process file (shared logic for input change and drop)
function processFile(file: File) {
    try {
        // AI : Store file and filename
        selectedFile.value = file;
        selectedFileName.value = file.name;

        // AI : Read file to create preview and data URL
        const reader = new FileReader();
        reader.addEventListener('load', () => {
            const dataUrl = reader.result as string;
            imageDataUrl.value = dataUrl;
            imagePreviewUrl.value = dataUrl; // Use same URL for preview
        });
        reader.readAsDataURL(file);

    } catch (error) {
        console.error('Error handling file selection:', error);
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('overlay.uploadFailedDetail'),
            life: 3000
        });
    }
}

// AI : Handle confirm - create overlay and close dialog
function handleConfirm() {
    if (!selectedFile.value || !imageDataUrl.value) return;

    // AI : Get project ID from store
    const projectId = uiStore.imageUploadDialog.projectId;
    if (!projectId) {
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('errors.projectRequired'),
            life: 3000
        });
        return;
    }

    try {
        // AI : Create overlay for this project
        addOverlay(imageDataUrl.value, projectId);

        // AI : Show success toast
        toast.add({
            severity: 'success',
            summary: t('overlay.overlayCreated'),
            detail: t('overlay.positionOverlayOnMap'),
            life: 3000
        });

        // AI : Close dialog
        uiStore.closeImageUploadDialog();
    } catch (error) {
        console.error('Error creating overlay:', error);
        toast.add({
            severity: 'error',
            summary: t('overlay.uploadFailed'),
            detail: t('overlay.uploadFailedDetail'),
            life: 3000
        });
    }
}

// AI : Handle dialog close
function handleClose() {
    uiStore.closeImageUploadDialog();
}
</script>

<style scoped>
.upload-dialog-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 0.5rem 0;
}

/* AI : Success banner styling - compact notification at top */
.success-banner {
    background: var(--p-green-50);
    border: 2px solid var(--p-green-200);
    border-radius: 8px;
    padding: 1rem;
    animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
    from {
        opacity: 0;
        transform: translateY(-10px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.success-banner-content {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.success-icon {
    font-size: 2rem;
    color: var(--p-green-600);
    flex-shrink: 0;
}

.success-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.success-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--p-green-900);
    margin: 0;
}

.selected-filename {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--p-green-700);
    margin: 0;
    font-family: monospace;
    word-break: break-all;
}

/* AI : Section styling */
.instructions-section,
.best-practices-section,
.pdf-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.section-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--p-surface-900);
    margin: 0;
}

.section-description {
    font-size: 0.875rem;
    color: var(--p-surface-600);
    line-height: 1.5;
    margin: 0;
}

/* AI : Best practices list */
.practices-list {
    margin: 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
}

.practices-list li {
    font-size: 0.875rem;
    color: var(--p-surface-600);
    line-height: 1.5;
}

/* AI : TokenTool link styling */
.tokentool-link {
    color: var(--p-primary-500);
    text-decoration: none;
    font-weight: 500;
    transition: color 0.2s ease;
}

.tokentool-link:hover {
    color: var(--p-primary-600);
    text-decoration: underline;
}

/* AI : Upload zone styling - compact version */
.upload-zone {
    margin-top: 0.5rem;
    border: 2px dashed var(--p-surface-300);
    border-radius: 8px;
    padding: 1rem;
    background: var(--p-surface-50);
    transition: all 0.2s ease;
    cursor: pointer;
    min-height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.upload-zone:not(.has-file):hover {
    border-color: var(--p-primary-400);
    background: var(--p-primary-50);
}

.upload-zone.has-file {
    border-color: var(--p-green-300);
    background: var(--p-green-50);
    cursor: default;
}

.drop-zone-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-align: center;
    width: 100%;
}

.drop-zone-text {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--p-surface-700);
    margin: 0;
}

.drop-zone-subtext {
    font-size: 0.75rem;
    color: var(--p-surface-500);
    margin: 0;
}

.supported-formats {
    font-size: 0.7rem;
    color: var(--p-surface-400);
    margin: 0;
    margin-top: 0.25rem;
}

/* AI : File preview container */
.file-preview-container {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
    cursor: pointer;
}

.file-preview-container:hover .image-preview {
    opacity: 0.9;
}

.image-preview {
    width: 80px;
    height: 80px;
    object-fit: cover;
    border-radius: 6px;
    border: 2px solid var(--p-green-200);
    flex-shrink: 0;
}

.file-info-compact {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
}

.filename-compact {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--p-green-900);
    font-family: monospace;
    word-break: break-all;
    margin: 0;
}
</style>
