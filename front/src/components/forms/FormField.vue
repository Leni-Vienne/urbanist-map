<template>
  <div class="flex flex-col gap-1">
    <FloatLabel class="w-full" variant="in">
      <slot :input-id="inputId" :input-class="['w-full', { 'p-invalid': error }]" />
      <label :for="inputId" class="text-(--p-text-color-secondary)">{{ label }}</label>
    </FloatLabel>
    <small v-if="error" class="text-red-600 text-xs block">{{ error }}</small>
    <ChangeIndicator :show="changed" :original-value="originalValue" />
  </div>
</template>

<script setup lang="ts">
import { useId } from "vue";

import ChangeIndicator from "./ChangeIndicator.vue";

// A labelled input: the float label sits over the slotted control, the validation error and the
// change indicator stack below it. The slot receives the id the label points at, plus the classes
// the control needs to fill the row and to show the invalid state.
defineProps<{
  label: string;
  error?: string | null;
  changed?: boolean;
  originalValue?: string | number | null;
}>();

const inputId = useId();
</script>
