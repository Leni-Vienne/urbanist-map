<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="$t('help.title')"
    :style="{ width: '90vw', maxWidth: '600px' }"
    :dismissableMask="true"
    :closeOnEscape="true"
    data-testid="map-help-modal"
  >
    <div class="text-[0.95rem] leading-relaxed">
      <p class="mb-6 text-[var(--p-text-color)] text-base">{{ $t("help.intro") }}</p>
      <p class="mb-6 text-[var(--p-text-color)] text-base">{{ $t("help.paragraph") }}</p>
      <div class="flex flex-col gap-6">
        <!-- AI : Map Controls Buttons -->
        <div class="border border-[var(--p-surface-300)] rounded-lg p-4 bg-[var(--p-surface-50)]">
          <h3
            class="m-0 mb-4 text-base font-semibold text-[var(--p-primary-color)] border-b border-[var(--p-surface-300)] pb-2"
          >
            {{ $t("help.buttons.title") }}
          </h3>
          <div class="flex items-center gap-4 mb-3">
            <Button
              icon="pi pi-question-circle"
              severity="help"
              aria-hidden="true"
              tabindex="-1"
              class="pointer-events-none shrink-0"
            />
            <div class="flex-1 text-[var(--p-text-color)] text-[0.9rem]">
              {{ $t("help.buttons.help") }}
            </div>
          </div>
          <div class="flex items-center gap-4 mb-3">
            <Button
              icon="pi pi-map"
              severity="secondary"
              aria-hidden="true"
              tabindex="-1"
              class="pointer-events-none shrink-0"
            />
            <div class="flex-1 text-[var(--p-text-color)] text-[0.9rem]">
              {{ $t("help.buttons.layers") }}
            </div>
          </div>
          <div class="flex items-center gap-4">
            <Button
              icon="pi pi-filter"
              severity="secondary"
              aria-hidden="true"
              tabindex="-1"
              class="pointer-events-none shrink-0"
            />
            <div class="flex-1 text-[var(--p-text-color)] text-[0.9rem]">
              {{ $t("help.buttons.filters") }}
            </div>
          </div>

          <template v-if="authStore.isAuthenticated">
            <div class="flex items-center justify-center gap-2 p-4">
              <div
                class="flex items-center gap-2 px-4 py-2 bg-amber-500/95 border-2 border-amber-600 text-white rounded-[1.5rem] shadow-[0_4px_12px_rgba(245,158,11,0.4)] font-semibold text-[0.9rem]"
              >
                <i class="pi pi-pencil text-base"></i>
                <span>{{ $t("map.editMode") }}</span>
                <i class="pi pi-refresh ml-1 opacity-70 text-[0.85rem]"></i>
              </div>
            </div>
            <div class="text-center text-[var(--p-text-color)] text-[0.9rem]">
              {{ $t("help.modes.description") }}
            </div>
          </template>
        </div>
      </div>

      <div class="pt-4 mt-6 border-t border-[var(--p-surface-300)] flex items-center">
        <Checkbox v-model="dontShowAgain" inputId="dontShowAgain" :binary="true" />
        <label
          for="dontShowAgain"
          class="text-[0.9rem] text-[var(--p-text-muted-color)] cursor-pointer"
        >
          &nbsp;{{ $t("help.dontShowAgain") }}
        </label>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-center w-full">
        <Button
          :label="$t('help.gotIt')"
          @click="closeModal"
          severity="primary"
          class="min-w-[120px]"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useAuthStore } from "@/stores/authStore";

interface Props {
  modelValue: boolean;
}

type Emits = (e: "update:modelValue", value: boolean) => void;

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const authStore = useAuthStore();
const dontShowAgain = ref(false);
const visible = ref(props.modelValue);

// AI : Watch for prop changes
watch(
  () => props.modelValue,
  (newValue) => {
    visible.value = newValue;
  },
);

// AI : Watch for internal visibility changes
watch(visible, (newValue) => {
  emit("update:modelValue", newValue);
});

const HELP_MODAL_STORAGE_KEY = "urbanist-map-help-modal-seen";

// AI : Close modal and handle "don't show again" preference
function closeModal() {
  if (dontShowAgain.value) {
    localStorage.setItem(HELP_MODAL_STORAGE_KEY, "true");
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
  shouldShowOnFirstVisit,
});
</script>
