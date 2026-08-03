import type { Locator } from '@playwright/test'

export interface OverflowViolation {
  description: string
  textSnippet: string
  axis: 'x' | 'y'
  scrollSize: number
  clientSize: number
}

/**
 * AC3 (S00.5-04): "nenhum estouro de layout, nenhum texto cortado sem
 * reticências". Percorre todo elemento sob `root` e reporta qualquer eixo
 * (x/y) cujo conteúdo estoura a própria caixa (scrollWidth/Height >
 * clientWidth/Height, com tolerância de 1px pra anti-aliasing) E, nesse
 * mesmo eixo, o elemento de fato CORTA o conteúdo — não basta estourar.
 * Um eixo só conta como violação se o `overflow` computado NAQUELE eixo for
 * `hidden`/`clip` e não houver affordance visível de truncamento
 * (`text-overflow: ellipsis` ou `-webkit-line-clamp`). Um eixo é sempre
 * benigno quando:
 *  (a) `overflow: visible` (o padrão do CSS) — nada é escondido, o conteúdo
 *      só extrapola a caixa visualmente, o que não é "corte";
 *  (b) alcançável por scroll — `overflow-x/y: auto|scroll` (mesmo padrão de
 *      região-com-scroll do WCAG 2.1.1 que KpiStrip e o rail de dias do
 *      CalendarViewport já usam, já coberto pela regra
 *      scrollable-region-focusable do axe);
 *  (c) truncado com affordance visível (`text-overflow: ellipsis` +
 *      `overflow` não-visible, ou `-webkit-line-clamp`).
 *
 * (a) é o motivo de checar por eixo, não a caixa inteira de uma vez: um
 * `div` de altura fixa com `overflow: visible` (o padrão) e conteúdo mais
 * alto que a caixa tem `scrollHeight > clientHeight`, mas nada é cortado —
 * o conteúdo só continua visível abaixo da borda declarada da caixa. Sem
 * essa exceção, qualquer elemento de altura fixa cujo conteúdo cresça sob
 * pseudo-locale dispararia falso positivo, mesmo sem nenhum corte real.
 *
 * Elemento sem altura/largura fixa nunca dispara isso: sem uma restrição
 * explícita, scrollHeight/Width e clientHeight/Width ficam iguais por
 * construção — então isto só pega corte de verdade, não reflow saudável sob
 * expansão de texto do pseudo-locale.
 *
 * Assume zero portal React dentro de root (nenhuma das 7 primitivas usa
 * createPortal), então um simples querySelectorAll('*') a partir de root vê
 * todo descendente renderizado, incluindo fixed/absolute.
 */
export async function findOverflowViolations(root: Locator): Promise<OverflowViolation[]> {
  return root.evaluate((rootEl: HTMLElement) => {
    const TOLERANCE_PX = 1
    const violations: OverflowViolation[] = []
    const elements = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))]

    for (const el of elements) {
      const style = getComputedStyle(el)
      const overflowsX = el.scrollWidth - el.clientWidth > TOLERANCE_PX
      const overflowsY = el.scrollHeight - el.clientHeight > TOLERANCE_PX
      if (!overflowsX && !overflowsY) continue

      const isEllipsized = style.textOverflow === 'ellipsis' && style.overflow !== 'visible'
      const isLineClamped =
        style.display.includes('box') && !['none', ''].includes(style.getPropertyValue('-webkit-line-clamp'))
      const isBenign = (axisOverflow: string) =>
        axisOverflow === 'visible' || /(auto|scroll)/.test(axisOverflow) || isEllipsized || isLineClamped

      const classNames = typeof el.className === 'string' ? el.className.trim() : ''
      const description = `${el.tagName.toLowerCase()}${classNames ? `.${classNames.split(/\s+/).join('.')}` : ''}`
      const textSnippet = (el.textContent ?? '').trim().slice(0, 60)
      if (overflowsX && !isBenign(style.overflowX)) {
        violations.push({ description, textSnippet, axis: 'x', scrollSize: el.scrollWidth, clientSize: el.clientWidth })
      }
      if (overflowsY && !isBenign(style.overflowY)) {
        violations.push({ description, textSnippet, axis: 'y', scrollSize: el.scrollHeight, clientSize: el.clientHeight })
      }
    }
    return violations
  })
}
