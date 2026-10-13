import { test, type TestInfo } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Origem = 'real' | 'simulado'

interface Linha { numero: number; passo: string; origem: Origem; ok: boolean; ms: number; erro?: string }

/** Marca cada passo do roteiro com resultado e tempo, e escreve o relatório que o dono lê. */
export class Relatorio {
  private readonly linhas: Linha[] = []
  private readonly medidas: [string, string][] = []
  private readonly fronteiras: string[] = []
  private readonly console: string[] = []

  fronteira(descricao: string): void { this.fronteiras.push(descricao) }
  medida(nome: string, valor: string): void { this.medidas.push([nome, valor]) }
  erroDoConsole(texto: string): void { this.console.push(texto.slice(0, 300)) }

  async passo<T>(nome: string, origem: Origem, corpo: () => Promise<T>): Promise<T> {
    const inicio = Date.now()
    const registrar = (ok: boolean, erro?: unknown) => this.linhas.push({
      numero: this.linhas.length + 1, passo: nome, origem, ok, ms: Date.now() - inicio,
      erro: erro === undefined ? undefined : String(erro instanceof Error ? erro.message : erro).split('\n')[0],
    })
    try {
      const resultado = await test.step(nome, corpo)
      registrar(true)
      return resultado
    } catch (erro) {
      registrar(false, erro)
      throw erro
    }
  }

  markdown(): string {
    const falhou = this.linhas.some((linha) => !linha.ok)
    const segundos = (ms: number) => `${(ms / 1000).toFixed(1)} s`
    return [
      '# Atendimento simulado: relatório do roteiro',
      '',
      `Resultado: **${falhou ? 'FALHOU' : 'OK'}**, ${this.linhas.length} passos, ${segundos(this.linhas.reduce((soma, linha) => soma + linha.ms, 0))} no total.`,
      '',
      '| # | Passo | Resultado | Tempo | Origem |',
      '|---|-------|-----------|-------|--------|',
      ...this.linhas.map((linha) => `| ${linha.numero} | ${linha.passo} | ${linha.ok ? 'ok' : `FALHOU: ${linha.erro}`} | ${segundos(linha.ms)} | ${linha.origem} |`),
      '',
      '"real" = o app falou com o serviço verdadeiro (API .NET, Postgres, navegador). "simulado" = a fronteira de rede foi substituída.',
      '',
      '## Fronteiras simuladas',
      ...this.fronteiras.map((fronteira) => `- ${fronteira}`),
      '',
      '## Medidas',
      ...this.medidas.map(([nome, valor]) => `- ${nome}: ${valor}`),
      '',
    ].join('\n')
  }

  async salvar(info: TestInfo): Promise<string> {
    const pasta = fileURLToPath(new URL('../../../test-results/atendimento-simulado', import.meta.url))
    mkdirSync(pasta, { recursive: true })
    const arquivo = join(pasta, 'relatorio.md')
    const texto = this.markdown()
    writeFileSync(arquivo, texto, 'utf8')
    await info.attach('relatorio.md', { body: texto, contentType: 'text/markdown' })
    return arquivo
  }
}
