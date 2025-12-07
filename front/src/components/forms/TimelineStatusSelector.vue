<template>
  <!-- AI : Reusable timeline status selector for project forms -->
  <fieldset class="field">
    <legend class="text-gray-600 font-medium mb-2 block">{{ $t('project.timelineStatus') }} *</legend>
    <div class="flex gap-4">
      <!-- AI : Proposed status option -->
      <div
        class="flex items-center gap-2 flex-1 p-3 border rounded cursor-pointer hover:bg-gray-50"
        :class="{ 'bg-blue-50 border-blue-500': modelValue, 'border-gray-300': !modelValue }"
        @click="handleSelect(true)"
      >
        <!-- AI : RadioButton is display-only, click handled by parent div -->
        <RadioButton
          :inputId="`${idPrefix}-status-proposed`"
          :name="`${idPrefix}-timelineStatus`"
          :value="true"
          :modelValue="modelValue"
          @click.stop.prevent
        />
        <div class="flex-1">
          <label
            :for="`${idPrefix}-status-proposed`"
            class="font-medium cursor-pointer"
            @click.prevent
          >{{ $t('project.proposed') }}</label>
          <div class="text-xs text-gray-500">{{ $t('project.proposedDescription') }}</div>
        </div>
      </div>
      
      <!-- AI : Planned status option -->
      <div
        class="flex items-center gap-2 flex-1 p-3 border rounded cursor-pointer hover:bg-gray-50"
        :class="{ 'bg-blue-50 border-blue-500': !modelValue, 'border-gray-300': modelValue }"
        @click="handleSelect(false)"
      >
        <!-- AI : RadioButton is display-only, click handled by parent div -->
        <RadioButton
          :inputId="`${idPrefix}-status-planned`"
          :name="`${idPrefix}-timelineStatus`"
          :value="false"
          :modelValue="modelValue"
          @click.stop.prevent
        />
        <div class="flex-1">
          <label
            :for="`${idPrefix}-status-planned`"
            class="font-medium cursor-pointer"
            @click.prevent
          >{{ $t('project.plannedStatus') }}</label>
          <div class="text-xs text-gray-500">{{ $t('project.plannedDescription') }}</div>
        </div>
      </div>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
interface Props {
  // AI : v-model value - true for proposed, false for planned
  modelValue: boolean
  // AI : Unique prefix for input IDs to avoid conflicts when multiple instances exist
  idPrefix?: string
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'change', value: boolean): void
}

const props = withDefaults(defineProps<Props>(), {
  idPrefix: 'timeline'
})

const emit = defineEmits<Emits>()

function handleSelect(isProposed: boolean) {
  emit('update:modelValue', isProposed)
  emit('change', isProposed)
}
</script>
