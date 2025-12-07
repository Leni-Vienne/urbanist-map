import { createRouter, createWebHistory } from "vue-router";
import Home from "@/pages/Home.vue";

const routes = [
  {
    path: "/",
    name: "Home",
    component: Home,
  },
  {
    path: "/verify",
    name: "EmailVerification",
    component: async () => import("@/pages/EmailVerification.vue"), // Lazy load
  },
  {
    path: "/reset-password",
    name: "PasswordReset",
    component: async () => import("@/pages/PasswordReset.vue"), // Lazy load
  },
  {
    path: "/legal",
    name: "Legal",
    component: async () => import("@/pages/Legal.vue"), // Lazy load
  },
  {
    path: "/contact",
    name: "Contact",
    component: async () => import("@/pages/Contact.vue"), // Lazy load
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
