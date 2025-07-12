<template>
    <form
        @submit.prevent="handleSubmit"
        class="project-editor"
    >
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
                        for="location-select"
                        class="text-gray-600"
                    >Location</label>
                </FloatLabel>
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
                        required
                    />
                    <label
                        for="source-url-input"
                        class="text-gray-600"
                    >Source URL</label>
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
                            v-model="localProject.startDate"
                            class="w-full"
                            required
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
                            v-model="localProject.endDate"
                            class="w-full"
                            required
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
                    <DatePicker
                        id="latest-update-on-input"
                        v-model="localProject.latestUpdateOn"
                        class="w-full"
                    />
                    <label
                        for="latest-update-on-input"
                        class="text-gray-600"
                    >Latest Update On</label>
                </FloatLabel>
            </div>
        </div>

        <div class="flex gap-2 justify-center mt-6">
            <Button
                type="button"
                label="Cancel"
                class="p-button-outlined"
                icon="pi pi-times"
                @click="$emit('cancel')"
            />
            <Button
                type="submit"
                :label="mode === 'create' ? 'Create project' : 'Update project'"
                icon="pi pi-save"
            />
        </div>
    </form>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { trpc, RouterOutput } from '@client';
import { idSelectedOverlay, overlays } from '@composables/overlay/useOverlay';
import { getCameraBounds } from '@composables/map/useCameraBounds';
import type { Project } from '@types';

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

    // AI : Auto-load cities when editing a project that has city data
    if (
        props.mode === 'edit' &&
        newProject?.city?.coordinates?.x != null &&
        newProject?.city?.coordinates?.y != null &&
        !citiesLoaded.value
    ) {
        loadCitiesNearLocation(newProject.city.coordinates.y, newProject.city.coordinates.x);
    }
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
    }    // AI : Fallback to camera center when no overlay is selected or overlay center fails
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
    emit('submit', localProject.value);
}
</script>

<style scoped>
.project-editor {
    max-width: 800px;
    margin: 0 auto;
    /* AI : Prevent form from creating its own scrollbar when inside Dialog */
    overflow: visible;
    height: auto;
    max-height: none;
}

/* AI : Ensure all form elements are properly sized without creating overflow */
.field {
    overflow: visible;
}

/* AI : Prevent flex containers from creating scrollbars */
.flex {
    overflow: visible;
}

/* AI : Override PrimeVue component overflow behavior when needed */
:deep(.p-component) {
    overflow: visible;
}

/* AI : Allow dropdown panels to scroll independently */
:deep(.p-dropdown-panel) {
    overflow-y: auto;
}
</style>
