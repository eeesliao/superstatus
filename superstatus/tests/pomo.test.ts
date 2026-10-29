import { describe, expect, test } from 'claude-code/testing'

import { FOCUS_MS, BREAK_MS, pomoAfter, pomoLeft, pomoNext, segmentsOf, clockText } from '../hooks/pomo'

// s44 (the owner 「蕃茄鐘現在做」, off the drawn draft): a pomodoro the band can show. The state is a plain value kept in the
// settings — what it is doing, when the running one ends, what was left when it was paused, and how many are done — so it
// survives a turn, a reload and a new session. These are the pure parts; register.tsx keeps the state and draws the module.
describe('a pomodoro, as a value', () => {
  const AT = 1792500000000

  test('idle: nothing is running and nothing is left', () => {
    const p = { state: 'idle' as const, done: 0 }
    expect(pomoLeft(p, AT)).toBe(0)
    expect(clockText(pomoLeft(p, AT))).toBe('25:00')
  })

  test('start sets the end 25 minutes away and the state to run', () => {
    const p = pomoNext({ state: 'idle', done: 0 }, 'start', AT)
    expect(p).toEqual({ state: 'run', endsAt: AT + FOCUS_MS, done: 0 })
    expect(pomoLeft(p, AT)).toBe(FOCUS_MS)
    expect(pomoLeft(p, AT + 60000)).toBe(FOCUS_MS - 60000)
    expect(clockText(pomoLeft(p, AT + 61000))).toBe('23:59')
  })

  test('pause keeps what was left; start again counts from there', () => {
    const run = pomoNext({ state: 'idle', done: 0 }, 'start', AT)
    const paused = pomoNext(run, 'pause', AT + 5 * 60000)
    expect(paused).toEqual({ state: 'pause', leftMs: FOCUS_MS - 5 * 60000, done: 0 })
    expect(pomoLeft(paused, AT + 99 * 60000)).toBe(FOCUS_MS - 5 * 60000)
    const again = pomoNext(paused, 'start', AT + 10 * 60000)
    expect(again).toEqual({ state: 'run', endsAt: AT + 10 * 60000 + FOCUS_MS - 5 * 60000, done: 0 })
  })

  test('reset puts it back to idle and keeps the count of finished ones', () => {
    const run = pomoNext({ state: 'run', endsAt: AT + 1000, done: 3 }, 'reset', AT)
    expect(run).toEqual({ state: 'idle', done: 3 })
  })

  test('a break is five minutes and does not count as a pomodoro', () => {
    const p = pomoNext({ state: 'idle', done: 2 }, 'break', AT)
    expect(p).toEqual({ state: 'break', endsAt: AT + BREAK_MS, done: 2 })
    expect(clockText(pomoLeft(p, AT))).toBe('05:00')
  })

  test('when a running one reaches zero it is done, counted, and goes quiet', () => {
    const run = { state: 'run' as const, endsAt: AT + 1000, done: 1 }
    expect(pomoAfter(run, AT + 500)).toEqual(run)
    expect(pomoAfter(run, AT + 1000)).toEqual({ state: 'idle', done: 2 })
    // a break that runs out is not counted
    expect(pomoAfter({ state: 'break', endsAt: AT + 1000, done: 2 }, AT + 2000)).toEqual({ state: 'idle', done: 2 })
  })

  test('the clock reads mm:ss, never negative, and rounds up so 1 ms left still shows a second', () => {
    expect(clockText(0)).toBe('25:00')
    expect(clockText(-5000)).toBe('25:00')
    expect(clockText(1)).toBe('00:01')
    expect(clockText(59_000)).toBe('00:59')
    expect(clockText(60_000)).toBe('01:00')
    expect(clockText(25 * 60000)).toBe('25:00')
  })
})

// The digits are drawn as rectangles, not letters: whether the desktop's SVG takes a font of its own has never been measured
// here (s44), and seven segments need none.
// The digits are drawn as segments, not letters: whether the desktop's SVG takes a font of its own has never been measured
// here (s44), and seven segments need none. Style C (the owner 「數字用 C」 off three drawn versions): each lit segment a hexagon
// with pointed ends, the classic LCD stroke, a slight lean to the right, thin, and nothing drawn for an unlit segment.
describe('seven-segment digits', () => {
  const polys = (svg: string) => [...svg.matchAll(/<polygon points="([^"]+)"/g)].map(m => (m[1] ?? '').trim().split(/\s+/).map(pt => pt.split(',').map(Number) as [number, number]))

  test('each digit lights its own segments and nothing else; a colon is two dots', () => {
    const svg = segmentsOf('09:41', { x: 0, y: 0, w: 120, h: 30 }, '#3fb950')
    // 0 lights 6, 9 lights 6, 4 lights 4, 1 lights 2 — and an unlit segment is not drawn at all
    expect(polys(svg).length).toBe(6 + 6 + 4 + 2)
    expect([...svg.matchAll(/<circle /g)].length).toBe(2)
    expect(svg).toContain('#3fb950')
    expect(svg).not.toContain('<rect')
  })

  test('a segment is a hexagon: six corners', () => {
    for (const pts of polys(segmentsOf('8', { x: 0, y: 0, w: 40, h: 30 }, '#3fb950'))) expect(pts.length).toBe(6)
  })

  test('nothing is drawn outside the box it was given, lean included', () => {
    const box = { x: 10, y: 4, w: 100, h: 28 }
    const svg = segmentsOf('12:34', box, '#3fb950')
    const wrong: string[] = []
    for (const pts of polys(svg)) for (const [x, y] of pts) {
      if (x < box.x - 0.5 || x > box.x + box.w + 0.5 || y < box.y - 0.5 || y > box.y + box.h + 0.5) wrong.push(`${x},${y}`)
    }
    expect(wrong).toEqual([])
  })

  test('the digits lean to the right: a top corner sits right of the bottom corner under it', () => {
    const [first] = polys(segmentsOf('1', { x: 0, y: 0, w: 40, h: 40 }, '#3fb950'))
    const top = Math.min(...(first ?? []).map(p => p[1]))
    const bottom = Math.max(...(first ?? []).map(p => p[1]))
    const xTop = Math.min(...(first ?? []).filter(p => p[1] === top).map(p => p[0]))
    const xBottom = Math.min(...(first ?? []).filter(p => p[1] === bottom).map(p => p[0]))
    expect(xTop > xBottom).toBe(true)
  })
})
