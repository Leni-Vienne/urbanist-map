import App from "./App.vue";
import { createApp } from "vue";
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

// AI : Custom PrimeVue preset for Urbanist Map
const UrbanistMapPreset = definePreset(Aura, {
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
    },
  },
});

// AI : Setup i18n with empty messages - locales are loaded asynchronously
const currentLocale = getStoredLocale();
const i18n = createI18n({
  locale: currentLocale,
  fallbackLocale: "en",
  messages: {},
  legacy: false,
  globalInjection: true,
});

// AI : Store i18n instance reference for async loading in other modules
setI18nInstance(i18n);

// AI : Set HTML lang attribute and translation settings based on language support
updateTranslationSettings(currentLocale);

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(i18n);

// @ts-ignore - AI : PrimeVue configuration type issue
app.use(PrimeVue, {
  ripple: true,
  inputVariant: "filled",
  theme: {
    preset: UrbanistMapPreset,
    options: {
      prefix: "p",
      darkModeSelector: "light",
      cssLayer: false,
    },
  },
});

app.use(ToastService);

// AI : Load initial locale messages synchronously before mounting the app
// All locale messages are statically imported, so this is now fully synchronous
const messages = loadLocaleMessages(currentLocale);
i18n.global.setLocaleMessage(currentLocale, messages);
app.mount("#app");
