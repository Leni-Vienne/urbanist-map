<template>
  <LanguageSwitcherMenu />

  <button
    type="button"
    class="appearance-none font-[inherit] bg-transparent border-none text-left flex items-center gap-[0.35rem] px-2 py-[0.35rem] w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] hover:bg-black/5 dark:hover:bg-white/10"
    @click="toggleTheme"
  >
    <i :class="theme === 'dark' ? 'pi pi-sun' : 'pi pi-moon'"></i>
    <span>{{ theme === "dark" ? $t("theme.light") : $t("theme.dark") }}</span>
  </button>

  <button
    type="button"
    class="appearance-none font-[inherit] bg-transparent border-none text-left flex items-center gap-[0.35rem] px-2 py-[0.35rem] w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] hover:bg-black/5 dark:hover:bg-white/10"
    @click="toggleBuildings3D"
  >
    <i class="pi pi-building"></i>
    <span>{{
      show3DBuildings ? $t("map.buildings3D.disable") : $t("map.buildings3D.enable")
    }}</span>
  </button>
</template>

<script setup lang="ts">
import LanguageSwitcherMenu from "@/components/map/LanguageSwitcherMenu.vue";
import { useTheme } from "@/composables/core/useTheme";
import { useBuildings3D } from "@/composables/core/useBuildings3D";

const { theme, toggle: toggleTheme } = useTheme();
const { show3DBuildings, toggle: toggleBuildings3D } = useBuildings3D();
</script>
