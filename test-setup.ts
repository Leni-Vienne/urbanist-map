import { vi } from "vitest";

// Global test setup for vitest

// Mock environment variables
Object.defineProperty(import.meta, "env", {
  value: {
    VITE_API_BASE_URL: "http://localhost:3000",
    NODE_ENV: "test",
  },
  writable: true,
});

// Mock console methods to reduce noise in tests
globalThis.console = {
  ...console,
  // Uncomment below to suppress logs in tests
  // log: vi.fn(),
  // debug: vi.fn(),
  // info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock IntersectionObserver for components that might use it
globalThis.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock ResizeObserver
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock globalThis.matchMedia for responsive components
Object.defineProperty(globalThis, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
});

// Mock sessionStorage
Object.defineProperty(globalThis, "sessionStorage", {
  value: localStorageMock,
});
