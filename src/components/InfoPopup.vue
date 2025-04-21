<template>
    <div
        v-if="overlayObject"
        class="info-popup-content"
    >
        <h3>Project Information</h3>
        <div class="flex flex-col gap-2">
            <label for="projectName">Username</label>
            <InputText
                id="projectName"
                v-model="formData.projectName"
                aria-describedby="projectName-help"
            />
            <Message
                size="small"
                severity="secondary"
                variant="simple"
            >Enter your username to reset your password.</Message>
        </div>
        <div class="form-group">
            <label for="project_address">Address:</label>
            <InputText
                id="project_address"
                v-model="formData.address"
                class="popup-input"
            />
        </div>
        <div class="form-group">
            <label for="construction_start">Construction start date:</label>
            <DatePicker
                id="construction_start"
                v-model="formData.startDate"
                dateFormat="mm/dd/yy"
                class="popup-input"
            />
        </div>
        <div class="form-group">
            <label for="construction_end">Construction end date:</label>
            <DatePicker
                id="construction_end"
                v-model="formData.endDate"
                dateFormat="mm/dd/yy"
                class="popup-input"
            />
        </div>
        <Button
            @click="submitForm"
            label="Save"
            type="submit"
            class="p-button-success"
        />
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

// Form data reactive object
const formData = ref({
    projectName: '',
    address: '',
    startDate: null as Date | null,
    endDate: null as Date | null,
    budget: 0
});

// Initialize form with existing data if available
onMounted(() => {
    if (props.overlayObject && props.overlayObject.info) {
        formData.value = {
            projectName: props.overlayObject.info.projectName || '',
            address: props.overlayObject.info.address || '',
            startDate: props.overlayObject.info.startDate,
            endDate: props.overlayObject.info.endDate,
            budget: props.overlayObject.info.budget || 0
        };
    }
});

// Submit form function
function submitForm() {
    console.log('Form submitted with data:', formData.value);
    emit('projectSubmit', {
        id: props.overlayObject.id,
        ...formData.value
    });
};
</script>

<style scoped>
.info-popup-content {
    padding: 10px;
    min-width: 300px;

    display: block !important;
    width: 300px !important;
    height: auto !important;
    line-height: 30px !important;



    background-color: white;
    border: transparent !important;

    color: black;


    z-index: 900 !important;
    user-select: text !important;
    cursor: default !important;
    translate: 0px calc(-100% - 30px);
    /* Adjusted to keep the bottom fixed */
    border-radius: 4px 4px 4px 4px !important;
}

.form-group {
    margin-bottom: 15px;
}

.popup-input {
    width: 100%;
    padding: 5px;
}

.form-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
}
</style>