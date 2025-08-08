<template>
  <Dialog
    v-model:visible="visible"
    header="Add Image Overlay"
    :modal="true"
    :style="{ width: '500px' }"
    @hide="onHide"
  >
    <div class="dialog-content">
      <div class="explanation-section">
        <h4>What kind of images are accepted?</h4>
        <p>
          This website is about upcoming infrastructure and buildings. whether that's new trams lines,
          cycle paths, redeveloppement and more.
        </p>

        <h4>Good to know</h4>

        If you want to upload an image that comes from a PDF, please use programs like <a
          href="https://www.rptools.net/toolbox/token-tool/"
          target="_blank"
          style="color: var(--p-primary-600); text-decoration: underline;"
        >TokenTool</a> for the best possible quality.

      </div>

      <div class="upload-section">
        <div class="file-input-container">
          <input
            ref="fileInput"
            type="file"
            @change="onFileSelect"
            accept="image/png, image/jpeg, image/jpg, image/webp"
            class="hidden-input"
            id="overlay-file-input"
          />
          <label
            for="overlay-file-input"
            class="file-input-label"
          >
            <i class="pi pi-cloud-upload text-3xl mb-2"></i>
            <span class="upload-text">Choose Image File</span>
            <span class="upload-subtext">Click here or drag and drop</span>
          </label>
        </div>

        <div
          v-if="selectedFile"
          class="selected-file"
        >
          <i class="pi pi-file"></i>
          <span>{{ selectedFile.name }}</span>
          <Button
            icon="pi pi-times"
            class="p-button-text p-button-sm"
            @click="clearFile"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button
          label="Cancel"
          icon="pi pi-times"
          class="p-button-text"
          @click="onCancel"
        />
        <Button
          label="Continue"
          icon="pi pi-check"
          :disabled="!selectedFile"
          @click="onContinue"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';

// AI : Component props and emits
interface Props {
  visible: boolean;
}

interface Emits {
  (e: 'update:visible', value: boolean): void;
  (e: 'file-selected', file: File): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// AI : Component state
const fileInput = ref<HTMLInputElement>();
const selectedFile = ref<File | null>(null);

// AI : Handle visibility changes
const visible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
});

// AI : File selection handler
function onFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    selectedFile.value = file;
  }
}

// AI : Clear selected file
function clearFile() {
  selectedFile.value = null;
  if (fileInput.value) {
    fileInput.value.value = '';
  }
}

// AI : Cancel dialog
function onCancel() {
  clearFile();
  visible.value = false;
}

// AI : Continue with selected file
function onContinue() {
  if (selectedFile.value) {
    emit('file-selected', selectedFile.value);
    clearFile();
    visible.value = false;
  }
}

// AI : Reset when dialog closes
function onHide() {
  clearFile();
}

// AI : Reset file when dialog opens
watch(() => props.visible, (newVisible) => {
  if (newVisible) {
    clearFile();
  }
});
</script>

<style scoped>
.dialog-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.explanation-section h4 {
  margin: 0 0 8px 0;
  color: var(--p-surface-800);
  font-size: 16px;
  font-weight: 600;
}

.explanation-section p {
  margin: 0 0 16px 0;
  color: var(--p-surface-600);
  line-height: 1.5;
}

.explanation-section ul {
  margin: 0 0 16px 0;
  padding-left: 20px;
  color: var(--p-surface-600);
}

.explanation-section li {
  margin-bottom: 4px;
}

.upload-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.file-input-container {
  position: relative;
}

.hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}

.file-input-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  border: 2px dashed #ccc;
  border-radius: 8px;
  background: #fafafa;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-input-label:hover {
  border-color: var(--p-primary-600);
  background: #f5f5f5;
}

.upload-text {
  font-weight: 600;
  color: var(--p-surface-800);
  margin-bottom: 4px;
}

.upload-subtext {
  font-size: 14px;
  color: var(--p-surface-600);
}

.selected-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f0f9ff;
  border-radius: 6px;
  border: 1px solid #e0f2fe;
}

.selected-file i {
  color: var(--p-primary-600);
}

.selected-file span {
  flex: 1;
  color: var(--p-primary-700);
  font-weight: 500;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
