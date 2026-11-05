async (page) => {
  const sim = page.__sim;
  if (sim.firstRunning) return { running: true, progress: sim.firstProgress };
  sim.firstRunning = true;
  sim.firstEvidence = { startedAt: new Date().toISOString(), websocket: [], insights: [] };
  const run = async () => {
    const patient = sim.prepPage;
    sim.firstProgress = 'aguardando cinco materiais preparados';
    const deadline = Date.now() + 30 * 60_000;
    while (true) {
      const response = await patient.request.get('http://127.0.0.1:8000/api/acervo/' + sim.accountId,
        { headers: { Authorization: 'Bearer ' + sim.accessToken } });
      if (!response.ok()) throw new Error('Consulta do preparo: HTTP ' + response.status());
      const data = await response.json();
      const ready = sim.scenario.sources.filter(source => data.materials.some(item => item.materialId === sim.materialIds[source.pmcid] && item.ready));
      sim.firstPrepared = ready.length;
      if (ready.length === 5) break;
      if (Date.now() > deadline) throw new Error('As cinco obras não ficaram preparadas em 30 minutos.');
      await patient.waitForTimeout(3000);
    }
    sim.firstProgress = 'autorizando cinco obras pela interface';
    const search = page.getByLabel('Buscar no acervo', { exact: true });
    for (const source of sim.scenario.sources) {
      await search.fill(source.pmcid);
      const row = page.locator('li.material-row').filter({ hasText: source.pmcid });
      const checkbox = row.getByRole('checkbox', { name: 'Autorizar nas minhas consultas' });
      if (!(await checkbox.isChecked())) {
        const changed = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/authorization'));
        await checkbox.click();
        const response = await changed;
        if (!response.ok()) throw new Error('Autorização: HTTP ' + response.status());
      }
    }
    await search.fill('');
    sim.firstProgress = 'aguardando correção de concorrência antes de iniciar áudio';
    while (!sim.allowASR) await patient.waitForTimeout(1000);
    await patient.reload();
    await patient.bringToFront();
    const materials = patient.getByRole('group', { name: 'Obras desta sessão', exact: true });
    await materials.waitFor();
    const checkboxes = materials.getByRole('checkbox');
    for (let index = 0; index < await checkboxes.count(); index++) {
      if (await checkboxes.nth(index).isChecked()) await checkboxes.nth(index).click();
    }
    for (const source of sim.scenario.sources) await materials.getByRole('checkbox', { name: source.title.slice(0, 300), exact: true }).click();
    const selected = await checkboxes.evaluateAll(inputs => inputs.filter(input => input.checked).length);
    if (selected !== 5) throw new Error('Seleção incorreta: ' + selected);
    patient.on('websocket', socket => {
      if (!socket.url().includes('/v1/fala')) return;
      socket.on('framereceived', frame => {
        if (typeof frame.payload !== 'string') return;
        try {
          const event = JSON.parse(frame.payload);
          if (['final', 'falante', 'erro', 'concluido'].includes(event.type)) sim.firstEvidence.websocket.push({ at: new Date().toISOString(), ...event });
          if (typeof event.processado_ms === 'number') sim.firstProcessedMs = event.processado_ms;
        } catch {}
      });
    });
    patient.on('response', async response => {
      if (!response.url().includes('/api/consultar-qualificado')) return;
      try { sim.firstEvidence.insights.push({ at: new Date().toISOString(), status: response.status(), request: response.request().postDataJSON(), results: (await response.text()).split('\n').filter(line => line.trim()).map(line => JSON.parse(line)) }); }
      catch { sim.firstEvidence.insights.push({ at: new Date().toISOString(), status: response.status(), unreadable: true }); }
    });
    sim.firstProgress = 'transcrevendo áudio real de 21 minutos';
    sim.firstEvidence.audioStartedAt = new Date().toISOString();
    await patient.getByLabel('Ou carregar áudio', { exact: true }).setInputFiles('C:/Users/m0retto/Documents/projects/limmiar/.local/simulacao-100/sessoes/001-trauma/session.wav');
    await patient.getByText('Transcrição concluída. Confirme os papéis das vozes.', { exact: true }).waitFor({ timeout: 60 * 60_000 });
    sim.firstEvidence.audioFinishedAt = new Date().toISOString();
    sim.firstEvidence.url = patient.url();
    sim.firstEvidence.text = await patient.locator('main').innerText();
    sim.firstEvidence.roles = await patient.getByRole('combobox', { name: /^Voz \d+$/ }).evaluateAll(inputs => inputs.map(input => ({ name: input.closest('label').textContent.trim(), value: input.value })));
    sim.firstEvidence.words = await patient.getByLabel(/^Texto aos /).evaluateAll(inputs => inputs.map(input => {
      const row = input.closest('li');
      return { text: input.value, start_seconds: Number(row.querySelector('button').textContent.replace('s', '')), speaker: row.querySelector('select').value };
    }));
    sim.firstProgress = 'transcrição concluída; análise e revisão pendentes';
  };
  sim.firstTask = run().catch(error => { sim.firstError = String(error); sim.firstProgress = 'falhou'; }).finally(() => { sim.firstRunning = false; });
  return { started: true };
}
