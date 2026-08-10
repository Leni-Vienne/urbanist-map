<template>
  <div class="w-full">
    <button
      type="button"
      class="appearance-none bg-transparent border-0 text-left flex items-center py-[0.35rem] px-2 w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] hover:bg-black/5 dark:hover:bg-white/10"
      @click="toggleMenu"
      :aria-label="$t('controls.language')"
      @dblclick.stop
    >
      <i class="pi pi-language text-base"></i>
      <span class="ml-2">{{ $t("controls.language") }}</span>
      <span class="ml-auto text-sm text-muted-color">{{ locale.toUpperCase() }}</span>
    </button>

    <Popover ref="languagePopover">
      <div class="flex flex-col w-40">
        <button
          v-for="availableLocale in availableLocales"
          :key="availableLocale.code"
          type="button"
          class="appearance-none border-0 text-left flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded w-full transition-colors duration-150 disabled:opacity-70 disabled:cursor-wait"
          :class="
            locale === availableLocale.code
              ? 'bg-primary-50 text-primary-700'
              : 'bg-transparent hover:bg-black/5 dark:hover:bg-white/10'
          "
          :disabled="isLoading"
          @click="changeLocale(availableLocale.code)"
        >
          <span class="text-lg">{{ availableLocale.flag }}</span>
          <span class="text-sm font-medium">{{ availableLocale.name }}</span>
          <i
            v-if="isLoading && loadingLocale === availableLocale.code"
            class="pi pi-spin pi-spinner ml-auto"
          ></i>
        </button>
      </div>
    </Popover>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  availableLocales,
  saveLocale,
  updateTranslationSettings,
  loadAndSetLocale,
  type Locale,
} from "../../locales";

const { locale } = useI18n();
const languagePopover = ref<{
  toggle(event: Event): void;
  hide(): void;
} | null>(null);
const isLoading = ref(false);
const loadingLocale = ref<Locale | null>(null);

function toggleMenu(event: Event) {
  languagePopover.value?.toggle(event);
}

async function changeLocale(newLocale: Locale): Promise<void> {
  if (isLoading.value || newLocale === locale.value) return;

  isLoading.value = true;
  loadingLocale.value = newLocale;

  try {
    const loaded = await loadAndSetLocale(newLocale);
    if (!loaded) {
      console.error(`Failed to load locale: ${newLocale}`);
      return;
    }

    locale.value = newLocale;
    saveLocale(newLocale);
    languagePopover.value?.hide();

    updateTranslationSettings(newLocale);
  } finally {
    isLoading.value = false;
    loadingLocale.value = null;
  }
}
</script>
