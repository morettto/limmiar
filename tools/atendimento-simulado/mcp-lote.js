async (page) => {
  const sim = page.__sim;
  if (!sim?.accountId || !sim.materialIds) throw new Error('Conta e materiais são obrigatórios.');
  if (sim.loteRunning) return { running: true, progress: sim.loteProgress };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const root = 'C:/Users/m0retto/Documents/projects/limmiar/.local/simulacao-100';
  const resumePath = typeof sim.loteResumePath === 'string' ? sim.loteResumePath.replaceAll('\\', '/') : undefined;
  const checkpointName = resumePath ? resumePath.split('/').at(-1) : sim.loteCheckpointName ?? `lote-checkpoint-100-${Date.now()}.json`;
  assert(/^lote-checkpoint-100-[A-Za-z0-9.-]+\.json$/.test(checkpointName), 'Nome de checkpoint inválido.');
  if (resumePath) assert(resumePath.toLowerCase().startsWith(`${root.toLowerCase()}/`) && resumePath.endsWith(checkpointName), 'Checkpoint fora da pasta da simulação.');
  if (!sim.loteCheckpoint && !resumePath) assert(sim.loteNewCheckpoint === checkpointName, 'Informe o checkpoint de retomada ou autorize explicitamente um arquivo novo.');
  sim.loteCheckpointName = checkpointName;
  delete sim.loteNewCheckpoint;
  const patient = sim.prepPage ?? page;
  assert(patient === page, 'O acervo e o prontuário precisam usar a mesma sessão autenticada do navegador.');
  sim.prepPage = patient;
  const now = () => new Date().toISOString();
  const progress = (id, stage) => { sim.loteProgress = { id, stage, at: now() }; };
  const wait = ms => patient.waitForTimeout(ms);
  const websocketTypes = ['pronta', 'parcial', 'final', 'falante', 'concluida', 'erro'];
  const progressStages = new Set([
    'aguardando liberação explícita do ASR', 'aguardando cinco obras prontas', 'ASR real',
    'aguardando consultas e cartões', 'validando oráculo sintético da transcrição e dos papéis',
    'confirmando revisão simulada pelo oráculo', 'pausado por divergência do oráculo sintético',
    'salvando nota de ensaio', 'encerrando sessão',
    'pausado entre atendimentos', '100 atendimentos concluídos com evidência', 'falhou',
  ]);
  const safeTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
  const safeSessionUrl = value => {
    if (typeof value !== 'string') return undefined;
    try {
      const url = new URL(value);
      return url.origin === 'http://localhost:5173' && /^\/pacientes\/[A-Za-z0-9_-]+\/sessoes\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
        (url.search === '' || url.search === '?aba=insights') ? url.toString() : undefined;
    } catch { return undefined; }
  };
  const safeErrorKind = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ? value : 'Error';
  const errorKind = error => safeErrorKind(error?.name);
  const safeCount = (value, fallback = 0) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  function sanitizeEvidence(previous, session) {
    const old = previous && typeof previous === 'object' ? previous : {};
    const oldWords = Array.isArray(old.words) ? old.words : [];
    const oldTranscript = old.transcriptMetrics && typeof old.transcriptMetrics === 'object' ? old.transcriptMetrics : {};
    const oldRoles = Array.isArray(old.roles) ? old.roles.map(role => role?.value) : [];
    const starts = oldWords.map(word => word?.start_seconds).filter(Number.isFinite);
    const roleSegments = {
      professional: oldWords.filter(word => word?.role === 'Profissional').length,
      patient: oldWords.filter(word => word?.role === 'Paciente').length,
      unassigned: oldWords.filter(word => word?.role == null).length,
    };
    const eventCounts = Object.fromEntries([...websocketTypes, 'unknown'].map(type => [type, 0]));
    const oldWebsocketMetrics = old.websocketMetrics && typeof old.websocketMetrics === 'object' ? old.websocketMetrics : {};
    const oldEvents = Array.isArray(old.websocket) ? old.websocket : [];
    for (const event of oldEvents) {
      const type = websocketTypes.includes(event?.type) ? event.type : 'unknown';
      eventCounts[type]++;
    }
    if (oldWebsocketMetrics.eventCounts && typeof oldWebsocketMetrics.eventCounts === 'object') {
      for (const type of [...websocketTypes, 'unknown']) eventCounts[type] = safeCount(oldWebsocketMetrics.eventCounts[type], eventCounts[type]);
    }
    const oldInsights = Array.isArray(old.insights) ? old.insights : [];
    const oldErrors = Array.isArray(old.errors) ? old.errors : [];
    const oldCadences = Array.isArray(old.cadences) ? old.cadences : [];
    const allowedMaterialIds = new Set(session.sources.map(source => sim.materialIds[source.pmcid]).filter(id => typeof id === 'string'));
    const materialIds = value => Array.isArray(value) ? value.filter(id => typeof id === 'string' && allowedMaterialIds.has(id)) : [];
    const min = (values, fallback) => values.length ? Math.min(...values) : fallback;
    const max = (values, fallback) => values.length ? Math.max(...values) : fallback;
    const eventAudioTimes = oldEvents.flatMap(event => Array.isArray(event?.palavras)
      ? event.palavras.flatMap(word => [word?.inicio_ms, word?.fim_ms].filter(Number.isFinite)) : []);
    const processedTimes = oldEvents.map(event => event?.processado_ms).filter(Number.isFinite);
    return {
      id: session.id,
      synthetic: true,
      evaluation_only: true,
      human_approval: false,
      sourceIds: session.sources.map(source => source.pmcid),
      duration_seconds: session.duration_seconds,
      audioStartedAt: safeTime(old.audioStartedAt),
      audioFinishedAt: safeTime(old.audioFinishedAt),
      finishedAt: safeTime(old.finishedAt),
      fixtureOracle: old.fixtureOracle === 'authored-turns-v1' ? 'authored-turns-v1' : undefined,
      reviewMode: old.reviewMode === 'fixture_oracle_simulated' ? 'fixture_oracle_simulated' : undefined,
      reviewSimulatedAt: old.reviewMode === 'fixture_oracle_simulated' ? safeTime(old.reviewSimulatedAt) : undefined,
      transcriptMetrics: {
        segmentCount: safeCount(oldTranscript.segmentCount, oldWords.length),
        wordCount: Number.isSafeInteger(oldTranscript.wordCount) ? oldTranscript.wordCount : null,
        timedSegmentCount: safeCount(oldTranscript.timedSegmentCount, starts.length),
        professionalSegments: safeCount(oldTranscript.professionalSegments, roleSegments.professional),
        patientSegments: safeCount(oldTranscript.patientSegments, roleSegments.patient),
        unassignedSegments: safeCount(oldTranscript.unassignedSegments, roleSegments.unassigned),
        minAudioSeconds: Number.isFinite(oldTranscript.minAudioSeconds) ? oldTranscript.minAudioSeconds : min(starts, null),
        maxAudioSeconds: Number.isFinite(oldTranscript.maxAudioSeconds) ? oldTranscript.maxAudioSeconds : max(starts, null),
        hasProfessionalRole: typeof oldTranscript.hasProfessionalRole === 'boolean' ? oldTranscript.hasProfessionalRole : oldRoles.includes('voce'),
        hasPatientRole: typeof oldTranscript.hasPatientRole === 'boolean' ? oldTranscript.hasPatientRole : oldRoles.includes('paciente'),
        fixtureWordCount: safeCount(oldTranscript.fixtureWordCount),
        fixtureTextMismatchCount: safeCount(oldTranscript.fixtureTextMismatchCount),
        fixtureRoleMismatchCount: safeCount(oldTranscript.fixtureRoleMismatchCount),
        fixtureOracleMatch: oldTranscript.fixtureOracleMatch === true,
      },
      websocketMetrics: {
        eventCounts,
        finalWordCount: safeCount(oldWebsocketMetrics.finalWordCount, oldEvents.reduce((count, event) => count + (event?.type === 'final' && Array.isArray(event.palavras) ? event.palavras.length : 0), 0)),
        minAudioMs: Number.isFinite(oldWebsocketMetrics.minAudioMs) ? oldWebsocketMetrics.minAudioMs : min(eventAudioTimes, null),
        maxAudioMs: Number.isFinite(oldWebsocketMetrics.maxAudioMs) ? oldWebsocketMetrics.maxAudioMs : max(eventAudioTimes, null),
        maxProcessedMs: Number.isFinite(oldWebsocketMetrics.maxProcessedMs) ? oldWebsocketMetrics.maxProcessedMs : max(processedTimes, null),
      },
      insights: oldInsights.map(row => ({
        startedAt: safeTime(row?.startedAt),
        status: Number.isInteger(row?.status) ? row.status : null,
        materialIds: materialIds(row?.materialIds ?? row?.request?.materialIds),
        responseLineCount: safeCount(row?.responseLineCount, Array.isArray(row?.lines) ? row.lines.length : 0),
        finishedAt: safeTime(row?.finishedAt),
        errorKind: row?.errorKind ? safeErrorKind(row.errorKind) : (row?.error ? 'Error' : undefined),
      })),
      errors: oldErrors.map(error => ({ at: safeTime(error?.at), kind: safeErrorKind(error?.kind) })),
      cadences: oldCadences.map(row => ({
        at: safeTime(row?.at), id: row?.id === session.id ? session.id : undefined,
        stage: progressStages.has(row?.stage) ? row.stage : undefined,
        insightResponses: safeCount(row?.insightResponses), finalEvents: safeCount(row?.finalEvents),
      })),
      visibleTranscriptBlockCount: safeCount(old.visibleTranscriptBlockCount),
      visibleInsightTriggerCount: safeCount(old.visibleInsightTriggerCount),
      visibleInsightSourceCount: safeCount(old.visibleInsightSourceCount),
      renderedInsightSourceCount: safeCount(old.renderedInsightSourceCount),
      insightSourceMismatchCount: safeCount(old.insightSourceMismatchCount),
      preUploadVerifiedAt: safeTime(old.preUploadVerifiedAt),
      preUploadTranscriptFieldCount: safeCount(old.preUploadTranscriptFieldCount),
      preUploadNonemptyTranscriptFieldCount: safeCount(old.preUploadNonemptyTranscriptFieldCount),
      preUploadTranscriptBlockCount: safeCount(old.preUploadTranscriptBlockCount),
      preUploadCompleteStatus: old.preUploadCompleteStatus === true,
      preUploadSavedStatus: old.preUploadSavedStatus === true,
    };
  }
  function sanitizeProgress(value) {
    if (!value || typeof value !== 'object') return undefined;
    return {
      id: typeof value.id === 'string' && manifest.sessions.some(session => session.id === value.id) ? value.id : undefined,
      stage: progressStages.has(value.stage) ? value.stage : undefined,
      at: safeTime(value.at),
      processedMs: Number.isFinite(value.processedMs) ? value.processedMs : undefined,
    };
  }
  async function navigate(url) {
    const target = new URL(url);
    assert(target.origin === 'http://localhost:5173' && ['/pacientes', '/acervo'].includes(target.pathname), 'Navegação fora do fluxo autenticado.');
    if (new URL(patient.url()).pathname !== target.pathname) {
      const link = target.pathname === '/acervo'
        ? patient.getByRole('link', { name: 'Acervo pessoal', exact: true })
        : patient.getByRole('link', { name: 'Pacientes', exact: true }).first();
      await link.click();
      await patient.waitForURL(current => current.pathname === target.pathname);
    }
    assert(!await patient.getByRole('heading', { name: 'Desbloqueie seu consultório', exact: true }).isVisible(),
      'Desbloqueie o prontuário antes de iniciar a simulação.');
  }
  async function localJson(path, name) {
    const url = 'http://localhost:5173/' + name;
    await page.route(url, route => route.fulfill({ path, contentType: 'application/json' }));
    try { return await page.evaluate(url => fetch(url).then(r => { if (!r.ok) throw new Error('Manifest HTTP ' + r.status); return r.json(); }), url); }
    finally { await page.unroute(url); }
  }
  function expectedPathFor(session) {
    const audioPath = typeof session.audio_path === 'string' ? session.audio_path.replaceAll('\\', '/') : '';
    const normalizedRoot = root.replaceAll('\\', '/');
    const match = audioPath.match(/^(.+)\/sessoes\/([^/]+)\/session\.wav$/i);
    assert(match && match[1].toLowerCase() === normalizedRoot.toLowerCase() && !['.', '..'].includes(match[2]),
      'Caminho do áudio fora da pasta da simulação: ' + session.id);
    return `${match[1]}/sessoes/${match[2]}/expected.json`;
  }
  const manifest = await localJson(root + '/lote-manifest.json', 'simulation-lote-manifest.json');
  assert(manifest.expected_materials === 214 && Object.keys(sim.materialIds).length === 214, 'Esperados 214 PDFs enviados.');
  assert(manifest.sessions.length === 100 && new Set(manifest.sessions.map(s => s.id)).size === 100, 'Esperadas 100 sessões distintas.');
  for (const s of manifest.sessions) {
    assert(s.sources.length === 5 && new Set(s.sources.map(x => x.pmcid)).size === 5, 'Exatamente cinco fontes: ' + s.id);
    assert(s.sources.every(x => sim.materialIds[x.pmcid]), 'Fonte sem material enviado: ' + s.id);
    assert(s.duration_seconds >= 1200 && s.duration_seconds <= 1800, 'WAV fora de 20–30 minutos: ' + s.id);
    const fixture = await localJson(expectedPathFor(s), 'simulation-expected-' + s.id + '.json');
    const expectedSources = Array.isArray(fixture.sources) ? fixture.sources.map(source => source?.pmcid) : [];
    assert(fixture.id === s.id && fixture.evaluation_only === true && expectedSources.length === 5 && new Set(expectedSources).size === 5 &&
      s.sources.every(source => expectedSources.includes(source.pmcid)),
    'Fontes do oráculo não correspondem ao plano canônico: ' + s.id);
  }
  if (!sim.loteCheckpoint && resumePath) sim.loteCheckpoint = await localJson(resumePath, 'simulation-lote-checkpoint.json');
  const loadedCheckpoint = sim.loteCheckpoint ?? { version: 1, accountId: sim.accountId, startedAt: now(), sessions: {} };
  assert(loadedCheckpoint.version === 1 && loadedCheckpoint.accountId === sim.accountId, 'Checkpoint de outra conta/versão.');
  assert(loadedCheckpoint.sessions && typeof loadedCheckpoint.sessions === 'object' && !Array.isArray(loadedCheckpoint.sessions), 'Checkpoint de sessões inválido.');
  const checkpoint = { version: 1, accountId: sim.accountId, startedAt: safeTime(loadedCheckpoint.startedAt) ?? now(), sessions: {} };
  if (safeTime(loadedCheckpoint.finishedAt)) checkpoint.finishedAt = loadedCheckpoint.finishedAt;
  if (loadedCheckpoint.lastError && typeof loadedCheckpoint.lastError === 'object') {
    checkpoint.lastError = {
      at: safeTime(loadedCheckpoint.lastError.at),
      kind: safeErrorKind(loadedCheckpoint.lastError.kind),
      progress: sanitizeProgress(loadedCheckpoint.lastError.progress),
    };
  }
  for (const session of manifest.sessions) {
    const oldEntry = loadedCheckpoint.sessions[session.id];
    if (!oldEntry || typeof oldEntry !== 'object' || Array.isArray(oldEntry)) continue;
    checkpoint.sessions[session.id] = {
      url: safeSessionUrl(oldEntry.url),
      patientName: typeof oldEntry.patientName === 'string' && oldEntry.patientName.startsWith('ENSAIO AUTOMATIZADO ') ? oldEntry.patientName : undefined,
      attempt: safeCount(oldEntry.attempt, 1) || 1,
      abandonedAttempts: Array.isArray(oldEntry.abandonedAttempts) ? oldEntry.abandonedAttempts
        .filter(attempt => Number.isSafeInteger(attempt?.attempt) && attempt.attempt > 0 && attempt.reason === 'partial_audio_not_saved')
        .map(attempt => ({ attempt: attempt.attempt, at: safeTime(attempt.at), reason: attempt.reason,
          url: safeSessionUrl(attempt.url), patientName: typeof attempt.patientName === 'string' && attempt.patientName.startsWith('ENSAIO AUTOMATIZADO ') ? attempt.patientName : undefined,
          audioStartedAt: safeTime(attempt.audioStartedAt), finalWordCount: safeCount(attempt.finalWordCount),
          insightCount: safeCount(attempt.insightCount), errorCount: safeCount(attempt.errorCount) })) : [],
      transcriptSaved: oldEntry.transcriptSaved === true,
      noteSaved: oldEntry.noteSaved === true,
      closedAt: safeTime(oldEntry.closedAt),
      completed: oldEntry.completed === true,
      ...(oldEntry.evidence && typeof oldEntry.evidence === 'object'
        ? { evidence: sanitizeEvidence(oldEntry.evidence, session) } : {}),
    };
  }
  sim.loteCheckpoint = checkpoint;
  const incompleteEvidence = manifest.sessions.find(session => {
    const entry = checkpoint.sessions[session.id];
    return entry?.transcriptSaved && (!entry?.evidence?.transcriptMetrics?.fixtureOracleMatch ||
      entry?.evidence?.fixtureOracle !== 'authored-turns-v1' || entry?.evidence?.reviewMode !== 'fixture_oracle_simulated' ||
      !entry?.evidence?.reviewSimulatedAt);
  });
  assert(!incompleteEvidence, `Sessão ${incompleteEvidence?.id} marcada como salva sem métricas do oráculo e revisão simulada.`);
  async function saveJson(name, value) {
    const downloading = patient.waitForEvent('download', { timeout: 30_000 });
    await patient.evaluate(({ name, value }) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, { name, value });
    await (await downloading).saveAs(root + '/' + name);
  }
  let checkpointWrite = Promise.resolve();
  const saveCheckpoint = () => {
    const write = checkpointWrite.then(async () => {
      await saveJson(checkpointName, checkpoint);
      delete sim.loteSaveError;
    });
    checkpointWrite = write.catch(error => { sim.loteSaveError = errorKind(error); });
    return write;
  };
  async function mutation(action, predicate) {
    const response = patient.waitForResponse(r => r.request().method() === 'POST' && predicate(r), { timeout: 30_000 });
    await action();
    const result = await response;
    assert(result.ok(), 'Mutação recusada: ' + result.status() + ' ' + result.url());
  }
  async function loadedPatientList() {
    const list = patient.getByRole('region', { name: 'Pacientes', exact: true });
    await list.getByText('Abrindo sua carteira...', { exact: true }).waitFor({ state: 'hidden' });
    assert(await list.getByRole('status').count() === 0 && await list.locator('.patient-folder[aria-disabled="true"]').count() === 0,
      'A carteira não confirmou carregamento completo.');
    return list;
  }
  async function openRecordedSession(s, entry) {
    const expectedName = `ENSAIO AUTOMATIZADO ${s.id} ${checkpoint.startedAt} tentativa ${entry.attempt}`;
    assert(entry.patientName === expectedName && safeSessionUrl(entry.url), 'Sessão registrada sem identidade sintética verificável.');
    const expected = new URL(entry.url);
    const patientId = expected.pathname.match(/^\/pacientes\/([^/]+)\/sessoes\//)?.[1];
    await navigate('http://localhost:5173/pacientes');
    const list = await loadedPatientList();
    const patientLink = list.getByRole('link', { name: expectedName, exact: true });
    assert(await patientLink.count() === 1, 'Paciente do checkpoint não está presente de forma única.');
    const patientHref = new URL(await patientLink.getAttribute('href'), patient.url());
    assert(patientHref.pathname === `/pacientes/${patientId}`, 'Checkpoint aponta para outro paciente.');
    await patientLink.click();
    await patient.getByText('Abrindo prontuário...', { exact: true }).waitFor({ state: 'hidden' });
    assert(await patient.getByRole('alert').count() === 0, 'O prontuário não confirmou carregamento.');
    const history = patient.getByRole('region', { name: 'Sessões do paciente', exact: true }).getByRole('link');
    assert(await history.count() === 1, 'Sessão do checkpoint não está presente de forma única.');
    const sessionHref = new URL(await history.getAttribute('href'), patient.url());
    assert(sessionHref.pathname === expected.pathname, 'Checkpoint aponta para outra sessão.');
    await history.click();
    await patient.waitForURL(url => url.pathname === expected.pathname);
    await patient.waitForFunction(() => Boolean(document.querySelector('input[type="file"], li.transcript-block')));
  }
  async function createSession(s, entry) {
    if (entry.url) { await openRecordedSession(s, entry); return; }
    await navigate('http://localhost:5173/pacientes');
    const list = await loadedPatientList();
    const name = 'ENSAIO AUTOMATIZADO ' + s.id + ' ' + checkpoint.startedAt + ' tentativa ' + entry.attempt;
    entry.patientName = name; await saveCheckpoint();
    let link = list.getByRole('link', { name, exact: true });
    if (!await link.count()) {
      await list.locator('details.patient-add > summary').click();
      await list.getByLabel('Nome do paciente', { exact: true }).fill(name);
      await mutation(() => list.getByRole('button', { name: 'Adicionar paciente', exact: true }).click(), r => new URL(r.url()).pathname.endsWith('/patients'));
    }
    await link.click();
    const sessionHistory = patient.getByRole('region', { name: 'Sessões do paciente', exact: true });
    await sessionHistory.waitFor({ state: 'visible' });
    const history = sessionHistory.getByRole('link');
    const historyCount = await history.count();
    assert(historyCount <= 1, 'Paciente sintético tem mais de uma sessão; retomada ambígua.');
    if (historyCount === 1) await history.first().click();
    else {
      const today = patient.getByRole('region', { name: 'Hoje', exact: true });
      await today.getByText('Carregando agenda de hoje...', { exact: true }).waitFor({ state: 'hidden' });
      assert(await today.getByRole('alert').count() === 0, 'A agenda não confirmou carregamento; criação de sessão bloqueada.');
      const start = today.getByRole('button', { name: 'Iniciar sessão', exact: true });
      const open = today.getByRole('link', { name: 'Abrir sessão', exact: true });
      assert(await start.count() + await open.count() <= 1, 'Agenda do paciente sintético está ambígua.');
      if (await open.count()) await open.click();
      else if (await start.count()) await start.click();
      else {
        assert(await today.getByText('Nenhum agendamento hoje', { exact: true }).count() === 1,
          'A agenda não confirmou ausência de sessões; criação bloqueada.');
        await today.getByRole('button', { name: 'Iniciar sessão agora', exact: true }).click();
      }
    }
    await patient.waitForURL(/\/pacientes\/[A-Za-z0-9_-]+\/sessoes\/[A-Za-z0-9_-]+/);
    entry.url = patient.url(); await saveCheckpoint();
  }
  async function consent() {
    for (const label of ['Paciente autorizou a gravação', 'Paciente autorizou a análise por IA local']) {
      const box = patient.getByRole('checkbox', { name: label, exact: true });
      if (!await box.isChecked()) await mutation(() => box.click(), r => new URL(r.url()).pathname.endsWith('/consents'));
      await box.waitFor({ state: 'visible' });
      const deadline = Date.now() + 30_000;
      while (!await box.isChecked() || !await box.isEnabled()) { assert(Date.now() < deadline, 'Consentimento não confirmado na interface.'); await wait(200); }
    }
  }
  async function authorize(s) {
    await navigate('http://localhost:5173/acervo');
    progress(s.id, 'aguardando cinco obras prontas');
    const deadline = Date.now() + 90 * 60_000;
    const search = page.getByLabel('Buscar no acervo', { exact: true });
    for (const source of s.sources) {
      await search.fill(source.pmcid);
      const row = page.locator('li.material-row').filter({ hasText: source.pmcid });
      const box = row.getByRole('checkbox', { name: 'Autorizar nas minhas consultas', exact: true });
      while (!await box.isEnabled()) { assert(Date.now() < deadline, 'Obra não preparada: ' + source.pmcid); await wait(3000); }
      if (!await box.isChecked()) {
        const changed = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/' + sim.materialIds[source.pmcid] + '/authorization'));
        await box.click(); assert((await changed).ok(), 'Falha de autorização: ' + source.pmcid);
      }
    }
    await search.fill('');
  }
  async function selectFive(s, entry) {
    await openRecordedSession(s, entry);
    const group = patient.getByRole('group', { name: 'Obras desta sessão', exact: true });
    await group.waitFor({ timeout: 60_000 });
    const boxes = group.getByRole('checkbox');
    for (let i = 0; i < await boxes.count(); i++) if (await boxes.nth(i).isChecked()) await boxes.nth(i).uncheck();
    for (const source of s.sources) await group.getByRole('checkbox', { name: source.title, exact: true }).check();
    const titles = await boxes.evaluateAll(nodes => nodes.filter(n => n.checked).map(n => n.closest('label').textContent.trim()));
    assert(titles.length === 5 && s.sources.every(s => titles.includes(s.title)), 'Seleção não corresponde às cinco obras canônicas.');
  }
  async function processSession(s, entry) {
    const evidence = entry.evidence = sanitizeEvidence(entry.evidence, s);
    const pending = new Set();
    let lastEvent = Date.now();
    const sockets = [];
    const onSocket = socket => {
      if (!socket.url().includes('/v1/fala')) return;
      const receive = frame => {
        if (typeof frame.payload !== 'string') return;
        try {
          const event = JSON.parse(frame.payload);
          const metrics = evidence.websocketMetrics;
          const type = websocketTypes.includes(event.type) ? event.type : 'unknown';
          metrics.eventCounts[type] = (metrics.eventCounts[type] ?? 0) + 1;
          if (type === 'final') {
            const words = Array.isArray(event.palavras) ? event.palavras : [];
            const times = words.flatMap(word => [word?.inicio_ms, word?.fim_ms].filter(Number.isFinite));
            metrics.finalWordCount += words.length;
            if (times.length) {
              metrics.minAudioMs = metrics.minAudioMs === null ? Math.min(...times) : Math.min(metrics.minAudioMs, ...times);
              metrics.maxAudioMs = metrics.maxAudioMs === null ? Math.max(...times) : Math.max(metrics.maxAudioMs, ...times);
            }
          }
          if (Number.isFinite(event.processado_ms)) {
            metrics.maxProcessedMs = metrics.maxProcessedMs === null ? event.processado_ms : Math.max(metrics.maxProcessedMs, event.processado_ms);
            sim.loteProgress = { ...sim.loteProgress, processedMs: event.processado_ms, at: now() };
          }
        } catch { evidence.errors.push({ at: now(), kind: 'websocket_json' }); }
      };
      socket.on('framereceived', receive); sockets.push([socket, receive]);
    };
    const onResponse = response => {
      if (!response.url().includes('/api/consultar-qualificado')) return;
      lastEvent = Date.now();
      const task = (async () => {
        let requestMaterialIds = [];
        try {
          const request = response.request().postDataJSON();
          const allowed = new Set(s.sources.map(source => sim.materialIds[source.pmcid]));
          requestMaterialIds = Array.isArray(request?.materialIds) ? request.materialIds.filter(id => typeof id === 'string' && allowed.has(id)) : [];
        } catch {}
        const row = { startedAt: now(), status: response.status(), materialIds: requestMaterialIds, responseLineCount: 0 };
        try {
          const raw = await response.text();
          const lines = raw.split('\n').filter(line => line.trim());
          for (const line of lines) JSON.parse(line);
          row.responseLineCount = lines.length;
        } catch (error) { row.errorKind = errorKind(error); }
        row.finishedAt = now(); evidence.insights.push(row); lastEvent = Date.now();
      })();
      pending.add(task); task.finally(() => pending.delete(task));
    };
    const onError = () => evidence.errors.push({ at: now(), kind: 'pageerror' });
    patient.on('websocket', onSocket); patient.on('response', onResponse); patient.on('pageerror', onError);
    let lastCheckpointAt = Date.now();
    const pulse = setInterval(() => {
      evidence.cadences.push({ at: now(), ...sim.loteProgress, insightResponses: evidence.insights.length, finalEvents: evidence.websocketMetrics.eventCounts.final });
      if (Date.now() - lastCheckpointAt >= 60_000) {
        lastCheckpointAt = Date.now();
        void saveCheckpoint().catch(() => {});
      }
    }, 15_000);
    try {
      await createSession(s, entry);
      if (!entry.transcriptSaved) {
        const fixture = await localJson(expectedPathFor(s), 'simulation-expected-' + s.id + '.json');
        assert(fixture.id === s.id && fixture.evaluation_only === true && Array.isArray(fixture.turns) && fixture.turns.length > 0 &&
          fixture.turns.every(turn => ['Profissional', 'Paciente'].includes(turn.role) && Array.isArray(turn.words) && turn.words.length > 0),
        'Oráculo sintético ausente ou inválido: ' + s.id);
        const expectedWords = fixture.turns.flatMap(turn => turn.words.map(text => ({
          text, role: turn.role === 'Profissional' ? 'voce' : 'paciente',
        })));
        assert(fixture.word_count === expectedWords.length, 'Contagem do oráculo sintético inválida: ' + s.id);
        await consent(); await authorize(s); await selectFive(s, entry);
        progress(s.id, 'ASR real');
        const preUpload = await patient.evaluate(() => {
          const fields = [...document.querySelectorAll('textarea')].filter(node =>
            /^Texto aos /u.test(node.getAttribute('aria-label') || [...(node.labels || [])].map(label => label.textContent.trim()).join(' ')));
          const body = document.body.innerText || '';
          return {
            uploadControlCount: document.querySelectorAll('input[type="file"]').length,
            transcriptFieldCount: fields.length,
            nonemptyTranscriptFieldCount: fields.filter(field => field.value.trim().length > 0).length,
            transcriptBlockCount: document.querySelectorAll('li.transcript-block').length,
            completeStatus: body.includes('Transcrição concluída. Confirme os papéis das vozes.'),
            savedStatus: body.includes('Transcrição salva no prontuário.'),
          };
        });
        Object.assign(evidence, {
          preUploadVerifiedAt: now(),
          preUploadTranscriptFieldCount: preUpload.transcriptFieldCount,
          preUploadNonemptyTranscriptFieldCount: preUpload.nonemptyTranscriptFieldCount,
          preUploadTranscriptBlockCount: preUpload.transcriptBlockCount,
          preUploadCompleteStatus: preUpload.completeStatus,
          preUploadSavedStatus: preUpload.savedStatus,
        });
        assert(preUpload.uploadControlCount === 1 && await patient.getByLabel('Ou carregar áudio', { exact: true }).isEnabled() &&
          preUpload.nonemptyTranscriptFieldCount === 0 && preUpload.transcriptBlockCount === 0 && !preUpload.completeStatus && !preUpload.savedStatus,
          'Transcrição anterior detectada; reenvio do áudio bloqueado: ' + s.id);
        evidence.audioStartedAt = now();
        await saveCheckpoint();
        await patient.getByLabel('Ou carregar áudio', { exact: true }).setInputFiles(s.audio_path);
        await patient.getByText('Transcrição concluída. Confirme os papéis das vozes.', { exact: true }).waitFor({ timeout: 90 * 60_000 });
        evidence.audioFinishedAt = now();
        progress(s.id, 'validando oráculo sintético da transcrição e dos papéis');
        const roles = await patient.getByRole('combobox', { name: /^Voz \d+$/ }).evaluateAll(nodes => nodes.map(node => node.value));
        evidence.transcriptMetrics = await patient.getByLabel(/^Texto aos /).evaluateAll((nodes, input) => {
          const { roleValues, expectedWords } = input;
          const metrics = { segmentCount: nodes.length, wordCount: 0, timedSegmentCount: 0,
            professionalSegments: 0, patientSegments: 0, unassignedSegments: 0,
            professionalWords: 0, patientWords: 0, unassignedWords: 0,
            minAudioSeconds: null, maxAudioSeconds: null,
            hasProfessionalRole: roleValues.includes('voce'), hasPatientRole: roleValues.includes('paciente'),
            fixtureWordCount: expectedWords.length, fixtureTextMismatchCount: Math.abs(expectedWords.length),
            fixtureRoleMismatchCount: Math.abs(expectedWords.length), fixtureOracleMatch: false };
          const normalize = value => value.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
          const actualWords = [];
          for (const node of nodes) {
            const phrase = node.value.trim();
            const words = phrase ? phrase.split(/\s+/u) : [];
            const wordCount = words.length;
            const row = node.closest('li');
            const startSeconds = Number(row.querySelector('button').textContent.replace('s', ''));
            const voice = row.querySelector('select');
            const role = roleValues[voice.selectedIndex - 1];
            for (const text of words) actualWords.push({ text: normalize(text), role });
            metrics.wordCount += wordCount;
            if (Number.isFinite(startSeconds)) {
              metrics.timedSegmentCount++;
              metrics.minAudioSeconds = metrics.minAudioSeconds === null ? startSeconds : Math.min(metrics.minAudioSeconds, startSeconds);
              metrics.maxAudioSeconds = metrics.maxAudioSeconds === null ? startSeconds : Math.max(metrics.maxAudioSeconds, startSeconds);
            }
            if (role === 'voce') { metrics.professionalSegments++; metrics.professionalWords += wordCount; }
            else if (role === 'paciente') { metrics.patientSegments++; metrics.patientWords += wordCount; }
            else { metrics.unassignedSegments++; metrics.unassignedWords += wordCount; }
          }
          const sharedWords = Math.min(actualWords.length, expectedWords.length);
          metrics.fixtureTextMismatchCount = Math.abs(actualWords.length - expectedWords.length);
          metrics.fixtureRoleMismatchCount = Math.abs(actualWords.length - expectedWords.length);
          for (let index = 0; index < sharedWords; index++) {
            if (actualWords[index].text !== normalize(expectedWords[index].text)) metrics.fixtureTextMismatchCount++;
            if (actualWords[index].role !== expectedWords[index].role) metrics.fixtureRoleMismatchCount++;
          }
          metrics.fixtureOracleMatch = metrics.fixtureTextMismatchCount === 0 && metrics.fixtureRoleMismatchCount === 0;
          return metrics;
        }, { roleValues: roles, expectedWords });
        assert(evidence.transcriptMetrics.segmentCount > 0 && evidence.transcriptMetrics.timedSegmentCount === evidence.transcriptMetrics.segmentCount,
          'Transcrição vazia ou tempos inválidos.');
        evidence.fixtureOracle = 'authored-turns-v1';
        if (!evidence.transcriptMetrics.fixtureOracleMatch) {
          const error = new Error('Oráculo sintético divergente; revisão simulada bloqueada.');
          error.name = 'FixtureOracleMismatch';
          error.textMismatchCount = evidence.transcriptMetrics.fixtureTextMismatchCount;
          error.roleMismatchCount = evidence.transcriptMetrics.fixtureRoleMismatchCount;
          throw error;
        }
        assert(evidence.websocketMetrics.eventCounts.concluida > 0, 'Gateway não confirmou conclusão.');
        progress(s.id, 'aguardando consultas e cartões');
        const deadline = Date.now() + 5 * 60_000;
        while (pending.size || Date.now() - lastEvent < 15_000) { assert(Date.now() < deadline, 'Consultas não terminaram.'); await wait(1000); }
        assert(evidence.insights.length > 0, 'Nenhuma resposta real do copiloto capturada.');
        assert(evidence.insights.every(r => r.status === 200 && !r.errorKind && r.responseLineCount > 0 && r.materialIds.length === 5 &&
          new Set(r.materialIds).size === 5 && r.materialIds.every(id => s.sources.some(x => sim.materialIds[x.pmcid] === id))),
        'Consulta falhou ou usou acervo diferente das cinco fontes.');
        evidence.visibleTranscriptBlockCount = await patient.locator('li.transcript-block').count();
        evidence.visibleInsightTriggerCount = await patient.locator('button.transcript-insight').count();
        assert(evidence.visibleInsightTriggerCount > 0, 'Nenhum gatilho de insight visível: ' + s.id);
        const firstTrigger = patient.locator('button.transcript-insight').first();
        await firstTrigger.click();
        const openSources = patient.locator('.insight-balloon[open] .insight-source');
        await openSources.first().waitFor({ state: 'visible', timeout: 30_000 });
        evidence.visibleInsightSourceCount = await openSources.count();
        evidence.renderedInsightSourceCount = await patient.locator('.insight-source').count();
        const visibleTitles = await openSources.locator('p strong').evaluateAll(nodes => nodes.map(node => node.textContent?.trim() || ''));
        const allowedTitles = new Set(s.sources.map(source => source.title));
        evidence.insightSourceMismatchCount = visibleTitles.filter(title => !allowedTitles.has(title)).length;
        assert(evidence.visibleInsightSourceCount > 0 && evidence.insightSourceMismatchCount === 0,
          'Cartão visível sem fonte do conjunto selecionado: ' + s.id);
        const review = patient.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho ouvindo o áudio.', exact: true });
        progress(s.id, 'confirmando revisão simulada pelo oráculo');
        await review.waitFor({ state: 'visible' });
        const reviewDeadline = Date.now() + 90 * 60_000;
        while (!await review.isEnabled()) {
          assert(Date.now() < reviewDeadline, 'A revisão simulada pelo oráculo expirou.');
          await wait(500);
        }
        if (await review.isChecked()) await review.uncheck();
        await review.check();
        assert(await review.isChecked(), 'A revisão simulada pelo oráculo não foi refletida na interface.');
        evidence.reviewMode = 'fixture_oracle_simulated';
        evidence.reviewSimulatedAt = now();
        await patient.getByRole('button', { name: 'Salvar transcrição', exact: true }).click();
        await patient.getByText('Transcrição salva no prontuário. Somente texto, tempos e identificação das falas foram armazenados.', { exact: true }).waitFor();
        await saveJson(s.id + '-evidence.json', evidence);
        entry.transcriptSaved = true; await saveCheckpoint();
      }
      const closed = patient.getByText('Sessão encerrada', { exact: true });
      if (await closed.count()) assert(entry.noteSaved, 'Sessão encerrada sem evidência da nota salva.');
      else if (!entry.noteSaved) {
        progress(s.id, 'salvando nota de ensaio');
        await patient.getByRole('link', { name: 'Nota', exact: true }).click();
        const noteField = patient.getByRole('textbox', { name: 'Subjetivo 1', exact: true });
        await noteField.waitFor({ state: 'visible' });
        const noteText = 'ENSAIO AUTOMATIZADO ' + s.id + ' tentativa ' + entry.attempt + '. Áudio e paciente sintéticos. Texto e papéis comparados ao oráculo sintético; revisão simulada. Sem diagnóstico ou aceitação clínica dos cartões.';
        const existingNote = await noteField.inputValue();
        assert(existingNote === '' || existingNote === noteText, 'Nota existente diverge; edição automática bloqueada.');
        if (existingNote !== noteText) {
          await noteField.fill(noteText);
          await patient.getByRole('button', { name: 'Salvar nota', exact: true }).click();
          await patient.getByText('Nota salva no prontuário.', { exact: true }).waitFor();
        }
        entry.noteSaved = true; await saveCheckpoint();
      }
      if (!await closed.count()) {
        progress(s.id, 'encerrando sessão');
        await patient.getByRole('button', { name: 'Encerrar sessão', exact: true }).click();
        await closed.waitFor();
      }
      entry.closedAt = now(); evidence.finishedAt = now();
      await saveJson(s.id + '-evidence.json', evidence);
      entry.completed = true; await saveCheckpoint();
    } finally {
      clearInterval(pulse); patient.off('websocket', onSocket); patient.off('response', onResponse); patient.off('pageerror', onError);
      for (const [socket, listener] of sockets) socket.off('framereceived', listener);
    }
  }
  sim.loteRunning = true;
  sim.loteTask = (async () => {
    await saveCheckpoint();
    progress(null, 'aguardando liberação explícita do ASR');
    while (!sim.allowASR) await wait(1000);
    assert(!sim.firstRunning, 'Cancele o primeiro job antes de iniciar o lote; não execute dois produtores de áudio.');
    for (const s of manifest.sessions) {
      if (sim.lotePause) { progress(s.id, 'pausado entre atendimentos'); return; }
      const entry = checkpoint.sessions[s.id] ??= {};
      entry.attempt = safeCount(entry.attempt, 1) || 1;
      if (entry.evidence?.audioStartedAt && !entry.transcriptSaved) {
        assert(entry.url && entry.patientName, 'Tentativa com áudio sem endereço reconciliável; retomada bloqueada.');
        await openRecordedSession(s, entry);
        const persisted = await patient.evaluate(() => {
          const fields = [...document.querySelectorAll('textarea')].filter(node =>
            /^Texto aos /u.test(node.getAttribute('aria-label') || [...(node.labels || [])].map(label => label.textContent.trim()).join(' ')));
          const body = document.body.innerText || '';
          return { nonemptyFields: fields.filter(field => field.value.trim().length > 0).length,
            transcriptBlockCount: document.querySelectorAll('li.transcript-block').length,
            completeStatus: body.includes('Transcrição concluída. Confirme os papéis das vozes.'),
            savedStatus: body.includes('Transcrição salva no prontuário.'), closed: body.includes('Sessão encerrada') };
        });
        assert(persisted.nonemptyFields === 0 && persisted.transcriptBlockCount === 0 && !persisted.completeStatus && !persisted.savedStatus && !persisted.closed,
          'A tentativa anterior contém dados de sessão; reconciliação explícita necessária antes de repetir o áudio.');
        const attempt = entry.attempt;
        entry.abandonedAttempts ??= [];
        if (!entry.abandonedAttempts.some(row => row.attempt === attempt)) entry.abandonedAttempts.push({
          attempt, at: now(), reason: 'partial_audio_not_saved', url: entry.url, patientName: entry.patientName,
          audioStartedAt: entry.evidence.audioStartedAt,
          finalWordCount: safeCount(entry.evidence.websocketMetrics?.finalWordCount),
          insightCount: safeCount(entry.evidence.insights?.length), errorCount: safeCount(entry.evidence.errors?.length),
        });
        entry.attempt++;
        delete entry.url; delete entry.patientName; delete entry.evidence; delete entry.transcriptSaved; delete entry.noteSaved; delete entry.closedAt; delete entry.completed;
        await saveCheckpoint();
      }
      if (entry.completed) { assert(entry.transcriptSaved && entry.noteSaved && entry.closedAt && entry.evidence?.transcriptMetrics?.fixtureOracleMatch &&
        entry.evidence?.fixtureOracle === 'authored-turns-v1' && entry.evidence?.reviewMode === 'fixture_oracle_simulated' &&
        entry.evidence?.reviewSimulatedAt, 'Checkpoint sem prova de conclusão e revisão pelo oráculo: ' + s.id); continue; }
      await processSession(s, entry);
    }
    assert(manifest.sessions.every(s => checkpoint.sessions[s.id]?.completed), 'Lote incompleto.');
    checkpoint.finishedAt = now(); await saveCheckpoint(); progress(null, '100 atendimentos concluídos com evidência');
  })().catch(async error => {
    sim.loteError = errorKind(error);
    if (errorKind(error) === 'FixtureOracleMismatch') {
      sim.loteOraclePause = {
        id: sim.loteProgress?.id,
        reason: 'fixture_oracle_mismatch',
        textMismatchCount: safeCount(error.textMismatchCount),
        roleMismatchCount: safeCount(error.roleMismatchCount),
      };
      progress(sim.loteProgress?.id, 'pausado por divergência do oráculo sintético');
    } else progress(sim.loteProgress?.id, 'falhou');
    checkpoint.lastError = { at: now(), kind: errorKind(error), progress: sanitizeProgress(sim.loteProgress) };
    try { await saveCheckpoint(); } catch (saveError) { sim.loteSaveError = errorKind(saveError); }
  }).finally(() => { sim.loteRunning = false; });
  return { started: true, gatedByAllowASR: !sim.allowASR, checkpoint: root + '/' + checkpointName, status: 'page.__sim.loteProgress; pause entre sessões: page.__sim.lotePause = true; retomada após reiniciar: page.__sim.loteResumePath = caminho do checkpoint' };
}
