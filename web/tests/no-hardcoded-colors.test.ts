import fs from 'node:fs'
import path from 'node:path'

// Charts and the field must theme via tokens (var(--…)); a raw color literal would not re-theme.
const DIRS = ['src/components/charts', 'src/components/field']
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(tsx?|css)$/.test(d.name) ? [path.join(dir, d.name)] : []))
}

describe('no hard-coded colors in charts/field', () => {
  const root = path.resolve(__dirname, '..')
  const all = DIRS.flatMap((d) => files(path.join(root, d)))

  it('finds the component files', () => {
    expect(all.length).toBeGreaterThan(4)
  })

  it.each(all.map((f) => [path.relative(root, f), f]))('%s', (_rel, f) => {
    const offenders = fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .map((line, i) => ({ line: line.replace(/\/\/.*$/, ''), n: i + 1 }))
      .filter(({ line }) => COLOR.test(line) && !/url\(#/.test(line))
      .map(({ line, n }) => `${n}: ${line.trim()}`)
    expect(offenders).toEqual([])
  })
})
