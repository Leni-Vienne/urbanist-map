import App from './App.vue'
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import ToastService from 'primevue/toastservice';
import { router } from './router';

// AI : Expose the router globally for use in composables
declare global {
  interface Window {
    router: typeof router;
  }
}
window.router = router;

const app = createApp(App)
app.use(PrimeVue, {
    theme: {
        preset: Aura,
        options: {
            prefix: 'p',
            darkModeSelector: 'light',
            cssLayer: false
        }
    }
})

app.use(ToastService);
app.use(router);
app.mount('#app');