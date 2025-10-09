<template>
  <!-- AI : Regular dialog for project type selection and overlay uploads -->
  <Dialog
    v-if="!markerPlacementMode"
    v-model:visible="visible"
    :header="selectedProjectType ? (selectedProjectType === 'overlay' ? $t('overlay.addImageOverlay') : $t('project.addDevelopmentProject')) : $t('project.chooseProjectType')"
    :modal="true"
    :style="{ width: '500px' }"
    @hide="onHide"
  >
    <div class="dialog-content">
      <!-- AI : Project type selection -->
      <div v-if="!selectedProjectType" class="project-type-selection">
        <h4>{{ $t('project.whatTypeOfProject') }}</h4>
        <p>{{ $t('project.chooseProjectTypeDescription') }}</p>
        
        <div class="project-type-buttons">
          <button
            @click="selectProjectType('overlay')"
            class="project-type-button overlay-button"
          >
            <i class="pi pi-image text-4xl mb-2"></i>
            <span class="button-title">{{ $t('project.overlayProject') }}</span>
            <span class="button-description">{{ $t('project.overlayProjectDescription') }}</span>
          </button>
          
          <button
            @click="selectProjectType('marker')"
            class="project-type-button marker-button"
          >
            <i class="pi pi-home text-4xl mb-2"></i>
            <span class="button-title">{{ $t('project.developmentProject') }}</span>
            <span class="button-description">{{ $t('project.developmentProjectDescription') }}</span>
          </button>
        </div>
      </div>
      
      <!-- AI : Overlay project flow -->
      <div v-else-if="selectedProjectType === 'overlay'" class="explanation-section">
        <h4>{{ $t('overlay.whatKindOfImages') }}</h4>
        <p>
          {{ $t('overlay.imageDescription') }}
        </p>

        <h4>{{ $t('overlay.goodToKnow') }}</h4>

        If you want to upload an image that comes from a PDF, please use programs like <a
          href="https://www.rptools.net/toolbox/token-tool/"
          target="_blank"
          style="color: var(--p-primary-600); text-decoration: underline;"
        >TokenTool</a> for the best possible quality.

      </div>
      
      <!-- AI : Development project flow -->
      <div v-else-if="selectedProjectType === 'marker'" class="marker-section">
        <div v-if="!markerPlacementMode">
          <h4>{{ $t('project.placeMarkerOnMap') }}</h4>
          <p>{{ $t('project.clickOnMapToPlace') }}</p>
          <Button @click="enableMarkerPlacement" :label="$t('project.startPlacement')" class="w-full" />
        </div>
        
        <div v-else class="marker-placement-active">
          <p class="placement-instruction">{{ $t('project.clickMapToPlace') }}</p>
          
          <div v-if="markerCoordinates" class="coordinates-display">
            <p>{{ $t('project.markerPlacedAt') }}:</p>
            <p class="coordinates">{{ markerCoordinates.lat.toFixed(6) }}, {{ markerCoordinates.lng.toFixed(6) }}</p>
          </div>
          
          <div v-else class="waiting-placement">
            <i class="pi pi-map-marker text-2xl text-primary"></i>
            <p>{{ $t('project.waitingForClick') }}</p>
          </div>
        </div>
      </div>

      <div v-if="selectedProjectType === 'overlay'" class="upload-section">
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
            :class="['file-input-label', { 'drag-over': isDragOver }]"
            @dragover.prevent="onDragOver"
            @dragenter.prevent="onDragEnter"
            @dragleave.prevent="onDragLeave"
            @drop.prevent="onDrop"
          >
            <i class="pi pi-cloud-upload text-3xl mb-2"></i>
            <span class="upload-text">{{ $t('overlay.chooseImageFile') }}</span>
            <span class="upload-subtext">{{ $t('overlay.clickOrDragDrop') }}</span>
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
          :label="$t('common.cancel')"
          icon="pi pi-times"
          class="p-button-text"
          @click="onCancel"
        />
        <Button
          :label="$t('common.continue')"
          icon="pi pi-check"
          :disabled="!selectedFile"
          @click="onContinue"
        />
      </div>
    </template>
  </Dialog>

  <!-- AI : Floating bar for marker placement -->
  <div 
    v-if="markerPlacementMode && visible" 
    class="marker-placement-bar"
  >
    <div class="placement-content">
      <i class="pi pi-map-marker placement-icon"></i>
      <div class="placement-text">
        <span v-if="!markerCoordinates" class="instruction">{{ $t('project.clickMapToPlace') }}</span>
        <span v-else class="coordinates-text">{{ markerCoordinates.lat.toFixed(5) }}, {{ markerCoordinates.lng.toFixed(5) }}</span>
      </div>
    </div>
    <div class="placement-actions">
      <Button 
        v-if="markerCoordinates"
        :label="$t('common.continue')"
        size="small"
        @click="onContinue"
      />
      <Button 
        :label="$t('common.cancel')"
        severity="secondary"
        size="small"
        @click="onCancel"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import Button from 'primevue/button';

// AI : Component props and emits
interface Props {
  visible: boolean;
}

interface Emits {
  (e: 'update:visible', value: boolean): void;
  (e: 'file-selected', file: File): void;
  (e: 'marker-coordinates', coordinates: { lat: number; lng: number }): void;
  (e: 'marker-mode-enabled'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// AI : Component state
const fileInput = ref<HTMLInputElement>();
const selectedFile = ref<File | null>(null);
const isDragOver = ref(false);
const selectedProjectType = ref<'overlay' | 'marker' | null>(null);
const markerCoordinates = ref<{ lat: number; lng: number } | null>(null);
const markerPlacementMode = ref(false);

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

// AI : Drag and drop handlers
function onDragOver(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = true;
}

function onDragEnter(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = true;
}

function onDragLeave(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = false;
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = false;
  
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    // AI : Check if file type is accepted
    const acceptedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (acceptedTypes.includes(file.type)) {
      selectedFile.value = file;
    }
  }
}

// AI : Clear selected file
function clearFile() {
  selectedFile.value = null;
  if (fileInput.value) {
    fileInput.value.value = '';
  }
}

// AI : Project type selection
function selectProjectType(type: 'overlay' | 'marker') {
  selectedProjectType.value = type;
}

// AI : Enable marker placement mode
function enableMarkerPlacement() {
  markerPlacementMode.value = true;
  emit('marker-mode-enabled');
}

// AI : Handle marker coordinates from map click
function setMarkerCoordinates(coordinates: { lat: number; lng: number }) {
  markerCoordinates.value = coordinates;
}

// AI : Cancel dialog
function onCancel() {
  clearFile();
  emit('update:visible', false);
}

// AI : Continue with selected file or marker coordinates
function onContinue() {
  if (selectedProjectType.value === 'overlay' && selectedFile.value) {
    emit('file-selected', selectedFile.value);
  } else if (selectedProjectType.value === 'marker' && markerCoordinates.value) {
    emit('marker-coordinates', markerCoordinates.value);
  }
  resetState();
  emit('update:visible', false);
}

// AI : Reset all state
function resetState() {
  clearFile();
  selectedProjectType.value = null;
  markerCoordinates.value = null;
  markerPlacementMode.value = false;
}

// AI : Reset when dialog closes
function onHide() {
  resetState();
}

// AI : Reset when dialog opens
watch(() => props.visible, (newVisible) => {
  if (newVisible) {
    resetState();
  }
});

// AI : Expose functions to parent component
defineExpose({
  setMarkerCoordinates
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

.file-input-label.drag-over {
  border-color: var(--p-primary-600);
  background: var(--p-primary-50);
  transform: scale(1.02);
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

/* AI : Project type selection styles */
.project-type-selection {
  text-align: center;
  margin-bottom: 20px;
}

.project-type-buttons {
  display: flex;
  gap: 20px;
  margin-top: 20px;
  justify-content: center;
}

.project-type-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  background: white;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 180px;
  text-align: center;
}

.project-type-button:hover {
  border-color: var(--p-primary-600);
  background: var(--p-primary-50);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.project-type-button .button-title {
  font-weight: 600;
  color: var(--p-surface-800);
  margin-bottom: 8px;
  font-size: 16px;
}

.project-type-button .button-description {
  font-size: 14px;
  color: var(--p-surface-600);
  line-height: 1.4;
}

.marker-section {
  text-align: center;
  margin-bottom: 20px;
}

.coordinates-display {
  margin-top: 15px;
  padding: 10px;
  background: var(--p-primary-50);
  border-radius: 6px;
  border: 1px solid var(--p-primary-200);
}

.coordinates-display p {
  margin: 0;
  color: var(--p-primary-700);
  font-weight: 500;
}

.marker-placement-active {
  text-align: center;
  padding: 20px 10px;
}

.placement-instruction {
  font-size: 14px;
  color: var(--p-surface-600);
  margin-bottom: 15px;
}

.waiting-placement {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--p-primary-600);
}

.waiting-placement p {
  margin: 0;
  font-size: 14px;
}

.coordinates {
  font-family: monospace;
  font-size: 12px;
  background: var(--p-surface-100);
  padding: 5px 10px;
  border-radius: 4px;
  margin-top: 5px;
}

/* AI : Floating marker placement bar */
.marker-placement-bar {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: white;
  border: 1px solid var(--p-surface-300);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  max-width: calc(100vw - 40px);
  min-width: 280px;
}

.placement-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.placement-icon {
  color: var(--p-primary-600);
  font-size: 16px;
}

.placement-text {
  flex: 1;
}

.instruction {
  color: var(--p-surface-600);
  font-size: 14px;
}

.coordinates-text {
  font-family: monospace;
  font-size: 13px;
  color: var(--p-primary-700);
  font-weight: 500;
}

.placement-actions {
  display: flex;
  gap: 8px;
}

/* AI : Mobile responsive */
@media (max-width: 768px) {
  .marker-placement-bar {
    top: 10px;
    left: 10px;
    right: 10px;
    transform: none;
    max-width: none;
    min-width: auto;
  }
  
  .placement-content {
    gap: 6px;
  }
  
  .placement-actions {
    gap: 6px;
  }
}
</style>
