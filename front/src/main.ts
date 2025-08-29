import App from './App.vue'
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';
import ToastService from 'primevue/toastservice';
import { createPinia } from 'pinia';
import { router } from './router';


// AI : Custom PrimeVue preset for Construction Map
const ConstructionMapPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{indigo.50}',
      100: '{indigo.100}',
      200: '{indigo.200}',
      300: '{indigo.300}',
      400: '{indigo.400}',
      500: '{indigo.500}',
      600: '{indigo.600}',
      700: '{indigo.700}',
      800: '{indigo.800}',
      900: '{indigo.900}',
      950: '{indigo.950}'
    },
    colorScheme: {
      light: {
        primary: {
          color: '{indigo.600}',
          inverseColor: '#ffffff',
          hoverColor: '{indigo.700}',
          activeColor: '{indigo.800}'
        },
        highlight: {
          background: '{indigo.600}',
          focusBackground: '{indigo.700}',
          color: '#ffffff',
          focusColor: '#ffffff'
        }
      }
    }
  }
});

const app = createApp(App)

app.use(createPinia());
app.use(router);

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
