import { defineConfig } from '@playwright/experimental-ct-react'
import { lingui, linguiTransformerBabelPreset } from '@lingui/vite-plugin'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// Visual-regression harness for Tela A1 (S02-01), same shape as packages/ui's config:
// one project per breakpoint, hasTouch on T/M. ctViteConfig adds Lingui's macro pass
// (react() comes from @playwright/experimental-ct-react itself); see ct-i18n.tsx.
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.tsx',
  snapshotDir: './__screenshots__',
  timeout: 10_000,
  fullyParallel: true,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  // Baselines were generated on win32 while CI runs on ubuntu-latest, whose font stack
  // differs; this tolerance absorbs anti-aliasing noise while still catching real layout
  // regressions, which are nowhere near this magnitude.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.05 },
  },
  use: {
    trace: 'on-first-retry',
    // Different port from packages/ui's ctPort (3100) so both packages'
    // CT suites could in principle run concurrently without colliding.
    ctPort: 3101,
    ctViteConfig: {
      plugins: [lingui(), babel({ presets: [linguiTransformerBabelPreset()] }), tailwindcss()],
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
      // isMobile deliberately omitted: on this Chromium it makes CT's page ignore the
      // explicit `viewport` below. hasTouch alone activates `pointer: coarse`, the only
      // device-emulation signal the spec's rules key off of.
      name: 'M-sm',
      use: { viewport: { width: 375, height: 800 }, hasTouch: true },
    },
  ],
})
