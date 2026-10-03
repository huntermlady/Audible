import '@testing-library/jest-dom/vitest'

// jsdom lacks ResizeObserver (Radix tooltips/popovers measure with it).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
