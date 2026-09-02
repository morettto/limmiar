import type { Locator } from '@playwright/test'

export interface OverflowViolation {
  description: string
  textSnippet: string
  axis: 'x' | 'y'
  scrollSize: number
  clientSize: number
}

/**
 * AC3 (S00.5-04): reporta um eixo cujo conteúdo estoura a caixa (tolerância de 1px)
 * E é de facto cortado — `overflow: hidden|clip` sem ellipsis nem line-clamp.
 * `visible`, scroll e truncagem com affordance são benignos. Assume zero portais.
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
