<template>
  <form @submit.prevent="handleSubmit" class="flex flex-col gap-4">
    <ProjectFormFields
      ref="formFieldsRef"
      :form-data="formData"
      :timeline-status="timelineStatus"
      :prefilled-city="props.project.city"
      :marker-coordinates="markerCoordinates"
      :staged-render-preview="stagedRender?.previewUrl ?? null"
      id-prefix="create"
      @update:timeline-status="timelineStatus = $event"
      @update:form-data="Object.assign(formData, $event)"
      @city-change="handleCityChange"
      @render-selected="stagedRender = $event"
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
import type { StagedRender } from "@/composables/submission/stagedRenderStore";

const props = defineProps<{
  project: Partial<Project>;
}>();

const formFieldsRef = ref<InstanceType<typeof ProjectFormFields> | null>(null);

const formData = reactive<ProjectFormData>(projectToFormData(props.project));

// A render staged in the form. The new project has no id yet, so it travels with the submit event
// and is keyed by the freshly created project id by the parent.
const stagedRender = ref<StagedRender | null>(null);

const timelineStatus = ref<
  "proposed" | "planned" | "under_construction" | "completed" | "canceled"
>("proposed");

const emit = defineEmits<{
  cancel: [];
  submit: [project: Partial<Project>, render: StagedRender | null];
}>();

const { validateProjectForm } = useProjectFormValidation();

const markerCoordinates =
  typeof props.project.lat === "number" && typeof props.project.lng === "number"
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

  emit("submit", result, stagedRender.value);
}

defineExpose({ handleSubmit });
</script>
