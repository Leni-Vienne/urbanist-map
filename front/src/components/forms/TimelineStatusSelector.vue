<template>
  <div class="field">
    <label
      :for="`${idPrefix}-status-select`"
      class="text-(--p-text-color-secondary) font-medium mb-2 block"
    >
      {{ $t("project.timelineStatus") }} *
    </label>
    <Select
      :id="`${idPrefix}-status-select`"
      :modelValue="modelValue"
      :options="statusOptions"
      optionLabel="label"
      optionValue="value"
      class="w-full"
      @update:modelValue="handleSelect"
    >
      <template #value="slotProps">
        <div v-if="slotProps.value" class="flex flex-col">
          <span>{{ getOptionLabel(slotProps.value) }}</span>
        </div>
      </template>
      <template #option="slotProps">
        <div class="flex flex-col py-1">
          <div class="font-medium">{{ slotProps.option.label }}</div>
        </div>
      </template>
    </Select>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Select from "primevue/select";

export type TimelineStatus =
  | "proposed"
  | "planned"
  | "under_construction"
  | "completed"
  | "canceled";

interface Props {
  modelValue: TimelineStatus;
  idPrefix?: string;
}

type Emits = (e: "update:modelValue" | "change", value: TimelineStatus) => void;

const props = withDefaults(defineProps<Props>(), {
  idPrefix: "timeline",
});

const emit = defineEmits<Emits>();
const { t } = useI18n();

const statusOptions = computed(() => [
  {
    value: "proposed",
    label: t("timelineStatus.proposed"),
  },
  {
    value: "planned",
    label: t("timelineStatus.planned"),
  },
  {
    value: "under_construction",
    label: t("timelineStatus.under_construction"),
  },
]);

function getOptionLabel(value: string) {
  const option = statusOptions.value.find((opt) => opt.value === value);
  // Fallback for options not in the array (e.g. if editing a completed project)
  if (!option) {
    return t(`timelineStatus.${value}`);
  }
  return option.label;
}

function handleSelect(status: string) {
  const typedStatus = status as TimelineStatus;
  emit("update:modelValue", typedStatus);
  emit("change", typedStatus);
}
</script>
