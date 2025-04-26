<template>
    <div class="info-popup-content">
        <h3 class="text-center text-xl font-bold mb-4">Project Information</h3>
        
        <!-- Edit Mode -->
        <form v-if="isEditMode" class="edit-mode" id="editForm" @submit.prevent="submitForm">
            <div class="card flex flex-wrap gap-4">
                <FloatLabel variant="in">
                    <InputText
                        id="projectName"
                        v-model="formData.projectName"
                        size="small"
                    />
                    <label for="projectName">Project name</label>
                </FloatLabel>
                <FloatLabel variant="in">
                    <InputText
                        id="sourceLink"
                        v-model="formData.sourceLink"
                        size="small"
                    />
                    <label for="sourceLink">Link to source</label>
                </FloatLabel>
                <FloatLabel variant="in">
                    <label for="construction_start">Construction start date:</label>
                    <DatePicker
                        id="construction_start"
                        v-model="formData.startDate"
                        dateFormat="yy"
                        showIcon
                        fluid
                        size="small"
                        required
                        view="year"
                        selectionMode="range"
                    />
                </FloatLabel>
                <FloatLabel variant="in">
                    <label for="construction_end">Construction end date:</label>
                    <DatePicker
                        id="construction_end"
                        v-model="formData.endDate"
                        dateFormat="dd/mm/yy"
                        showIcon
                        size="small"
                        required
                    />
                </FloatLabel>
            </div>
            <br>
            <div class="flex justify-center gap-2">
                <Button
                    form="editForm"
                    type="submit"
                    icon="pi pi-save"
                    
                    label="Save"
                    class="p-button-success"
                    size="small"
                />
                <Button
                    icon="pi pi-times"
                    @click="cancelEdit"
                    label="Cancel"
                    class="p-button-secondary"
                    size="small"
                />
            </div>
        </form>

        <!-- View Mode -->
        <div v-else class="view-mode">
            <div class="info-display">
                <div class="info-row">
                    <strong>Project Name:</strong> {{ formData.projectName || 'Not specified' }}
                </div>
                <div class="info-row">
                    <strong>Link to source:</strong> {{ formData.sourceLink || 'Not specified' }}
                </div>
                <div class="info-row">
                    <strong>Construction Start:</strong> {{ formatDate(formData.startDate) }}
                </div>
                <div class="info-row">
                    <strong>Construction End:</strong> {{ formatDate(formData.endDate) }}
                </div>
                <div class="info-row" v-if="formData.budget">
                    <strong>Budget:</strong> {{ formData.budget }} €
                </div>
            </div>
            <br>
            <div class="flex justify-center">
                <Button
                    icon="pi pi-pencil"
                    @click="enableEdit"
                    label="Edit"
                    class="p-button-primary"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, PropType, onMounted } from 'vue';
import type { overlayObject } from '../App.vue'
import { useToast } from 'primevue/usetoast';

const toast = useToast();

const props = defineProps({
    overlayObject: {
        type: Object as PropType<overlayObject>,
        required: true
    },
});

// Define emit for sending data to parent
const emit = defineEmits(['projectSubmit']);

// Track whether we're in edit mode or view mode
const isEditMode = ref(true);

// Form data reactive object
const formData = ref({
    projectName: '',
    sourceLink: '',
    startDate: null as Date | null,
    endDate: null as Date | null,
    budget: 0
});

// Initialize form with existing data if available
onMounted(() => {
    console.log("dans onMounted", props.overlayObject);
    if (props.overlayObject && props.overlayObject.info) {
        formData.value = {
            projectName: props.overlayObject.info.projectName || '',
            sourceLink: props.overlayObject.info.sourceLink || '',
            startDate: props.overlayObject.info.startDate,
            endDate: props.overlayObject.info.endDate,
            budget: props.overlayObject.info.budget || 0
        };
    }
});

function submitForm() {
    console.log('Form submitted with data:', formData.value);
    emit('projectSubmit', {
        id: props.overlayObject.id,
        ...formData.value
    });
    isEditMode.value = false;
};

function cancelEdit() {
    // Switch to view mode without saving changes
    isEditMode.value = false;
}

function enableEdit() {
    // Switch back to edit mode
    isEditMode.value = true;
}

// Format date for display
function formatDate(date: Date | null): string {
    if (!date) return 'Not set';
    return new Date(date).toLocaleDateString();
}
</script>

<style scoped>

@import "tailwindcss";

.info-popup-content {
    padding: 10px;
    width: 270px !important;
    background-color: white !important;
    color: black;
    cursor: default !important;
    /* so that the popup div sits above the toolbar, no matter its height*/
    translate: 0px calc(-100% - 30px);
    border-radius: 6px 6px 6px 6px !important;
    user-select:text !important;
}

.form-group {
    margin-bottom: 15px;
}

.view-mode .info-display {
    border-radius: 4px;
    padding: 10px;
}

.info-row {
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e9ecef;
}

.info-row:last-child {
    border-bottom: none;
    margin-bottom: 0;
}
</style>