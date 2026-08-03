import { expect, test } from '@playwright/experimental-ct-react'
import { findOverflowViolations } from './overflow'

// Texto longo e sem espaço — força estouro horizontal real em vez de quebra
// de linha saudável, que é o que este helper NÃO deve pegar.
const UNBREAKABLE_TEXT = 'X'.repeat(80)

test('clipping real sem ellipsis é pego', async ({ mount }) => {
  // height:30 é folgada o bastante pra 1 linha de texto (~24px de
  // line-height) não estourar também no eixo y — este teste é sobre o
  // estouro horizontal específico, não sobre os dois eixos ao mesmo tempo.
  const component = await mount(
    <div style={{ width: 100, height: 30, overflow: 'hidden', whiteSpace: 'nowrap' }}>{UNBREAKABLE_TEXT}</div>,
  )

  const violations = await findOverflowViolations(component)

  expect(violations).toHaveLength(1)
  expect(violations[0]?.axis).toBe('x')
})

test('clipping com text-overflow: ellipsis não é pego', async ({ mount }) => {
  const component = await mount(
    <div
      style={{
        width: 100,
        height: 20,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
    >
      {UNBREAKABLE_TEXT}
    </div>,
  )

  expect(await findOverflowViolations(component)).toEqual([])
})

// Achado real ao instrumentar AdaptiveNav.spec.tsx: um wrapper de altura
// fixa com overflow padrão (visible) e conteúdo mais alto que a caixa NÃO
// deve contar como violação — nada é cortado, o conteúdo só continua visível
// abaixo da borda declarada da caixa.
test('estouro com overflow: visible (padrão) não é clipping — não é pego', async ({ mount }) => {
  const component = await mount(
    <div style={{ width: 200, height: 20 }}>
      <div style={{ height: 60 }}>{UNBREAKABLE_TEXT.slice(0, 10)}</div>
    </div>,
  )

  expect(await findOverflowViolations(component)).toEqual([])
})

test('overflow-x: auto (região scrollável) não é pego', async ({ mount }) => {
  const component = await mount(
    <div style={{ width: 100, height: 20, overflowX: 'auto', whiteSpace: 'nowrap' }}>{UNBREAKABLE_TEXT}</div>,
  )

  expect(await findOverflowViolations(component)).toEqual([])
})

// Com espaço (quebrável) — ao contrário de UNBREAKABLE_TEXT, este texto pode
// quebrar linha normalmente sob um maxWidth, então a caixa só cresce em
// altura (reflow saudável), nunca estoura sua própria largura.
const WRAPPABLE_TEXT = 'palavra '.repeat(60)

test('reflow livre sem altura/largura fixa não é pego (falso positivo sob texto longo)', async ({ mount }) => {
  const component = await mount(<div style={{ maxWidth: 300 }}>{WRAPPABLE_TEXT}</div>)

  expect(await findOverflowViolations(component)).toEqual([])
})
