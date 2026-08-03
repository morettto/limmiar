import { defineConfig } from '@lingui/cli'

export default defineConfig({
  locales: ['pt-BR', 'es-419', 'it-IT', 'en-US'],
  sourceLocale: 'pt-BR',
  catalogs: [{ path: '<rootDir>/src/locales/{locale}/messages', include: ['<rootDir>/src'] }],
})
