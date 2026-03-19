<template>
  <form @submit.prevent="handleSubmit">
    <ProjectFormFields
      ref="formFieldsRef"
      :form-data="formData"
      :show-latest-update-field="false"
      :timeline-status="timelineStatus"
      :prefilled-city="props.project.city"
      :marker-coordinates="markerCoordinates"
      id-prefix="create"
      @update:timeline-status="timelineStatus = $event"
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
import { projectToFormData, formDataToProjectFields } from "@/utils/projectFormHelpers";

const props = defineProps<{
  project: Partial<Project>;
}>();

const formFieldsRef = ref<InstanceType<typeof ProjectFormFields> | null>(null);

const formData = reactive<ProjectFormData>(projectToFormData(props.project));

const timelineStatus = ref<
  "proposed" | "planned" | "under_construction" | "completed" | "canceled"
>("proposed");

const emit = defineEmits<{ cancel: []; submit: [project: Partial<Project>] }>();

const { validateProjectForm } = useProjectFormValidation();

const markerCoordinates =
  props.project.lat && props.project.lng
    ? { lat: props.project.lat, lng: props.project.lng }
    : null;

watch(
  () => props.project,
  (p) => Object.assign(formData, projectToFormData(p)),
  { deep: true },
);
async function handleCityChange(newCityId: number | null) {
  if (!newCityId) return;
  const cities = formFieldsRef.value?.cities ?? [];
  const selectedCity = cities.find((c) => c.id === newCityId);
  if (selectedCity) {
    await switchTileLayer(
      isTileLayerType(selectedCity.countryCode) ? selectedCity.countryCode : "esri",
    );
  }
}

function handleSubmit() {
  const cities = formFieldsRef.value?.cities ?? [];
  const citiesLoaded = formFieldsRef.value?.citiesLoaded ?? false;

  if (!validateProjectForm(formData, timelineStatus.value, cities, citiesLoaded)) return;

  const result: Partial<Project> = {
    ...props.project,
    ...formDataToProjectFields(formData),
    timelineStatus: timelineStatus.value,
    proposalDate: timelineStatus.value === "proposed" ? formData.proposalDate : null,
    proposalDatePrecision:
      timelineStatus.value === "proposed" ? formData.proposalDatePrecision : null,
    startDate: timelineStatus.value === "proposed" ? null : formData.startDate,
    startDatePrecision: timelineStatus.value === "proposed" ? null : formData.startDatePrecision,
    endDate: timelineStatus.value === "proposed" ? null : formData.endDate,
    endDatePrecision: timelineStatus.value === "proposed" ? null : formData.endDatePrecision,
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
