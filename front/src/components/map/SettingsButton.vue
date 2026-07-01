<template>
  <Button
    @click.stop="toggleSettings"
    @dblclick.stop
    raised
    icon="pi pi-cog"
    :aria-label="$t('controls.settings')"
    v-tooltip.bottom="{
      value: $t('controls.settings'),
      disabled: isMobile,
    }"
    :severity="isOpen ? undefined : 'secondary'"
  />

  <Popover ref="settingsPopover" class="settings-popover">
    <div class="flex flex-col w-max min-w-48" @click.stop @dblclick.stop>
      <SettingsMenuItems />
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import SettingsMenuItems from "@/components/map/SettingsMenuItems.vue";
import { useIsMobile } from "@/composables/ui/useIsMobile";

const { isMobile } = useIsMobile();
const settingsPopover = ref();
const isOpen = ref(false);

function toggleSettings(event: Event) {
  settingsPopover.value.toggle(event);
}

watch(
  () => settingsPopover.value?.visible,
  (visible) => {
    isOpen.value = visible ?? false;
  },
);
</script>
