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
                        v-model="localProject.name"
                        required
                        class="w-full"
                    />
                    <label class="text-gray-600">Project Name</label>
                </FloatLabel>
            </div>

            <div class="field">
                <FloatLabel
                    class="w-full"
                    variant="in"
                >
                    <Textarea
                        v-model="localProject.description"
                        rows="2"
                        class="w-full"
                    />
                    <label class="text-gray-600">Description</label>
                </FloatLabel>
            </div>

            <div class="field">
                <FloatLabel
                    class="w-full"
                    variant="in"
                >
                    <InputText
                        v-model="localProject.location"
                        class="w-full"
                    />
                    <label class="text-gray-600">Location</label>
                </FloatLabel>
            </div>

            <div class="field">
                <FloatLabel
                    class="w-full"
                    variant="in"
                >
                    <InputText
                        v-model="localProject.sourceUrl"
                        class="w-full"
                    />
                    <label class="text-gray-600">Source URL</label>
                </FloatLabel>
            </div>

            <div class="flex gap-3">
                <div class="flex-1 field">
                    <FloatLabel
                        class="w-full"
                        variant="in"
                    >
                        <DatePicker
                            v-model="localProject.startDate"
                            class="w-full"
                        />
                        <label class="text-gray-600">Start Date</label>
                    </FloatLabel>
                </div>
                <div class="flex-1 field">
                    <FloatLabel
                        class="w-full"
                        variant="in"
                    >
                        <DatePicker
                            v-model="localProject.endDate"
                            class="w-full"
                        />
                        <label class="text-gray-600">End Date</label>
                    </FloatLabel>
                </div>
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
import { ref, watch } from 'vue';
import type { Project } from '@types';

const props = defineProps<{
    project: Partial<Project>;
    mode: 'edit' | 'create';
}>();

const emit = defineEmits<{
    cancel: [];
    submit: [project: Partial<Project>];
}>();

const localProject = ref<Partial<Project>>({ ...props.project });

// AI : Watch for external project changes
watch(() => props.project, (newProject) => {
    localProject.value = { ...newProject };
}, { deep: true });

function handleSubmit() {
    emit('submit', localProject.value);
}
</script>

<style scoped>
@import "tailwindcss";

.project-editor {
    max-width: 800px;
    margin: 0 auto;
}
</style>
