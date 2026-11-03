import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('./mcp-upload.js', import.meta.url), 'utf8')
const upload = vm.runInNewContext(source)

function article(index, pmcid = `PMC${String(100000 + index).padStart(6, '0')}`) {
  return {
    pmcid,
    sha256: `hash-${index}`,
    title: `Material ${index}`,
    authors: [`Author ${index}`, `Second ${index}`],
    doi: `10.1000/${index}`,
    license_code: 'CC BY',
    source_url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
    path: `C:/synthetic/${pmcid}.pdf`,
  }
}

function row(article) {
  return `${article.title}\n${article.authors.join('; ')}\n${article.pmcid}; DOI ${article.doi}; ${article.license_code}; ${article.source_url}`
}

test('reconciliation trusts the remote inventory over stale in-memory upload counts', () => {
  const articles = Array.from({ length: 214 }, (_, index) => article(index))
  const existing = articles.slice(0, 47)
  const ids = existing.map((_, index) => `material-${index}`)
  const rows = existing.map(row)
  const previous = {
    version: 1,
    accountId: 'account-test',
    manifestDigest: 'digest-test',
    records: {
      [articles[0].pmcid]: { materialId: ids[0], sha256: articles[0].sha256, state: 'uploaded', updatedAt: 'then' },
      [articles[47].pmcid]: { materialId: 'stale-id', sha256: articles[47].sha256, state: 'uploaded', updatedAt: 'then' },
    },
  }

  const result = upload.reconcileInventory(articles, ids, rows, previous, 'account-test', 'digest-test', 'now')

  assert.equal(Object.keys(result.materialIds).length, 47)
  assert.equal(result.pending.length, 167)
  assert.equal(result.pending[0].pmcid, articles[47].pmcid)
  assert.equal(result.materialIds[articles[46].pmcid], ids[46])
  assert.equal(result.ledger.records[articles[0].pmcid].state, 'uploaded')
  assert.equal(result.ledger.records[articles[1].pmcid].state, 'reconciled')
  assert.equal(result.ledger.records[articles[47].pmcid], undefined)
  assert.deepEqual(Object.keys(result.ledger).sort(), ['accountId', 'manifestDigest', 'records', 'updatedAt', 'version'])
  assert.deepEqual(Object.keys(result.ledger.records[articles[0].pmcid]).sort(), ['materialId', 'sha256', 'state', 'updatedAt'])
  assert.equal(upload.validLedger(result.ledger, 'account-test', 'digest-test', articles), true)
  assert.equal(upload.validLedger({ ...result.ledger, accessToken: 'synthetic-secret' }, 'account-test', 'digest-test', articles), false)
})

test('ledger storage key is scoped to both account and manifest', () => {
  const first = upload.ledgerKey('account-a', 'manifest-1')
  assert.notEqual(first, upload.ledgerKey('account-b', 'manifest-1'))
  assert.notEqual(first, upload.ledgerKey('account-a', 'manifest-2'))
})

test('duplicate or conflicting existing materials stop reconciliation', () => {
  const expected = article(0)
  assert.throws(() => upload.reconcileInventory([expected], ['id-a', 'id-b'], [row(expected), row(expected)], null,
    'account-test', 'digest-test', 'now'), /Material duplicado/)
  assert.throws(() => upload.reconcileInventory([expected], ['id-a'], [row(expected).replace(expected.title, 'Different title')], null,
    'account-test', 'digest-test', 'now'), /Metadados existentes não correspondem/)
})

test('PMCID prefixes do not match a different material identifier', () => {
  const shorter = article(0, 'PMC1234')
  const longer = article(1, 'PMC12345')
  const result = upload.reconcileInventory([shorter, longer], ['id-long'], [row(longer)], null,
    'account-test', 'digest-test', 'now')
  assert.equal(result.materialIds[longer.pmcid], 'id-long')
  assert.equal(result.pending.length, 1)
  assert.equal(result.pending[0].pmcid, shorter.pmcid)
})
