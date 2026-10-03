import type { ReactNode } from 'react'

/** Visually hidden table view of a chart's data, for screen readers. */
export function SrDataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    // Wrapped: a table ignores the 1px width of .sr-only and would widen the page.
    <div className="sr-only">
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}
