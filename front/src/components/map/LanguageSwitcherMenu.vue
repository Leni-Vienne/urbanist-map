<template>
  <div :class="{ 'w-full': displayMode === 'list-item' }">
    <!-- Language Menu Toggle Button -->
    <button
      v-if="displayMode === 'icon'"
      type="button"
      class="appearance-none font-[inherit] p-0 flex items-center justify-center w-8 h-8 rounded-full bg-content-background border border-surface cursor-pointer transition-all duration-200 text-(--p-text-color-secondary) hover:bg-content-hover-background hover:border-surface hover:text-primary-600 hover:shadow-sm"
      @click="toggleMenu"
      ref="languageMenuRef"
      :aria-label="$t('controls.language')"
      @dblclick.stop
    >
      <i class="pi pi-language text-base"></i>
    </button>
    <button
      v-else
      type="button"
      class="appearance-none font-[inherit] bg-transparent border-0 text-left flex items-center py-[0.35rem] px-2 w-full cursor-pointer rounded text-color transition-colors duration-200 text-[0.9rem] hover:bg-content-hover-background"
      @click="toggleMenu"
      ref="languageMenuRef"
      :aria-label="$t('controls.language')"
      @dblclick.stop
    >
      <i class="pi pi-language text-base"></i>
      <span class="ml-2">{{ $t("controls.language") }}</span>
      <span class="ml-auto text-sm text-muted-color">{{ currentLocale.toUpperCase() }}</span>
    </button>

    <!-- Language selection popover -->
    <Popover ref="languagePopover">
      <div class="flex flex-col w-40">
        <button
          v-for="locale in availableLocales"
          :key="locale.code"
          type="button"
          class="appearance-none font-[inherit] border-0 text-left flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded w-full transition-colors duration-150 disabled:opacity-70 disabled:cursor-wait"
          :class="
            currentLocale === locale.code
              ? 'bg-primary-50 text-primary-700'
              : 'bg-transparent hover:bg-content-hover-background'
          "
          :disabled="isLoading"
          @click="changeLocale(locale.code)"
        >
          <span class="text-lg">{{ locale.flag }}</span>
          <span class="text-sm font-medium">{{ locale.name }}</span>
          <i
            v-if="isLoading && loadingLocale === locale.code"
            class="pi pi-spin pi-spinner ml-auto"
          ></i>
        </button>
      </div>
    </Popover>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  availableLocales,
  saveLocale,
  updateTranslationSettings,
  loadAndSetLocale,
  type Locale,
} from "../../locales";

const { locale } = useI18n();
const currentLocale = ref<Locale>("en");
const languagePopover = ref();
const isLoading = ref(false);
const loadingLocale = ref<Locale | null>(null);

defineProps<{
  displayMode?: "icon" | "list-item";
}>();

onMounted(() => {
  currentLocale.value = locale.value as Locale;
  window.addEventListener("resize", handleResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
});

// Close menu on window resize
function handleResize() {
  if (languagePopover.value?.visible) {
    languagePopover.value.hide();
  }
}

// Toggle language menu visibility using Popover
function toggleMenu(event: Event) {
  languagePopover.value.toggle(event);
}

// Change language with async loading and persist preference
async function changeLocale(newLocale: Locale): Promise<void> {
  if (isLoading.value || newLocale === currentLocale.value) return;

  isLoading.value = true;
  loadingLocale.value = newLocale;

  try {
    // Load locale messages if not already loaded
    const loaded = await loadAndSetLocale(newLocale);
    if (!loaded) {
      console.error(`Failed to load locale: ${newLocale}`);
      return;
    }

    locale.value = newLocale;
    currentLocale.value = newLocale;
    saveLocale(newLocale);
    languagePopover.value.hide();

    // Update HTML lang attribute and translation settings intelligently
    updateTranslationSettings(newLocale);
  } finally {
    isLoading.value = false;
    loadingLocale.value = null;
  }
}
</script>
