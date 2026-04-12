import { ref } from "vue";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme-preference";
const DARK_CLASS = "dark-mode";

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle(DARK_CLASS, theme === "dark");
}

const theme = ref<Theme>(getInitialTheme());
applyTheme(theme.value);

export function useTheme() {
  function toggle() {
    theme.value = theme.value === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, theme.value);
    applyTheme(theme.value);
  }

  return { theme, toggle };
}
