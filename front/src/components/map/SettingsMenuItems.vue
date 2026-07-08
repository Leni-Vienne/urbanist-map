<template>
  <LanguageSwitcherMenu />

  <MapLanguageMenu />

  <label
    class="flex items-center justify-between gap-3 px-2 py-[0.35rem] w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] whitespace-nowrap hover:bg-black/5 dark:hover:bg-white/10"
  >
    <span class="flex items-center gap-[0.35rem]">
      <i class="pi pi-moon"></i>
      <span>{{ $t("theme.label") }}</span>
    </span>
    <ToggleSwitch
      class="shrink-0"
      :modelValue="theme === 'dark'"
      @update:modelValue="toggleTheme"
    />
  </label>

  <label
    class="flex items-center justify-between gap-3 px-2 py-[0.35rem] w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] whitespace-nowrap hover:bg-black/5 dark:hover:bg-white/10"
  >
    <span class="flex items-center gap-[0.35rem]">
      <i class="pi pi-building"></i>
      <span>{{ $t("map.buildings3D.label") }}</span>
    </span>
    <ToggleSwitch
      class="shrink-0"
      :modelValue="show3DBuildings"
      @update:modelValue="toggle3DBuildings"
    />
  </label>

  <label
    class="flex items-center justify-between gap-3 px-2 py-[0.35rem] w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] whitespace-nowrap hover:bg-black/5 dark:hover:bg-white/10"
  >
    <span class="flex items-center gap-[0.35rem]">
      <CompassRose :size="18" />
      <span>{{ $t("map.rotation.label") }}</span>
    </span>
    <ToggleSwitch
      class="shrink-0"
      :modelValue="mapRotationEnabled"
      @update:modelValue="toggleMapRotation"
    />
  </label>
</template>

<script setup lang="ts">
import LanguageSwitcherMenu from "@/components/map/LanguageSwitcherMenu.vue";
import MapLanguageMenu from "@/components/map/MapLanguageMenu.vue";
import CompassRose from "@/components/map/CompassRose.vue";
import { useTheme } from "@/composables/core/useTheme";
import {
  show3DBuildings,
  toggle3DBuildings,
  mapRotationEnabled,
  toggleMapRotation,
} from "@/services/map/settings";

const { theme, toggle: toggleTheme } = useTheme();
</script>
