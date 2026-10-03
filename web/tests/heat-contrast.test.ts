import fs from 'node:fs'
import path from 'node:path'
import { contrastRatio, hexToOklch, oklchToHex } from '@/design/color'

// Heatmap/Field cells render foreground text on `color-mix(in oklch, <pole> p%, <base>)` with p ≤ 70
// (see divergingFill/sequentialFill). Verify that text stays ≥ 4.5:1 across the whole scale.
const css = fs.readFileSync(path.resolve(__dirname, '../src/design/tokens.css'), 'utf8')
const block = (sel: RegExp) => css.slice(css.search(sel), css.indexOf('}', css.search(sel)))
const THEMES = { light: block(/:root,\s*\.light\s*\{/), dark: block(/\n\.dark\s*\{/) }
const token = (b: string, name: string) => {
  const v = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(b)?.[1]
  if (!v) throw new Error(`missing --${name}`)
  return v
}

/** CSS color-mix(in oklch, a p%, b): lerp L, C, and hue along the shorter arc (powerless hue → other's). */
function mixOklch(a: string, b: string, p: number): string {
  const [l1, c1, h1] = hexToOklch(a)
  const [l2, c2, h2] = hexToOklch(b)
  const ha = c1 < 0.02 ? h2 : h1
  const hb = c2 < 0.02 ? h1 : h2
  let dh = hb - ha
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  const t = 1 - p
  return oklchToHex([l1 + (l2 - l1) * t, c1 + (c2 - c1) * t, (ha + dh * t + 360) % 360])
}

describe.each(Object.entries(THEMES))('%s theme heat fills keep text ≥ 4.5:1', (_theme, b) => {
  const fg = token(b, 'foreground')
  const steps = Array.from({ length: 15 }, (_, i) => i * 0.05) // 0 … 0.70

  it.each(['div-pos', 'div-neg'])('diverging %s', (pole) => {
    for (const p of steps) expect(contrastRatio(mixOklch(token(b, pole), token(b, 'div-mid'), p), fg), `p=${p}`).toBeGreaterThanOrEqual(4.5)
  })
  it('sequential', () => {
    for (const p of steps) expect(contrastRatio(mixOklch(token(b, 'seq-high'), token(b, 'seq-low'), p), fg), `p=${p}`).toBeGreaterThanOrEqual(4.5)
  })
})
