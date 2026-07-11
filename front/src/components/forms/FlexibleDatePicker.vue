<template>
  <div class="w-full flex flex-col gap-2">
    <label class="text-sm text-(--p-text-color-secondary) font-medium">
      {{ label }}
    </label>

    <!-- Compact layout: precision toggle + inputs on same row -->
    <div class="flex gap-2 items-center flex-nowrap">
      <!-- Precision Selection - compact segmented buttons -->
      <SelectButton
        v-model="internalPrecision"
        :options="precisionOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        class="shrink-0"
        @change="handlePrecisionChange"
      />

      <!-- Year Only Mode: simple year dropdown -->
      <Select
        v-if="internalPrecision === 'year'"
        v-model="selectedYear"
        :options="yearOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Year"
        class="w-28"
        :class="{ 'p-invalid': isTouched && Boolean(error) }"
        @change="handleYearChange"
      />

      <!-- Month & Year Mode: month + year dropdowns -->
      <template v-else-if="internalPrecision === 'month'">
        <Select
          v-model="selectedMonth"
          :options="monthOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Month"
          class="min-w-0 flex-1"
          :class="{ 'p-invalid': isTouched && Boolean(error) }"
          @change="handleMonthYearChange"
        />
        <Select
          v-model="selectedYear"
          :options="yearOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Year"
          class="min-w-0 flex-1"
          :class="{ 'p-invalid': isTouched && Boolean(error) }"
          @change="handleMonthYearChange"
        />
      </template>

      <!-- Full Date Mode: DatePicker calendar -->
      <!-- @vue-expect-error PrimeVue v-model type mismatch -->
      <DatePicker
        v-else
        v-model="fullDateValue"
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

// Internal state
const internalPrecision = ref<DatePrecision>("day");
const selectedYear = ref<number | null>(null);
const selectedMonth = ref<number | null>(null);
const fullDateValue = ref<Date | null>(null);

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

// Sync from props
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal) {
      internalPrecision.value = newVal.precision;
      selectedYear.value = newVal.year;
      selectedMonth.value = newVal.month ?? null;

      if (newVal.precision === "day" && newVal.month && newVal.day) {
        fullDateValue.value = new Date(newVal.year, newVal.month - 1, newVal.day);
      } else {
        fullDateValue.value = null;
      }
    } else {
      selectedYear.value = null;
      selectedMonth.value = null;
      fullDateValue.value = null;
    }
  },
  { immediate: true, deep: true },
);

function handlePrecisionChange() {
  isTouched.value = true;

  if (internalPrecision.value === "year") {
    selectedMonth.value = null;
    if (!selectedYear.value) {
      selectedYear.value = new Date().getFullYear();
    }
  } else if (internalPrecision.value === "month") {
    if (!selectedMonth.value) {
      selectedMonth.value = new Date().getMonth() + 1;
    }
    if (!selectedYear.value) {
      selectedYear.value = new Date().getFullYear();
    }
  } else if (selectedYear.value) {
    const month = selectedMonth.value ?? 1;
    fullDateValue.value = new Date(selectedYear.value, month - 1, 1);
  }

  if (selectedYear.value) {
    emitValue();
  }
}

function handleYearChange() {
  isTouched.value = true;
  emitValue();
}

function handleMonthYearChange() {
  isTouched.value = true;
  emitValue();
}

function handleFullDateChange(date: Date | Date[] | (Date | null)[] | null | undefined) {
  isTouched.value = true;
  // PrimeVue DatePicker can emit various types; we only handle single Date
  const singleDate = Array.isArray(date) ? date[0] : date;
  if (singleDate instanceof Date) {
    fullDateValue.value = singleDate;
    // Sync year/month for when user switches precision
    selectedYear.value = singleDate.getFullYear();
    selectedMonth.value = singleDate.getMonth() + 1;
  } else {
    fullDateValue.value = null;
  }
  emitValue();
}

function handleClear() {
  isTouched.value = true;
  selectedYear.value = null;
  selectedMonth.value = null;
  fullDateValue.value = null;
  emit("update:modelValue", null);
  emit("blur");
}

function emitValue() {
  let value: FlexibleDateInput | null = null;

  if (internalPrecision.value === "year" && selectedYear.value) {
    value = { year: selectedYear.value, precision: "year" };
  } else if (internalPrecision.value === "month" && selectedYear.value && selectedMonth.value) {
    value = { year: selectedYear.value, month: selectedMonth.value, precision: "month" };
  } else if (internalPrecision.value === "day" && fullDateValue.value) {
    value = {
      year: fullDateValue.value.getFullYear(),
      month: fullDateValue.value.getMonth() + 1,
      day: fullDateValue.value.getDate(),
      precision: "day",
    };
  }

  emit("update:modelValue", value);
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
