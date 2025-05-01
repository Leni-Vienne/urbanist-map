import { createRouter, createWebHashHistory } from 'vue-router'
import ProjectList from './components/ProjectList.vue'
import ProjectEditor from './components/ProjectEditor.vue'
import ProjectManager from './components/ProjectManager.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/projects',
      component: ProjectManager,
      children: [
        {
          path: '',
          name: 'project-list',
          component: ProjectList
        },
        {
          path: ':id/:mode',
          name: 'project-editor',
          component: ProjectEditor,
          props: true
        },
        {
          path: 'create',
          name: 'project-create',
          component: ProjectEditor,
          props: { mode: 'create' }
        }
      ]
    }
  ]
})

export default router