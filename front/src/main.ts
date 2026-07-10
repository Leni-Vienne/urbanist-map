import App from "./App.vue";
import { createApp } from "vue";
import { hasUnsavedChanges } from "./utils/unsavedState";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import { definePreset } from "@primeuix/themes";
import ToastService from "primevue/toastservice";
import { createPinia } from "pinia";
import { router } from "./router";
import { createI18n } from "vue-i18n";
import {
  getStoredLocale,
  updateTranslationSettings,
  loadLocaleMessages,
  setI18nInstance,
} from "./locales";
import { setupKeyboardShortcuts } from "./services/overlay/history";
import { initializeDetailWatcher } from "./services/map/projectDetailWatcher";

// importing Aura Theme has a 5 kB gzipped impact over manual imports, worth the DX improvement
const UrbanistmapPreset = definePreset(Aura, {
  components: {
    accordion: {
      header: {
        // Aura defaults to {text.muted.color} which is low-contrast; use full text color
        color: "{text.color}",
        toggleIcon: {
          color: "{text.color}",
        },
      },
    },
  },
  semantic: {
    primary: {
      50: "{indigo.50}",
      100: "{indigo.100}",
      200: "{indigo.200}",
      300: "{indigo.300}",
      400: "{indigo.400}",
      500: "{indigo.500}",
      600: "{indigo.600}",
      700: "{indigo.700}",
      800: "{indigo.800}",
      900: "{indigo.900}",
      950: "{indigo.950}",
    },
    colorScheme: {
      light: {
        primary: {
          color: "{indigo.600}",
          inverseColor: "#ffffff",
          hoverColor: "{indigo.700}",
          activeColor: "{indigo.800}",
        },
        highlight: {
          background: "{indigo.600}",
          focusBackground: "{indigo.700}",
          color: "#ffffff",
          focusColor: "#ffffff",
        },
      },
      dark: {
        primary: {
          color: "{indigo.400}",
          inverseColor: "{surface.900}",
          hoverColor: "{indigo.300}",
          activeColor: "{indigo.200}",
        },
        highlight: {
          background: "{indigo.500}",
          focusBackground: "{indigo.400}",
          color: "#ffffff",
          focusColor: "#ffffff",
        },
      },
    },
  },
});

// Setup i18n with empty messages - locales are loaded asynchronously
const currentLocale = getStoredLocale();
const i18n = createI18n({
  locale: currentLocale,
  fallbackLocale: "en",
  messages: {},
  legacy: false,
  globalInjection: true,
});

// Store i18n instance reference for async loading in other modules
setI18nInstance(i18n);

// Set HTML lang attribute and translation settings based on language support
updateTranslationSettings(currentLocale);

const app = createApp(App);

app.use(createPinia());

// Detail watcher drives detail-state-driven side effects across the map. Initialize once
// after Pinia is installed so click handlers only need to toggle detail state.
initializeDetailWatcher();

// Keyboard shortcuts (undo/redo) are document-level and only act when an overlay is selected,
// so register them once at boot rather than re-installing on every mode switch.
setupKeyboardShortcuts();

window.addEventListener("beforeunload", (event) => {
  if (hasUnsavedChanges()) event.preventDefault();
});

// Record when the page was last hidden, so we can detect long absences on bfcache restore
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    sessionStorage.setItem("lastHidden", String(Date.now()));
  }
});

// On bfcache restore, reload if the page was hidden for more than 6 hours.
// Normal back navigation happens in seconds; "came back next day" is hours.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  const lastHidden = Number(sessionStorage.getItem("lastHidden"));
  const sixHours = 6 * 60 * 60 * 1000;
  if (lastHidden > 0 && Date.now() - lastHidden > sixHours) globalThis.location.reload();
});

app.use(router);
app.use(i18n);

// @ts-expect-error PrimeVue configuration type issue
app.use(PrimeVue, {
  ripple: true,
  inputVariant: "filled",
  theme: {
    preset: UrbanistmapPreset,
    options: {
      prefix: "p",
      darkModeSelector: ".dark-mode",
      cssLayer: false,
    },
  },
});

app.use(ToastService);

// Load English (the fallback locale) plus the active locale before mounting.
// IIFE to reduce splitting from 15 chunks down to 6 versus top level await
/* oxlint-disable no-floating-promises */
(async function initApp() {
  i18n.global.setLocaleMessage("en", await loadLocaleMessages("en"));
  if (currentLocale !== "en") {
    i18n.global.setLocaleMessage(currentLocale, await loadLocaleMessages(currentLocale));
  }
  app.mount("#app");
})();
