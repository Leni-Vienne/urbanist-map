<template>
  <component
    :is="as"
    :type="as === 'button' ? 'button' : undefined"
    class="appearance-none bg-transparent border-0 text-left flex items-center justify-between gap-3 px-2 py-[0.35rem] w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] whitespace-nowrap hover:bg-black/5 dark:hover:bg-white/10"
    @click="emit('click', $event)"
    @dblclick.stop
  >
    <span class="flex items-center gap-[0.35rem]">
      <slot name="icon">
        <i :class="icon"></i>
      </slot>
      <span>{{ label }}</span>
    </span>
    <slot />
  </component>
</template>

<script setup lang="ts">
// A row of the settings menu: leading icon, label, and a trailing control (toggle, current value).
// `as` is "label" for rows wrapping their own input, "button" for rows that act on click.
// The menu floats over the map, which zooms on double click; the row swallows it.
const {
  as = "label",
  icon = "",
  label,
} = defineProps<{
  as?: "label" | "button";
  icon?: string;
  label: string;
}>();

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>
