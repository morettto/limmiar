// Integration check for AC4 (S00.5-03): proves the CI-only pseudo-locale
// pipeline (lingui.config.pseudo.ts) actually generates a pseudo-LOCALE
// catalog from the real source catalog, end to end, with no mocking — this
// script only runs after `pnpm build:i18n-pseudo` produced real compiled
// output on disk.
//
// The compiled catalogs are CJS (`module.exports = ...`), which can't be
// `import()`-ed directly under this package's `"type": "module"` — so the
// JSON payload is pulled out of the file text instead of executing it.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

function extractMessages(source) {
  const match = source.match(/JSON\.parse\("(.*)"\)/s)
  if (!match) {
    throw new Error('compiled catalog does not contain the expected JSON.parse(...) payload')
  }
  return JSON.parse(JSON.parse(`"${match[1]}"`))
}

const [sourceCatalog, pseudoCatalog] = await Promise.all([
  readFile(`${appRoot}src/locales/pt-BR/messages.js`, 'utf-8'),
  readFile(`${appRoot}src/locales/pseudo-LOCALE/messages.js`, 'utf-8'),
])

const sourceMessages = extractMessages(sourceCatalog)
const pseudoMessages = extractMessages(pseudoCatalog)

const sourceKeys = Object.keys(sourceMessages)
if (sourceKeys.length === 0) {
  throw new Error('source catalog (pt-BR) has no messages to verify pseudo-localization against')
}

for (const key of sourceKeys) {
  const [sourceText] = sourceMessages[key]
  const [pseudoText] = pseudoMessages[key] ?? []

  if (pseudoText === undefined) {
    throw new Error(`pseudo-LOCALE catalog is missing key "${key}" present in the source catalog`)
  }
  if (pseudoText === sourceText) {
    throw new Error(`pseudo-LOCALE text for "${key}" is identical to the source — pseudolocalization did not run`)
  }
  if (pseudoText.length <= sourceText.length) {
    throw new Error(`pseudo-LOCALE text for "${key}" is not longer than the source (expected ~35% text expansion)`)
  }
  // eslint-disable-next-line no-control-regex -- deliberately checking for non-ASCII (accented) characters
  if (/^[\x00-\x7F]*$/.test(pseudoText)) {
    throw new Error(`pseudo-LOCALE text for "${key}" has no accented characters — expected synthetic accents`)
  }
}

console.log(`pseudo-locale OK: ${sourceKeys.length} message(s) verified (expanded + accented, none identical to source)`)
