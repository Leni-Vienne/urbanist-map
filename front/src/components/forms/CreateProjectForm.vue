<template>
  <form @submit.prevent="handleSubmit">
    <ProjectFormFields
      ref="formFieldsRef"
      :form-data="formData"
      :show-latest-update-field="false"
      :is-proposed="isProposed"
      :prefilled-city="props.project.city"
      :marker-coordinates="markerCoordinates"
      id-prefix="create"
      @update:is-proposed="isProposed = $event"
      @update:form-data="Object.assign(formData, $event)"
      @city-change="handleCityChange"
    />
  </form>
</template>

<script setup lang="ts">
import { ref, watch, reactive } from "vue";
import { switchTileLayer, isTileLayerType } from "@/services/map/tileLayers";
import { useProjectFormValidation } from "@/composables/forms/useProjectFormValidation";
import type ProjectFormFields from "@/components/forms/ProjectFormFields.vue";
import type { ProjectFormData } from "@/components/forms/ProjectFormFields.vue";
import type { Project } from "@/types/index";

const props = defineProps<{
  project: Partial<Project>;
}>();

const formFieldsRef = ref<InstanceType<typeof ProjectFormFields> | null>(null);

const formData = reactive<ProjectFormData>({
  name: props.project.name ?? "",
  description: props.project.description ?? null,
  proposalDate: props.project.proposalDate ?? null,
  proposalDatePrecision: props.project.proposalDatePrecision ?? null,
  startDate: props.project.startDate ?? null,
  startDatePrecision: props.project.startDatePrecision ?? null,
  endDate: props.project.endDate ?? null,
  endDatePrecision: props.project.endDatePrecision ?? null,
  cityId: props.project.cityId ?? null,
  sourceUrl: props.project.sourceUrl ?? null,
  tags: props.project.tags ?? [],
});

const isProposed = ref(false);

const emit = defineEmits<{ cancel: []; submit: [project: Partial<Project>] }>();

const { validateProjectForm } = useProjectFormValidation();

const markerCoordinates =
  props.project.lat && props.project.lng
    ? { lat: props.project.lat, lng: props.project.lng }
    : null;

watch(
  () => props.project,
  (p) => {
    formData.name = p.name ?? "";
    formData.description = p.description ?? null;
    formData.proposalDate = p.proposalDate ?? null;
    formData.startDate = p.startDate ?? null;
    formData.endDate = p.endDate ?? null;
    formData.cityId = p.cityId ?? null;
    formData.sourceUrl = p.sourceUrl ?? null;
    formData.tags = p.tags ?? [];
  },
  { deep: true },
);
function handleCityChange(newCityId: number | null) {
  if (!newCityId) return;
  const cities = formFieldsRef.value?.cities ?? [];
  const selectedCity = cities.find((c) => c.id === newCityId);
  if (selectedCity) {
    switchTileLayer(isTileLayerType(selectedCity.countryCode) ? selectedCity.countryCode : "esri");
  }
}

function handleSubmit() {
  const cities = formFieldsRef.value?.cities ?? [];
  const citiesLoaded = formFieldsRef.value?.citiesLoaded ?? false;

  if (!validateProjectForm(formData, isProposed.value, cities, citiesLoaded)) return;

  const result: Partial<Project> = {
    ...props.project,
    name: formData.name,
    description: formData.description,
    sourceUrl: formData.sourceUrl,
    cityId: formData.cityId === null ? undefined : formData.cityId,
    proposalDate: isProposed.value ? formData.proposalDate : null,
    proposalDatePrecision: isProposed.value ? formData.proposalDatePrecision : null,
    startDate: isProposed.value ? null : formData.startDate,
    startDatePrecision: isProposed.value ? null : formData.startDatePrecision,
    endDate: isProposed.value ? null : formData.endDate,
    endDatePrecision: isProposed.value ? null : formData.endDatePrecision,
    tags: formData.tags,
  };

  // Include city object if available
  const selectedCity = cities.find((c) => c.id === result.cityId);
  if (selectedCity) {
    result.city = {
      id: selectedCity.id,
      name: selectedCity.name,
      nameLocal: selectedCity.nameLocal,
      countryCode: selectedCity.countryCode,
      coordinates: { x: selectedCity.lng, y: selectedCity.lat },
      approvedProjectCount: 0, // Not available from form context, will be populated by backend
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  emit("submit", result);
}

defineExpose({ handleSubmit });
</script>
