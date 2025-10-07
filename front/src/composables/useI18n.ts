import { useI18n as useVueI18n } from 'vue-i18n'

// AI : Composable for i18n with type safety
export function useI18n() {
  const { t, locale } = useVueI18n()

  return {
    t,
    locale
  }
}