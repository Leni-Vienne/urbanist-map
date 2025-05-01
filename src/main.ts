import App from './App.vue'
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import ToastService from 'primevue/toastservice';

// PrimeVue Components
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import FloatLabel from 'primevue/floatlabel';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Calendar from 'primevue/calendar';
import Tooltip from 'primevue/tooltip';
import ContextMenu from 'primevue/contextmenu';
import Toast from 'primevue/toast';

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

// Register PrimeVue components
app.component('Button', Button);
app.component('Dialog', Dialog);
app.component('FloatLabel', FloatLabel);
app.component('InputText', InputText);
app.component('Textarea', Textarea);
app.component('DatePicker', Calendar);
app.component('ContextMenu', ContextMenu);
app.component('Toast', Toast);
app.directive('tooltip', Tooltip);

app.use(ToastService);
app.mount('#app');