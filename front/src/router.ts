import { createRouter, createWebHistory } from 'vue-router'
import Home from '@pages/Home.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/verify',
    name: 'EmailVerification',
    component: () => import('@pages/EmailVerification.vue') // Lazy load
  },
  {
    path: '/reset-password',
    name: 'PasswordReset', 
    component: () => import('@pages/PasswordReset.vue') // Lazy load
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})