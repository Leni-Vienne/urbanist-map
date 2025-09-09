<template>
  <Dropdown 
    v-model="currentLocale" 
    :options="[...availableLocales]" 
    optionLabel="name" 
    optionValue="code"
    @change="changeLocale"
    class="w-40"
  >
    <template #value="slotProps">
      <div v-if="slotProps.value" class="flex items-center gap-2">
        <span>{{ getLocaleFlag(slotProps.value) }}</span>
        <span>{{ getLocaleName(slotProps.value) }}</span>
      </div>
    </template>
    <template #option="slotProps">
      <div class="flex items-center gap-2">
        <span>{{ slotProps.option.flag }}</span>
        <span>{{ slotProps.option.name }}</span>
      </div>
    </template>
  </Dropdown>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Dropdown from 'primevue/dropdown'
import { availableLocales, saveLocale, type Locale } from '../locales'

const { locale } = useI18n()
const currentLocale = ref<Locale>('en')

onMounted(() => {
  currentLocale.value = locale.value as Locale
})

// AI : Change language and persist preference
function changeLocale(event: any): void {
  const newLocale = event.value as Locale
  locale.value = newLocale
  currentLocale.value = newLocale
  saveLocale(newLocale)
}

// AI : Get flag for current locale
function getLocaleFlag(localeCode: string): string {
  return availableLocales.find(l => l.code === localeCode)?.flag ?? '🌐'
}

// AI : Get name for current locale
function getLocaleName(localeCode: string): string {
  return availableLocales.find(l => l.code === localeCode)?.name ?? 'Unknown'
}
</script>