<template>
  <div class="flexible-date-picker">
    <!-- AI : Precision Selection -->
    <div class="flex gap-4 mb-2">
      <div class="flex items-center gap-2">
        <RadioButton
          v-model="internalPrecision"
          :inputId="'precision-year-' + uniqueId"
          value="year"
          :name="groupName"
          @change="handlePrecisionChange"
        />
        <label :for="'precision-year-' + uniqueId" class="cursor-pointer text-sm mb-0">{{
          $t("project.yearOnly")
        }}</label>
      </div>
      <div class="flex items-center gap-2">
        <RadioButton
          v-model="internalPrecision"
          :inputId="'precision-month-' + uniqueId"
          value="month"
          :name="groupName"
          @change="handlePrecisionChange"
        />
        <label :for="'precision-month-' + uniqueId" class="cursor-pointer text-sm mb-0">{{
          $t("project.monthYear")
        }}</label>
      </div>
      <div class="flex items-center gap-2">
        <RadioButton
          v-model="internalPrecision"
          :inputId="'precision-day-' + uniqueId"
          value="day"
          :name="groupName"
          @change="handlePrecisionChange"
        />
        <label :for="'precision-day-' + uniqueId" class="cursor-pointer text-sm mb-0">{{
          $t("project.fullDate")
        }}</label>
      </div>
    </div>

    <!-- AI : Input Fields based on precision -->
    <div class="flex gap-2 items-start">
      <!-- AI : Year Only Mode -->
      <div v-if="internalPrecision === 'year'" class="w-full">
        <FloatLabel class="w-full" variant="in">
          <DatePicker
            v-model="yearDateValue"
            view="year"
            dateFormat="yy"
            class="w-full"
            :class="{ 'p-invalid': isTouched && !!error }"
            :maxDate="maxDate"
            :minDate="minDate"
            showIcon
            @update:modelValue="handleYearDateChange"
            :id="'year-input-' + uniqueId"
          />
          <label :for="'year-input-' + uniqueId">{{ label }} {{ required ? "*" : "" }}</label>
        </FloatLabel>
      </div>

      <!-- AI : Month & Year Mode -->
      <div v-else-if="internalPrecision === 'month'" class="flex gap-2 w-full">
        <div class="flex-1">
          <FloatLabel class="w-full" variant="in">
            <DatePicker
              v-model="monthDateValue"
              view="month"
              dateFormat="mm/yy"
              class="w-full"
              :class="{ 'p-invalid': isTouched && !!error }"
              :maxDate="maxDate"
              :minDate="minDate"
              @update:modelValue="handleMonthDateChange"
              showIcon
              :id="'month-input-' + uniqueId"
            />
            <label :for="'month-input-' + uniqueId">{{ label }} {{ required ? "*" : "" }}</label>
          </FloatLabel>
        </div>
      </div>

      <!-- AI : Full Date Mode -->
      <div v-else class="w-full">
        <FloatLabel class="w-full" variant="in">
          <label for="date-input">{{ label }} {{ required ? "*" : "" }}</label>

          <DatePicker
            v-model="fullDateValue"
            dateFormat="dd/mm/yy"
            class="w-full"
            :class="{ 'p-invalid': isTouched && !!error }"
            :maxDate="maxDate"
            :minDate="minDate"
            @update:modelValue="handleFullDateChange"
            showIcon
            id="date-input"
          />
          <label for="date-input">{{ label }} {{ required ? "*" : "" }}</label>
        </FloatLabel>
      </div>
    </div>

    <small v-if="isTouched && error" class="text-red-500 text-xs mt-1 block">{{ error }}</small>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import type { FlexibleDateInput, DatePrecision } from "@shared/types/flexibleDate";
import RadioButton from "primevue/radiobutton";
import DatePicker from "primevue/datepicker";
import FloatLabel from "primevue/floatlabel";

const props = defineProps<{
  modelValue: FlexibleDateInput | null;
  label: string;
  required?: boolean;
  maxDate?: Date;
  minDate?: Date;
  error?: string;
  uniqueId?: string; // AI : For grouping radio buttons if multiple instances exist
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: FlexibleDateInput | null): void;
  (e: "blur"): void;
}>();

const groupName = props.uniqueId || `precision-group-${Math.random().toString(36).substring(7)}`;

// AI : Track if user has interacted with the field to avoid premature validation errors
const isTouched = ref(false);

// AI : Internal state
const internalPrecision = ref<DatePrecision>("day");
const yearDateValue = ref<Date | null>(null); // AI : Changed to Date for DatePicker compatibility
const monthDateValue = ref<Date | null>(null);
const fullDateValue = ref<Date | null>(null);

// AI : Sync from props
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal) {
      internalPrecision.value = newVal.precision;

      // AI : Init year date
      if (newVal.year) {
        yearDateValue.value = new Date(newVal.year, 0, 1);
      }

      // AI : Construct dates for pickers
      if (newVal.month) {
        // AI : Month picker needs date
        monthDateValue.value = new Date(newVal.year, newVal.month - 1, 1);

        // AI : Full date picker needs date
        if (newVal.day) {
          fullDateValue.value = new Date(newVal.year, newVal.month - 1, newVal.day);
        }
      } else if (newVal.year) {
        // AI : Also set month/full pickers to that year to be helpful if user switches precision
        monthDateValue.value = new Date(newVal.year, 0, 1);
        fullDateValue.value = new Date(newVal.year, 0, 1);
      }
    } else {
      // AI : If null, keep last precision or default, but clear values
      yearDateValue.value = null;
      monthDateValue.value = null;
      fullDateValue.value = null;
    }
  },
  { immediate: true, deep: true },
);

function handlePrecisionChange() {
  // AI : When changing precision, try to preserve loaded values
  // AI : If we have a value in current mode, propagate it to others?
  // AI : Actually, if we switch FROM year TO month, we should keep year.
  // AI : But updateModel will read from the active input.
  // AI : So we need to sync internal states before updateModel if we want preservation.

  // AI : Strategy: Always keep the most precise date possible in a shared "currentDate" ?
  // AI : Or just sync the refs.

  if (yearDateValue.value) {
    if (!monthDateValue.value) monthDateValue.value = new Date(yearDateValue.value);
    if (!fullDateValue.value) fullDateValue.value = new Date(yearDateValue.value);
  }

  updateModel();
}

function handleYearDateChange(date: any) {
  if (date instanceof Date) {
    yearDateValue.value = date;
    // Sync others
    monthDateValue.value = new Date(date);
    fullDateValue.value = new Date(date);
  }
  updateModel();
}

function handleMonthDateChange(date: any) {
  if (date instanceof Date) {
    monthDateValue.value = date;
    // Sync others
    yearDateValue.value = new Date(date);
    fullDateValue.value = new Date(date);
  }
  updateModel();
}

function handleFullDateChange(date: any) {
  if (date instanceof Date) {
    fullDateValue.value = date;
    // Sync others
    yearDateValue.value = new Date(date);
    monthDateValue.value = new Date(date);
  }
  updateModel();
}

function updateModel() {
  if (internalPrecision.value === "year") {
    if (yearDateValue.value) {
      emit("update:modelValue", {
        year: yearDateValue.value.getFullYear(),
        precision: "year",
      });
    } else {
      emit("update:modelValue", null);
    }
  } else if (internalPrecision.value === "month") {
    if (monthDateValue.value) {
      emit("update:modelValue", {
        year: monthDateValue.value.getFullYear(),
        month: monthDateValue.value.getMonth() + 1,
        precision: "month",
      });
    } else {
      emit("update:modelValue", null);
    }
  } else if (internalPrecision.value === "day") {
    if (fullDateValue.value) {
      emit("update:modelValue", {
        year: fullDateValue.value.getFullYear(),
        month: fullDateValue.value.getMonth() + 1,
        day: fullDateValue.value.getDate(),
        precision: "day",
      });
    } else {
      emit("update:modelValue", null);
    }
  }
}

function validate() {
  isTouched.value = true;
  emit("blur");
}
</script>

<style scoped>
.flexible-date-picker :deep(.p-radiobutton) .p-radiobutton-box {
  width: 18px;
  height: 18px;
}
</style>
