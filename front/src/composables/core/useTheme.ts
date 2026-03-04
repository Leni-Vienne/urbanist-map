import { ref } from "vue";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme-preference";
const DARK_CLASS = "dark-mode";

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle(DARK_CLASS, t === "dark");
}

// Module-level reactive state shared across all composable instances
const theme = ref<Theme>(getInitialTheme());
applyTheme(theme.value);

export function useTheme() {
  function toggle() {
    theme.value = theme.value === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, theme.value);
    applyTheme(theme.value);
  }

  function setTheme(t: Theme) {
    theme.value = t;
    localStorage.setItem(STORAGE_KEY, t);
    applyTheme(t);
  }

  return { theme, toggle, setTheme };
}
