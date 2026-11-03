(() => {
  const VERSION = 1;
  const BATCH_SIZE = 8;
  const LEDGER_PREFIX = 'limmiar.synthetic-material-upload.v1';

  function expectedReference(article) {
    return `${article.pmcid}; DOI ${article.doi}; ${article.license_code}; ${article.source_url}`.slice(0, 1000);
  }

  function normalized(value) {
    return value.replace(/\s+/gu, ' ').trim();
  }

  function validateManifest(articles) {
    if (!Array.isArray(articles) || articles.length === 0) throw new Error('Manifesto sem artigos.');
    const seen = new Set();
    for (const article of articles) {
      if (!article || typeof article.pmcid !== 'string' || !article.pmcid || seen.has(article.pmcid) ||
        typeof article.sha256 !== 'string' || !article.sha256 || typeof article.title !== 'string' ||
        !Array.isArray(article.authors) || typeof article.doi !== 'string' ||
        typeof article.license_code !== 'string' || typeof article.source_url !== 'string' || typeof article.path !== 'string') {
        throw new Error('Manifesto de materiais inválido ou com PMCIDs duplicados.');
      }
      seen.add(article.pmcid);
    }
  }

  function ledgerKey(accountId, digest) {
    if (!accountId || !digest) throw new Error('Conta ou manifesto ausente para o ledger.');
    return `${LEDGER_PREFIX}:${encodeURIComponent(accountId)}:${digest}`;
  }

  function validLedger(value, accountId, digest, articles) {
    if (!value || value.version !== VERSION || value.accountId !== accountId || value.manifestDigest !== digest ||
      !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) return false;
    const known = new Map(articles.map(article => [article.pmcid, article.sha256]));
    return Object.entries(value.records).every(([pmcid, record]) => known.has(pmcid) && record &&
      typeof record.materialId === 'string' && record.materialId && record.sha256 === known.get(pmcid) &&
      ['uploaded', 'reconciled'].includes(record.state) && typeof record.updatedAt === 'string' &&
      Object.keys(record).every(key => ['materialId', 'sha256', 'state', 'updatedAt'].includes(key))) &&
      Object.keys(value).every(key => ['version', 'accountId', 'manifestDigest', 'updatedAt', 'records'].includes(key));
  }

  function reconcileInventory(articles, materialIds, rowTexts, previous, accountId, digest, verifiedAt) {
    validateManifest(articles);
    if (!Array.isArray(materialIds) || !Array.isArray(rowTexts) || materialIds.length !== rowTexts.length) {
      throw new Error('Inventário da API e linhas do acervo não correspondem.');
    }
    if (new Set(materialIds).size !== materialIds.length || materialIds.some(id => typeof id !== 'string' || !id)) {
      throw new Error('IDs de material ausentes ou duplicados no inventário.');
    }

    const matches = new Map();
    for (let index = 0; index < rowTexts.length; index++) {
      const text = normalized(rowTexts[index]);
      for (const article of articles) {
        if (!text.includes(`${article.pmcid}; DOI`)) continue;
        const reference = expectedReference(article);
        const authors = article.authors.join('; ').slice(0, 500);
        if (!text.includes(normalized(article.title.slice(0, 300))) ||
          !text.includes(normalized(authors)) || !text.includes(normalized(reference))) {
          throw new Error(`Metadados existentes não correspondem ao manifesto: ${article.pmcid}`);
        }
        if (matches.has(article.pmcid)) throw new Error(`Material duplicado no acervo: ${article.pmcid}`);
        matches.set(article.pmcid, { materialId: materialIds[index], sha256: article.sha256 });
      }
    }

    const records = {};
    for (const article of articles) {
      const match = matches.get(article.pmcid);
      if (!match) continue;
      const prior = previous?.records?.[article.pmcid];
      const retainedUpload = prior?.materialId === match.materialId && prior.sha256 === article.sha256 && prior.state === 'uploaded';
      records[article.pmcid] = { ...match, state: retainedUpload ? 'uploaded' : 'reconciled', updatedAt: verifiedAt };
    }
    const ledger = { version: VERSION, accountId, manifestDigest: digest, updatedAt: verifiedAt, records };
    return {
      ledger,
      materialIds: Object.fromEntries(Object.entries(records).map(([pmcid, record]) => [pmcid, record.materialId])),
      pending: articles.filter(article => !records[article.pmcid]),
    };
  }

  async function uploadMaterials(page) {
    const sim = page.__sim;
    if (!sim?.accountId || !sim.accessToken) throw new Error('Conta fictícia autenticada obrigatória.');
    if (sim.uploadRunning) return { running: true, progress: sim.uploadProgress };
    sim.uploadRunning = true;
    sim.uploadError = null;

    const run = async () => {
      if (!sim.manifestRoute) {
        await page.route('**/simulation-manifest.json', route => route.fulfill({
          path: 'C:/Users/m0retto/Documents/projects/limmiar/.local/simulacao-100/materiais/manifest.json',
          contentType: 'application/json',
        }));
        sim.manifestRoute = true;
      }
      const manifest = await page.evaluate(() => fetch('/simulation-manifest.json').then(response => {
        if (!response.ok) throw new Error(`Manifesto HTTP ${response.status}`);
        return response.json();
      }));
      validateManifest(manifest.articles);

      const identity = JSON.stringify(manifest.articles.map(article => [article.pmcid, article.sha256]));
      const digest = await page.evaluate(async value => {
        const bytes = new TextEncoder().encode(value);
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      }, identity);
      const key = ledgerKey(sim.accountId, digest);
      const saved = await page.evaluate(storageKey => {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
      }, key);
      const previous = validLedger(saved, sim.accountId, digest, manifest.articles) ? saved : null;

      const inventory = await page.evaluate(async ({ accountId, accessToken }) => {
        const response = await fetch(`/accounts/${encodeURIComponent(accountId)}/materials`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) throw new Error(`Inventário do acervo HTTP ${response.status}`);
        const body = await response.json();
        if (!Array.isArray(body.materials)) throw new Error('Inventário do acervo inválido.');
        return body.materials.map(material => material.materialId);
      }, { accountId: sim.accountId, accessToken: sim.accessToken });

      await page.getByRole('heading', { name: 'Seu acervo', exact: true }).waitFor();
      await page.getByText('Abrindo seu acervo...', { exact: true }).waitFor({ state: 'hidden' });
      if (await page.getByText('Não foi possível abrir seu acervo. Tente novamente.', { exact: true }).count()) {
        throw new Error('A interface não carregou o acervo para reconciliação.');
      }
      const search = page.getByLabel('Buscar no acervo', { exact: true });
      await search.fill('');
      const rowLocator = page.locator('li.material-row');
      const rowTexts = [];
      if (inventory.length === 0) {
        if (await rowLocator.count() !== 0) throw new Error('A interface e a API discordam sobre o acervo vazio.');
      } else {
        const navigation = page.getByRole('navigation', { name: 'Paginação do acervo', exact: true });
        await navigation.waitFor({ state: 'visible' });
        const totalPages = Math.ceil(inventory.length / 10);
        // The acervo renders the API list unchanged, so visible rows map to IDs by index.
        for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
          await navigation.getByText(`Página ${currentPage} de ${totalPages}`, { exact: true }).waitFor({ state: 'visible' });
          const visibleRows = await rowLocator.allInnerTexts();
          const expectedRows = Math.min(10, inventory.length - rowTexts.length);
          if (visibleRows.length !== expectedRows) throw new Error('Paginação incompleta ao reconciliar o acervo.');
          rowTexts.push(...visibleRows);
          if (currentPage < totalPages) {
            await navigation.getByRole('button', { name: 'Próxima página', exact: true }).click();
          }
        }
      }

      const reconciled = reconcileInventory(manifest.articles, inventory, rowTexts, previous,
        sim.accountId, digest, new Date().toISOString());
      let ledger = reconciled.ledger;
      const persist = async () => page.evaluate(({ storageKey, value }) => {
        localStorage.setItem(storageKey, JSON.stringify(value));
      }, { storageKey: key, value: ledger });
      await persist();
      sim.materialIds = reconciled.materialIds;
      sim.uploaded = Object.keys(reconciled.materialIds);
      sim.uploadExpected = manifest.articles.length;
      const alreadyPresent = sim.uploaded.length;
      let createdThisRun = 0;
      const pending = reconciled.pending;
      sim.uploadProgress = { uploaded: sim.uploaded.length, expected: manifest.articles.length, alreadyPresent, createdThisRun };

      for (let start = 0; start < pending.length; start += BATCH_SIZE) {
        for (const article of pending.slice(start, start + BATCH_SIZE)) {
          await page.getByLabel('Arquivo do material', { exact: true }).setInputFiles(article.path);
          const title = page.getByLabel('Título da obra', { exact: true });
          await title.waitFor({ state: 'visible' });
          await title.fill(article.title.slice(0, Number(await title.getAttribute('maxlength')) || 300));
          const authors = page.getByLabel('Autores', { exact: true });
          await authors.fill(article.authors.join('; ').slice(0, Number(await authors.getAttribute('maxlength')) || 500));
          const reference = page.getByLabel('Referência bibliográfica ou edição', { exact: true });
          await reference.fill(expectedReference(article));
          const savedResponse = page.waitForResponse(response => response.request().method() === 'POST' &&
            new URL(response.url()).pathname.endsWith('/materials'));
          await page.getByRole('button', { name: 'Guardar no acervo', exact: true }).click();
          const response = await savedResponse;
          if (!response.ok()) throw new Error(`Upload ${article.pmcid}: HTTP ${response.status()}`);
          const materialId = response.request().postDataJSON()?.materialId;
          if (typeof materialId !== 'string' || !materialId) throw new Error(`Resposta do upload sem ID: ${article.pmcid}`);

          ledger.records[article.pmcid] = { materialId, sha256: article.sha256, state: 'uploaded', updatedAt: new Date().toISOString() };
          ledger.updatedAt = new Date().toISOString();
          await persist();
          sim.materialIds[article.pmcid] = materialId;
          sim.uploaded.push(article.pmcid);
          sim.results ??= [];
          sim.results.push({ kind: 'material_upload', pmcid: article.pmcid, theme: article.theme, at: ledger.updatedAt, status: response.status() });
          createdThisRun++;
          sim.uploadProgress = { uploaded: sim.uploaded.length, expected: manifest.articles.length, alreadyPresent, createdThisRun };
        }
      }

      if (sim.uploaded.length !== manifest.articles.length) throw new Error('Reconciliação terminou sem completar o manifesto.');
      const preparationErrors = await page.getByText('Não foi possível preparar este arquivo. Tente novamente.', { exact: true }).count();
      const prepared = await page.getByText('Pronto para selecionar na sessão', { exact: true }).count();
      return { uploaded: sim.uploaded.length, downloaded: manifest.articles.length, alreadyPresent, createdThisRun,
        failedPreparationsVisible: preparationErrors, preparedVisible: prepared };
    };

    sim.uploadTask = run().then(result => {
      sim.uploadProgress = result;
      return result;
    }).catch(error => {
      sim.uploadError = String(error);
      sim.uploadProgress = { uploaded: sim.uploaded?.length ?? 0, expected: sim.uploadExpected ?? null, failed: true };
      return sim.uploadProgress;
    }).finally(() => { sim.uploadRunning = false; });
    return { started: true, progress: sim.uploadProgress };
  }

  uploadMaterials.reconcileInventory = reconcileInventory;
  uploadMaterials.ledgerKey = ledgerKey;
  uploadMaterials.validLedger = validLedger;
  return uploadMaterials;
})()
