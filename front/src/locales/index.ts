import type { I18n, I18nOptions } from "vue-i18n";

// AI : Statically import all locale messages to avoid dynamic import boundary
import enMessages from "./messages/en.json";
import frMessages from "./messages/fr.json";

export const availableLocales = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
] as const;

export type Locale = (typeof availableLocales)[number]["code"];

// AI : I18n instance type matching createI18n with legacy: false
type I18nInstance = I18n<
  NonNullable<I18nOptions["messages"]>,
  NonNullable<I18nOptions["datetimeFormats"]>,
  NonNullable<I18nOptions["numberFormats"]>,
  string,
  false
>;

// AI : Reference to the i18n instance, set during app initialization
let i18nInstance: I18nInstance | null = null;

// AI : Set the i18n instance reference for use in async loading
export function setI18nInstance(instance: I18nInstance): void {
  i18nInstance = instance;
}

// AI : Global translation function for use outside of Vue components
// AI : Supports interpolation values for pluralization, named parameters, etc.
export function t(key: string, values?: Record<string, unknown>): string {
  if (!i18nInstance) {
    return key;
  }
  return i18nInstance.global.t(key, values ?? {});
}

const localeMessagesMap: Record<Locale, Record<string, unknown>> = {
  en: enMessages,
  fr: frMessages,
};

// AI : Synchronously load locale messages - no dynamic imports needed
export function loadLocaleMessages(locale: Locale): Record<string, unknown> {
  return localeMessagesMap[locale] ?? localeMessagesMap.en;
}

// AI : Load and set locale messages, returns true if messages were loaded
export function loadAndSetLocale(locale: Locale): boolean {
  if (!i18nInstance) {
    console.error("i18n instance not set");
    return false;
  }

  // AI : Check if locale is already loaded
  if (i18nInstance.global.availableLocales.includes(locale)) {
    return true;
  }

  try {
    const messages = loadLocaleMessages(locale);
    i18nInstance.global.setLocaleMessage(locale, messages);
    return true;
  } catch (error) {
    console.error(`Failed to load locale ${locale}:`, error);
    return false;
  }
}

// AI : Get browser locale or fallback to English
function getBrowserLocale(): Locale {
  const browserLocale = navigator.language.split("-")[0];
  const isSupported = availableLocales.some((l) => l.code === browserLocale);
  return isSupported ? (browserLocale as Locale) : "en";
}

// AI : Store locale in localStorage
export function saveLocale(locale: Locale): void {
  localStorage.setItem("urbanist-map-locale", locale);
}

// AI : Get stored locale or browser locale
export function getStoredLocale(): Locale {
  const stored = localStorage.getItem("urbanist-map-locale");
  const isSupported = availableLocales.some((l) => l.code === stored);
  return isSupported ? (stored as Locale) : getBrowserLocale();
}

// AI : Check if browser's language is supported by our app
function isBrowserLanguageSupported(): boolean {
  const browserLocale = navigator.language.split("-")[0];
  return availableLocales.some((l) => l.code === browserLocale);
}

// AI : Set HTML translation attributes based on language support
export function updateTranslationSettings(currentLocale: Locale): void {
  const isSupported = isBrowserLanguageSupported();

  // AI : Set the HTML lang attribute
  document.documentElement.lang = currentLocale;

  // AI : Only prevent translation if we support the user's browser language
  // If we don't support their language, allow browser translation
  if (isSupported) {
    document.documentElement.setAttribute("translate", "no");
    // AI : Add or update the Google Chrome no-translate meta tag
    let metaTag = document.querySelector('meta[name="google"]');
    metaTag ??= document.createElement("meta");
    if (!metaTag.hasAttribute("name")) {
      metaTag.setAttribute("name", "google");
      document.head.appendChild(metaTag);
    }
    metaTag.setAttribute("content", "notranslate");
  } else {
    // AI : Remove translation prevention for unsupported languages
    document.documentElement.removeAttribute("translate");
    const metaTag = document.querySelector('meta[name="google"]');
    if (metaTag) {
      metaTag.remove();
    }
  }
}
