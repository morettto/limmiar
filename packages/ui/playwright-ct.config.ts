import { defineConfig } from '@playwright/experimental-ct-react'
import tailwindcss from '@tailwindcss/vite'

// Visual-regression harness for the 7 adaptive primitives (S00-03): one project per
// breakpoint bucket, T/M with hasTouch so `pointer: coarse` activates. Each
// *.spec.tsx is a breakpoint × locale matrix, so locales change without this file.
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.tsx',
  snapshotDir: './__screenshots__',
  timeout: 10_000,
  fullyParallel: true,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  // Baselines were generated on win32 while CI runs on ubuntu-latest, whose font
  // stack differs; this tolerance absorbs anti-aliasing noise while still catching
  // real layout regressions, which are nowhere near this magnitude.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.05 },
  },
  use: {
    trace: 'on-first-retry',
    ctPort: 3100,
    ctViteConfig: {
      plugins: [tailwindcss()],
    },
  },
  projects: [
    {
      name: 'D-xl',
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'T-lg',
      use: { viewport: { width: 1150, height: 900 }, hasTouch: true },
    },
    {
      name: 'T-md',
      use: { viewport: { width: 900, height: 1100 }, hasTouch: true },
    },
    {
      // isMobile deliberately omitted: on this Chromium it makes CT's page ignore
      // the explicit `viewport` (innerWidth came out ~981px instead of 375).
      // hasTouch alone activates `pointer: coarse`, the only signal the spec uses.
      name: 'M-sm',
      use: { viewport: { width: 375, height: 800 }, hasTouch: true },
    },
  ],
})
