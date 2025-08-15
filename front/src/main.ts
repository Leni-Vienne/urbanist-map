import App from './App.vue'
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';
import ToastService from 'primevue/toastservice';
import { createPinia } from 'pinia';


// AI : Custom PrimeVue preset for Construction Map
const ConstructionMapPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{blue.50}',
      100: '{blue.100}',
      200: '{blue.200}',
      300: '{blue.300}',
      400: '{blue.400}',
      500: '{blue.500}',
      600: '{blue.600}',
      700: '{blue.700}',
      800: '{blue.800}',
      900: '{blue.900}',
      950: '{blue.950}'
    },
    colorScheme: {
      light: {
        primary: {
          color: '{blue.600}',
          inverseColor: '#ffffff',
          hoverColor: '{blue.700}',
          activeColor: '{blue.800}'
        },
        highlight: {
          background: '{blue.600}',
          focusBackground: '{blue.700}',
          color: '#ffffff',
          focusColor: '#ffffff'
        }
      }
    }
  }
});

const app = createApp(App)

app.use(createPinia());

// @ts-ignore - AI : PrimeVue configuration type issue
app.use(PrimeVue, {
  ripple: true,
  inputVariant: "filled",
  theme: {
    preset: ConstructionMapPreset,
    options: {
      prefix: 'p',
      darkModeSelector: 'light',
      cssLayer: false
    }
  }
});

app.use(ToastService);

app.mount('#app');
