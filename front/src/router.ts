// filepath: d:\Documents\Perso\prog\city-map-overlay\src\router.ts
import { createRouter, createWebHistory } from 'vue-router';
import { initializeStores } from '@composables/overlay/useOverlay';

// AI : Lazy load heavy components to reduce initial bundle size
const AppLayout = () => import('@components/layout/AppLayout.vue');

// AI : Define routes for the application
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: { 
        // AI : Empty component for home route since MapView is already in App.vue
        template: '<div></div>' 
      },
      meta: { title: 'Map View' },
      // AI : Add query params definition to handle overlay selection via URL
      props: (route) => ({ overlayId: route.query.overlay })
    },
    {
      // AI : Add dedicated route for overlay selection with path parameter
      path: '/overlay/:id',
      name: 'overlay-view',
      component: { 
        template: '<div></div>' 
      },
      props: true,
      meta: { title: 'Overlay View' }
    },
    {
      path: '/projects',
      component: AppLayout,
    }
  ]
});

// AI : Initialize stores when router navigation starts
let storesInitialized = false;
router.beforeEach(async (_to, _from) => {
  if (!storesInitialized) {
    // AI : Import and initialize stores on first navigation only
    initializeStores();
    storesInitialized = true;
  }
  
  return true;
});