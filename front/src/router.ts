import { createRouter, createWebHistory } from "vue-router";
import Home from "@/pages/Home.vue";
import { useAuthStore } from "@/stores/authStore";

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
  {
    path: "/admin/reports",
    name: "AdminReports",
    component: async () => import("@/pages/AdminReportsPage.vue"), // Lazy load
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/admin/user/:userId",
    name: "AdminUserContributions",
    component: async () => import("@/pages/AdminUserContributionsPage.vue"), // Lazy load
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  // AI : Catch-all route — redirect unknown paths to home
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// AI : Router guard to check authentication and admin status
router.beforeEach(async (to) => {
  const authStore = useAuthStore();

  // AI : Wait for auth to initialize if it hasn't yet
  if (authStore.loading) {
    await authStore.initialize();
  }

  // AI : Redirects to home if auth/admin requirements are not met
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: "Home" };
  }

  if (to.meta.requiresAdmin && authStore.user?.role !== "admin") {
    return { name: "Home" };
  }
});
