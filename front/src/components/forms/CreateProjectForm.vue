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
                <label class="text-gray-600 font-medium mb-2 block">{{ $t('project.projectStatus') }} *</label>
                <div class="flex gap-4">
                    <div
                        class="flex items-center gap-2 flex-1 p-3 border rounded cursor-pointer hover:bg-gray-50"
                        :class="{ 'bg-blue-50 border-blue-500': isProposed, 'border-gray-300': !isProposed }"
                        @click="isProposed = true"
                    >
                        <RadioButton
                            inputId="status-proposed"
                            name="projectStatus"
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
                            name="projectStatus"
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
                        :showClear="true"
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
import { ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'primevue/usetoast';
import { trpc, RouterOutput } from '@client';
import { getCameraBounds } from '@composables/map/useCameraBounds';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';
import type { Project } from '@types';

// AI : Get i18n and toast
const { t } = useI18n();
const toast = useToast();

// AI : Get store refs
const overlayStore = useOverlayStore();
const { idSelectedOverlay, overlays } = storeToRefs(overlayStore);

const props = defineProps<{
    project: Partial<Project>;
    mode: 'edit' | 'create';
}>();

const emit = defineEmits<{
    cancel: [];
    submit: [project: Partial<Project>];
}>();

// AI : Determine initial status based on project data
const initialIsProposed = computed(() => {
    const proj = props.project;
    // AI : Project is proposed if it has proposalDate but no startDate/endDate
    return !!(proj.proposalDate && !proj.startDate && !proj.endDate);
});

// AI : Track if project is proposed or planned
const isProposed = ref<boolean>(props.mode === 'create' ? true : initialIsProposed.value);

// AI : Initialize project data - set default proposal date for new proposed projects
const localProject = ref<Partial<Project>>({
    ...props.project,
    proposalDate: props.mode === 'create' ? new Date() : props.project.proposalDate
});

// AI : Update dates when switching between proposed/planned
// AI : Use null instead of undefined for proper serialization
watch(isProposed, (newValue) => {
    if (newValue) {
        // AI : Switching to proposed - clear planned dates and set proposal date
        localProject.value.startDate = null as any;
        localProject.value.endDate = null as any;
        if (!localProject.value.proposalDate) {
            localProject.value.proposalDate = new Date();
        }
    } else {
        // AI : Switching to planned - clear proposal date and restore original planned dates if available
        localProject.value.proposalDate = null as any;
        if (props.project.startDate) {
            localProject.value.startDate = props.project.startDate;
        }
        if (props.project.endDate) {
            localProject.value.endDate = props.project.endDate;
        }
    }
});

// AI : Helper function to convert DBCity to city select format
function convertDBCityToSelectFormat(dbCity: typeof props.project.city): RouterOutput['cities']['getCitiesNearLocation'][number] {
    if (!dbCity) throw new Error('City is required');
    return {
        id: dbCity.id,
        name: dbCity.name,
        countryCode: dbCity.countryCode,
        lat: dbCity.coordinates.y,
        lng: dbCity.coordinates.x,
        distance: 0
    };
}

// AI : Cities data and state - prefill with existing city if available
const cities = ref<RouterOutput['cities']['getCitiesNearLocation']>(
    props.project.city ? [convertDBCityToSelectFormat(props.project.city)] : []
);
const citiesLoading = ref(false);
const citiesLoaded = ref(!!props.project.city); // AI : Mark as loaded if we have a prefilled city

// AI : Watch for external project changes
watch(() => props.project, (newProject) => {
    localProject.value = { ...newProject };

    // AI : Update cities list if project city changes
    if (newProject.city && cities.value.length === 0) {
        cities.value = [convertDBCityToSelectFormat(newProject.city)];
        citiesLoaded.value = true;
    }
}, { deep: true, immediate: true });



// AI : Computed property for cities with display names and distance
const filteredCities = computed(() => {
    return cities.value.map(city => ({
        ...city,
        displayName: `${city.name}, ${city.countryCode}`
    }));
});


// AI : Get center coordinates of currently selected overlay or camera center as fallback
function getOverlayCenter(): { lat: number; lng: number } | null {

    // AI : First try to get overlay center if one is selected
    if (idSelectedOverlay.value && overlays.value[idSelectedOverlay.value]) {
        const overlayObject = overlays.value[idSelectedOverlay.value];

        if (overlayObject.overlay) {
            try {
                const bounds = overlayObject.overlay.getBounds();
                const center = bounds.getCenter();
                return {
                    lat: center.lat,
                    lng: center.lng
                };
            } catch (error) {
                console.error('Error getting overlay center:', error);
            }
        }
    }
    // AI : Fallback to camera center when no overlay is selected or overlay center fails
    const cameraBounds = getCameraBounds();

    if (cameraBounds.value &&
        cameraBounds.value.north !== 0 &&
        cameraBounds.value.south !== 0 &&
        cameraBounds.value.east !== 0 &&
        cameraBounds.value.west !== 0) {
        const center = {
            lat: (cameraBounds.value.north + cameraBounds.value.south) / 2,
            lng: (cameraBounds.value.east + cameraBounds.value.west) / 2
        };
        return center;
    }

    return null;
}

// AI : Load cities when dropdown is about to show
async function onSelectShow() {
    // AI : Always load nearby cities when user opens dropdown, even if we have a prefilled city
    if (!citiesLoading.value) {
        const overlayCenter = getOverlayCenter();
        if (overlayCenter) {
            await loadCitiesNearLocation(overlayCenter.lat, overlayCenter.lng);
        }
    }
}

// AI : Load cities near a specific location
async function loadCitiesNearLocation(lat: number, lng: number) {
    try {
        citiesLoading.value = true;
        citiesLoaded.value = true;

        const nearbyCities = await trpc.cities.getCitiesNearLocation.query({
            lat,
            lng,
            limit: 20
        });

        // AI : Merge with prefilled city if it exists and isn't already in the results
        if (props.project.city) {
            const prefilledCityId = props.project.city.id;
            const cityAlreadyInResults = nearbyCities.some(c => c.id === prefilledCityId);

            if (!cityAlreadyInResults) {
                // AI : Add prefilled city at the beginning using helper function
                cities.value = [
                    convertDBCityToSelectFormat(props.project.city),
                    ...nearbyCities
                ];
            } else {
                cities.value = nearbyCities;
            }
        } else {
            cities.value = nearbyCities;
        }
    } catch (error) {
        console.error('Error loading cities near location:', error);
        cities.value = [];
    } finally {
        citiesLoading.value = false;
    }
}

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

    if (!localProject.value.cityId) {
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
