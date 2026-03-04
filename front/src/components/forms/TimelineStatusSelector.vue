<template>
  <!-- Reusable timeline status selector for project forms -->
  <fieldset class="field">
    <legend class="text-(--p-text-color-secondary) font-medium mb-2 block">
      {{ $t("project.timelineStatus") }} *
    </legend>
    <div class="flex gap-4">
      <!-- Planned status option -->
      <div
        class="flex items-center gap-2 flex-1 p-3 border rounded cursor-pointer hover:bg-content-hover-background transition-colors"
        :class="{
          'border-primary-500': !modelValue,
          'border-surface': modelValue,
        }"
        @click="handleSelect(false)"
      >
        <!-- RadioButton click triggers parent div handler -->
        <RadioButton
          :inputId="`${idPrefix}-status-planned`"
          :name="`${idPrefix}-timelineStatus`"
          :value="false"
          :modelValue="modelValue"
        />
        <div class="flex-1">
          <label :for="`${idPrefix}-status-planned`" class="font-medium cursor-pointer">{{
            $t("status.planned")
          }}</label>
          <div class="text-xs text-muted-color">
            {{ $t("project.plannedDescription") }}
          </div>
        </div>
      </div>

      <!-- Proposed status option -->
      <div
        class="flex items-center gap-2 flex-1 p-3 border rounded cursor-pointer hover:bg-content-hover-background transition-colors"
        :class="{
          'border-primary-500': modelValue,
          'border-surface': !modelValue,
        }"
        @click="handleSelect(true)"
      >
        <!-- RadioButton click triggers parent div handler -->
        <RadioButton
          :inputId="`${idPrefix}-status-proposed`"
          :name="`${idPrefix}-timelineStatus`"
          :value="true"
          :modelValue="modelValue"
        />
        <div class="flex-1">
          <label :for="`${idPrefix}-status-proposed`" class="font-medium cursor-pointer">{{
            $t("project.proposed")
          }}</label>
          <div class="text-xs text-muted-color">
            {{ $t("project.proposedDescription") }}
          </div>
        </div>
      </div>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
interface Props {
  // v-model value - true for proposed, false for planned
  modelValue: boolean;
  // Unique prefix for input IDs to avoid conflicts when multiple instances exist
  idPrefix?: string;
}

interface Emits {
  (e: "update:modelValue", value: boolean): void;
  (e: "change", value: boolean): void;
}

const props = withDefaults(defineProps<Props>(), {
  idPrefix: "timeline",
});

const emit = defineEmits<Emits>();

function handleSelect(isProposed: boolean) {
  emit("update:modelValue", isProposed);
  emit("change", isProposed);
}
</script>
