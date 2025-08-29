import { createRouter, createWebHistory } from 'vue-router'
import Home from '@pages/Home.vue'
import EmailVerification from '@pages/EmailVerification.vue'
import PasswordReset from '@pages/PasswordReset.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/verify',
    name: 'EmailVerification',
    component: EmailVerification
  },
  {
    path: '/reset-password',
    name: 'PasswordReset', 
    component: PasswordReset
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})