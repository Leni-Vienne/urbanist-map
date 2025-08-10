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
                        class="w-full"
                        placeholder="e.g. Downtown Office Building"
                    />
                    <label
                        for="project-name-input"
                        class="text-gray-600"
                    >Project Name</label>
                </FloatLabel>
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
                        placeholder="Brief description of the construction project"
                    />
                    <label
                        for="project-description-input"
                        class="text-gray-600"
                    >Description</label>
                </FloatLabel>
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
                        :placeholder="citiesPlaceholder"
                        class="w-full"
                        :showClear="true"
                        :loading="citiesLoading"
                        :disabled="false"
                        required
                        @focus="onSelectFocus"
                        @click="onSelectFocus"
                    ><template #option="{ option }">
                            <div class="flex items-center justify-between w-full">
                                <span>{{ option.name }}</span>
                                <span class="text-xs text-gray-500">{{ option.countryCode }}<span
                                        v-if="option.distance > 0"
                                    > ({{ Math.round(option.distance) / 1000 }} km)</span></span>
                            </div>
                        </template>
                    </Select>
                    <label
                    v-if="filteredCities.length > 0"
                        for="location-select"
                        class="text-gray-600"
                    >Location</label>
                </FloatLabel>
            </div>

            <div class="flex gap-3">
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
                            placeholder="Select start date"
                            showIcon
                        />
                        <label
                            for="start-date-input"
                            class="text-gray-600"
                        >Start Date</label>
                    </FloatLabel>
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
                            placeholder="Select end date"
                            showIcon
                        />
                        <label
                            for="end-date-input"
                            class="text-gray-600"
                        >End Date</label>
                    </FloatLabel>
                </div>
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
                        placeholder="https://example.com/project.pdf"
                    />
                    <label
                        for="source-url-input"
                        class="text-gray-600"
                    >Source URL</label>
                </FloatLabel>
            </div>

            <div class="field">
                <label class="text-gray-600 block mb-2">Source PDF</label>
                <FileUpload
                    id="source-pdf-input"
                    mode="basic"
                    accept=".pdf"
                    :maxFileSize="50000000"
                    :auto="false"
                    choose-label="Source PDF"
                    @select="onPdfSelect"
                    @clear="onPdfClear"
                />
            </div>
        </div>
    </form>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { trpc, RouterOutput } from '@client';
import { getCameraBounds } from '@composables/map/useCameraBounds';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';
import type { Project } from '@types';
import FileUpload from 'primevue/fileupload';

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

// AI : Project data
const localProject = ref<Partial<Project>>({ ...props.project });

// AI : Cities data and state
const cities = ref<RouterOutput['cities']['getCitiesNearLocation']>([]);
const citiesLoading = ref(false);
const citiesLoaded = ref(false); // AI : Track if cities have been loaded to avoid multiple loads

// AI : Watch for external project changes
watch(() => props.project, (newProject) => {
    localProject.value = { ...newProject };

    // AI : Don't auto-load cities based on existing project location
    // AI : Let user click to load cities near current camera/overlay position instead
}, { deep: true, immediate: true });

const citiesPlaceholder = computed(() => {
    if (citiesLoading.value) return 'Loading cities...';
    if (!citiesLoaded.value) return 'Click to load cities...';

    if (cities.value.length === 0) return 'No cities found in this area';
    return 'Select a city...';
});

// AI : Computed property for cities with display names and distance
const filteredCities = computed(() => {
    return cities.value.map(city => ({
        ...city,
        displayName: `${city.name}, ${city.countryCode}`
    }));
});

// AI : Watch for cityId changes to update location field for backward compatibility
// AI : Watch for cityId changes to update city name if needed (backward compatibility)
watch(() => localProject.value.cityId, (newCityId) => {
    if (newCityId && cities.value.length > 0) {
        // AI : Add logic here if you want to update another field based on city selection
    }
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

// AI : Lazy load cities when user first interacts with the select
async function onSelectFocus() {
    if (!citiesLoaded.value && !citiesLoading.value) {
        citiesLoaded.value = true;
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
        cities.value = await trpc.cities.getCitiesNearLocation.query({
            lat,
            lng,
            limit: 20
        });
    } catch (error) {
        console.error('Error loading cities near location:', error);
        cities.value = [];
    } finally {
        citiesLoading.value = false;
    }
}

function handleSubmit() {
    // AI : Create a clean project object without File objects to prevent serialization issues
    const { sourcePdf, ...cleanProjectData } = localProject.value;
    emit('submit', cleanProjectData);
}

// AI : Handle PDF file selection
function onPdfSelect(event: any) {
    const file = event.files[0];
    if (file) {
        localProject.value.sourcePdf = file;
    }
}

// AI : Handle PDF file clear
function onPdfClear() {
    localProject.value.sourcePdf = null;
}
</script>
