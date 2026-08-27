import type { ReactNode } from 'react'
import { useBreakpoint } from './use-breakpoint'

export interface AdaptiveTableColumn {
  key: string
  header: string
  /** Collapses into the card's 2nd line below lg, instead of its own column. */
  secondary?: boolean
}

export interface AdaptiveTableRow {
  key: string
  /** One pre-built cell per column, aligned by index with `columns`. */
  cells: ReactNode[]
}

export interface AdaptiveTableProps {
  columns: AdaptiveTableColumn[]
  rows: AdaptiveTableRow[]
  caption?: string
}

/**
 * R3 — Tabelas: tabela (D/T paisagem) → cartão de 2 linhas por registro (T
 * retrato/M); colunas secundárias viram a 2ª linha.
 *
 * `rows[].cells` are pre-built ReactNode, not a `render(row)` callback: a
 * prop function that returns JSX and gets invoked inside the mounted
 * component can't cross Playwright Component Testing's mount() boundary
 * (see CalendarViewport for the same fix, and the ticket's Handoff for why).
 */
export function AdaptiveTable({ columns, rows, caption }: AdaptiveTableProps) {
  const breakpoint = useBreakpoint()
  const isTableLayout = breakpoint === 'xl' || breakpoint === 'lg'

  if (isTableLayout) {
    return (
      <table aria-label={caption} className="w-full border-collapse text-left">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="border-b border-neutral-300 p-2 text-xs text-neutral-500">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-neutral-200 pointer-coarse:h-11">
              {row.cells.map((cell, index) => (
                <td key={columns[index].key} className="p-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const primaryIndexes = columns.reduce<number[]>((acc, column, index) => {
    if (!column.secondary) acc.push(index)
    return acc
  }, [])
  const secondaryIndexes = columns.reduce<number[]>((acc, column, index) => {
    if (column.secondary) acc.push(index)
    return acc
  }, [])

  return (
    <ul aria-label={caption} className="flex flex-col gap-2">
      {rows.map((row) => (
        // min-h-16 (64px) matches the wireframe's own P2.1-M annotation:
        // "card inteiro é o alvo (≥64px)".
        <li key={row.key} className="min-h-16 rounded-lg border border-neutral-300 p-3">
          <div className="flex flex-wrap gap-x-2">
            {primaryIndexes.map((index) => (
              <span key={columns[index].key}>{row.cells[index]}</span>
            ))}
          </div>
          {secondaryIndexes.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-2 text-sm text-neutral-500">
              {secondaryIndexes.map((index) => (
                <span key={columns[index].key}>{row.cells[index]}</span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
