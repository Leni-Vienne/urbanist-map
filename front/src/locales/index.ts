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

// AI : Check if browser's language is supported by our app
export function isBrowserLanguageSupported(): boolean {
  const browserLocale = navigator.language.split('-')[0] as Locale
  return !!messages[browserLocale]
}

// AI : Set HTML translation attributes based on language support
export function updateTranslationSettings(currentLocale: Locale): void {
  const browserLocale = navigator.language.split('-')[0] as Locale
  const isSupported = !!messages[browserLocale]
  
  // AI : Set the HTML lang attribute
  document.documentElement.lang = currentLocale
  
  // AI : Only prevent translation if we support the user's browser language
  // If we don't support their language, allow browser translation
  if (isSupported) {
    document.documentElement.setAttribute('translate', 'no')
    // AI : Add or update the Google Chrome no-translate meta tag
    let metaTag = document.querySelector('meta[name="google"]')
    metaTag ??= document.createElement('meta')
    if (!metaTag.hasAttribute('name')) {
      metaTag.setAttribute('name', 'google')
      document.head.appendChild(metaTag)
    }
    metaTag.setAttribute('content', 'notranslate')
  } else {
    // AI : Remove translation prevention for unsupported languages
    document.documentElement.removeAttribute('translate')
    const metaTag = document.querySelector('meta[name="google"]')
    if (metaTag) {
      metaTag.remove()
    }
  }
}