// A pomodoro the band can show (the owner 2026-10-21 s44 「比如說什麼蕃茄鐘呢不要時間」, then 「蕃茄鐘現在做」, off the drawn draft
// docs/teach/20-pomodoro.py). Pure values and pure drawing here, as hooks/lang and hooks/profiles are: register.tsx keeps the
// state in the settings (so it survives a turn, a reload and a new session) and draws the module.
//
// The digits are seven segments of rectangles, not letters: whether this desktop's SVG takes a font of its own has never been
// measured in this project (s44), and segments need none.

export const FOCUS_MS = 25 * 60 * 1000
export const BREAK_MS = 5 * 60 * 1000

// state: what it is doing. endsAt: when a running one ends. leftMs: what was left when it was paused. done: finished pomodoros.
export type Pomo = {
  state: 'idle' | 'run' | 'pause' | 'break'
  endsAt?: number
  leftMs?: number
  done: number
}
export type PomoVerb = 'start' | 'pause' | 'reset' | 'break'

export const NO_POMO: Pomo = { state: 'idle', done: 0 }

// What is left on the clock right now; an idle one shows a whole pomodoro, which is what the card says before it is started.
export function pomoLeft(p: Pomo, now: number): number {
  if (p.state === 'pause') return Math.max(0, p.leftMs ?? 0)
  if (p.state === 'run' || p.state === 'break') return Math.max(0, (p.endsAt ?? now) - now)
  return 0
}

// mm:ss, never negative; a second that has begun is still shown, so 1 ms left reads 00:01 and not 00:00.
export function clockText(leftMs: number): string {
  const ms = leftMs <= 0 ? FOCUS_MS : leftMs
  const secs = Math.ceil(ms / 1000)
  const mm = Math.floor(secs / 60)
  const ss = secs % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

// A press: start (or carry on from a pause), pause, reset, or take a break. The count of finished ones is never touched here.
export function pomoNext(p: Pomo, verb: PomoVerb, now: number): Pomo {
  switch (verb) {
    case 'start': {
      const left = p.state === 'pause' ? Math.max(0, p.leftMs ?? 0) : FOCUS_MS
      return { state: 'run', endsAt: now + (left === 0 ? FOCUS_MS : left), done: p.done }
    }
    case 'pause':
      return p.state === 'run' || p.state === 'break'
        ? { state: 'pause', leftMs: pomoLeft(p, now), done: p.done }
        : p
    case 'break':
      return { state: 'break', endsAt: now + BREAK_MS, done: p.done }
    case 'reset':
      return { state: 'idle', done: p.done }
  }
}

// The state once the clock has caught up with it: a pomodoro that ran out is counted and goes quiet; a break that ran out is
// not counted. Anything still running is left as it is.
export function pomoAfter(p: Pomo, now: number): Pomo {
  if ((p.state !== 'run' && p.state !== 'break') || (p.endsAt ?? Infinity) > now) return p
  return { state: 'idle', done: p.state === 'run' ? p.done + 1 : p.done }
}

// ── the drawing ────────────────────────────────────────────────────────────────
// which of the seven segments each digit lights
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd',
}
const px = (n: number) => Math.round(n * 10) / 10

export type SegBox = { x: number; y: number; w: number; h: number }

// Style C (the owner 「數字用 C」, 2026-10-21, off three versions drawn at the real tile size, docs/teach/22-pomo-styles.py): a digit
// is TALLER than wide (0.52 of its height, a real display's proportion — the first version filled the width and he said so);
// each lit segment is a hexagon with pointed ends, the classic LCD stroke, thin (0.11 of the height); the whole clock leans a
// little to the right; an unlit segment is not drawn at all. The clock is centred in its box and shrunk to fit a narrow one, the
// lean's room counted in so no corner leaves the box.
const DIGIT_ASPECT = 0.52
const STROKE = 0.11
const LEAN = 0.08

function hexagon(x: number, y: number, w: number, h: number, horizontal: boolean, lean: number, baseline: number): string {
  const pts: [number, number][] = horizontal
    ? [[x, y + h / 2], [x + h / 2, y], [x + w - h / 2, y], [x + w, y + h / 2], [x + w - h / 2, y + h], [x + h / 2, y + h]]
    : [[x + w / 2, y], [x + w, y + w / 2], [x + w, y + h - w / 2], [x + w / 2, y + h], [x, y + h - w / 2], [x, y + w / 2]]
  return `<polygon points="${pts.map(([ax, ay]) => `${px(ax + (baseline - ay) * lean)},${px(ay)}`).join(' ')}"/>`
}

export function segmentsOf(text: string, box: SegBox, colour: string): string {
  const digits = [...text].filter(c => c !== ':').length
  const colons = [...text].filter(c => c === ':').length
  if (digits === 0) return ''
  // the height a digit can take: its own, or less when the width (the lean's room included) is the tighter of the two
  const units = digits * DIGIT_ASPECT + colons * 0.3 + (digits + colons - 1) * 0.12 + LEAN
  const dh = Math.max(6, Math.min(box.h, box.w / units))
  const dw = dh * DIGIT_ASPECT
  const gap = dh * 0.12
  const colonW = dh * 0.3
  const t = Math.max(1.5, dh * STROKE)
  const width = dw * digits + colonW * colons + gap * (digits + colons - 1) + dh * LEAN
  let x = box.x + (box.w - width) / 2
  const y = box.y + (box.h - dh) / 2
  const baseline = y + dh
  const out: string[] = [`<g fill="${colour}">`]
  for (const ch of text) {
    if (ch === ':') {
      const cx = x + colonW / 2
      for (const dy of [dh * 0.32, dh * 0.68]) out.push(`<circle cx="${px(cx + (baseline - (y + dy)) * LEAN)}" cy="${px(y + dy)}" r="${px(t * 0.42)}"/>`)
      x += colonW + gap
      continue
    }
    const on = SEGMENTS[ch] ?? ''
    const g = t * 0.18
    const h2 = (dh - t) / 2
    const bars: [string, number, number, number, number, boolean][] = [
      ['a', x + g, y, dw - 2 * g, t, true],
      ['g', x + g, y + h2, dw - 2 * g, t, true],
      ['d', x + g, y + dh - t, dw - 2 * g, t, true],
      ['f', x, y + g, t, h2 - 2 * g + t * 0.5, false],
      ['b', x + dw - t, y + g, t, h2 - 2 * g + t * 0.5, false],
      ['e', x, y + h2 + t * 0.5 + g, t, h2 - 2 * g + t * 0.5, false],
      ['c', x + dw - t, y + h2 + t * 0.5 + g, t, h2 - 2 * g + t * 0.5, false],
    ]
    for (const [name, bx, by, bw, bh, horizontal] of bars) if (on.includes(name)) out.push(hexagon(bx, by, bw, bh, horizontal, LEAN, baseline))
    x += dw + gap
  }
  out.push('</g>')
  return out.join('')
}
