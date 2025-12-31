<template>
  <!-- AI : Shared project form fields component used by both CreateProjectForm and EditProjectForm -->
  <div class="flex flex-col gap-4">
    <!-- AI : Project name field -->
    <div class="form-group">
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
        <label for="project-name-input" class="text-gray-600">{{ $t('project.name') }} *</label>
      </FloatLabel>
      <small v-if="nameError" class="validation-error">{{ nameError }}</small>
      <small v-if="showNameChangeIndicator" class="change-indicator">
        {{ $t('overlay.changedFrom') }}: "{{ originalData?.name || $t('overlay.notSet') }}"
      </small>
    </div>

    <!-- AI : Project description field -->
    <div class="form-group">
      <FloatLabel class="w-full" variant="in">
        <Textarea
          id="project-description-input"
          v-model="localFormData.description"
          :class="getInputClass('description')"
          rows="2"
          @blur="handleDescriptionBlur"
          @input="handleDescriptionInput"
        />
        <label for="project-description-input" class="text-gray-600"
          >{{ $t('project.description') }} ({{ $t('project.optionalField') }})</label
        >
      </FloatLabel>
      <small v-if="descriptionError" class="validation-error">{{ descriptionError }}</small>
      <small v-if="showDescriptionChangeIndicator" class="change-indicator">
        {{ $t('overlay.changedFrom') }}: "{{ originalData?.description || $t('overlay.notSet') }}"
      </small>
    </div>

    <!-- AI : Timeline status selector -->
    <TimelineStatusSelector
      v-model="localIsProposed"
      :id-prefix="idPrefix"
      @change="handleTimelineStatusChange"
    />
    <!-- AI : Show change indicator when timeline status changes -->
    <small v-if="showChangeIndicators && timelineStatusChanged" class="change-indicator">
      {{ timelineStatusChangeMessage }}
    </small>

    <!-- AI : Proposal date field (shown when project is proposed) -->
    <div class="form-group" v-if="localIsProposed">
      <FloatLabel class="w-full" variant="in">
        <DatePicker
          id="proposal-date-input"
          v-model="localFormData.proposalDate"
          :class="[{ 'w-full': true }, fieldClasses?.('proposalDate')]"
          dateFormat="dd/mm/yy"
          :updateModelType="'date'"
          showIcon
          required
          :maxDate="new Date()"
          @update:model-value="handleProposalDateChange"
        />
        <label for="proposal-date-input" class="text-gray-600"
          >{{ $t('project.proposalDate') }} *</label
        >
      </FloatLabel>
      <small class="text-gray-500 block mt-1">{{ $t('project.proposalDateHelp') }}</small>
      <small v-if="showProposalDateChangeIndicator" class="change-indicator">
        {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData?.proposalDate) || $t('overlay.notSet')
        }}"
      </small>
    </div>

    <!-- AI : Start and end date fields (shown when project is planned) -->
    <div class="flex gap-3" v-if="!localIsProposed">
      <div class="flex-1 form-group">
        <FloatLabel class="w-full" variant="in">
          <DatePicker
            id="start-date-input"
            v-model="localFormData.startDate"
            :class="getInputClass('startDate')"
            dateFormat="dd/mm/yy"
            :updateModelType="'date'"
            showIcon
            required
            @update:model-value="handleDateChange"
          />
          <label for="start-date-input" class="text-gray-600"
            >{{ $t('project.startDate') }} *</label
          >
        </FloatLabel>
        <small v-if="startDateError" class="validation-error">{{ startDateError }}</small>
        <small v-else class="text-gray-500 block mt-1">{{ $t('project.startDateHelp') }}</small>
        <small v-if="showStartDateChangeIndicator" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData?.startDate) || $t('overlay.notSet')
          }}"
        </small>
      </div>

      <div class="flex-1 form-group">
        <FloatLabel class="w-full" variant="in">
          <DatePicker
            id="end-date-input"
            v-model="localFormData.endDate"
            :class="getInputClass('endDate')"
            dateFormat="dd/mm/yy"
            :updateModelType="'date'"
            showIcon
            required
            @update:model-value="handleDateChange"
          />
          <label for="end-date-input" class="text-gray-600">{{ $t('project.endDate') }} *</label>
        </FloatLabel>
        <small v-if="endDateError" class="validation-error">{{ endDateError }}</small>
        <small v-else class="text-gray-500 block mt-1">{{ $t('project.endDateHelp') }}</small>
        <small v-if="showEndDateChangeIndicator" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData?.endDate) || $t('overlay.notSet')
          }}"
        </small>
      </div>
    </div>

    <!-- AI : City select field -->
    <div class="form-group">
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
        <label for="location-select" class="text-gray-600">{{ $t('project.location') }} *</label>
      </FloatLabel>
      <small v-if="cityIdError" class="validation-error">{{ cityIdError }}</small>
      <small v-if="showCityChangeIndicator" class="change-indicator">
        {{ $t('overlay.changedFrom') }}: {{ getCityNameSafe(originalData?.cityId) }}
      </small>
    </div>

    <!-- AI : Latest update date field (only shown in edit mode) -->
    <div class="form-group" v-if="showLatestUpdateField">
      <FloatLabel class="w-full" variant="in">
        <DatePicker
          id="latest-update-input"
          v-model="localFormData.latestUpdateOn"
          :class="[{ 'w-full': true }, fieldClasses?.('latestUpdateOn')]"
          dateFormat="dd/mm/yy"
          :updateModelType="'date'"
          showIcon
          :showClear="true"
        />
        <label for="latest-update-input" class="text-gray-600"
          >{{ $t('project.latestUpdateOn') }} ({{ $t('project.optionalField') }})</label
        >
      </FloatLabel>
      <small class="text-gray-500 block mt-1">{{ $t('project.latestUpdateOnHelp') }}</small>
      <small v-if="showLatestUpdateChangeIndicator" class="change-indicator">
        {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData?.latestUpdateOn) || $t('overlay.notSet')
        }}"
      </small>
    </div>

    <!-- AI : Source URL field -->
    <div class="form-group">
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
        <label for="source-url-input" class="text-gray-600"
          >{{ $t('project.sourceUrl') }} ({{ $t('project.optionalField') }})</label
        >
      </FloatLabel>
      <small v-if="sourceUrlError" class="validation-error">{{ sourceUrlError }}</small>
      <small v-if="showSourceUrlChangeIndicator" class="change-indicator">
        {{ $t('overlay.changedFrom') }}: "{{ originalData?.sourceUrl || $t('overlay.notSet') }}"
      </small>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import FloatLabel from 'primevue/floatlabel'
import TimelineStatusSelector from './TimelineStatusSelector.vue'
import type CitySelect from './CitySelect.vue'
import type { Project, ProjectFormData } from '@/types/index'
import { formatDate } from '@/utils/dateFormat'
import { useFieldValidation } from '@/composables/forms/useFieldValidation'
import { projectSchema } from '@shared/validation/schemas'
import { prepareProjectValidationData } from '@/utils/validationHelpers'

// AI : Re-export for backward compatibility
export type { ProjectFormData }

interface Props {
  // AI : v-model for form data
  formData: ProjectFormData
  // AI : Original data for change comparison (used in edit mode)
  originalData?: ProjectFormData
  // AI : Show change indicators for modified fields
  showChangeIndicators?: boolean
  // AI : Show the latest update date field (typically only in edit mode)
  showLatestUpdateField?: boolean
  // AI : Unique prefix for input IDs to avoid conflicts
  idPrefix?: string
  // AI : Initial isProposed state
  isProposed?: boolean
  // AI : Pre-filled city data for the CitySelect (uses Project['city'] format from DB)
  prefilledCity?: Project['city']
  // AI : Marker coordinates for city proximity search
  markerCoordinates?: { lat: number; lng: number } | null
  // AI : Function to get CSS classes for fields (from BaseEditForm)
  fieldClasses?: (fieldName: string) => string | object | undefined
  // AI : Function to check if a field has changed (from BaseEditForm)
  hasChanged?: (fieldName: string) => boolean
}

interface Emits {
  (e: 'update:formData', value: ProjectFormData): void
  (e: 'update:isProposed', value: boolean): void
  (e: 'cityChange', cityId: number | null): void
}

const props = withDefaults(defineProps<Props>(), {
  showChangeIndicators: false,
  showLatestUpdateField: false,
  idPrefix: 'project',
  isProposed: true,
  prefilledCity: undefined,
  markerCoordinates: null
})

const emit = defineEmits<Emits>()

// AI : i18n for translations
const { t } = useI18n()

// AI : Reference to CitySelect component
const citySelectRef = ref<InstanceType<typeof CitySelect> | null>(null)

// AI : Setup field validation
const { getFieldError, hasFieldError, validateField, isFieldTouched } = useFieldValidation(projectSchema)

// AI : Local isProposed state synced with parent
const localIsProposed = ref(props.isProposed)

// AI : Local copy of formData to avoid mutating props
const localFormData = ref<ProjectFormData>({ ...props.formData })

// AI : Watch for external formData changes and sync local copy
watch(() => props.formData, (newFormData) => {
  localFormData.value = { ...newFormData }
}, { deep: true })

// AI : Watch local formData changes and emit to parent
watch(localFormData, (newFormData) => {
  emit('update:formData', toRaw(newFormData))
}, { deep: true })

// AI : Convert null to undefined for CitySelect compatibility
const cityIdForSelect = computed(() => localFormData.value.cityId ?? undefined)

// AI : Shared validation helper to avoid rebuilding validation data
function validateFieldHelper(fieldPath: string) {
  const validationData = prepareProjectValidationData(localFormData.value)
  validateField(fieldPath, validationData)
}

// AI : Validation handlers for each field - blur always validates and marks as touched
function handleNameBlur() {
  validateFieldHelper('name')
}

function handleDescriptionBlur() {
  validateFieldHelper('description')
}

function handleSourceUrlBlur() {
  validateFieldHelper('sourceUrl')
}

// AI : Input handlers - validate immediately on every input (real-time feedback)
function handleNameInput() {
  validateFieldHelper('name')
}

function handleDescriptionInput() {
  validateFieldHelper('description')
}

function handleSourceUrlInput() {
  validateFieldHelper('sourceUrl')
}

// AI : Get combined class for inputs with validation state
function getInputClass(fieldName: string) {
  const baseClasses = props.fieldClasses?.(fieldName) ?? ''
  const errorClass = hasFieldError(fieldName) ? 'p-invalid' : ''
  return [{ 'w-full': true }, baseClasses, errorClass]
}

// AI : Computed properties for change indicators to simplify template logic
const showNameChangeIndicator = computed(() =>
  props.showChangeIndicators && props.hasChanged?.('name')
)

const showDescriptionChangeIndicator = computed(() =>
  props.showChangeIndicators && props.hasChanged?.('description')
)

const showProposalDateChangeIndicator = computed(() =>
  props.showChangeIndicators && props.hasChanged?.('proposalDate') && wasOriginallyProposed.value
)

const showStartDateChangeIndicator = computed(() =>
  props.showChangeIndicators && props.hasChanged?.('startDate') && !wasOriginallyProposed.value
)

const showEndDateChangeIndicator = computed(() =>
  props.showChangeIndicators && props.hasChanged?.('endDate') && !wasOriginallyProposed.value
)

const showCityChangeIndicator = computed(() =>
  props.showChangeIndicators && props.hasChanged?.('cityId')
)

const showLatestUpdateChangeIndicator = computed(() =>
  props.showChangeIndicators && props.hasChanged?.('latestUpdateOn')
)

const showSourceUrlChangeIndicator = computed(() =>
  props.showChangeIndicators && props.hasChanged?.('sourceUrl')
)

// AI : Computed error messages for each field
const nameError = computed(() => getFieldError('name'))
const descriptionError = computed(() => getFieldError('description'))
const sourceUrlError = computed(() => getFieldError('sourceUrl'))
const startDateError = computed(() => getFieldError('startDate'))
const endDateError = computed(() => getFieldError('endDate'))
const cityIdError = computed(() => getFieldError('cityId'))

// AI : Date change handler - validates dates whenever they change
function handleDateChange() {
  // AI : Validate both date fields when either changes (they depend on each other)
  validateFieldHelper('startDate')
  validateFieldHelper('endDate')
}

// AI : Proposal date change handler
function handleProposalDateChange() {
  validateFieldHelper('proposalDate')
}

// AI : Handle city ID updates from CitySelect
function handleCityIdUpdate(cityId: number | undefined) {
  // AI : Update local form data (will trigger watch to emit)
  localFormData.value.cityId = cityId ?? null
  // AI : Emit city change event for parent components (e.g., to switch tile layer)
  emit('cityChange', cityId ?? null)
  // AI : Validate city field when it changes
  validateFieldHelper('cityId')
}

// AI : Watch for external isProposed changes
watch(() => props.isProposed, (newValue) => {
  localIsProposed.value = newValue
})

// AI : Computed to check if project was originally proposed
const wasOriginallyProposed = computed(() => {
  if (!props.originalData) return false
  return Boolean(props.originalData.proposalDate && !props.originalData.startDate && !props.originalData.endDate)
})

// AI : Computed to check if timeline status has changed
const timelineStatusChanged = computed(() => {
  if (!props.originalData) return false
  return localIsProposed.value !== wasOriginallyProposed.value
})

// AI : Computed message to show what changed when timeline status changes
const timelineStatusChangeMessage = computed(() => {
  if (!props.originalData) return ''

  if (wasOriginallyProposed.value && !localIsProposed.value) {
    // AI : Changed from proposed to planned
    const oldDate = formatDate(props.originalData.proposalDate) ?? t('overlay.notSet')
    return t('project.timelineChangedFromProposedToPlanned', { proposalDate: oldDate })
  } else if (!wasOriginallyProposed.value && localIsProposed.value) {
    // AI : Changed from planned to proposed
    const oldStart = formatDate(props.originalData.startDate) ?? t('overlay.notSet')
    const oldEnd = formatDate(props.originalData.endDate) ?? t('overlay.notSet')
    return t('project.timelineChangedFromPlannedToProposed', { startDate: oldStart, endDate: oldEnd })
  }

  return ''
})

// AI : Handle timeline status change
function handleTimelineStatusChange(newIsProposed: boolean) {
  localIsProposed.value = newIsProposed
  emit('update:isProposed', newIsProposed)

  // AI : Update local form data based on timeline status
  if (newIsProposed) {
    // AI : Switching to proposed - clear planned dates
    localFormData.value.startDate = null
    localFormData.value.endDate = null
  } else {
    // AI : Switching to planned - clear proposal date
    localFormData.value.proposalDate = null
    // AI : Restore original dates if available
    if (props.originalData?.startDate && !localFormData.value.startDate) {
      localFormData.value.startDate = props.originalData.startDate
    }
    if (props.originalData?.endDate && !localFormData.value.endDate) {
      localFormData.value.endDate = props.originalData.endDate
    }
  }
}

// AI : Watch for city changes in local form data
watch(() => localFormData.value.cityId, (newCityId) => {
  emit('cityChange', newCityId)
})

// AI : Safe getter for city name that handles null/undefined conversion
function getCityNameSafe(cityId: number | null | undefined): string {
  return citySelectRef.value?.getCityName(cityId ?? undefined) ?? 'Not set'
}

// AI : Expose cities data and methods to parent
defineExpose({
  citySelectRef,
  get cities() {
    return citySelectRef.value?.cities ?? []
  },
  get citiesLoaded() {
    return citySelectRef.value?.citiesLoaded ?? false
  },
  getCityName(cityId: number | null | undefined) {
    return getCityNameSafe(cityId)
  }
})
</script>

<style scoped>
/* AI : Form group styling */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

/* AI : Validation error styling */
.validation-error {
  color: #dc2626;
  font-size: 0.75rem;
  display: block;
}

/* AI : Change indicator styling (matches BaseEditForm) */
.change-indicator {
  color: #92400e;
  font-style: italic;
  background: #fef3c7;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  min-height: 1.25rem;
  display: flex;
  align-items: center;
}
</style>
