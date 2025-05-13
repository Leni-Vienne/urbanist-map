import App from './App.vue'
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import ToastService from 'primevue/toastservice';
import { router } from './router';

// AI : Expose the router globally for use in composables
declare global {
  interface Window {
    router: any; // AI : Use 'any' to avoid type conflicts
    $primevue?: any; // AI : Expose PrimeVue globally as a fallback
  }
}
window.router = router;

// AI : Create PrimeVue config
const primeVueConfig = {
    theme: {
        preset: Aura,
        options: {
            prefix: 'p',
            darkModeSelector: 'light',
            cssLayer: false
        }
    }
};

// AI : Make PrimeVue config globally available as a fallback
window.$primevue = primeVueConfig;

const app = createApp(App)
app.use(PrimeVue, primeVueConfig)

app.use(ToastService);
app.use(router);
app.mount('#app');