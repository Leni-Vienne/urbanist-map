<template>
    <<div
        v-if="overlayObject"
        class="info-popup-content"
    >
        <h3>Project Information</h3>
        <form @submit.prevent="submitForm">
            <div class="form-group">
                <label for="project_name">Project name:</label>
                <InputText
                    id="project_name"
                    v-model="formData.projectName"
                    class="popup-input"
                    required
                />
            </div>
            <div class="form-group">
                <label for="project_address">Address:</label>
                <InputText
                    id="project_address"
                    v-model="formData.address"
                    class="popup-input"
                    required
                />
            </div>
            <div class="form-group">
                <label for="construction_start">Construction start date:</label>
                <DatePicker
                    id="construction_start"
                    v-model="formData.startDate"
                    dateFormat="mm/dd/yy"
                    class="popup-input"
                    required
                />
            </div>
            <div class="form-group">
                <label for="construction_end">Construction end date:</label>
                <DatePicker
                    id="construction_end"
                    v-model="formData.endDate"
                    dateFormat="mm/dd/yy"
                    class="popup-input"
                    required
                />
            </div>

            <div class="form-actions">
                <Button
                    type="submit"
                    label="Submit"
                    class="p-button-success"
                />
            </div>
        </form>
    </div>>
</template>

<script setup lang="ts">
import { ref, PropType } from 'vue';
import type { overlayObject } from '../App.vue'

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

// Submit form function
const submitForm = () => {
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