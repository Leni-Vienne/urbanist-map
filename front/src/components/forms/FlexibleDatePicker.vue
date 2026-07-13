<template>
  <div class="w-full flex flex-col gap-2">
    <label class="text-sm text-(--p-text-color-secondary) font-medium">
      {{ label }}
    </label>

    <!-- Compact layout: precision toggle + inputs on same row -->
    <div class="flex gap-2 items-center flex-nowrap">
      <!-- Precision Selection - compact segmented buttons -->
      <SelectButton
        v-model="precision"
        :options="precisionOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        class="shrink-0"
        @change="handlePrecisionChange"
      />

      <!-- Year Only Mode: simple year dropdown -->
      <Select
        v-if="precision === 'year'"
        v-model="selectedYear"
        :options="yearOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Year"
        class="w-28"
        :class="{ 'p-invalid': isTouched && Boolean(error) }"
        @change="markTouched"
      />

      <!-- Month & Year Mode: month + year dropdowns -->
      <template v-else-if="precision === 'month'">
        <Select
          v-model="selectedMonth"
          :options="monthOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Month"
          class="min-w-0 flex-1"
          :class="{ 'p-invalid': isTouched && Boolean(error) }"
          @change="markTouched"
        />
        <Select
          v-model="selectedYear"
          :options="yearOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Year"
          class="min-w-0 flex-1"
          :class="{ 'p-invalid': isTouched && Boolean(error) }"
          @change="markTouched"
        />
      </template>

      <!-- Full Date Mode: DatePicker calendar -->
      <DatePicker
        v-else
        :model-value="fullDateValue"
        dateFormat="dd/mm/yy"
        fluid
        class="flex-1 max-w-64"
        :class="{ 'p-invalid': isTouched && Boolean(error) }"
        :maxDate="maxDate"
        showIcon
        showButtonBar
        @update:modelValue="handleFullDateChange"
      />

      <!-- Clear button: lets the user remove the date entirely (e.g. suggest deleting an approved date) -->
      <Button
        v-if="modelValue"
        type="button"
        icon="pi pi-times"
        severity="secondary"
        text
        rounded
        size="small"
        class="shrink-0 clear-date-btn"
        :title="$t('project.clearDate')"
        :aria-label="$t('project.clearDate')"
        @click="handleClear"
      />
    </div>

    <small v-if="isTouched && error" class="text-red-500 text-xs block">{{ error }}</small>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { FlexibleDateInput, DatePrecision } from "@shared/types/flexibleDate";

const props = defineProps<{
  modelValue: FlexibleDateInput | null;
  label: string;
  maxDate?: Date;
  error?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: FlexibleDateInput | null): void;
  (e: "blur"): void;
}>();

const { t } = useI18n();

// Track if user has interacted with the field
const isTouched = ref(false);

// The model carries a precision only when it holds a value, so the chosen precision is kept locally
// and adopted from the model whenever the model supplies one.
const precision = ref<DatePrecision>(props.modelValue?.precision ?? "day");

watch(
  () => props.modelValue?.precision,
  (modelPrecision) => {
    if (modelPrecision) precision.value = modelPrecision;
  },
);

const selectedYear = computed<number | null>({
  get: () => props.modelValue?.year ?? null,
  set: (year) => emitParts({ year, month: selectedMonth.value, day: selectedDay.value }),
});

const selectedMonth = computed<number | null>({
  get: () => props.modelValue?.month ?? null,
  set: (month) => emitParts({ year: selectedYear.value, month, day: selectedDay.value }),
});

const selectedDay = computed(() => props.modelValue?.day ?? null);

const fullDateValue = computed(() => {
  const value = props.modelValue;
  if (value?.precision === "day" && value.month && value.day) {
    return new Date(value.year, value.month - 1, value.day);
  }
  return null;
});

// Precision options for SelectButton
const precisionOptions = computed(() => [
  { label: t("project.yearOnly"), value: "year" },
  { label: t("project.monthYear"), value: "month" },
  { label: t("project.fullDate"), value: "day" },
]);

// Generate year options (from 1900 to maxDate year or current + 30)
const yearOptions = computed(() => {
  const minYear = 1900;
  const maxYear = props.maxDate?.getFullYear() ?? new Date().getFullYear() + 30;
  const years = [];
  for (let y = maxYear; y >= minYear; y -= 1) {
    years.push({ label: String(y), value: y });
  }
  return years;
});

const monthOptions = computed(() => {
  const formatter = new Intl.DateTimeFormat(undefined, { month: "long" });
  return Array.from({ length: 12 }, (_, i) => ({
    label: formatter.format(new Date(2000, i, 1)),
    value: i + 1,
  }));
});

interface DateParts {
  year: number | null;
  month: number | null;
  day: number | null;
}

function emitParts(parts: DateParts, targetPrecision: DatePrecision = precision.value) {
  emit("update:modelValue", buildValue(parts, targetPrecision));
}

function buildValue(parts: DateParts, targetPrecision: DatePrecision): FlexibleDateInput | null {
  const { year, month, day } = parts;
  if (!year) return null;

  if (targetPrecision === "year") {
    return { year, precision: "year" };
  }
  if (targetPrecision === "month") {
    return month ? { year, month, precision: "month" } : null;
  }
  return month && day ? { year, month, day, precision: "day" } : null;
}

// Switching precision fills the fields the new precision needs, defaulting to today. Day precision
// keeps an empty field empty: there is no sensible default day to invent.
function handlePrecisionChange() {
  isTouched.value = true;

  const now = new Date();
  const year = selectedYear.value;
  const month = selectedMonth.value;

  if (precision.value === "year") {
    emitParts({ year: year ?? now.getFullYear(), month: null, day: null });
  } else if (precision.value === "month") {
    emitParts({ year: year ?? now.getFullYear(), month: month ?? now.getMonth() + 1, day: null });
  } else if (year) {
    emitParts({ year, month: month ?? 1, day: 1 });
  }
}

function markTouched() {
  isTouched.value = true;
}

function handleFullDateChange(date: Date | Date[] | (Date | null)[] | null | undefined) {
  isTouched.value = true;
  // PrimeVue DatePicker can emit various types; we only handle single Date
  const singleDate = Array.isArray(date) ? date[0] : date;
  if (singleDate instanceof Date) {
    emitParts({
      year: singleDate.getFullYear(),
      month: singleDate.getMonth() + 1,
      day: singleDate.getDate(),
    });
  } else {
    emit("update:modelValue", null);
  }
}

function handleClear() {
  isTouched.value = true;
  emit("update:modelValue", null);
  emit("blur");
}
</script>

<style scoped>
:deep(.clear-date-btn.p-button) {
  width: auto;
  min-width: 0;
  padding-left: 0;
  padding-right: 0;
}
</style>
