<template>
  <div class="language-menu-container">
    <!-- AI : Language Menu Toggle Button -->
    <div
      class="language-menu-trigger"
      @click="toggleMenu"
      ref="languageMenuRef"
      role="button"
      aria-label="Language Selector"
      tabindex="0"
      @dblclick.stop
      @keydown.enter="toggleMenu"
      @keydown.space="toggleMenu"
    >
      <i class="pi pi-language"></i>
    </div>

    <!-- AI : Language selection popover -->
    <Popover ref="languagePopover">
      <div class="flex flex-col w-40">
        <div 
          v-for="locale in availableLocales" 
          :key="locale.code"
          class="flex items-center gap-2 px-3 py-2 hover:bg-surface-100 cursor-pointer border-round"
          :class="{ 'bg-primary-50 text-primary-700': currentLocale === locale.code }"
          @click="changeLocale(locale.code)"
          role="button"
          tabindex="0"
          @keydown.enter="changeLocale(locale.code)"
          @keydown.space="changeLocale(locale.code)"
        >
          <span class="text-lg">{{ locale.flag }}</span>
          <span class="text-sm font-medium">{{ locale.name }}</span>
        </div>
      </div>
    </Popover>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { availableLocales, saveLocale, updateTranslationSettings, type Locale } from '../../locales'

const { locale } = useI18n()
const currentLocale = ref<Locale>('en')
const languagePopover = ref()

onMounted(() => {
  currentLocale.value = locale.value as Locale
})

// AI : Toggle language menu visibility using Popover
function toggleMenu(event: Event) {
  languagePopover.value.toggle(event)
}

// AI : Change language and persist preference
function changeLocale(newLocale: Locale): void {
  locale.value = newLocale
  currentLocale.value = newLocale
  saveLocale(newLocale)
  languagePopover.value.hide()
  
  // AI : Update HTML lang attribute and translation settings intelligently
  updateTranslationSettings(newLocale)
}
</script>

<style scoped>
.language-menu-trigger {
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