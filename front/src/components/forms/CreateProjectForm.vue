<template>
  <form @submit.prevent="handleSubmit">
    <ProjectFormFields
      ref="formFieldsRef"
      :form-data="formData"
      :show-latest-update-field="props.mode === 'edit'"
      :is-proposed="isProposed"
      :prefilled-city="props.project.city"
      :marker-coordinates="markerCoordinates"
      id-prefix="create"
      @update:is-proposed="isProposed = $event"
      @city-change="handleCityChange"
    />
  </form>
</template>

<script setup lang="ts">
import { ref, watch, reactive } from 'vue'
import { switchTileLayer, isTileLayerType } from '@/composables/map/useTileLayers'
import { useProjectFormValidation } from '@/composables/forms/useProjectFormValidation'
import type ProjectFormFields from './ProjectFormFields.vue';
import type { ProjectFormData } from './ProjectFormFields.vue';
import type { Project } from '@/types/index'

const props = defineProps<{
    project: Partial<Project>
    mode: 'edit' | 'create'
}>()

const emit = defineEmits<{ cancel: [], submit: [project: Partial<Project>] }>()

const { validateProjectForm } = useProjectFormValidation()
const formFieldsRef = ref<InstanceType<typeof ProjectFormFields> | null>(null)

const formData = reactive<ProjectFormData>({
    name: props.project.name ?? '',
    description: props.project.description ?? null,
    proposalDate: props.project.proposalDate ?? null,
    startDate: props.project.startDate ?? null,
    endDate: props.project.endDate ?? null,
    latestUpdateOn: props.project.latestUpdateOn ?? null,
    cityId: props.project.cityId ?? null,
    sourceUrl: props.project.sourceUrl ?? null,
})

const isProposed = ref(props.mode === 'create' ? true : !!(props.project.proposalDate && !props.project.startDate))

const markerCoordinates = props.project.lat && props.project.lng
    ? { lat: props.project.lat, lng: props.project.lng }
    : null

function handleCityChange(newCityId: string | null) {
    if (!newCityId) return
    const cities = formFieldsRef.value?.cities ?? []
    const selectedCity = cities.find(c => c.id === newCityId)
    if (selectedCity) {
        switchTileLayer(isTileLayerType(selectedCity.countryCode) ? selectedCity.countryCode : 'esri')
    }
}

watch(() => props.project, (p) => {
    formData.name = p.name ?? ''
    formData.description = p.description ?? null
    formData.proposalDate = p.proposalDate ?? null
    formData.startDate = p.startDate ?? null
    formData.endDate = p.endDate ?? null
    formData.latestUpdateOn = p.latestUpdateOn ?? null
    formData.cityId = p.cityId ?? null
    formData.sourceUrl = p.sourceUrl ?? null
}, { deep: true })

function handleSubmit() {
    const cities = formFieldsRef.value?.cities ?? []
    const citiesLoaded = formFieldsRef.value?.citiesLoaded ?? false

    if (!validateProjectForm(formData, isProposed.value, cities, citiesLoaded)) return

    const result: Partial<Project> = {
        ...props.project,
        name: formData.name,
        description: formData.description,
        sourceUrl: formData.sourceUrl,
        latestUpdateOn: formData.latestUpdateOn,
        cityId: formData.cityId === null ? undefined : formData.cityId,
        proposalDate: isProposed.value ? formData.proposalDate : null,
        startDate: isProposed.value ? null : formData.startDate,
        endDate: isProposed.value ? null : formData.endDate,
    }

    // AI : Include city object if available
    const selectedCity = cities.find(c => c.id === result.cityId)
    if (selectedCity) {
        result.city = {
            id: selectedCity.id,
            name: selectedCity.name,
            countryCode: selectedCity.countryCode,
            coordinates: { x: selectedCity.lng, y: selectedCity.lat },
            approvedProjectCount: 0, // AI : Not available from form context, will be populated by backend
            createdAt: new Date(),
            updatedAt: new Date()
        }
    }

    emit('submit', result)
}

defineExpose({ handleSubmit })
</script>
