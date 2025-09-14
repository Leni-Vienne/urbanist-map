import { useI18n as useVueI18n } from 'vue-i18n'

// AI : Composable for i18n with type safety
export function useI18n() {
  const i18n = useVueI18n()
  
  return {
    ...i18n,
    locale: i18n.locale,
    t: i18n.t,
    tm: i18n.tm,
    rt: i18n.rt,
    te: i18n.te
  }
}

// AI : Type-safe translation function for use in script setup
export const { t } = useVueI18n()