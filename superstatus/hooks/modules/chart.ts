// Drawing a tile's chart (the owner 2026-10-12 s35 「H3 以上的可以畫一些圖表或是做成漂亮一點的介面給我看嗎」): an SVG document as text, which
// the desktop draws as an image (no script, no web font). The colours are the status line's tones (the dials' green, yellow and red), the
// dials' dark disc as the panel behind, light and mid greys on it, and a blue and a purple for what has no tone (GitHub's dark palette,
// as the tones are).
import { estimateEm } from '../labels'
import type { ChartBox } from './types'

export const FONT = '-apple-system,system-ui,sans-serif'
export const COLOUR = {
  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
  blue: '#58a6ff',
  purple: '#bc8cff',
  panel: '#262626',
  track: '#808080',
  text: '#f2f2f2',
  light: '#c9d1d9',
  dim: '#8a8a8a',
} as const

// The day colours (s39, the owner's day mode 「我如果改成daymode 還是黑卡耶」; 14.webp-16.webp: an SVG image follows the app's day and night through
// prefers-color-scheme, and a rule on [fill="…"] overrides the attribute; 「可以」 on the swatches): each dark colour's counterpart in GitHub's
// light palette, as the dark ones are its dark palette. The track's grey stays; the add-card pane's chosen place (#b1b9f9) takes the day blue.
export const DAY: Readonly<Record<string, string>> = {
  '#262626': '#f6f8fa',
  '#f2f2f2': '#1f2328',
  '#c9d1d9': '#424a53',
  '#8a8a8a': '#656d76',
  '#3fb950': '#1a7f37',
  '#d29922': '#9a6700',
  '#f85149': '#cf222e',
  '#58a6ff': '#0969da',
  '#bc8cff': '#8250df',
  '#b1b9f9': '#0969da',
}
const DAY_STYLE =
  '<style>@media (prefers-color-scheme: light){' +
  Object.entries(DAY).map(([dark, day]) => `[fill="${dark}"]{fill:${day}}[stroke="${dark}"]{stroke:${day}}`).join('') +
  '}</style>'
// An SVG document with its day colours: the rules right after its opening tag (every Svg the mod draws goes through it)
export const withDay = (source: string) => source.replace(/^<svg[^>]*>/, open => open + DAY_STYLE)

// Words from files (a journal line, a branch, a mount) go into markup escaped.
export const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A coordinate or a length: one decimal, never NaN.
export const px = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0)

// The status line's tones (session status, s27): what is used turns yellow from 60% and red from 85%; what is left yellow under 30% and
// red under 10%; nothing read is grey.
export const usedTone = (p: number | undefined) => (p === undefined ? COLOUR.dim : p >= 85 ? COLOUR.error : p >= 60 ? COLOUR.warning : COLOUR.success)
export const leftTone = (p: number | undefined) => (p === undefined ? COLOUR.dim : p < 10 ? COLOUR.error : p < 30 ? COLOUR.warning : COLOUR.success)
export const pct = (p: number | undefined) => (p === undefined ? '?' : `${Math.round(p)}%`)
const clamp = (p: number) => Math.max(0, Math.min(100, p))

// The document: the box's size in CSS px, a rounded dark panel filling it, then the body.
export function svg(box: ChartBox, body: string): string {
  const w = Math.max(1, Math.round(box.width))
  const h = Math.max(1, Math.round(box.height))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" rx="10" fill="${COLOUR.panel}"/>${body}</svg>`
  )
}

type TextStyle = { size?: number; colour?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; extra?: string }

// A line of text whose baseline is at y.
export function text(x: number, y: number, content: string, style: TextStyle = {}): string {
  const { size = 12, colour = COLOUR.light, anchor = 'start', weight = 400, extra = '' } = style
  return (
    `<text x="${px(x)}" y="${px(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${px(size)}" font-weight="${weight}" ` +
    `fill="${colour}"${extra}>${esc(content)}</text>`
  )
}

// A chart's head (s37, the owner's 17.webp: the Jev chart's 「Jev this month 2 · <$0.01」 drawn over 「Today 2」 in a 206 px tile): its left words
// in bold, its right ones at the right end in their colour; the left squeezed into the room the right leave (the letter-by-letter estimate,
// a bold 5% wider, a gap of 8 px), so the two never overlap; with room enough nothing is squeezed.
export function headRow(box: ChartBox, pad: number, size: number, left: string, right: string, rightColour: string): string {
  return shrinkRow(box, pad, pad + size, size, left, right, rightColour)
}

// A chart's head, two texts on one line (s37; reshaped s44 on the owner's 「乙，整行字變小」 after he saw his own narrow band): the right
// one at the right end, the left one at the left. When the two do not fit, the WHOLE line is drawn a size smaller — both texts
// together, so they stay the same size as each other — down to HEAD_MIN_SIZE. A glyph is never pressed thin (s37 gave the left words
// an SVG textLength with lengthAdjust="spacingAndGlyphs", which is what he reported as 「被擠」). At the floor, where nothing else can
// give, the left words are cut with an ellipsis, as a card's words are. The H2 tiles' own pair (barTile) keeps the s39 look: his
// ruling was made on the chart head he was shown, and that is the only place it is applied.
const HEAD_MIN_SIZE = 7
const HEAD_GAP = 8
const lineWidth = (left: string, right: string, size: number) =>
  estimateEm(left) * size * 1.05 + (right === '' ? 0 : HEAD_GAP + estimateEm(right) * size)

export function shrinkRow(
  box: ChartBox, pad: number, y: number, size: number, left: string, right: string, rightColour: string,
  leftStyle: { weight?: number; colour?: string } = {},
): string {
  const { weight = 600, colour = COLOUR.light } = leftStyle
  const room = box.width - 2 * pad
  const wanted = lineWidth(left, right, size)
  // the gap between the two texts is a fixed number of pixels and does not shrink with them, so it is taken off both sides of the
  // ratio; without that the line is still a few pixels too long after shrinking and the left words were cut for nothing
  const fixed = right === '' ? 0 : HEAD_GAP
  const fitted = wanted <= room ? size : Math.max(HEAD_MIN_SIZE, (size * Math.max(1, room - fixed)) / Math.max(1, wanted - fixed))
  const forLeft = room - (right === '' ? 0 : HEAD_GAP + estimateEm(right) * fitted)
  let shown = left
  // a hair of tolerance: where the line was shrunk to fit, the left words fill their room exactly and a float must not cut them
  if (estimateEm(shown) * fitted * 1.05 > forLeft + 0.5) {
    // take a character off until what is left, with its ellipsis, fits; a box too narrow even for that empties it, and the left
    // words simply go — the value is what the tile is for. One rule, no special case for the last character (s44 mutant P6: the
    // old `length > 1` guard made a difference nothing could see, because the give-way below swallowed it).
    while (shown !== '' && estimateEm(`${shown}…`) * fitted * 1.05 > forLeft) shown = shown.slice(0, -1)
    shown = shown === '' ? '' : `${shown}…`
  }
  return (
    (shown === '' ? '' : text(pad, y, shown, { size: fitted, colour, weight })) +
    (right === '' ? '' : text(box.width - pad, y, right, { size: fitted, colour: rightColour, anchor: 'end' }))
  )
}

// Two texts on one line at baseline y. Since s44 (the owner's 「OK」 on the drawn pair) this is shrinkRow for everyone: the H2 tiles
// followed the chart head, so no line in the band presses its glyphs thin. s37's and s39's textLength squeeze is gone.
export function pairRow(
  box: ChartBox, pad: number, y: number, size: number, left: string, right: string, rightColour: string,
  leftStyle: { weight?: number; colour?: string } = {},
): string {
  return shrinkRow(box, pad, y, size, left, right, rightColour, leftStyle)
}

// An H2 tile's room (s39, his 1.webp: an H2 frame 67 px, a chart box 30 CSS px high): the margin, the words' size on their line, and the
// bar's place under them.
export function tileRoom(box: ChartBox): { pad: number; size: number; barY: number; barH: number } {
  const pad = Math.max(4, Math.min(8, box.height * 0.16))
  const size = Math.max(9, Math.min(12, box.height * 0.36))
  const barH = Math.max(3, Math.min(8, box.height * 0.17))
  return { pad, size, barY: box.height - pad - barH, barH }
}

// A tile of a percent (s39, B): the words and the value on one line, a bar of it under them.
export function barTile(box: ChartBox, words: string, value: string, percent: number | undefined, colour: string): string {
  const { pad, size, barY, barH } = tileRoom(box)
  return svg(
    box,
    pairRow(box, pad, pad + size, size, words, value, COLOUR.text, { weight: 400 }) + bar(pad, barY, box.width - 2 * pad, barH, percent, colour),
  )
}

// A tile's words, the part of a line before its value (s39): the value is given as MARK; words that put the value first fall back.
export const MARK = '\u0001'
export const wordsBefore = (line: string, fallback: string) => (line.split(MARK)[0] ?? '').trim() || fallback

// A ring open at the bottom, as the Status Line's dials (s27 「有缺口」): 270 degrees from the bottom left over the top; the arc is the
// percent of it (none at 0%), the value inside, the label in the opening below.
export function ring(cx: number, cy: number, r: number, percent: number | undefined, colour: string, value: string, label: string): string {
  const width = Math.max(3, r * 0.22)
  const round = 2 * Math.PI * r
  const sweep = 0.75 * round
  const turn = `fill="none" stroke-width="${px(width)}" stroke-linecap="round" transform="rotate(135 ${px(cx)} ${px(cy)})"`
  const arc = percent === undefined ? 0 : (sweep * clamp(percent)) / 100
  return (
    `<circle cx="${px(cx)}" cy="${px(cy)}" r="${px(r)}" stroke="${COLOUR.track}" stroke-opacity="0.28" ${turn} stroke-dasharray="${px(sweep)} ${px(round)}"/>` +
    (arc > 0 ? `<circle cx="${px(cx)}" cy="${px(cy)}" r="${px(r)}" stroke="${colour}" ${turn} stroke-dasharray="${px(arc)} ${px(round)}"/>` : '') +
    text(cx, cy + r * 0.16, value, { size: Math.max(9, r * 0.5), colour: COLOUR.text, anchor: 'middle', weight: 600 }) +
    text(cx, cy + r + Math.max(9, r * 0.36) * 0.35, label, { size: Math.max(9, r * 0.36), colour: COLOUR.dim, anchor: 'middle' })
  )
}

// A bar of a percent: the track, then the part filled (none at 0% or with nothing read).
export function bar(x: number, y: number, w: number, h: number, percent: number | undefined, colour: string): string {
  const fill = percent === undefined ? 0 : (Math.max(0, w) * clamp(percent)) / 100
  const r = px(h / 2)
  return (
    `<rect x="${px(x)}" y="${px(y)}" width="${px(Math.max(0, w))}" height="${px(h)}" rx="${r}" fill="${COLOUR.track}" fill-opacity="0.28"/>` +
    (fill > 0 ? `<rect x="${px(x)}" y="${px(y)}" width="${px(Math.max(fill, h))}" height="${px(h)}" rx="${r}" fill="${colour}"/>` : '')
  )
}

// Rings in a row, filling the box (s43): a head above them, one ring an item with its own number and label, and an
// optional line under them. The layout his office Mac's four modules worked out, made a shape a module file can name.
export function ringsChart(
  box: ChartBox,
  head: string,
  items: readonly { label: string; percent: number | undefined; value: string; colour: string }[],
  foot = '',
): string {
  const pad = Math.min(14, box.height * 0.12)
  const size = Math.max(9, Math.min(12, box.height * 0.11))
  const under = Math.max(9, Math.min(11, box.height * 0.08))
  const top = pad + size * 1.6
  const bottom = box.height - pad - under * 1.6
  const n = Math.max(1, items.length)
  const r = Math.max(6, Math.min((box.width / (n + 1)) * 0.38, (bottom - top) * 0.38))
  const cy = top + (bottom - top) * 0.45
  const at = (k: number) => (box.width * (k + 1)) / (n + 1)

  return svg(
    box,
    (head === '' ? '' : headRow(box, pad, size, head, '', COLOUR.dim)) +
      items.map((it, k) => ring(at(k), cy, r, it.percent, it.colour, it.value, it.label)).join('') +
      (foot === '' ? '' : text(box.width / 2, box.height - pad, foot, { size: under, colour: COLOUR.dim, anchor: 'middle' })),
  )
}

// Labelled bars, one a row, filling the box: the label on the left, the bar, the value on the right.
export function barRows(box: ChartBox, rows: readonly { label: string; percent: number | undefined; value: string; colour: string }[]): string {
  if (rows.length === 0) return ''
  const pad = Math.min(14, box.height * 0.12)
  const pitch = (box.height - 2 * pad) / rows.length
  const size = Math.max(9, Math.min(13, pitch * 0.5))
  const labelW = Math.min(box.width * 0.3, Math.max(...rows.map(r => r.label.length)) * size * 0.62 + 6)
  const valueW = Math.min(box.width * 0.3, Math.max(...rows.map(r => r.value.length)) * size * 0.6 + 8)
  const barX = pad + labelW
  const barW = Math.max(0, box.width - 2 * pad - labelW - valueW)
  const barH = Math.max(3, Math.min(10, pitch * 0.32))
  return rows
    .map((row, k) => {
      const mid = pad + pitch * (k + 0.5)
      return (
        text(pad, mid + size * 0.35, row.label, { size, colour: COLOUR.dim }) +
        bar(barX, mid - barH / 2, barW, barH, row.percent, row.colour) +
        text(box.width - pad, mid + size * 0.35, row.value, { size, colour: COLOUR.text, anchor: 'end', weight: 600 })
      )
    })
    .join('')
}
