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
      <div class="help-sections">
        <!-- AI : Map Controls Buttons -->
        <div class="help-section">
          <h4 class="help-section-title">{{ $t('help.buttons.title') }}</h4>
          <div class="help-item">
            <div class="help-icon">
              <Button
                icon="pi pi-question-circle"
                size="small"
                severity="help"
                disabled
              />
            </div>
            <div class="help-text">{{ $t('help.buttons.help') }}</div>
          </div>
          <div class="help-item">
            <div class="help-icon">
              <Button
                icon="pi pi-map"
                size="small"
                severity="secondary"
                disabled
              />
            </div>
            <div class="help-text">{{ $t('help.buttons.layers') }}</div>
          </div>
          <div class="help-item">
            <div class="help-icon">
              <Button
                icon="pi pi-filter"
                size="small"
                severity="secondary"
                disabled
              />
            </div>
            <div class="help-text">{{ $t('help.buttons.filters') }}</div>
          </div>

          <template v-if="authStore.isAuthenticated">
            <div class="mode-controls-demo">
              <div class="mode-indicator-demo">
                <i class="pi pi-pencil"></i>
                <span>{{ $t('map.editMode') }}</span>
                <i class="pi pi-refresh switch-icon-demo"></i>
              </div>
            </div>
            <div class="help-text centered-help-text">{{ $t('help.modes.description') }}</div>
          </template>
        </div>
      </div>


      <div class="help-footer">
        <Checkbox
          v-model="dontShowAgain"
          inputId="dontShowAgain"
          :binary="true"
        />
        <label
          for="dontShowAgain"
          class="help-checkbox-label"
        >
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
import { useAuthStore } from '@/stores/authStore';

interface Props {
  modelValue: boolean;
}

type Emits = (e: 'update:modelValue', value: boolean) => void;

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
    visible.value = true;
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

.mode-controls-demo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1rem;
}

.mode-indicator-demo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(245, 158, 11, 0.95);
  border: 2px solid #d97706;
  color: white;
  border-radius: 1.5rem;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
  font-weight: 600;
  font-size: 0.9rem;
}

.mode-indicator-demo i {
  font-size: 1rem;
}

/* AI : Integrated switch icon styling - matches actual ModeControls */
.switch-icon-demo {
  margin-left: 0.25rem;
  opacity: 0.7;
  font-size: 0.85rem;
}

.centered-help-text {
  text-align: center;
  margin-top: 0.5rem;
  font-size: 0.9rem;
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
