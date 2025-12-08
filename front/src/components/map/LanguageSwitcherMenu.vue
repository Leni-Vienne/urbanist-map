<template>
  <div class="language-menu-container">
    <!-- AI : Language Menu Toggle Button -->
    <button
      type="button"
      class="language-menu-trigger"
      @click="toggleMenu"
      ref="languageMenuRef"
      :aria-label="$t('controls.language')"
      @dblclick.stop
    >
      <i class="pi pi-language"></i>
    </button>

    <!-- AI : Language selection popover -->
    <Popover ref="languagePopover">
      <div class="flex flex-col w-40">
        <button
          v-for="locale in availableLocales"
          :key="locale.code"
          type="button"
          class="locale-btn flex items-center gap-2 px-3 py-2 hover:bg-surface-100 cursor-pointer border-round w-full"
          :class="{ 'bg-primary-50 text-primary-700': currentLocale === locale.code }"
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
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { availableLocales, saveLocale, updateTranslationSettings, loadAndSetLocale, type Locale } from '../../locales'

const { locale } = useI18n()
const currentLocale = ref<Locale>('en')
const languagePopover = ref()
const isLoading = ref(false)
const loadingLocale = ref<Locale | null>(null)

onMounted(() => {
  currentLocale.value = locale.value as Locale
})

// AI : Toggle language menu visibility using Popover
function toggleMenu(event: Event) {
  languagePopover.value.toggle(event)
}

// AI : Change language with async loading and persist preference
async function changeLocale(newLocale: Locale): Promise<void> {
  if (isLoading.value || newLocale === currentLocale.value) return

  isLoading.value = true
  loadingLocale.value = newLocale

  try {
    // AI : Load locale messages if not already loaded
    const loaded = await loadAndSetLocale(newLocale)
    if (!loaded) {
      console.error(`Failed to load locale: ${newLocale}`)
      return
    }

    locale.value = newLocale
    currentLocale.value = newLocale
    saveLocale(newLocale)
    languagePopover.value.hide()

    // AI : Update HTML lang attribute and translation settings intelligently
    updateTranslationSettings(newLocale)
  } finally {
    isLoading.value = false
    loadingLocale.value = null
  }
}
</script>

<style scoped>
.language-menu-trigger {
  /* AI : Reset button defaults */
  appearance: none;
  font-family: inherit;
  padding: 0;
  /* AI : Layout and styling */
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-300);
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--p-surface-600);
}

/* AI : Reset button defaults for locale buttons */
.locale-btn {
  appearance: none;
  font-family: inherit;
  background: transparent;
  border: none;
  text-align: left;
}

.locale-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.language-menu-trigger:hover {
  background: var(--p-surface-50);
  border-color: var(--p-surface-400);
  color: var(--p-primary-600);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.pi-language {
  font-size: 16px;
}

</style>
