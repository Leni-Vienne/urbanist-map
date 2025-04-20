import App from './App.vue'
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';

const app = createApp(App)
app.use(PrimeVue, {
    theme: {
        preset: Aura
    }
})

app.mount('#app');