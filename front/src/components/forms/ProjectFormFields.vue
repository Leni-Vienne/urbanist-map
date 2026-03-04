<template>
  <!-- Shared project form fields component used by both CreateProjectForm and EditProjectForm -->
  <div class="flex flex-col gap-4">
    <!-- Project name field -->
    <div class="flex flex-col gap-1">
      <FloatLabel class="w-full" variant="in">
        <InputText
          id="project-name-input"
          v-model="localFormData.name"
          :class="getInputClass('name')"
          required
          minlength="8"
          autocomplete="off"
          @blur="handleNameBlur"
          @input="handleNameInput"
        />
        <label for="project-name-input" class="text-(--p-text-color-secondary)"
          >{{ $t("project.name") }} *</label
        >
      </FloatLabel>
      <small v-if="nameError" class="text-red-600 text-xs block">{{ nameError }}</small>
      <small
        v-if="showNameChangeIndicator"
        class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
      >
        {{ $t("overlay.changedFrom") }}: "{{ originalData?.name || $t("overlay.notSet") }}"
      </small>
    </div>

    <!-- Project description field -->
    <div class="flex flex-col gap-1">
      <FloatLabel class="w-full" variant="in">
        <Textarea
          id="project-description-input"
          v-model="localFormData.description"
          :class="getInputClass('description')"
          rows="2"
          @blur="handleDescriptionBlur"
          @input="handleDescriptionInput"
        />
        <label for="project-description-input" class="text-(--p-text-color-secondary)"
          >{{ $t("common.description") }} ({{ $t("project.optionalField") }})</label
        >
      </FloatLabel>
      <small v-if="descriptionError" class="text-red-600 text-xs block">{{
        descriptionError
      }}</small>
      <small
        v-if="showDescriptionChangeIndicator"
        class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
      >
        {{ $t("overlay.changedFrom") }}: "{{ originalData?.description || $t("overlay.notSet") }}"
      </small>
    </div>

    <!-- Timeline status selector -->
    <TimelineStatusSelector
      v-model="localIsProposed"
      :id-prefix="idPrefix"
      @change="handleTimelineStatusChange"
    />
    <!-- Show change indicator when timeline status changes -->
    <small
      v-if="showChangeIndicators && timelineStatusChanged"
      class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
    >
      {{ timelineStatusChangeMessage }}
    </small>

    <!-- Proposal date field (shown when project is proposed) -->
    <div class="flex flex-col gap-1" v-if="localIsProposed">
      <FlexibleDatePicker
        v-model="flexibleProposalDate"
        :label="$t('project.proposalDate')"
        :max-date="new Date()"
        required
        unique-id="proposal-date"
        :error="getFieldError('proposalDate') ?? undefined"
        @update:modelValue="handleProposalDateChange"
        @blur="handleProposalDateChange"
      />
      <small class="text-muted-color block mt-1">{{ $t("project.proposalDateHelp") }}</small>
      <small
        v-if="showProposalDateChangeIndicator"
        class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
      >
        {{ $t("overlay.changedFrom") }}: "{{
          formatFlexibleDateFromProp(originalData?.proposalDate) || $t("overlay.notSet")
        }}"
      </small>
    </div>

    <!-- Start and end date fields (shown when project is planned) -->
    <div class="flex flex-col gap-4" v-if="!localIsProposed">
      <!-- Start Date (Optional with checkbox) -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2 mb-2">
          <Checkbox v-model="projectAlreadyStarted" binary inputId="project-started-checkbox" />
          <label for="project-started-checkbox" class="cursor-pointer">{{
            $t("project.alreadyStarted")
          }}</label>
        </div>

        <div v-if="!projectAlreadyStarted">
          <FlexibleDatePicker
            v-model="flexibleStartDate"
            :label="$t('project.startDate')"
            required
            unique-id="start-date"
            :error="startDateError ?? undefined"
            @update:modelValue="handleDateChange"
            @blur="handleDateChange"
          />
          <small
            v-if="showStartDateChangeIndicator"
            class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
          >
            {{ $t("overlay.changedFrom") }}: "{{
              formatFlexibleDateFromProp(originalData?.startDate) || $t("overlay.notSet")
            }}"
          </small>
        </div>
      </div>

      <!-- End Date -->
      <div class="flex flex-col gap-1">
        <FlexibleDatePicker
          v-model="flexibleEndDate"
          :label="$t('project.endDate')"
          required
          unique-id="end-date"
          :error="endDateError ?? undefined"
          @update:modelValue="handleDateChange"
          @blur="handleDateChange"
        />
        <small
          v-if="showEndDateChangeIndicator"
          class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
        >
          {{ $t("overlay.changedFrom") }}: "{{
            formatFlexibleDateFromProp(originalData?.endDate) || $t("overlay.notSet")
          }}"
        </small>
      </div>
    </div>

    <!-- City select field -->
    <div class="flex flex-col gap-1">
      <FloatLabel class="w-full" variant="in">
        <CitySelect
          ref="citySelectRef"
          :model-value="cityIdForSelect"
          :class="getInputClass('cityId')"
          :prefilled-city="prefilledCity"
          :marker-coordinates="markerCoordinates"
          required
          @update:modelValue="handleCityIdUpdate"
        />
        <label for="location-select" class="text-(--p-text-color-secondary)"
          >{{ $t("project.location") }} *</label
        >
      </FloatLabel>
      <small v-if="cityIdError" class="text-red-600 text-xs block">{{ cityIdError }}</small>
      <small
        v-if="showCityChangeIndicator"
        class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
      >
        {{ $t("overlay.changedFrom") }}:
        {{ getCityNameSafe(originalData?.cityId) }}
      </small>
    </div>

    <!-- Source URL field -->
    <div class="flex flex-col gap-1">
      <FloatLabel class="w-full" variant="in">
        <InputText
          id="source-url-input"
          type="url"
          v-model="localFormData.sourceUrl"
          :class="getInputClass('sourceUrl')"
          autocomplete="off"
          @blur="handleSourceUrlBlur"
          @input="handleSourceUrlInput"
        />
        <label for="source-url-input" class="text-(--p-text-color-secondary)"
          >{{ $t("project.sourceUrl") }} ({{ $t("project.optionalField") }})</label
        >
      </FloatLabel>
      <small v-if="sourceUrlError" class="text-red-600 text-xs block">{{ sourceUrlError }}</small>
      <small
        v-if="showSourceUrlChangeIndicator"
        class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
      >
        {{ $t("overlay.changedFrom") }}: "{{ originalData?.sourceUrl || $t("overlay.notSet") }}"
      </small>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRaw } from "vue";
import { useI18n } from "vue-i18n";
import FloatLabel from "primevue/floatlabel";
import TimelineStatusSelector from "./TimelineStatusSelector.vue";
import FlexibleDatePicker from "./FlexibleDatePicker.vue";
import Checkbox from "primevue/checkbox";
import type CitySelect from "./CitySelect.vue";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import DatePicker from "primevue/datepicker";
import type { Project, ProjectFormData } from "@/types/index";
import { formatDate } from "@/utils/dateFormat";
import {
  dbToFlexibleDate,
  flexibleDateToDb,
  formatFlexibleDate,
} from "@/utils/flexibleDateHelpers";
import type { FlexibleDateInput } from "@shared/types/flexibleDate";
import { useFieldValidation } from "@/composables/forms/useFieldValidation";
import { projectSchema } from "@shared/validation/schemas";
import { prepareProjectValidationData } from "@/utils/validationHelpers";

// Re-export for backward compatibility
export type { ProjectFormData };

interface Props {
  // v-model for form data
  formData: ProjectFormData;
  // Original data for change comparison (used in edit mode)
  originalData?: ProjectFormData;
  // Show change indicators for modified fields
  showChangeIndicators?: boolean;
  // Unique prefix for input IDs to avoid conflicts
  idPrefix?: string;
  // Initial isProposed state
  isProposed?: boolean;
  // Pre-filled city data for the CitySelect (uses Project['city'] format from DB)
  prefilledCity?: Project["city"];
  // Marker coordinates for city proximity search
  markerCoordinates?: { lat: number; lng: number } | null;
  // Function to get CSS classes for fields (from BaseEditForm)
  fieldClasses?: (fieldName: string) => string | object | undefined;
  // Function to check if a field has changed (from BaseEditForm)
  hasChanged?: (fieldName: string) => boolean;
}

interface Emits {
  (e: "update:formData", value: ProjectFormData): void;
  (e: "update:isProposed", value: boolean): void;
  (e: "cityChange", cityId: number | null): void;
}

const props = withDefaults(defineProps<Props>(), {
  showChangeIndicators: false,
  idPrefix: "project",
  isProposed: false,
  prefilledCity: undefined,
  markerCoordinates: null,
});

const emit = defineEmits<Emits>();

// i18n for translations
const { t } = useI18n();

// Reference to CitySelect component
const citySelectRef = ref<InstanceType<typeof CitySelect> | null>(null);

// Setup field validation
const { getFieldError, hasFieldError, validateField } = useFieldValidation(projectSchema);

// Local isProposed state synced with parent
const localIsProposed = ref(props.isProposed);

// Local copy of formData to avoid mutating props
// Explicitly initialize precision fields to null if undefined (for old projects without precision)
const localFormData = ref<ProjectFormData>({
  ...props.formData,
  proposalDatePrecision: props.formData.proposalDatePrecision ?? null,
  startDatePrecision: props.formData.startDatePrecision ?? null,
  endDatePrecision: props.formData.endDatePrecision ?? null,
});

// Local state for flexible dates
// We maintain these separately and sync them to localFormData (which uses plain Dates)
const flexibleProposalDate = ref<FlexibleDateInput | null>(
  dbToFlexibleDate(props.formData.proposalDate, props.formData.proposalDatePrecision),
);
const flexibleStartDate = ref<FlexibleDateInput | null>(
  dbToFlexibleDate(props.formData.startDate, props.formData.startDatePrecision),
);
const flexibleEndDate = ref<FlexibleDateInput | null>(
  dbToFlexibleDate(props.formData.endDate, props.formData.endDatePrecision),
);

// "Already Started" state
// If active, startDate is cleared and disabled
const projectAlreadyStarted = ref(false);

// Initialize "Already Started" if we have an endDate but no startDate in a planned project
// This assumes "Already Started" means we don't know the startDate
if (!props.formData.startDate && props.formData.endDate && !props.isProposed) {
  projectAlreadyStarted.value = true;
}

// Watch for external formData changes and sync local copy AND flexible states
watch(
  () => props.formData,
  (newFormData) => {
    localFormData.value = { ...newFormData };

    // Only update flexible inputs if the timestamp is different (simple check)
    // We use timestamps to avoid unnecessary re-parsing
    const currentProposalTs = flexibleDateToDb(flexibleProposalDate.value)?.getTime();
    if (newFormData.proposalDate?.getTime() !== currentProposalTs) {
      flexibleProposalDate.value = dbToFlexibleDate(
        newFormData.proposalDate,
        newFormData.proposalDatePrecision,
      );
    }

    const currentStartTs = flexibleDateToDb(flexibleStartDate.value)?.getTime();
    if (newFormData.startDate?.getTime() !== currentStartTs) {
      if (newFormData.startDate) {
        projectAlreadyStarted.value = false;
      }
      flexibleStartDate.value = dbToFlexibleDate(
        newFormData.startDate,
        newFormData.startDatePrecision,
      );
    }

    const currentEndTs = flexibleDateToDb(flexibleEndDate.value)?.getTime();
    if (newFormData.endDate?.getTime() !== currentEndTs) {
      flexibleEndDate.value = dbToFlexibleDate(newFormData.endDate, newFormData.endDatePrecision);
    }
  },
  { deep: true },
);

// Sync flexible dates to formData
function syncDatesToFormData() {
  localFormData.value.proposalDate = localIsProposed.value
    ? flexibleDateToDb(flexibleProposalDate.value)
    : null;
  localFormData.value.proposalDatePrecision = localIsProposed.value
    ? (flexibleProposalDate.value?.precision ?? null)
    : null;

  if (localIsProposed.value) {
    localFormData.value.startDate = null;
    localFormData.value.startDatePrecision = null;
    localFormData.value.endDate = null;
    localFormData.value.endDatePrecision = null;
  } else {
    localFormData.value.startDate = projectAlreadyStarted.value
      ? null
      : flexibleDateToDb(flexibleStartDate.value);
    localFormData.value.startDatePrecision = projectAlreadyStarted.value
      ? null
      : (flexibleStartDate.value?.precision ?? null);
    localFormData.value.endDate = flexibleDateToDb(flexibleEndDate.value);
    localFormData.value.endDatePrecision = flexibleEndDate.value?.precision ?? null;
  }
}

// Watch local formData changes and emit to parent
watch(
  localFormData,
  (newFormData) => {
    emit("update:formData", toRaw(newFormData));
  },
  { deep: true },
);

// Watch projectAlreadyStarted to clear start date if checked
watch(projectAlreadyStarted, (newValue) => {
  if (newValue) {
    flexibleStartDate.value = null; // Clear the input
  }
  syncDatesToFormData();
  handleDateChange(); // Re-validate
});

// Convert null to undefined for CitySelect compatibility
const cityIdForSelect = computed(() => localFormData.value.cityId ?? undefined);

// Shared validation helper to avoid rebuilding validation data
function validateFieldHelper(fieldPath: string) {
  const validationData = prepareProjectValidationData(localFormData.value);
  validateField(fieldPath, validationData);
}

// Validation handlers for each field - blur always validates and marks as touched
function handleNameBlur() {
  validateFieldHelper("name");
}

function handleDescriptionBlur() {
  validateFieldHelper("description");
}

function handleSourceUrlBlur() {
  validateFieldHelper("sourceUrl");
}

// Input handlers - validate immediately on every input (real-time feedback)
function handleNameInput() {
  validateFieldHelper("name");
}

function handleDescriptionInput() {
  validateFieldHelper("description");
}

function handleSourceUrlInput() {
  validateFieldHelper("sourceUrl");
}

// Get combined class for inputs with validation state
function getInputClass(fieldName: string) {
  const baseClasses = props.fieldClasses?.(fieldName) ?? "";
  const errorClass = hasFieldError(fieldName) ? "p-invalid" : "";
  return [{ "w-full": true }, baseClasses, errorClass];
}

// Computed properties for change indicators to simplify template logic
const showNameChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("name"),
);

const showDescriptionChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("description"),
);

const showProposalDateChangeIndicator = computed(
  () =>
    props.showChangeIndicators && props.hasChanged?.("proposalDate") && wasOriginallyProposed.value,
);

const showStartDateChangeIndicator = computed(
  () =>
    props.showChangeIndicators && props.hasChanged?.("startDate") && !wasOriginallyProposed.value,
);

const showEndDateChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("endDate") && !wasOriginallyProposed.value,
);

const showCityChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("cityId"),
);

const showSourceUrlChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("sourceUrl"),
);

// Computed error messages for each field
const nameError = computed(() => getFieldError("name"));
const descriptionError = computed(() => getFieldError("description"));
const sourceUrlError = computed(() => getFieldError("sourceUrl"));
const startDateError = computed(() => getFieldError("startDate"));
const endDateError = computed(() => getFieldError("endDate"));
const cityIdError = computed(() => getFieldError("cityId"));

// Date change handler - validates dates whenever they change
function handleDateChange() {
  syncDatesToFormData();
  // Validate both date fields when either changes (they depend on each other)
  validateFieldHelper("startDate");
  validateFieldHelper("endDate");
}

// Proposal date change handler
function handleProposalDateChange() {
  syncDatesToFormData();
  validateFieldHelper("proposalDate");
}

// Handle city ID updates from CitySelect
function handleCityIdUpdate(cityId: number | undefined) {
  // Update local form data (will trigger watch to emit)
  localFormData.value.cityId = cityId ?? null;
  // Emit city change event for parent components (e.g., to switch tile layer)
  emit("cityChange", cityId ?? null);
  // Validate city field when it changes
  validateFieldHelper("cityId");
}

// Watch for external isProposed changes
watch(
  () => props.isProposed,
  (newValue) => {
    localIsProposed.value = newValue;
  },
);

// Computed to check if project was originally proposed
const wasOriginallyProposed = computed(() => {
  if (!props.originalData) return false;
  return Boolean(
    props.originalData.proposalDate && !props.originalData.startDate && !props.originalData.endDate,
  );
});

// Computed to check if timeline status has changed
const timelineStatusChanged = computed(() => {
  if (!props.originalData) return false;
  return localIsProposed.value !== wasOriginallyProposed.value;
});

// Computed message to show what changed when timeline status changes
const timelineStatusChangeMessage = computed(() => {
  if (!props.originalData) return "";

  if (wasOriginallyProposed.value && !localIsProposed.value) {
    // Changed from proposed to planned
    const oldDate = formatDate(props.originalData.proposalDate) ?? t("overlay.notSet");
    return t("project.timelineChangedFromProposedToPlanned", {
      proposalDate: oldDate,
    });
  } else if (!wasOriginallyProposed.value && localIsProposed.value) {
    // Changed from planned to proposed
    const oldStart = formatDate(props.originalData.startDate) ?? t("overlay.notSet");
    const oldEnd = formatDate(props.originalData.endDate) ?? t("overlay.notSet");
    return t("project.timelineChangedFromPlannedToProposed", {
      startDate: oldStart,
      endDate: oldEnd,
    });
  }

  return "";
});

// Handle timeline status change
function handleTimelineStatusChange(newIsProposed: boolean) {
  localIsProposed.value = newIsProposed;
  emit("update:isProposed", newIsProposed);

  // Update local form data based on timeline status
  if (newIsProposed) {
    // Switching to proposed - clear planned dates
    flexibleStartDate.value = null;
    flexibleEndDate.value = null;
    projectAlreadyStarted.value = false;
  } else {
    // Switching to planned - clear proposal date
    flexibleProposalDate.value = null;

    // Restore original dates if available
    if (props.originalData?.startDate) {
      flexibleStartDate.value = dbToFlexibleDate(props.originalData.startDate);
      projectAlreadyStarted.value = false;
    } else {
      // If no original start date (and we are switching to planned), maybe it was already started?
      flexibleStartDate.value = null;
    }

    if (props.originalData?.endDate) {
      flexibleEndDate.value = dbToFlexibleDate(props.originalData.endDate);
    } else {
      flexibleEndDate.value = null;
    }
  }
  syncDatesToFormData();
}

// Watch for city changes in local form data
watch(
  () => localFormData.value.cityId,
  (newCityId) => {
    emit("cityChange", newCityId);
  },
  {
    // immediate: true
    // Actually, we don't need immediate because we init cityIdForSelect computed
  },
);

// Safe getter for city name that handles null/undefined conversion
function getCityNameSafe(cityId: number | null | undefined): string {
  return citySelectRef.value?.getCityName(cityId ?? undefined) ?? "Not set";
}

// Helper to format date from prop (Date) using flexible helper
function formatFlexibleDateFromProp(date: Date | null | undefined): string {
  return formatFlexibleDate(dbToFlexibleDate(date));
}

// Expose cities data and methods to parent
defineExpose({
  citySelectRef,
  get cities() {
    return citySelectRef.value?.cities ?? [];
  },
  get citiesLoaded() {
    return citySelectRef.value?.citiesLoaded ?? false;
  },
  getCityName(cityId: number | null | undefined) {
    return getCityNameSafe(cityId);
  },
});
</script>
