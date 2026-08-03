import { defineConfig } from '@playwright/experimental-ct-react'
import tailwindcss from '@tailwindcss/vite'

// Visual-regression harness for the 7 adaptive primitives (ticket S00-03).
// One project per breakpoint bucket from the wireframe spec (sm/md/lg/xl —
// see Wireframes - Responsivo (3 plataformas).dc.html, section "Nomenclatura,
// breakpoints e regras"). T/M projects set hasTouch so `pointer: coarse`
// media queries activate the same way they would on a real device — this is
// the "pointer:coarse emulado" the Spec's Critérios de Aceite calls for.
//
// Each *.spec.tsx under src/ is written as a breakpoint × locale matrix
// generator (LOCALES currently just ['pt-BR']) so S00.5-04 can add
// 'pseudo' to that array without touching this config or the projects below.
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.tsx',
  snapshotDir: './__screenshots__',
  timeout: 10_000,
  fullyParallel: true,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  // Baselines were generated on win32 (no Linux/Docker runner available in
  // this session — see the ticket's Handoff for why). CI runs on
  // ubuntu-latest, whose font stack differs enough that pixel-identical
  // matching isn't realistic; this tolerance absorbs anti-aliasing/hinting
  // noise while still catching real layout regressions (wrong breakpoint,
  // missing element, wrong color) at nowhere near this magnitude.
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
      // isMobile deliberately omitted: on this Playwright/Chromium version it
      // makes CT's internal page ignore the explicit `viewport` below
      // (window.innerWidth came out ~981px instead of 375 — verified with a
      // throwaway debug spec). hasTouch alone is enough to activate
      // `pointer: coarse`, which is the only device-emulation signal the
      // spec's rules actually key off of.
      name: 'M-sm',
      use: { viewport: { width: 375, height: 800 }, hasTouch: true },
    },
  ],
})
