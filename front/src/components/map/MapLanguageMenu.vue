<template>
  <div class="w-full">
    <button
      type="button"
      class="appearance-none bg-transparent border-0 text-left flex items-center py-[0.35rem] px-2 w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] hover:bg-black/5 dark:hover:bg-white/10"
      @click="toggleMenu"
      :aria-label="$t('controls.mapLanguage')"
      @dblclick.stop
    >
      <i class="pi pi-map text-base"></i>
      <span class="ml-2">{{ $t("controls.mapLanguage") }}</span>
      <span class="ml-auto text-sm text-muted-color">{{ currentLabel }}</span>
    </button>

    <Popover ref="mapLanguagePopover">
      <div class="flex flex-col w-44 max-h-80 overflow-y-auto">
        <button
          v-for="option in options"
          :key="option.code"
          type="button"
          class="appearance-none border-0 text-left flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded w-full transition-colors duration-150"
          :class="
            mapLabelLanguageRef === option.code
              ? 'bg-primary-50 text-primary-700'
              : 'bg-transparent hover:bg-black/5 dark:hover:bg-white/10'
          "
          @click="selectLanguage(option.code)"
        >
          <span class="text-sm font-medium">{{ option.name }}</span>
          <i v-if="mapLabelLanguageRef === option.code" class="pi pi-check ml-auto text-xs"></i>
        </button>
      </div>
    </Popover>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  getBrowserLanguageCode,
  getBrowserLanguageName,
  mapLabelLanguageRef,
  setMapLabelLanguage,
  type MapLabelLanguage,
} from "@/services/map/mapLabelLanguage";

const { t } = useI18n();
const mapLanguagePopover = ref<{
  toggle: (event: Event) => void;
  hide: () => void;
} | null>(null);

const options = computed<{ code: MapLabelLanguage; name: string }[]>(() => [
  { code: "default", name: t("controls.mapLanguageDefault") },
  { code: "local", name: t("controls.mapLanguageLocal") },
  { code: "auto", name: getBrowserLanguageName() },
]);

const currentLabel = computed(() => {
  if (mapLabelLanguageRef.value === "auto") return getBrowserLanguageCode().toUpperCase();
  return mapLabelLanguageRef.value === "default" ? "DEF" : "LOCAL";
});

function toggleMenu(event: Event): void {
  mapLanguagePopover.value?.toggle(event);
}

function selectLanguage(code: MapLabelLanguage): void {
  setMapLabelLanguage(code);
  mapLanguagePopover.value?.hide();
}
</script>
