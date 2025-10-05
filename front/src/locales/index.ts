// AI : Lazy-load locale messages to reduce initial bundle size
export const messages = {
  en: () => import('./en.json'),
  fr: () => import('./fr.json')
}

export const availableLocales = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' }
] as const

export type Locale = keyof typeof messages
export type AvailableLocale = typeof availableLocales[number]

// AI : Get browser locale or fallback to English
export function getBrowserLocale(): Locale {
  const browserLocale = navigator.language.split('-')[0] as Locale
  return messages[browserLocale] ? browserLocale : 'en'
}

// AI : Store locale in localStorage
export function saveLocale(locale: Locale): void {
  localStorage.setItem('construction-map-locale', locale)
}

// AI : Get stored locale or browser locale
export function getStoredLocale(): Locale {
  const stored = localStorage.getItem('construction-map-locale') as Locale
  return stored && messages[stored] ? stored : getBrowserLocale()
}

// AI : Load a specific locale dynamically
export async function loadLocale(locale: Locale) {
  const loader = messages[locale];
  if (!loader) return null;
  const module = await loader();
  return module.default;
}