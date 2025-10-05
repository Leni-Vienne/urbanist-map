import en from './en.json'
import fr from './fr.json'

export const messages = {
  en,
  fr
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