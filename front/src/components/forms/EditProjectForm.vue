<template>
  <BaseEditForm
    entity-type="project"
    :entity-id="project.id"
    :initial-data="projectData"
    :entity-status="project.status"
    container-class="editable-project-form"
    form-class="project-form"
    @close="$emit('close')"
    @submitted="$emit('submitted')"
  >
    <template #fields="{ formData, originalData, hasChanged, getFieldClasses, formatDate }">
      <div class="form-group">
        <label for="name">{{ $t('project.name') }} *</label>
        <InputText
          id="name"
          v-model="formData.name"
          :class="getFieldClasses('name')"
          :placeholder="$t('project.name')"
          required
        />
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
        <label for="proposalDate">{{ $t('project.proposalDate') }} ({{ $t('project.optionalField') }})</label>
        <DatePicker
          id="proposalDate"
          v-model="formData.proposalDate"
          :class="getFieldClasses('proposalDate')"
          dateFormat="yy-mm-dd"
          :placeholder="$t('project.proposalDate')"
          updateModelType="yyyy-MM-dd"
          showIcon
        />
        <small class="text-gray-500">{{ $t('project.proposalDateHelp') }}</small>
        <small v-if="hasChanged('proposalDate')" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData.proposalDate) || $t('overlay.notSet') }}"
        </small>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="startDate">{{ $t('project.startDate') }} ({{ $t('project.optionalField') }})</label>
          <DatePicker
            id="startDate"
            v-model="formData.startDate"
            :class="getFieldClasses('startDate')"
            dateFormat="yy-mm-dd"
            :placeholder="$t('project.startDate')"
            updateModelType="yyyy-MM-dd"
            showIcon
          />
          <small class="text-gray-500">{{ $t('project.startDateHelp') }}</small>
          <small v-if="hasChanged('startDate')" class="change-indicator">
            {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData.startDate) || $t('overlay.notSet') }}"
          </small>
        </div>

        <div class="form-group">
          <label for="endDate">{{ $t('project.endDate') }} ({{ $t('project.optionalField') }})</label>
          <DatePicker
            id="endDate"
            v-model="formData.endDate"
            :class="getFieldClasses('endDate')"
            dateFormat="yy-mm-dd"
            :placeholder="$t('project.endDate')"
            updateModelType="yyyy-MM-dd"
            showIcon
          />
          <small class="text-gray-500">{{ $t('project.endDateHelp') }}</small>
          <small v-if="hasChanged('endDate')" class="change-indicator">
            {{ $t('overlay.changedFrom') }}: "{{ formatDate(originalData.endDate) || $t('overlay.notSet') }}"
          </small>
        </div>
      </div>

      <div class="form-group">
        <label for="latestUpdateOn">{{ $t('project.latestUpdateOn') }} ({{ $t('project.optionalField') }})</label>
        <DatePicker
          id="latestUpdateOn"
          v-model="formData.latestUpdateOn"
          :class="getFieldClasses('latestUpdateOn')"
          dateFormat="yy-mm-dd"
          :placeholder="$t('project.latestUpdateOn')"
          updateModelType="yyyy-MM-dd"
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

interface Props {
  project: Project
}

interface Emits {
  (e: 'close'): void
  (e: 'submitted'): void
}

const props = defineProps<Props>()
defineEmits<Emits>()

// AI : Transform project data for the form (include cityId to preserve it)
const projectData = computed(() => ({
  name: props.project.name,
  description: props.project.description || '',
  sourceUrl: props.project.sourceUrl || '',
  proposalDate: props.project.proposalDate,
  startDate: props.project.startDate,
  endDate: props.project.endDate,
  latestUpdateOn: props.project.latestUpdateOn,
  cityId: props.project.cityId, // AI : Include cityId to prevent it from being lost
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