import { defineConfig } from '@playwright/experimental-ct-react'
import { lingui, linguiTransformerBabelPreset } from '@lingui/vite-plugin'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// Visual-regression harness for Tela A1 (ticket S02-01's AuthScreen, AC "A1
// verde nos 4 breakpoints com axe bloqueante"). Same pattern as
// packages/ui/playwright-ct.config.ts (S00-03/S00.5-04) -- one project per
// breakpoint bucket from the wireframe spec (sm/md/lg/xl -- see Wireframes -
// Responsivo (3 plataformas).dc.html, section "Nomenclatura, breakpoints e
// regras"). T/M projects set hasTouch so `pointer: coarse` media queries
// activate the same way they would on a real device.
//
// ctViteConfig differs from packages/ui's: AuthScreen's copy is entirely
// Lingui macros (<Trans>/t), so this CT bundle needs the same
// lingui() + babel(linguiTransformerBabelPreset()) pair apps/app's own
// vite.config.ts runs for the real app -- @vitejs/plugin-react v6 dropped
// its own Babel integration, so the macro transform needs its own pass.
// react() itself is NOT listed here (same as packages/ui's config):
// @playwright/experimental-ct-react depends on @vitejs/plugin-react
// directly and wires its own copy in automatically whenever ctViteConfig
// supplies no plugins of its own -- and Vite's own default esbuild-based
// JSX handling covers plain JSX fine either way (verified: the screenshots
// this config produces render real React output, not blank/broken JSX).
//
// Getting AuthScreen's Portuguese copy to actually render here (not the
// raw hashed catalog id, e.g. "1hNmgK" instead of "Profissional") needed a
// separate, real fix: apps/app/src/locales/*/messages.po had never been
// re-extracted since AuthScreen.tsx was written, so its <Trans>/t strings
// had no catalog entries at all. `vite build` (what CT's bundler always
// runs, even for this dev-loop) builds in production mode, where Lingui's
// babel macro strips each message's inline fallback default text -- so
// with no catalog entry AND no fallback, `i18n._()` had nothing left to
// render but the id itself. Ran `pnpm --filter app check:i18n-extract`
// (`lingui extract`) to populate the missing entries; pt-BR (this repo's
// sourceLocale) autofills msgstr from the source text, so no manual
// translation was needed for this catalog. The other 3 catalogs
// (en-US/es-419/it-IT) picked up the same new msgids with empty msgstr --
// real translation work for whoever owns those locales, out of this
// ticket's "4 breakpoints com axe bloqueante" AC. See
// src/test-support/ct-i18n.tsx for how the catalog gets activated for
// this CT bundle.
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.tsx',
  snapshotDir: './__screenshots__',
  timeout: 10_000,
  fullyParallel: true,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  // Same rationale as packages/ui's config: baselines are generated on
  // win32 (no Linux/Docker runner available in this session), CI runs
  // ubuntu-latest, whose font stack differs enough that pixel-identical
  // matching isn't realistic -- this tolerance absorbs anti-aliasing/hinting
  // noise while still catching real layout regressions (wrong breakpoint,
  // missing element, wrong color) nowhere near this magnitude.
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
      // isMobile deliberately omitted -- same finding as packages/ui's
      // config: on this Playwright/Chromium version it makes CT's internal
      // page ignore the explicit `viewport` below. hasTouch alone is enough
      // to activate `pointer: coarse`, the only device-emulation signal the
      // spec's rules actually key off of.
      name: 'M-sm',
      use: { viewport: { width: 375, height: 800 }, hasTouch: true },
    },
  ],
})
