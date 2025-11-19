<template>
    <form @submit.prevent="handleSubmit">
        <div class="flex flex-col gap-4">
            <div class="field">
                <FloatLabel
                    class="w-full"
                    variant="in"
                >
                    <InputText
                        id="project-name-input"
                        v-model="localProject.name"
                        required
                        minlength="8"
                        class="w-full"
                    />
                    <label
                        for="project-name-input"
                        class="text-gray-600"
                    >{{ $t('project.name') }} *</label>
                </FloatLabel>
                <small class="text-gray-500 mt-1">{{ $t('project.nameTooShort') }}</small>
            </div>

            <div class="field">
                <FloatLabel
                    class="w-full"
                    variant="in"
                >
                    <Textarea
                        id="project-description-input"
                        v-model="localProject.description"
                        rows="2"
                        class="w-full"
                    />
                    <label
                        for="project-description-input"
                        class="text-gray-600"
                    >{{ $t('project.description') }} ({{ $t('project.optionalField') }})</label>
                </FloatLabel>
            </div>

            <div class="field">
                <label class="text-gray-600 font-medium mb-2 block">{{ $t('project.timelineStatus') }} *</label>
                <div class="flex gap-4">
                    <div
                        class="flex items-center gap-2 flex-1 p-3 border rounded cursor-pointer hover:bg-gray-50"
                        :class="{ 'bg-blue-50 border-blue-500': isProposed, 'border-gray-300': !isProposed }"
                        @click="isProposed = true"
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
                        @click="isProposed = false"
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

            <div
                class="field"
                v-if="isProposed"
            >
                <FloatLabel
                    class="w-full"
                    variant="in"
                >
                    <DatePicker
                        id="proposal-date-input"
                        dateFormat="dd/mm/yy"
                        v-model="localProject.proposalDate"
                        class="w-full"
                        required
                        showIcon
                        :updateModelType="'date'"
                    />
                    <label
                        for="proposal-date-input"
                        class="text-gray-600"
                    >{{ $t('project.proposalDate') }} *</label>
                </FloatLabel>
                <small class="text-gray-500 block mt-1">{{ $t('project.proposalDateHelp') }}</small>
            </div>

            <div
                class="flex gap-3"
                v-if="!isProposed"
            >
                <div class="flex-1 field">
                    <FloatLabel
                        class="w-full"
                        variant="in"
                    >
                        <DatePicker
                            id="start-date-input"
                            dateFormat="dd/mm/yy"
                            v-model="localProject.startDate"
                            class="w-full"
                            required
                            showIcon
                            :updateModelType="'date'"
                        />
                        <label
                            for="start-date-input"
                            class="text-gray-600"
                        >{{ $t('project.startDate') }} *</label>
                    </FloatLabel>
                    <small class="text-gray-500 block mt-1">{{ $t('project.startDateHelp') }}</small>
                </div>
                <div class="flex-1 field">
                    <FloatLabel
                        class="w-full"
                        variant="in"
                    >
                        <DatePicker
                            id="end-date-input"
                            dateFormat="dd/mm/yy"
                            v-model="localProject.endDate"
                            class="w-full"
                            required
                            showIcon
                            :updateModelType="'date'"
                        />
                        <label
                            for="end-date-input"
                            class="text-gray-600"
                        >{{ $t('project.endDate') }} *</label>
                    </FloatLabel>
                    <small class="text-gray-500 block mt-1">{{ $t('project.endDateHelp') }}</small>
                </div>
            </div>

            <div class="field">
                <FloatLabel
                    class="w-full"
                    variant="in"
                >
                    <Select
                        id="location-select"
                        v-model="localProject.cityId"
                        :options="filteredCities"
                        optionLabel="displayName"
                        optionValue="id"
                        class="w-full"
                        :showClear="false"
                        :loading="citiesLoading"
                        :disabled="false"
                        required
                        @show="onSelectShow"
                    ><template #option="{ option }">
                            <div class="flex items-center justify-between w-full">
                                <span>{{ option.name }}</span>
                                <span class="text-xs text-gray-500">{{ option.countryCode }}
                                    <span v-if="option.distance > 0"> ({{ Math.round(option.distance) / 1000 }}
                                        km)</span>
                                </span>
                            </div>
                        </template>
                    </Select>
                    <label
                        for="location-select"
                        class="text-gray-600"
                    >{{ $t('project.location') }} *</label>
                </FloatLabel>
            </div>

            <div
                class="field"
                v-if="props.mode === 'edit'"
            >
                <FloatLabel
                    class="w-full"
                    variant="in"
                >
                    <DatePicker
                        id="latest-update-input"
                        dateFormat="dd/mm/yy"
                        v-model="localProject.latestUpdateOn"
                        class="w-full"
                        showIcon
                        :showClear="true"
                        :updateModelType="'date'"
                    />
                    <label
                        for="latest-update-input"
                        class="text-gray-600"
                    >{{ $t('project.latestUpdateOn') }} ({{
                        $t('project.optionalField') }})</label>
                </FloatLabel>
                <small class="text-gray-500 block mt-1">{{ $t('project.latestUpdateOnHelp') }}</small>
            </div>

            <div class="field">
                <FloatLabel
                    class="w-full"
                    variant="in"
                >
                    <InputText
                        id="source-url-input"
                        type="url"
                        v-model="localProject.sourceUrl"
                        class="w-full"
                    />
                    <label
                        for="source-url-input"
                        class="text-gray-600"
                    >{{ $t('project.sourceUrl') }} ({{
                        $t('project.optionalField') }})</label>
                </FloatLabel>
            </div>
        </div>
    </form>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '@composables/ui/useToast'
import { useCitySelect } from '@composables/forms/useCitySelect'
import { useProjectTimelineStatus } from '@composables/forms/useProjectTimelineStatus'
import { switchTileLayer, type TileLayerType, isTileLayerType } from '@composables/map/useTileLayers'
import type { Project } from '@types';

// AI : Get i18n and toast
const { t } = useI18n();
const toast = useToast();

const props = defineProps<{
    project: Partial<Project>;
    mode: 'edit' | 'create';
}>();

const emit = defineEmits<{
    cancel: [];
    submit: [project: Partial<Project>];
}>();

// AI : Initialize project data - set default proposal date for new proposed projects
const localProject = ref<Partial<Project>>({
    ...props.project,
    proposalDate: props.mode === 'create' ? new Date() : props.project.proposalDate
});

// AI : Use timeline status composable with formData watcher for CreateProjectForm
const { isProposed } = useProjectTimelineStatus(props.project, localProject.value)

// AI : Override initial value for create mode
if (props.mode === 'create') {
    isProposed.value = true
}

// AI : Use city select composable with prefilled city
const { cities, citiesLoading, citiesLoaded, filteredCities, onSelectShow } = useCitySelect(props.project.city)

// AI : Map country code to tile layer type - returns appropriate layer or default
function getLayerTypeForCountry(countryCode: string): TileLayerType {
    return isTileLayerType(countryCode) ? countryCode : 'esri';
}

// AI : Watch for city selection changes to automatically switch tile layer to match country
watch(() => localProject.value.cityId, (newCityId) => {
    if (!newCityId || cities.value.length === 0) return;

    const selectedCity = cities.value.find(c => c.id === newCityId);
    if (selectedCity) {
        const layerType = getLayerTypeForCountry(selectedCity.countryCode);
        switchTileLayer(layerType);
    }
});

// AI : Watch for external project changes
watch(() => props.project, (newProject) => {
    localProject.value = { ...newProject };

    // AI : Update cities list if project city changes - handled internally by composable now
}, { deep: true, immediate: true });

function handleSubmit() {
    // AI : Validate required fields based on project status
    if (!localProject.value.name?.trim()) {
        toast.add({
            severity: 'error',
            summary: t('project.validationError'),
            detail: t('project.nameRequired'),
            life: 3000
        });
        return;
    }

    // AI : Validate minimum name length
    if (localProject.value.name.trim().length < 8) {
        toast.add({
            severity: 'error',
            summary: t('project.validationError'),
            detail: t('project.nameTooShort'),
            life: 3000
        });
        return;
    }

    // AI : Validate that location is selected AND cities were loaded/validated
    if (!localProject.value.cityId || !citiesLoaded.value) {
        toast.add({
            severity: 'error',
            summary: t('project.validationError'),
            detail: t('project.locationRequired'),
            life: 3000
        });
        return;
    }

    // AI : Validate that the selected cityId exists in the loaded cities list
    if (cities.value.length > 0 && !cities.value.find(c => c.id === localProject.value.cityId)) {
        toast.add({
            severity: 'error',
            summary: t('project.validationError'),
            detail: t('project.locationRequired'),
            life: 3000
        });
        return;
    }

    // AI : For proposed projects, proposal date is required
    if (isProposed.value) {
        if (!localProject.value.proposalDate) {
            toast.add({
                severity: 'error',
                summary: t('project.validationError'),
                detail: t('project.proposalDateRequired'),
                life: 3000
            });
            return;
        }
        // AI : For planned projects, start and end dates are required
    } else if (!localProject.value.startDate || !localProject.value.endDate) {
        toast.add({
            severity: 'error',
            summary: t('project.validationError'),
            detail: t('project.datesRequired'),
            life: 3000
        });
        return;
    }

    // AI : Create a clean project object without File objects to prevent serialization issues
    const cleanProjectData = localProject.value;

    // AI : Clear inappropriate dates based on project status
    // AI : Use null instead of undefined to ensure database values are actually cleared
    if (isProposed.value) {
        // AI : Proposed projects should not have start/end dates
        cleanProjectData.startDate = null as any;
        cleanProjectData.endDate = null as any;
    } else {
        // AI : Planned projects should not have proposal date
        cleanProjectData.proposalDate = null as any;
    }

    // AI : Include city object if cityId is set and city data is available
    if (cleanProjectData.cityId && cities.value.length > 0) {
        const selectedCity = cities.value.find(c => c.id === cleanProjectData.cityId);
        if (selectedCity) {
            cleanProjectData.city = {
                id: selectedCity.id,
                name: selectedCity.name,
                countryCode: selectedCity.countryCode,
                coordinates: { x: selectedCity.lng, y: selectedCity.lat },
                createdAt: new Date(),
                updatedAt: new Date()
            };
        }
    }

    emit('submit', cleanProjectData);
}

// AI : Expose methods to parent component
defineExpose({
    handleSubmit
});
</script>
