// Playwright Component Testing bootstrap. Loaded once per test worker --
// mirrors packages/ui/playwright/index.tsx: this is where the same Tailwind
// pipeline apps/app runs in production gets wired into the isolated CT
// bundler, so screenshots reflect real styling instead of unstyled markup.
import './index.css'
