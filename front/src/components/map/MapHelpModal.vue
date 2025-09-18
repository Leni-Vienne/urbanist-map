<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="$t('help.title')"
    :style="{ width: '90vw', maxWidth: '500px' }"
    :dismissableMask="true"
    :closeOnEscape="true"
    data-testid="map-help-modal"
  >
    <div class="help-content">
      <p class="help-intro">{{ $t('help.intro') }}</p>
      
      <div class="help-sections">
        <!-- AI : Zoom Controls -->
        <div class="help-section">
          <h4 class="help-section-title">{{ $t('help.zoom.title') }}</h4>
          <div class="help-item">
            <div class="help-icon">
              <Button
                icon="pi pi-plus"
                size="small"
                severity="secondary"
                disabled
              />
            </div>
            <div class="help-text">{{ $t('help.zoom.in') }}</div>
          </div>
          <div class="help-item">
            <div class="help-icon">
              <Button
                icon="pi pi-minus"
                size="small"
                severity="secondary"
                disabled
              />
            </div>
            <div class="help-text">{{ $t('help.zoom.out') }}</div>
          </div>
        </div>

        <!-- AI : Edit Controls (only if authenticated) -->
        <div v-if="authStore.isAuthenticated" class="help-section">
          <h4 class="help-section-title">{{ $t('help.edit.title') }}</h4>
          <div class="help-item">
            <div class="help-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="1.2em"
                height="1.2em"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="help-svg-icon"
              >
                <path d="M16 5h6" />
                <path d="M19 2v6" />
                <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                <circle cx="9" cy="9" r="2" />
              </svg>
            </div>
            <div class="help-text">{{ $t('help.edit.addOverlay') }}</div>
          </div>
          <div class="help-item">
            <div class="help-icon">
              <Button
                icon="pi pi-eye"
                size="small"
                severity="secondary"
                disabled
              />
            </div>
            <div class="help-text">{{ $t('help.edit.viewMode') }}</div>
          </div>
          <div class="help-item">
            <div class="help-icon">
              <Button
                icon="pi pi-pencil"
                size="small"
                severity="primary"
                disabled
              />
            </div>
            <div class="help-text">{{ $t('help.edit.editMode') }}</div>
          </div>
        </div>

        <!-- AI : Project Filters -->
        <div class="help-section">
          <h4 class="help-section-title">{{ $t('help.filters.title') }}</h4>
          <div class="help-item">
            <div class="help-icon">
              <div v-html="getMarkerSVG('yellow')"></div>
            </div>
            <div class="help-text">{{ $t('help.filters.proposed') }}</div>
          </div>
          <div class="help-item">
            <div class="help-icon">
              <div v-html="getMarkerSVG('green')"></div>
            </div>
            <div class="help-text">{{ $t('help.filters.planned') }}</div>
          </div>
          <div class="help-item">
            <div class="help-icon">
              <div v-html="getMarkerSVG('orange')"></div>
            </div>
            <div class="help-text">{{ $t('help.filters.inProgress') }}</div>
          </div>
          <div class="help-item">
            <div class="help-icon">
              <div v-html="getMarkerSVG('grey')"></div>
            </div>
            <div class="help-text">{{ $t('help.filters.completed') }}</div>
          </div>
        </div>
      </div>

      <div class="help-footer">
        <Checkbox
          v-model="dontShowAgain"
          inputId="dontShowAgain"
          :binary="true"
        />
        <label for="dontShowAgain" class="help-checkbox-label">
          {{ $t('help.dontShowAgain') }}
        </label>
      </div>
    </div>

    <template #footer>
      <div class="help-modal-footer">
        <Button
          :label="$t('help.gotIt')"
          @click="closeModal"
          severity="primary"
          class="help-close-button"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useAuthStore } from '@stores/authStore';
import { createButtonSVG } from '@composables/ui/markerIcons';

interface Props {
  modelValue: boolean;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const authStore = useAuthStore();
const dontShowAgain = ref(false);
const visible = ref(props.modelValue);

// AI : Watch for prop changes
watch(() => props.modelValue, (newValue) => {
  visible.value = newValue;
});

// AI : Watch for internal visibility changes
watch(visible, (newValue) => {
  emit('update:modelValue', newValue);
});

const HELP_MODAL_STORAGE_KEY = 'construction-map-help-modal-seen';

// AI : Get marker SVG for button icons
function getMarkerSVG(color: 'yellow' | 'green' | 'orange' | 'grey'): string {
  return createButtonSVG(color);
}

// AI : Close modal and handle "don't show again" preference
function closeModal() {
  if (dontShowAgain.value) {
    localStorage.setItem(HELP_MODAL_STORAGE_KEY, 'true');
  }
  visible.value = false;
}

// AI : Check if modal should be shown on first visit
function shouldShowOnFirstVisit(): boolean {
  return !localStorage.getItem(HELP_MODAL_STORAGE_KEY);
}

// AI : Export function to manually show the modal (for help button)
function showModal() {
  visible.value = true;
}

// AI : Auto-show on first visit
onMounted(() => {
  if (shouldShowOnFirstVisit()) {
    // AI : Small delay to ensure the page has loaded
    setTimeout(() => {
      visible.value = true;
    }, 1000);
  }
});

// AI : Expose function for parent component
defineExpose({
  showModal,
  shouldShowOnFirstVisit
});
</script>

<style scoped>
.help-content {
  font-size: 0.95rem;
  line-height: 1.5;
}

.help-intro {
  margin-bottom: 1.5rem;
  color: var(--text-color-secondary);
  text-align: center;
}

.help-sections {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.help-section {
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 1rem;
  background: var(--surface-50);
}

.help-section-title {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--primary-color);
  border-bottom: 1px solid var(--surface-border);
  padding-bottom: 0.5rem;
}

.help-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.help-item:last-child {
  margin-bottom: 0;
}

.help-icon {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-0);
  border: 1px solid var(--surface-border);
  border-radius: 6px;
}

.help-svg-icon {
  width: 1.2em;
  height: 1.2em;
  color: var(--text-color-secondary);
}

.help-text {
  flex: 1;
  color: var(--text-color);
  font-size: 0.9rem;
}

.help-footer {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--surface-border);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.help-checkbox-label {
  font-size: 0.9rem;
  color: var(--text-color-secondary);
  cursor: pointer;
}

.help-modal-footer {
  display: flex;
  justify-content: center;
  width: 100%;
}

.help-close-button {
  min-width: 120px;
}

/* AI : Mobile optimizations */
@media (max-width: 768px) {
  .help-content {
    font-size: 0.9rem;
  }
  
  .help-item {
    gap: 0.75rem;
  }
  
  .help-icon {
    width: 2rem;
    height: 2rem;
  }
  
  .help-text {
    font-size: 0.85rem;
  }
  
  .help-section {
    padding: 0.75rem;
  }
}
</style>