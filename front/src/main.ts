import App from './App.vue'
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import ToastService from 'primevue/toastservice';
import { router } from './router';
import { createPinia } from 'pinia';

const app = createApp(App)

app.use(createPinia());

// @ts-ignore - AI : PrimeVue configuration type issue
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      prefix: 'p',
      darkModeSelector: 'light',
      cssLayer: false
    }
  }
});

app.use(ToastService);
app.use(router);

// AI : Store the app instance globally for access by dynamically created components
(window as any).vueApp = app;

app.mount('#app');
