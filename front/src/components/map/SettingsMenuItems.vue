<template>
  <LanguageSwitcherMenu />

  <MapLanguageMenu />

  <SettingsMenuRow icon="pi pi-moon" :label="$t('theme.label')">
    <ToggleSwitch
      class="shrink-0"
      :modelValue="theme === 'dark'"
      @update:modelValue="toggleTheme"
    />
  </SettingsMenuRow>

  <SettingsMenuRow icon="pi pi-building" :label="$t('map.buildings3D.label')">
    <ToggleSwitch
      class="shrink-0"
      :modelValue="show3DBuildings"
      @update:modelValue="toggle3DBuildings"
    />
  </SettingsMenuRow>

  <SettingsMenuRow :label="$t('map.rotation.label')">
    <template #icon>
      <CompassRose :size="18" />
    </template>
    <ToggleSwitch
      class="shrink-0"
      :modelValue="mapRotationEnabled"
      @update:modelValue="toggleMapRotation"
    />
  </SettingsMenuRow>
</template>

<script setup lang="ts">
import LanguageSwitcherMenu from "@/components/map/LanguageSwitcherMenu.vue";
import MapLanguageMenu from "@/components/map/MapLanguageMenu.vue";
import SettingsMenuRow from "@/components/map/SettingsMenuRow.vue";
import CompassRose from "@/components/map/CompassRose.vue";
import { useTheme } from "@/composables/core/useTheme";
import {
  show3DBuildings,
  toggle3DBuildings,
  mapRotationEnabled,
  toggleMapRotation,
} from "@/services/core/settings";

const { theme, toggle: toggleTheme } = useTheme();
</script>
