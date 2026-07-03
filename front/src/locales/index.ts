import type { I18n, I18nOptions } from "vue-i18n";

export const availableLocales = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
] as const;

export type Locale = (typeof availableLocales)[number]["code"];

// I18n instance type matching createI18n with legacy: false
type I18nInstance = I18n<
  NonNullable<I18nOptions["messages"]>,
  NonNullable<I18nOptions["datetimeFormats"]>,
  NonNullable<I18nOptions["numberFormats"]>,
  string,
  false
>;

let i18nInstance: I18nInstance | null = null;

export function setI18nInstance(instance: I18nInstance): void {
  i18nInstance = instance;
}

// Global translation function for use outside of Vue components
export function t(key: string, values?: Record<string, unknown>): string {
  if (!i18nInstance) {
    return key;
  }
  return i18nInstance.global.t(key, values ?? {});
}

// Lazy-load locale messages via dynamic import for chunk splitting.
export async function loadLocaleMessages(locale: Locale): Promise<Record<string, unknown>> {
  if (locale === "fr") {
    const module = await import("./messages/fr.json");
    return module.default;
  }
  const module = await import("./messages/en.json");
  return module.default;
}

export async function loadAndSetLocale(locale: Locale): Promise<boolean> {
  if (!i18nInstance) {
    console.error("i18n instance not set");
    return false;
  }

  // Check if locale is already loaded
  if (i18nInstance.global.availableLocales.includes(locale)) {
    return true;
  }

  try {
    const messages = await loadLocaleMessages(locale);
    i18nInstance.global.setLocaleMessage(locale, messages);
    return true;
  } catch (error) {
    console.error(`Failed to load locale ${locale}:`, error);
    return false;
  }
}

function isLocale(code: string | null | undefined): code is Locale {
  return availableLocales.some((l) => l.code === code);
}

function getBrowserLocale(): Locale {
  const browserLocale = navigator.language.split("-")[0];
  return isLocale(browserLocale) ? browserLocale : "en";
}

export function saveLocale(locale: Locale): void {
  localStorage.setItem("urbanist-map-locale", locale);
}

export function getStoredLocale(): Locale {
  const stored = localStorage.getItem("urbanist-map-locale");
  return isLocale(stored) ? stored : getBrowserLocale();
}

function isBrowserLanguageSupported(): boolean {
  const browserLocale = navigator.language.split("-")[0];
  return availableLocales.some((l) => l.code === browserLocale);
}

export function updateTranslationSettings(currentLocale: Locale): void {
  const isSupported = isBrowserLanguageSupported();

  document.documentElement.lang = currentLocale;

  if (isSupported) {
    document.documentElement.setAttribute("translate", "no");
    let metaTag = document.querySelector('meta[name="google"]');
    metaTag ??= document.createElement("meta");
    if (!metaTag.hasAttribute("name")) {
      metaTag.setAttribute("name", "google");
      document.head.appendChild(metaTag);
    }
    metaTag.setAttribute("content", "notranslate");
  } else {
    document.documentElement.removeAttribute("translate");
    const metaTag = document.querySelector('meta[name="google"]');
    if (metaTag) {
      metaTag.remove();
    }
  }
}
