import { defineConfig, devices } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codificarWav } from '../../packages/audio/src/wav'
import base from './playwright.config'
import { planoDaCarga } from './e2e/fixtures/atendimento/carga-plano'
import { montarAtendimentoDe } from './e2e/fixtures/atendimento/roteiro'
import { falar, VOZ_PROFISSIONAL } from './e2e/fixtures/atendimento/voz-sintetica'

// Carga ponta a ponta com o copiloto real (mvp-copiloto + Laya) e o produto inteiro: um profissional por tema prepara o
// acervo e, depois dele, as sessões do tema rodam uma após a outra; os temas correm em paralelo (um worker cada). O fluxo
// inteiro de trauma (profissional e as 5 sessões) abre janela; o resto roda sem janela. Uso: pnpm exec playwright test -c playwright.carga.config.ts

const plano = planoDaCarga()
const pasta = join(tmpdir(), 'limmiar-e2e-carga')
mkdirSync(pasta, { recursive: true })
const perfil = join(pasta, 'perfil-profissional.wav')
writeFileSync(perfil, codificarWav(falar(VOZ_PROFISSIONAL, 60)))
const VISIVEIS = new Set(['trauma'])
const microfone = (arquivo: string) => ({
  permissions: ['microphone'], locale: 'pt-BR', actionTimeout: 120_000,
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${arquivo}`] },
})

// CARGA_RETOMAR=sessao-012,... roda só essas sessões, com os profissionais já criados (conta-*.json), encadeadas por tema
const RETOMAR = process.env.CARGA_RETOMAR ? new Set(process.env.CARGA_RETOMAR.split(',')) : null
const projetos = plano.profissionais.filter(() => RETOMAR === null).map((p) => ({
  name: `profissional-${p.tema}`, testMatch: /carga-profissional\.spec\.ts/, metadata: { tema: p.tema }, timeout: 120 * 60_000,
  use: { ...devices['Desktop Chrome'], ...microfone(perfil), headless: !VISIVEIS.has(p.tema) },
}))
for (const s of plano.sessoes.filter((o) => RETOMAR === null || RETOMAR.has(o.id))) {
  const audio = join(pasta, `${s.id}.wav`)
  writeFileSync(audio, codificarWav(montarAtendimentoDe(s.turnos).audio))
  const anterior = plano.sessoes.filter((o) => o.tema === s.tema && o.ordem < s.ordem && (RETOMAR === null || RETOMAR.has(o.id))).at(-1)
  projetos.push({
    name: `sessao-${s.id}`, testMatch: /carga-sessao\.spec\.ts/, metadata: { sessao: s.id }, timeout: 30 * 60_000,
    dependencies: anterior ? [`sessao-${anterior.id}`] : RETOMAR === null ? [`profissional-${s.tema}`] : [],
    use: { ...devices['Desktop Chrome'], ...microfone(audio), headless: !VISIVEIS.has(s.tema) },
  } as (typeof projetos)[number])
}

// A API confere com o copiloto que a obra está preparada antes de autorizá-la e de reservá-la na sessão
// (MaterialReadiness); no E2E simulado ninguém responde ali, aqui é o copiloto real.
const servidores = (Array.isArray(base.webServer) ? base.webServer : [base.webServer!]).map((servidor) =>
  servidor.command.includes('dotnet run')
    ? { ...servidor, env: { ...servidor.env, Copiloto__BaseUrl: process.env.COPILOTO_REAL_URL ?? 'http://127.0.0.1:8000' } }
    : servidor)

export default defineConfig({
  ...base,
  webServer: servidores,
  testIgnore: [],
  testMatch: /carga-(profissional|sessao)\.spec\.ts/,
  fullyParallel: false,
  workers: plano.profissionais.length,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: join(pasta, 'resultado.json') }]],
  projects: projetos,
})
