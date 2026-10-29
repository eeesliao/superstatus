// The session modules (the owner 2026-10-10 s33 「框45678 展示可以顯示的資訊」): what superstatus already reads for its status line, one
// subject a tile: the room before auto-compaction, the quota, git, the score, the tool calls, the project's journal.
import type { Translate } from '../lang/types'
import { barTile, COLOUR, headRow, leftTone, MARK, pairRow, pct, px, ring, svg, text, tileRoom, usedTone, wordsBefore } from './chart'
import type { ChartBox, JournalEvent, ModuleInput, SessionFacts, SsModule } from './types'
import { bar, runKey } from './types'
import { BREAK_MS, clockText, FOCUS_MS, segmentsOf } from '../pomo'

const percent = (value: number | undefined) => (value === undefined ? '?' : `${Math.round(value)}%`)
const barOf = (value: number | undefined) => (value === undefined ? '' : bar(value))
const ffWords = { done: 'line.ffDone', can: 'line.ffCan', cannot: 'line.ffCannot' } as const
// a branch's last part: claude/l-8b5c70 → l-8b5c70
const shortBranch = (branch: string) => branch.split('/').pop() || branch

// A tile's lines without the empty ones (a value that could not be read leaves no blank line).
const kept = (lines: string[]) => {
  const out = lines.filter(l => l !== '')
  return out.length > 0 ? out : ['?']
}

export const sessionLines = {
  ctx: (s: SessionFacts, t: Translate) => kept([t('ses.ctx', { p: percent(s.left) }), barOf(s.left), s.left === undefined ? '' : t('ses.ctxNote')]),
  h5: (s: SessionFacts, t: Translate) => kept([t('ses.h5', { p: percent(s.h5) }), barOf(s.h5), s.h5 === undefined ? '' : t('ses.used')]),
  d7: (s: SessionFacts, t: Translate) => kept([t('ses.d7', { p: percent(s.d7) }), barOf(s.d7), s.d7 === undefined ? '' : t('ses.used')]),
  git: (s: SessionFacts, t: Translate) =>
    s.branch === undefined
      ? [t('ses.notGit')]
      : kept([t('ses.branch', { v: shortBranch(s.branch) }), t('ses.dirty', { v: s.dirty ?? '?' }), t(s.ff === undefined ? 'line.ffUnknown' : ffWords[s.ff])]),
  score: (s: SessionFacts, t: Translate) =>
    kept([t('ses.score', { total: s.total ?? '?', band: s.score ?? '?' }), s.pending === undefined ? '' : t('ses.pending', { n: s.pending })]),
  tools: (s: SessionFacts, t: Translate) => [t('ses.tools', { n: s.tools >= 0 ? s.tools : '?' }), t('ses.toolsNote')],
  // the newest first: an H2 tile shows the latest event
  journal: (s: SessionFacts, t: Translate) => (s.journal.length === 0 ? [t('ses.journalNone')] : [...s.journal].reverse()),
  project: (s: SessionFacts, t: Translate) => [t('ses.who', { v: s.who ?? '?' }), t('ses.block', { v: s.block ?? '?' }), `superstatus ${s.version}`],
}

// s35 (the owner 「H3 以上的可以畫一些圖表或是做成漂亮一點的介面給我看嗎」): the session in pictures.

// 額度儀表: three rings, as the Status Line's dials: what is left before auto-compaction, the 5-hour and the weekly quota used.
function gauges(s: SessionFacts, t: Translate, box: ChartBox): string {
  const items = [
    { p: s.left, colour: leftTone(s.left), label: t('line.ctx') },
    { p: s.h5, colour: usedTone(s.h5), label: t('line.5h') },
    { p: s.d7, colour: usedTone(s.d7), label: t('line.7d') },
  ]
  const slot = box.width / items.length
  const r = Math.max(6, Math.min(box.height * 0.3, slot * 0.32))
  const cy = box.height * 0.45
  return svg(box, items.map((it, k) => ring(slot * (k + 0.5), cy, r, it.p, it.colour, pct(it.p), it.label)).join(''))
}

// 分數卡: the band in large, coloured (A and B green, C yellow, D red: DESIGN §3, D is below the baseline), the total beside it, the
// pending pitfalls under the total.
const BAND_COLOUR: Record<string, string> = { A: COLOUR.success, B: COLOUR.success, C: COLOUR.warning, D: COLOUR.error }
function scorecard(s: SessionFacts, t: Translate, box: ChartBox): string {
  const band = s.score ?? '?'
  const big = Math.max(14, Math.min(box.height * 0.62, box.width * 0.3))
  const left = box.width * 0.3
  const right = box.width * 0.62
  const mid = box.height / 2
  const pending = s.pending
  return svg(
    box,
    text(left, mid + big * 0.36, band, { size: big, colour: BAND_COLOUR[band] ?? COLOUR.dim, anchor: 'middle', weight: 700 }) +
      text(right, mid - big * 0.08, s.total ?? '?', { size: Math.max(11, big * 0.48), colour: COLOUR.text, anchor: 'middle', weight: 600 }) +
      text(right, mid + big * 0.18, t('chart.total'), { size: Math.max(9, big * 0.17), colour: COLOUR.dim, anchor: 'middle' }) +
      text(right, mid + big * 0.48, pending === undefined ? '?' : t('ses.pending', { n: pending }), {
        size: Math.max(9, big * 0.19),
        colour: pending ? COLOUR.warning : COLOUR.dim,
        anchor: 'middle',
      }),
  )
}

// 提交活動: commits a day over the 14 days to today, from git log (this branch's history) and the host's date.
export const GIT_LOG = ['git', 'log', '--since=15.days.ago', '--format=%cs'] as const
export const TODAY = ['date', '+%F'] as const
const DAYS = 14
const DAY_MS = 86400000
function commitDays(input: ModuleInput): { day: string; n: number }[] | undefined {
  const today = input.runs[runKey(TODAY)]?.trim() ?? ''
  const log = input.runs[runKey(GIT_LOG)]
  const base = Date.parse(`${today}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || log === undefined || !Number.isFinite(base)) return undefined
  const counts: Record<string, number> = {}
  for (const line of log.split('\n')) {
    const day = line.trim()
    if (day !== '') counts[day] = (counts[day] ?? 0) + 1
  }
  return Array.from({ length: DAYS }, (_, k) => {
    const day = new Date(base - (DAYS - 1 - k) * DAY_MS).toISOString().slice(0, 10)
    return { day, n: counts[day] ?? 0 }
  })
}

function commitLines(input: ModuleInput): string[] {
  const days = commitDays(input)
  if (days === undefined) return [input.t('chart.commits', { n: '?', days: DAYS })]
  return [input.t('chart.commits', { n: days.reduce((sum, d) => sum + d.n, 0), days: DAYS }), input.t('chart.today', { n: days[DAYS - 1]?.n ?? 0 })]
}

function commits(input: ModuleInput, box: ChartBox): string {
  const days = commitDays(input)
  const pad = Math.min(14, box.height * 0.12)
  const size = Math.max(9, Math.min(12, box.height * 0.11))
  const [title = '', today = ''] = commitLines(input)
  const head = headRow(box, pad, size, title, today, COLOUR.blue)
  if (days === undefined) return svg(box, head)
  const top = pad + size * 1.9
  const base = box.height - pad - size * 1.3
  const pitch = (box.width - 2 * pad) / DAYS
  const most = Math.max(1, ...days.map(d => d.n))
  const columns = days
    .map((d, k) => {
      const x = pad + pitch * k + pitch * 0.18
      const w = pitch * 0.64
      const h = Math.max(2, ((base - top) * d.n) / most)
      const colour = k === DAYS - 1 ? COLOUR.blue : d.n > 0 ? COLOUR.success : COLOUR.track
      const label = pitch >= 22 || k % 2 === 1 ? text(x + w / 2, box.height - pad, d.day.slice(8), { size: size * 0.85, colour: COLOUR.dim, anchor: 'middle' }) : ''
      const count = d.n > 0 && pitch >= 14 ? text(x + w / 2, base - h - 3, String(d.n), { size: size * 0.85, colour: COLOUR.light, anchor: 'middle' }) : ''
      return (
        `<rect data-day="${d.day}" data-n="${d.n}" x="${px(x)}" y="${px(base - h)}" width="${px(w)}" height="${px(h)}" rx="${px(Math.min(3, w / 3))}" ` +
        `fill="${colour}"${d.n > 0 ? '' : ' fill-opacity="0.35"'}/>` +
        count +
        label
      )
    })
    .join('')
  return svg(box, head + columns)
}

// 時間軸: the newest journal's events in order along a line, coloured by kind (DESIGN §1's closed list), counted above; past the width the
// newest that fit (at least 7 px apart), the last always.
const EVENT_ORDER = ['WHO', 'ADD', 'DECIDE', 'LAUNCH', 'PASS', 'FAIL', 'FIX', 'CLOSE'] as const
const EVENT_COLOUR: Record<string, string> = {
  WHO: COLOUR.dim, ADD: COLOUR.blue, DECIDE: COLOUR.purple, LAUNCH: COLOUR.light, PASS: COLOUR.success, FAIL: COLOUR.error, FIX: COLOUR.warning, CLOSE: COLOUR.text,
}
const countsOf = (events: readonly JournalEvent[]) => {
  const counts: Record<string, number> = {}
  for (const e of events) counts[e.word] = (counts[e.word] ?? 0) + 1
  return [...EVENT_ORDER.filter(w => counts[w]), ...Object.keys(counts).filter(w => !(EVENT_ORDER as readonly string[]).includes(w))].map(w => ({ word: w, n: counts[w] ?? 0 }))
}

function timelineLines(s: SessionFacts, t: Translate): string[] {
  const events = s.events ?? []
  if (events.length === 0) return [t('ses.journalNone')]
  return [
    t('chart.events', { n: events.length }),
    countsOf(events).map(c => `${c.word} ${c.n}`).join(' · '),
    ...(s.journal.length > 0 ? [s.journal[s.journal.length - 1] as string] : []),
  ]
}

function timeline(s: SessionFacts, t: Translate, box: ChartBox): string {
  const events = s.events ?? []
  const pad = Math.min(16, box.height * 0.13)
  const size = Math.max(9, Math.min(12, box.height * 0.1))
  // the counts across the top, each with its colour's dot
  let x = pad
  const legend = [{ word: t('chart.events', { n: events.length }), n: -1 }, ...countsOf(events)]
    .map(c => {
      const label = c.n < 0 ? c.word : `${c.word} ${c.n}`
      const width = label.length * size * 0.62 + 18
      if (x + width > box.width - pad) return ''
      const out =
        (c.n < 0 ? '' : `<circle cx="${px(x + 4)}" cy="${px(pad + size * 0.65)}" r="4" fill="${EVENT_COLOUR[c.word] ?? COLOUR.dim}"/>`) +
        text(c.n < 0 ? x : x + 12, pad + size, label, { size, colour: c.n < 0 ? COLOUR.light : COLOUR.dim, weight: c.n < 0 ? 600 : 400 })
      x += width
      return out
    })
    .join('')
  if (events.length === 0) return svg(box, legend)
  const fit = Math.max(1, Math.floor((box.width - 2 * pad) / 7))
  const shownEvents = events.slice(-fit)
  const lineY = pad + size * 1.6 + (box.height - pad * 2 - size * 2.8) / 2
  const step = shownEvents.length > 1 ? (box.width - 2 * pad - 8) / (shownEvents.length - 1) : 0
  const r = Math.max(2.5, Math.min(6, step * 0.4))
  const every = Math.max(1, Math.ceil(26 / Math.max(step, 1)))
  const dots = shownEvents
    .map((e, k) => {
      const cx = shownEvents.length > 1 ? pad + 4 + step * k : box.width / 2
      const isLast = k === shownEvents.length - 1
      const label = k % every === 0 || isLast ? text(cx, lineY + r + size + 2, String(e.id), { size: size * 0.85, colour: isLast ? COLOUR.text : COLOUR.dim, anchor: 'middle' }) : ''
      return (
        (isLast ? `<circle cx="${px(cx)}" cy="${px(lineY)}" r="${px(r + 3)}" fill="none" stroke="${COLOUR.text}" stroke-width="1.2"/>` : '') +
        `<circle data-event="${e.id} ${e.word.replace(/[^A-Z]/g, '')}" cx="${px(cx)}" cy="${px(lineY)}" r="${px(r)}" fill="${EVENT_COLOUR[e.word] ?? COLOUR.dim}"/>` +
        label
      )
    })
    .join('')
  const axis = `<line x1="${px(pad)}" y1="${px(lineY)}" x2="${px(box.width - pad)}" y2="${px(lineY)}" stroke="${COLOUR.track}" stroke-opacity="0.4" stroke-width="2"/>`
  return svg(box, legend + axis + dots)
}

// The branch's tile (s39, B): its last part after ⎇, then the unsaved files (yellow while any) and a mark of the fast-forward in its colour.
const FF_MARK = { done: ['✓', COLOUR.success], can: ['↑', COLOUR.blue], cannot: ['✕', COLOUR.error] } as const
function gitTile(s: SessionFacts, t: Translate, box: ChartBox): string {
  const { pad, size } = tileRoom(box)
  if (s.branch === undefined) return svg(box, pairRow(box, pad, pad + size, size, t('ses.notGit'), '', COLOUR.dim, { weight: 400 }))
  const [mark, markColour] = s.ff === undefined ? ['?', COLOUR.dim] : FF_MARK[s.ff]
  return svg(
    box,
    pairRow(box, pad, pad + size * 0.85, size, `⎇ ${shortBranch(s.branch)}`, '', COLOUR.dim, { weight: 400, colour: COLOUR.text }) +
      pairRow(box, pad, box.height - pad, size * 0.9, t('ses.dirty', { v: s.dirty ?? '?' }), mark, markColour, {
        weight: 400,
        colour: s.dirty ? COLOUR.warning : COLOUR.dim,
      }),
  )
}

// The score's tile (s39, B): the total and band in the band's colour, under them a strip of A B C D with the band lit.
function scoreTile(s: SessionFacts, t: Translate, box: ChartBox): string {
  const { pad, size, barY, barH } = tileRoom(box)
  const band = s.score ?? '?'
  const colour = BAND_COLOUR[band] ?? COLOUR.dim
  const gap = 2
  const seg = (box.width - 2 * pad - 3 * gap) / 4
  const strip = ['A', 'B', 'C', 'D']
    .map(
      (b, k) =>
        `<rect data-band="${b}" x="${px(pad + k * (seg + gap))}" y="${px(barY)}" width="${px(seg)}" height="${px(barH)}" rx="${px(Math.min(2, barH / 2))}" ` +
        (b === band ? `fill="${colour}"/>` : `fill="${COLOUR.track}" fill-opacity="0.28"/>`),
    )
    .join('')
  return svg(box, pairRow(box, pad, pad + size, size, t('line.score'), `${s.total ?? '?'} · ${band}`, colour, { weight: 400 }) + strip)
}

// s44 (the owner 「蕃茄鐘現在做」): the pomodoro. The clock is seven segments of rectangles (hooks/pomo.ts), which need no font of
// their own; under it a bar of how much has gone, and the count of finished ones. Keeping the state is register.tsx's.
const pomoOf = (s: SessionFacts) => s.pomo ?? { left: 0, state: 'idle' as const, done: 0 }
const pomoColour = (state: string) => (state === 'run' ? COLOUR.success : state === 'break' ? COLOUR.blue : state === 'pause' ? COLOUR.warning : COLOUR.dim)
const pomoGone = (p: { left: number; state: string }) => {
  const whole = p.state === 'break' ? BREAK_MS : FOCUS_MS
  return Math.max(0, Math.min(100, ((whole - p.left) / whole) * 100))
}

export function pomoLines(s: SessionFacts, t: Translate): string[] {
  const p = pomoOf(s)
  return [`${t(`pomo.state.${p.state}`)} ${clockText(p.left)}`, t('pomo.done', { n: p.done })]
}

export function pomoTile(s: SessionFacts, t: Translate, box: ChartBox): string {
  const p = pomoOf(s)
  return barTile(box, t(`pomo.state.${p.state}`), clockText(p.left), pomoGone(p), pomoColour(p.state))
}

export function pomoChart(s: SessionFacts, t: Translate, box: ChartBox): string {
  const p = pomoOf(s)
  const pad = Math.min(12, box.height * 0.12)
  const size = Math.max(9, Math.min(12, box.height * 0.11))
  const head = headRow(box, pad, size, t(`pomo.state.${p.state}`), t('pomo.done', { n: p.done }), pomoColour(p.state))
  const top = pad + size * 2
  const clockH = Math.max(12, box.height - top - pad - 14)
  const digits = segmentsOf(clockText(p.left), { x: pad * 2, y: top, w: box.width - pad * 4, h: clockH }, pomoColour(p.state))
  const barY = top + clockH + 7
  const w = box.width - pad * 2
  return svg(box, head + digits +
    `<rect x="${px(pad)}" y="${px(barY)}" width="${px(w)}" height="4" rx="2" fill="${COLOUR.track}"/>` +
    `<rect x="${px(pad)}" y="${px(barY)}" width="${px((w * pomoGone(p)) / 100)}" height="4" rx="2" fill="${pomoColour(p.state)}"/>`)
}

export const SESSION_MODULES: readonly SsModule[] = [
  { id: 'session.ctx', name: 'Context', group: 'session', about: 'how much is left before auto-compaction, with a bar', role: 'tile', lines: i => sessionLines.ctx(i.session, i.t),
    tile: (i, box) => barTile(box, wordsBefore(i.t('ses.ctx', { p: MARK }), i.t('line.ctx')), pct(i.session.left), i.session.left, leftTone(i.session.left)) },
  { id: 'session.5h', name: '5 hours', group: 'session', about: 'the 5-hour quota used, with a bar', role: 'tile', lines: i => sessionLines.h5(i.session, i.t),
    tile: (i, box) => barTile(box, wordsBefore(i.t('ses.h5', { p: MARK }), i.t('line.5h')), pct(i.session.h5), i.session.h5, usedTone(i.session.h5)) },
  { id: 'session.7d', name: 'Weekly', group: 'session', about: 'the weekly quota used, with a bar', role: 'tile', lines: i => sessionLines.d7(i.session, i.t),
    tile: (i, box) => barTile(box, wordsBefore(i.t('ses.d7', { p: MARK }), i.t('line.7d')), pct(i.session.d7), i.session.d7, usedTone(i.session.d7)) },
  { id: 'session.git', name: 'Branch', group: 'session', about: 'the branch, files not saved, whether it can fast-forward', role: 'tile', lines: i => sessionLines.git(i.session, i.t),
    tile: (i, box) => gitTile(i.session, i.t, box) },
  { id: 'session.score', name: 'Score', group: 'session', about: 'the score total and band, pending pitfalls (Score.md, MEMORY.md)', role: 'tile', lines: i => sessionLines.score(i.session, i.t),
    tile: (i, box) => scoreTile(i.session, i.t, box) },
  { id: 'session.tools', name: 'Tools', group: 'session', about: "this session's main-loop tool calls", role: 'tile', lines: i => sessionLines.tools(i.session, i.t) },
  { id: 'session.journal', every: 300, name: 'Journal', group: 'session', about: "the newest journal's last lines, the newest on top", role: 'tile', lines: i => sessionLines.journal(i.session, i.t) },
  { id: 'session.project', name: 'Project', group: 'session', about: 'operator, block, superstatus version', role: 'tile', lines: i => sessionLines.project(i.session, i.t) },
  { id: 'session.gauges', name: 'Quotas', group: 'session', about: 'three rings: context left, the 5-hour and the weekly quota used (a chart in H3)', role: 'tile',
    lines: i => [i.t('ses.ctx', { p: percent(i.session.left) }), i.t('ses.h5', { p: percent(i.session.h5) }), i.t('ses.d7', { p: percent(i.session.d7) })],
    chart: (i, box) => gauges(i.session, i.t, box) },
  { id: 'session.scorecard', name: 'Score card', group: 'session', about: 'the score band in large, the total, pending pitfalls (a chart in H3)', role: 'tile',
    lines: i => sessionLines.score(i.session, i.t), chart: (i, box) => scorecard(i.session, i.t, box) },
  { id: 'session.pomo', every: 1, name: 'Pomodoro', group: 'session', about: 'a 25-minute pomodoro, the clock in large (/ss pomo start)', role: 'tile',
    lines: i => pomoLines(i.session, i.t), tile: (i, box) => pomoTile(i.session, i.t, box), chart: (i, box) => pomoChart(i.session, i.t, box) },
  { id: 'session.commits', every: 300, name: 'Commits', group: 'session', about: 'commits a day over the last 14 days (git log; a chart in H3)', role: 'tile',
    runs: [GIT_LOG, TODAY], lines: commitLines, chart: commits },
  { id: 'session.timeline', every: 300, name: 'Timeline', group: 'session', about: "the newest journal's events in order, coloured by kind (a chart in H3)", role: 'tile',
    lines: i => timelineLines(i.session, i.t), chart: (i, box) => timeline(i.session, i.t, box) },
  {
    id: 'session.snapshot',
    name: 'State now',
    group: 'session',
    about: 'a press: a line in the corner with context, 5 hours, weekly, score',
    role: 'button',
    press: ({ session: s, t }) => ({
      kind: 'toast',
      text: t('ses.snapshot', { l: percent(s.left), h: percent(s.h5), d: percent(s.d7), t: s.total ?? '?', b: s.score ?? '?' }),
    }),
  },
]
