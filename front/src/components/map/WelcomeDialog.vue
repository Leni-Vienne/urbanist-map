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
    <div class="text-[0.95rem] leading-relaxed flex flex-col gap-5">
      <p class="m-0 text-[var(--p-text-color)] text-base">{{ $t("help.intro") }}</p>
      <p class="m-0 text-[var(--p-text-color)] text-base">{{ $t("help.paragraph") }}</p>

      <div class="flex items-center gap-4">
        <Button
          icon="pi pi-filter"
          severity="secondary"
          aria-hidden="true"
          tabindex="-1"
          class="pointer-events-none shrink-0"
        />
        <span class="text-[var(--p-text-muted-color)] text-[0.9rem]">{{
          $t("help.buttons.filters")
        }}</span>
      </div>

      <template v-if="authStore.isAuthenticated">
        <div class="flex items-center gap-4">
          <div
            class="flex items-center gap-2 px-3 py-1.5 bg-amber-500/95 border-2 border-amber-600 text-white rounded-[1.5rem] shadow-[0_4px_12px_rgba(245,158,11,0.4)] font-semibold text-[0.85rem] shrink-0"
          >
            <i class="pi pi-pencil text-sm"></i>
            <span>{{ $t("map.editMode") }}</span>
            <i class="pi pi-refresh ml-1 opacity-70 text-xs"></i>
          </div>
          <span class="text-[var(--p-text-muted-color)] text-[0.9rem]">{{
            $t("help.modes.description")
          }}</span>
        </div>
      </template>

      <div class="pt-3 border-t border-[var(--p-surface-300)] flex items-center">
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
import { ref, computed, onMounted } from "vue";
import { useAuthStore } from "@/stores/authStore";

interface Props {
  modelValue: boolean;
}

type Emits = (e: "update:modelValue", value: boolean) => void;

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const authStore = useAuthStore();
const dontShowAgain = ref(false);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const HELP_MODAL_STORAGE_KEY = "urbanist-map-help-modal-seen";

function closeModal() {
  if (dontShowAgain.value) {
    localStorage.setItem(HELP_MODAL_STORAGE_KEY, "true");
  }
  visible.value = false;
}

onMounted(() => {
  if (!localStorage.getItem(HELP_MODAL_STORAGE_KEY)) {
    visible.value = true;
  }
});
</script>
