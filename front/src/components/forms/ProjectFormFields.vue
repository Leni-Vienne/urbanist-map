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
      v-model="localTimelineStatus"
      :id-prefix="idPrefix"
      @change="handleTimelineStatusChange"
    />
    <small
      v-if="showTimelineStatusChangeIndicator"
      class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
    >
      {{ $t("overlay.changedFrom") }}: "{{ originalData?.timelineStatus || $t("overlay.notSet") }}"
    </small>

    <!-- Start and end date fields (always shown) -->
    <div class="flex flex-col gap-4">
      <!-- Start Date -->
      <div class="flex flex-col gap-1">
        <FlexibleDatePicker
          v-model="flexibleStartDate"
          :label="$t('project.startDate')"
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

      <!-- End Date -->
      <div class="flex flex-col gap-1">
        <FlexibleDatePicker
          v-model="flexibleEndDate"
          :label="$t('project.endDate')"
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

    <!-- Country field -->
    <div class="flex flex-col gap-1">
      <FloatLabel class="w-full" variant="in">
        <Select
          input-id="country-select"
          v-model="localFormData.countryCode"
          :options="countries"
          option-label="name"
          option-value="code"
          :loading="countriesLoading"
          class="w-full"
          @update:modelValue="handleCountryCodeUpdate"
        />
        <label for="country-select" class="text-(--p-text-color-secondary)">
          {{ $t("project.country") }}
        </label>
      </FloatLabel>
      <small
        v-if="showCountryCodeChangeIndicator"
        class="italic bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-1 rounded text-xs min-h-5 flex items-center"
      >
        {{ $t("overlay.changedFrom") }}: "{{ originalData?.countryCode || $t("overlay.notSet") }}"
      </small>
    </div>

    <!-- Additional details section (collapsible) -->
    <Panel :header="$t('project.additionalDetails')" toggleable collapsed>
      <div class="flex flex-col gap-4">
        <!-- Proposal date field -->
        <div class="flex flex-col gap-1">
          <FlexibleDatePicker
            v-model="flexibleProposalDate"
            :label="$t('project.proposalDate')"
            :max-date="new Date()"
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
      </div>
    </Panel>

    <!-- City select field -->
    <div class="flex flex-col gap-1">
      <FloatLabel class="w-full" variant="in">
        <CitySelect
          ref="citySelectRef"
          :model-value="cityIdForSelect"
          :class="getInputClass('cityId')"
          :prefilled-city="prefilledCity"
          :marker-coordinates="markerCoordinates"
          show-clear
          @update:modelValue="handleCityIdUpdate"
        />
        <label for="location-select" class="text-(--p-text-color-secondary)"
          >{{ $t("project.location") }} ({{ $t("project.optionalField") }})</label
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

    <!-- Tags field -->
    <div class="flex flex-col gap-2">
      <span class="text-sm text-(--p-text-color-secondary)">
        {{ $t("project.tags") }} ({{ $t("project.optionalField") }})
      </span>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="tag in allTags"
          :key="tag.slug"
          type="button"
          class="px-3 py-1 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer"
          :aria-pressed="localFormData.tags.includes(tag.slug)"
          :style="
            localFormData.tags.includes(tag.slug)
              ? { backgroundColor: tag.color, color: tag.textColor, borderColor: tag.color }
              : { backgroundColor: 'transparent', color: tag.color, borderColor: tag.color }
          "
          @click="toggleTag(tag.slug)"
        >
          {{ $te(`tags.${tag.slug}`) ? $t(`tags.${tag.slug}`) : tag.slug }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRaw, onMounted } from "vue";
import TimelineStatusSelector, { type TimelineStatus } from "./TimelineStatusSelector.vue";
import FlexibleDatePicker from "./FlexibleDatePicker.vue";
import type CitySelect from "./CitySelect.vue";
import { trpc } from "@/client";
import type { Project, ProjectFormData } from "@/types/index";
import {
  dbToFlexibleDate,
  flexibleDateToDb,
  formatFlexibleDate,
} from "@/utils/flexibleDateHelpers";
import type { FlexibleDateInput } from "@shared/types/flexibleDate";
import { useFieldValidation } from "@/composables/forms/useFieldValidation";
import { projectSchema } from "@shared/validation/schemas";
import { prepareProjectValidationData } from "@/utils/validationHelpers";
import { PROJECT_TAGS } from "@/config/projectTags";

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
  // Initial timelineStatus state
  timelineStatus?: TimelineStatus;
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
  (e: "update:timelineStatus", value: TimelineStatus): void;
  (e: "cityChange", cityId: number | null): void;
}

const props = withDefaults(defineProps<Props>(), {
  showChangeIndicators: false,
  idPrefix: "project",
  timelineStatus: "proposed",
  prefilledCity: undefined,
  markerCoordinates: null,
});

const emit = defineEmits<Emits>();

// Reference to CitySelect component
const citySelectRef = ref<InstanceType<typeof CitySelect> | null>(null);

// Setup field validation
const { getFieldError, hasFieldError, validateField } = useFieldValidation(projectSchema);

// Local timelineStatus state synced with parent
const localTimelineStatus = ref(props.timelineStatus);

// Local copy of formData to avoid mutating props
// Explicitly initialize precision fields to null if undefined (for old projects without precision)
const localFormData = ref<ProjectFormData>({
  ...props.formData,
  proposalDatePrecision: props.formData.proposalDatePrecision ?? null,
  startDatePrecision: props.formData.startDatePrecision ?? null,
  endDatePrecision: props.formData.endDatePrecision ?? null,
  countryCode: props.formData.countryCode,
  tags: props.formData.tags,
});

const allTags = PROJECT_TAGS.filter((t) => !t.hidden);

// Countries for the country dropdown
const countries = ref<{ code: string; name: string }[]>([]);
const countriesLoading = ref(false);

onMounted(async () => {
  try {
    countriesLoading.value = true;
    countries.value = await trpc.country.getAllCountries.query();
  } catch (error) {
    console.error("Failed to load countries:", error);
  } finally {
    countriesLoading.value = false;
  }
  // Auto-fetch country code for the initial marker position if not already set
  if (props.markerCoordinates && !localFormData.value.countryCode) {
    await fetchAndSetNearestCountryCode(props.markerCoordinates.lat, props.markerCoordinates.lng);
  }
  // If still empty after fetch (no nearby city found), leave as-is; user must select manually
});

async function fetchAndSetNearestCountryCode(lat: number, lng: number) {
  try {
    const code = await trpc.cities.getNearestCountryCode.query({ lat, lng });
    localFormData.value.countryCode = code ?? "";
  } catch (error) {
    console.error("Failed to fetch nearest country code:", error);
  }
}

watch(
  () => props.markerCoordinates,
  async (coords) => {
    if (coords) {
      await fetchAndSetNearestCountryCode(coords.lat, coords.lng);
    }
  },
);

function toggleTag(slug: string) {
  const idx = localFormData.value.tags.indexOf(slug);
  if (idx === -1) {
    localFormData.value.tags = [...localFormData.value.tags, slug];
  } else {
    localFormData.value.tags = localFormData.value.tags.filter((tag) => tag !== slug);
  }
}

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
  // Always sync all dates - no longer clearing based on timeline status
  localFormData.value.proposalDate = flexibleDateToDb(flexibleProposalDate.value);
  localFormData.value.proposalDatePrecision = flexibleProposalDate.value?.precision ?? null;

  localFormData.value.startDate = flexibleDateToDb(flexibleStartDate.value);
  localFormData.value.startDatePrecision = flexibleStartDate.value?.precision ?? null;
  localFormData.value.endDate = flexibleDateToDb(flexibleEndDate.value);
  localFormData.value.endDatePrecision = flexibleEndDate.value?.precision ?? null;
}

// Watch local formData changes and emit to parent
watch(
  localFormData,
  (newFormData) => {
    emit("update:formData", toRaw(newFormData));
  },
  { deep: true },
);

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

const showTimelineStatusChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("timelineStatus"),
);

const showDescriptionChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("description"),
);

const showProposalDateChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("proposalDate"),
);

const showStartDateChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("startDate"),
);

const showEndDateChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("endDate"),
);

const showCityChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("cityId"),
);

const showCountryCodeChangeIndicator = computed(
  () => props.showChangeIndicators && props.hasChanged?.("countryCode"),
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
function handleCityIdUpdate(cityId: number | undefined | "") {
  // Convert empty string or undefined to null (PrimeVue Select emits "" when cleared)
  const normalizedCityId = cityId === "" || cityId === undefined ? null : cityId;
  // Update local form data (will trigger watch to emit)
  localFormData.value.cityId = normalizedCityId;
  // Prefill countryCode from the selected city
  if (normalizedCityId !== null) {
    const city = citySelectRef.value?.cities.find((c) => c.id === normalizedCityId);
    if (city) localFormData.value.countryCode = city.countryCode;
  }
  // Emit city change event for parent components (e.g., to switch tile layer)
  emit("cityChange", normalizedCityId);
  // Validate city field when it changes
  validateFieldHelper("cityId");
}

function handleCountryCodeUpdate(code: string | null | undefined) {
  localFormData.value.countryCode = code ?? "";
}

// Watch for external timelineStatus changes
watch(
  () => props.timelineStatus,
  (newValue) => {
    localTimelineStatus.value = newValue;
  },
);

// Handle timeline status change
function handleTimelineStatusChange(newStatus: TimelineStatus) {
  localTimelineStatus.value = newStatus;
  emit("update:timelineStatus", newStatus);
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
