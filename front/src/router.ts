// filepath: d:\Documents\Perso\prog\city-map-overlay\src\router.ts
import { createRouter, createWebHistory } from 'vue-router';
import AppLayout from '@components/AppLayout.vue';
import ProjectList from '@components/ProjectList.vue';
import ProjectEditor from '@components/ProjectEditor.vue';
import ProjectOverlaysList from '@components/ProjectOverlaysList.vue';

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
      children: [
        {
          path: '',
          name: 'projects',
          component: ProjectList,
          meta: { title: 'Project Manager' }
        },
        {
          path: 'create',
          name: 'project-create',
          component: ProjectEditor,
          props: { mode: 'create' },
          meta: { title: 'Create Project' }
        },
        {
          path: ':id',
          name: 'project-view',
          component: ProjectEditor,
          props: (route) => ({ 
            id: route.params.id, 
            mode: 'view' 
          }),
          meta: { title: 'Project Details' }
        },
        {
          path: ':id/edit',
          name: 'project-edit',
          component: ProjectEditor,
          props: (route) => ({ 
            id: route.params.id, 
            mode: 'edit' 
          }),
          meta: { title: 'Edit Project' }
        },
        {
          path: ':id/overlays',
          name: 'project-overlays',
          component: ProjectOverlaysList,
          props: (route) => ({ projectId: route.params.id }),
          meta: { title: 'Project Overlays' }
        }
      ]
    }
  ]
});