<template>
  <div class="mb-3">
    <h5 class="font-bold mb-2 text-sm">Actions</h5>
    <div class="grid grid-cols-2 gap-2">
      <Button
        label="Highlight All"
        icon="pi pi-eye"
        :class="[
          'p-button-outlined p-button-sm',
        ]"
        @click="$emit('toggle-highlight')"
      />
      <Button
        label="Edit Project"
        icon="pi pi-pencil"
        class="p-button-outlined p-button-info p-button-sm"
        @click="$emit('edit-project')"
      />
    </div>
  </div>
  
  <Button
    label="Back to Projects"
    icon="pi pi-arrow-left"
    class="p-button-text p-button-sm w-full"
    @click="$emit('go-back')"
  />
</template>

<script setup lang="ts">
interface Props {
  isHighlighted: boolean;
}

defineProps<Props>();

defineEmits<{
  'toggle-highlight': [];
  'edit-project': [];
  'go-back': [];
}>();
</script>
