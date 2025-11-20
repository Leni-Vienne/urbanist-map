<template>
  <BaseEditForm
    entity-type="project"
    :entity-id="project.id"
    :initial-data="projectData"
    :entity-status="project.status"
    :local-only="true"
    :get-available-cities="() => cities"
    container-class="editable-project-form"
    form-class="project-form"
    :submit-label="$t('forms.saveChanges')"
    @close="$emit('close')"
    @submitted="$emit('submitted')"
  >
    <template #fields="{ formData, originalData, hasChanged, getFieldClasses }">
      <div class="form-group">
        <label for="name">{{ $t('project.name') }} *</label>
        <InputText
          id="name"
          v-model="formData.name"
          :class="getFieldClasses('name')"
          :placeholder="$t('project.name')"
          required
          minlength="8"
        />
        <small class="text-gray-500">{{ $t('project.nameTooShort') }}</small>
        <small v-if="hasChanged('name')" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ originalData.name || $t('overlay.notSet') }}"
        </small>
      </div>

      <div class="form-group">
        <label for="description">{{ $t('project.description') }} ({{ $t('project.optionalField') }})</label>
        <Textarea
          id="description"
          v-model="formData.description"
          :class="getFieldClasses('description')"
          rows="3"
          :placeholder="$t('project.description')"
        />
        <small v-if="hasChanged('description')" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ originalData.description || $t('overlay.notSet') }}"
        </small>
      </div>

      <div class="form-group">
        <label class="text-gray-600 font-medium mb-2 block">{{ $t('project.timelineStatus') }} *</label>
        <div class="flex gap-4">
          <div
            class="flex items-center gap-2 flex-1 p-3 border rounded cursor-pointer hover:bg-gray-50"
            :class="{ 'bg-blue-50 border-blue-500': isProposed, 'border-gray-300': !isProposed }"
            @click="toggleTimelineStatus(true, formData)"
          >
            <RadioButton
              inputId="status-proposed"
              name="timelineStatus"
              :value="true"
              v-model="isProposed"
            />
            <div class="flex-1">
              <label
                for="status-proposed"
                class="font-medium cursor-pointer"
              >{{ $t('project.proposed') }}</label>
              <div class="text-xs text-gray-500">{{ $t('project.proposedDescription') }}</div>
            </div>
          </div>
          <div
            class="flex items-center gap-2 flex-1 p-3 border rounded cursor-pointer hover:bg-gray-50"
            :class="{ 'bg-blue-50 border-blue-500': !isProposed, 'border-gray-300': isProposed }"
            @click="toggleTimelineStatus(false, formData)"
          >
            <RadioButton
              inputId="status-planned"
              name="timelineStatus"
              :value="false"
              v-model="isProposed"
            />
            <div class="flex-1">
              <label
                for="status-planned"
                class="font-medium cursor-pointer"
              >{{ $t('project.plannedStatus') }}</label>
              <div class="text-xs text-gray-500">{{ $t('project.plannedDescription') }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="form-group" v-if="isProposed">
        <label for="proposalDate">{{ $t('project.proposalDate') }} *</label>
        <DatePicker
          id="proposalDate"
          v-model="formData.proposalDate"
          :class="getFieldClasses('proposalDate')"
          dateFormat="dd/mm/yy"
          :placeholder="$t('project.proposalDate')"
          updateModelType="date"
          showIcon
          required
          :maxDate="new Date()"
        />
        <small class="text-gray-500">{{ $t('project.proposalDateHelp') }}</small>
        <small v-if="hasChanged('proposalDate')" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData.proposalDate) || $t('overlay.notSet') }}"
        </small>
      </div>

      <div class="form-row" v-if="!isProposed">
        <div class="form-group">
          <label for="startDate">{{ $t('project.startDate') }} *</label>
          <DatePicker
            id="startDate"
            v-model="formData.startDate"
            :class="getFieldClasses('startDate')"
            dateFormat="dd/mm/yy"
            :placeholder="$t('project.startDate')"
            updateModelType="date"
            showIcon
            required
          />
          <small class="text-gray-500">{{ $t('project.startDateHelp') }}</small>
          <small v-if="hasChanged('startDate')" class="change-indicator">
            {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData.startDate) || $t('overlay.notSet') }}"
          </small>
        </div>

        <div class="form-group">
          <label for="endDate">{{ $t('project.endDate') }} *</label>
          <DatePicker
            id="endDate"
            v-model="formData.endDate"
            :class="getFieldClasses('endDate')"
            dateFormat="dd/mm/yy"
            :placeholder="$t('project.endDate')"
            updateModelType="date"
            showIcon
            required
          />
          <small class="text-gray-500">{{ $t('project.endDateHelp') }}</small>
          <small v-if="hasChanged('endDate')" class="change-indicator">
            {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData.endDate) || $t('overlay.notSet') }}"
          </small>
        </div>
      </div>

      <div class="form-group">
        <label for="location-select">{{ $t('project.location') }} *</label>
        <Select
          id="location-select"
          v-model="formData.cityId"
          :options="filteredCities"
          optionLabel="displayName"
          optionValue="id"
          :class="getFieldClasses('cityId')"
          :showClear="false"
          :loading="citiesLoading"
          required
          @show="onSelectShow"
        >
          <template #option="{ option }">
            <div class="flex items-center justify-between w-full">
              <span>{{ option.name }}</span>
              <span class="text-xs text-gray-500">{{ option.countryCode }}
                <span v-if="option.distance > 0"> ({{ Math.round(option.distance) / 1000 }} km)</span>
              </span>
            </div>
          </template>
        </Select>
        <small v-if="hasChanged('cityId')" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: {{ getCityName(originalData.cityId) }}
        </small>
      </div>

      <div class="form-group">
        <label for="latestUpdateOn">{{ $t('project.latestUpdateOn') }} ({{ $t('project.optionalField') }})</label>
        <DatePicker
          id="latestUpdateOn"
          v-model="formData.latestUpdateOn"
          :class="getFieldClasses('latestUpdateOn')"
          dateFormat="dd/mm/yy"
          :placeholder="$t('project.latestUpdateOn')"
          updateModelType="date"
          showIcon
        />
        <small class="text-gray-500">{{ $t('project.latestUpdateOnHelp') }}</small>
        <small v-if="hasChanged('latestUpdateOn')" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData.latestUpdateOn) || $t('overlay.notSet') }}"
        </small>
      </div>

      <div class="form-group">
        <label for="sourceUrl">{{ $t('project.sourceUrl') }} ({{ $t('project.optionalField') }})</label>
        <InputText
          id="sourceUrl"
          v-model="formData.sourceUrl"
          :class="getFieldClasses('sourceUrl')"
          placeholder="https://example.com/project-info"
        />
        <small v-if="hasChanged('sourceUrl')" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ originalData.sourceUrl || $t('overlay.notSet') }}"
        </small>
      </div>
    </template>
  </BaseEditForm>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BaseEditForm from './BaseEditForm.vue'
import type { Project } from '@types'
import { useCitySelect } from '@composables/forms/useCitySelect'
import { useProjectTimelineStatus } from '@composables/forms/useProjectTimelineStatus'
import { formatDate } from '@utils/dateFormat'

interface Props {
  project: Project
}

interface Emits {
  (e: 'close'): void
  (e: 'submitted'): void
}

const props = defineProps<Props>()
defineEmits<Emits>()

// AI : Use city select composable with prefilled city
const { cities, filteredCities, citiesLoading, onSelectShow, getCityName } = useCitySelect(props.project.city)

// AI : Use timeline status composable (without formData watcher since we handle status in toggleTimelineStatus)
const { isProposed, toggleTimelineStatus } = useProjectTimelineStatus(props.project)

// AI : Helper to ensure dates are Date objects (handles both Date and string from backend)
function toDateObject(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date
}

// AI : Transform project data for the form - ensure all dates are Date objects for DatePicker
const projectData = computed(() => ({
  name: props.project.name,
  description: props.project.description || '',
  sourceUrl: props.project.sourceUrl || '',
  proposalDate: toDateObject(props.project.proposalDate),
  startDate: toDateObject(props.project.startDate),
  endDate: toDateObject(props.project.endDate),
  latestUpdateOn: toDateObject(props.project.latestUpdateOn),
  cityId: props.project.cityId,
}))
</script>

<style scoped>
/* AI : Project-specific form styling */
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (max-width: 640px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>