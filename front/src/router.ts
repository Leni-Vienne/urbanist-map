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
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// AI : Router guard to check authentication and admin status
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  // AI : Wait for auth to initialize if it hasn't yet
  if (authStore.loading) {
    await authStore.initialize();
  }

  // AI : Check if route requires authentication
  if (to.meta.requiresAuth) {
    if (!authStore.isAuthenticated) {
      // AI : User not authenticated, redirect to home
      console.warn("Access denied: Authentication required");
      next({ name: "Home" });
      return;
    }

    // AI : Check if route requires admin access
    if (to.meta.requiresAdmin) {
      const isAdmin = authStore.user?.role === "admin";
      if (!isAdmin) {
        // AI : User is authenticated but not admin
        console.warn("Access denied: Admin access required");
        next({ name: "Home" });
        return;
      }
    }
  }

  // AI : Allow navigation
  next();
});
