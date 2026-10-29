// A user's own module, read from a .json file (the owner 2026-10-19 s43 「步驟固定、內容彈性」, his 「四種一起做成同一條流程（B）」):
// the same mechanism the language folder has had since s34, for the same reason — the hooks environment refuses every way of
// turning text into code (s43 lab: eval, new Function, a function's own .constructor and import() all throw EvalError;
// docs/measures.md), so a module that is not part of the framework can only be DATA: which commands to run, which files to
// read, how to pull a number out of what came back, and the lines to show.
//
// Plain functions here, on the file's text alone, as hooks/lang's checkLang and hooks/profiles' checkProfile are: the folder
// itself, and the reporting of a refusal, are register.tsx's (the engine refuses a module that hands $ to a function declared
// in another file, s29).
import { barRows, barTile, COLOUR, ringsChart, svg as svgOf, usedTone } from './modules/chart'
import type { ChartBox, ModuleInput, SsModule } from './modules'
import { isRhythm, RHYTHM_SECONDS, runKey } from './modules'
import type { Rhythm } from './modules'

export const USER_MOD_FORMAT = 1
// a user's module can never take a built-in's name (host.* session.* action.*): lowercase, and under user.
export const USER_MOD_ID = /^user\.[a-z0-9]+$/
// the heading the 新增卡片 pane lists them under
export const USER_GROUP = 'user'
// what a value that could not be read shows: never a number from an earlier read (the rule every built-in module keeps)
export const UNREAD = '?'

// where one value comes from: `run:<n>` the nth command, `read:<n>` the nth file; then the line and the column of what it printed
export type UserValue = { from: string; line: number; col: number; scale?: number }
// the shapes a file may name; the drawing itself is chart.ts's, the same one the built-in modules use
export const SHAPES = ['rings', 'bars'] as const
export type Shape = (typeof SHAPES)[number]
// a colour a file may name: by the number itself (green to red), or flat
export const COLOURS = ['used', 'blue', 'dim'] as const
export type UserItem = { label: string; percent: string; value: string; colour: string }
export type UserChart = { shape: Shape; head: string; foot: string; items: readonly UserItem[] }
export type UserTile = { words: string; value: string; percent: string; colour: string }
export type UserModDef = {
  id: string
  // language code -> the words; 'en' is always there
  name: Record<string, string>
  about: Record<string, string>
  runs: readonly (readonly string[])[]
  reads: readonly string[]
  values: Record<string, UserValue>
  lines: readonly string[]
  chart?: UserChart
  tile?: UserTile
  // the module's own rhythm, as one of the four words turned into its seconds; absent, the minute
  every?: number
}

export type UserModCheck =
  | { ok: true; def: UserModDef }
  // why: a key of the language files ('usermod.why.…'), with what fills it
  | { ok: false; why: string; vars?: Record<string, string | number> }

const no = (why: string, vars?: Record<string, string | number>): UserModCheck => (vars === undefined ? { ok: false, why } : { ok: false, why, vars })
const isWords = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(w => typeof w === 'string' && w.trim() !== '')
// a name or an about: one string is English, an object is a language code for each
const words = (v: unknown): Record<string, string> => {
  if (typeof v === 'string') return { en: v }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { en: '' }
  const out: Record<string, string> = { en: '' }
  for (const [code, value] of Object.entries(v as Record<string, unknown>)) if (typeof value === 'string') out[code] = value
  return out
}
const whole = (v: unknown, fallback: number) => (Number.isInteger(v) ? (v as number) : v === undefined ? fallback : NaN)
// every {name} a line asks for
const asked = (lines: readonly string[]) => lines.flatMap(line => [...line.matchAll(/\{(\w+)\}/g)].map(m => m[1] as string))

// A file as read (its text): refused when it is not JSON, of another format, or when anything in it does not hold together —
// an id that is not under user., a role format 1 does not do, no lines, a command that is not a list of words, a path that is
// not absolute, a value taken from a command or file the file never named, or a line asking for a value it never declared.
export function checkUserModule(text: string): UserModCheck {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return no('usermod.why.json')
  }
  const file = (raw ?? {}) as Record<string, unknown>
  if (file['format'] !== USER_MOD_FORMAT) return no('usermod.why.format', { got: String(file['format'] ?? '?'), want: USER_MOD_FORMAT })
  const id = file['id']
  if (typeof id !== 'string' || !USER_MOD_ID.test(id)) return no('usermod.why.id')
  if (file['role'] !== 'tile') return no('usermod.why.role', { got: String(file['role'] ?? '?') })

  const lines = file['lines']
  if (!Array.isArray(lines) || lines.length === 0 || !lines.every(l => typeof l === 'string' && l.trim() !== '')) return no('usermod.why.lines')

  const rawRuns = file['runs'] ?? []
  if (!Array.isArray(rawRuns) || !rawRuns.every(isWords)) return no('usermod.why.runs')
  const runs = rawRuns as string[][]

  const rawReads = file['reads'] ?? []
  if (!Array.isArray(rawReads) || !rawReads.every(p => typeof p === 'string' && p.startsWith('/'))) return no('usermod.why.reads')
  const reads = rawReads as string[]

  const rawValues = file['values']
  if (rawValues !== undefined && (rawValues === null || typeof rawValues !== 'object' || Array.isArray(rawValues))) return no('usermod.why.values')
  const values: Record<string, UserValue> = {}
  for (const [name, value] of Object.entries((rawValues ?? {}) as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return no('usermod.why.pick', { name })
    const v = value as Record<string, unknown>
    const from = typeof v['from'] === 'string' ? v['from'] : ''
    const at = /^(run|read):(\d+)$/.exec(from)
    const within = at === null ? false : (at[1] === 'run' ? runs.length : reads.length) > Number(at[2])
    if (!within) return no('usermod.why.from', { name, from: from === '' ? '?' : from })
    const line = whole(v['line'], 1)
    const col = whole(v['col'], 1)
    const scale = v['scale'] === undefined ? undefined : Number(v['scale'])
    if (!(line >= 1) || !(col >= 1) || (scale !== undefined && (!Number.isFinite(scale) || scale === 0))) return no('usermod.why.pick', { name })
    values[name] = scale === undefined ? { from, line, col } : { from, line, col, scale }
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const colourOf = (v: unknown) => (typeof v === 'string' && (COLOURS as readonly string[]).includes(v) ? v : 'used')

  let chart: UserChart | undefined
  const rawChart = file['chart']
  if (rawChart !== undefined) {
    if (rawChart === null || typeof rawChart !== 'object' || Array.isArray(rawChart)) return no('usermod.why.items')
    const c = rawChart as Record<string, unknown>
    const shape = str(c['shape'])
    if (!(SHAPES as readonly string[]).includes(shape)) return no('usermod.why.shape', { got: shape === '' ? '?' : shape })
    const rawItems = c['items']
    if (!Array.isArray(rawItems) || rawItems.length === 0 || !rawItems.every(i => i !== null && typeof i === 'object' && !Array.isArray(i))) return no('usermod.why.items')
    const items = (rawItems as Record<string, unknown>[]).map(i => ({ label: str(i['label']), percent: str(i['percent']), value: str(i['value']), colour: colourOf(i['colour']) }))
    chart = { shape: shape as Shape, head: str(c['head']), foot: str(c['foot']), items }
  }

  let tile: UserTile | undefined
  const rawTile = file['tile']
  if (rawTile !== undefined) {
    if (rawTile === null || typeof rawTile !== 'object' || Array.isArray(rawTile)) return no('usermod.why.items')
    const d = rawTile as Record<string, unknown>
    tile = { words: str(d['words']), value: str(d['value']), percent: str(d['percent']), colour: colourOf(d['colour']) }
  }

  // every {name} anywhere in the file — a line, a chart, a tile — must be a value the file declares
  const everywhere = [
    ...(lines as string[]),
    ...(chart === undefined ? [] : [chart.head, chart.foot, ...chart.items.flatMap(i => [i.label, i.percent, i.value])]),
    ...(tile === undefined ? [] : [tile.words, tile.value, tile.percent]),
  ]
  for (const name of asked(everywhere)) if (!(name in values)) return no('usermod.why.value', { name })

  const rawEvery = file['every']
  if (rawEvery !== undefined && !isRhythm(rawEvery)) return no('usermod.why.every', { got: String(rawEvery) })

  const def: UserModDef = { id, name: words(file['name']), about: words(file['about']), runs, reads, values, lines: lines as string[] }
  if (rawEvery !== undefined) def.every = RHYTHM_SECONDS[rawEvery as Rhythm]
  if (chart !== undefined) def.chart = chart
  if (tile !== undefined) def.tile = tile

  return { ok: true, def }
}

// The text one value stands for, or ? when it could not be read: the named command's output or the named file's, that line
// (1 first, blank lines skipped), that column (split on commas and spaces), as a number, divided by scale where there is one.
function valueOf(def: UserModDef, input: ModuleInput, name: string): string {
  const value = def.values[name]
  if (value === undefined) return UNREAD
  const at = /^(run|read):(\d+)$/.exec(value.from)
  if (at === null) return UNREAD
  const n = Number(at[2])
  const source = at[1] === 'run' ? input.runs[runKey(def.runs[n] ?? [])] : input.files[def.reads[n] ?? '']
  const rows = (source ?? '').split('\n').filter(l => l.trim() !== '')
  const cells = (rows[value.line - 1] ?? '').split(/[,\s]+/).filter(c => c !== '')
  const cell = cells[value.col - 1]
  if (cell === undefined || !/^-?\d+(\.\d+)?$/.test(cell)) return UNREAD
  const number = Number(cell) / (value.scale ?? 1)

  return String(Math.round(number * 10) / 10)
}

// A template with every {name} filled in, and the same read as a number (undefined where it could not be read).
const fill = (def: UserModDef, input: ModuleInput, template: string) => template.replace(/\{(\w+)\}/g, (wholeMatch, name: string) => valueOf(def, input, name))
const asNumber = (def: UserModDef, input: ModuleInput, template: string) => {
  const filled = fill(def, input, template)
  return /^-?\d+(\.\d+)?$/.test(filled) ? Number(filled) : undefined
}
const tone = (name: string, percent: number | undefined) => (name === 'blue' ? COLOUR.blue : name === 'dim' ? COLOUR.dim : usedTone(percent))

// What the H2 family draws: the file's own tile, else one made from the chart's first item, else none.
function tileOf(def: UserModDef): UserTile | undefined {
  if (def.tile !== undefined) return def.tile
  const first = def.chart?.items[0]
  if (first === undefined) return undefined

  return { words: def.chart?.head !== undefined && def.chart.head !== '' ? def.chart.head : first.label, value: first.value, percent: first.percent, colour: first.colour }
}

// The module superstatus offers and draws: its commands and files as the file gave them, its lines with every {name} filled in.
export function toUserModule(def: UserModDef): SsModule {
  return {
    id: def.id,
    name: def.name['en'] ?? def.id,
    group: USER_GROUP,
    about: def.about['en'] ?? '',
    role: 'tile',
    ...(def.every === undefined ? {} : { every: def.every }),
    ...(def.runs.length > 0 ? { runs: def.runs } : {}),
    ...(def.reads.length > 0 ? { reads: def.reads } : {}),
    lines: (input: ModuleInput) => def.lines.map(line => fill(def, input, line)),
    ...(def.chart === undefined
      ? {}
      : {
          chart: (input: ModuleInput, box: ChartBox) => {
            const chart = def.chart as UserChart
            const items = chart.items.map(i => {
              const percent = asNumber(def, input, i.percent)
              return { label: fill(def, input, i.label), percent, value: fill(def, input, i.value), colour: tone(i.colour, percent) }
            })
            return chart.shape === 'rings'
              ? ringsChart(box, fill(def, input, chart.head), items, fill(def, input, chart.foot))
              : svgOf(box, barRows(box, items))
          },
        }),
    // The H2 family's small card. A file that writes its own `tile` keeps it; a file that only drew a chart gets one for
    // free, from the chart's head (or its first item's label) and that item's number — always a bar, whatever the chart is
    // (the owner 2026-10-19 s43 「應該就是這樣 Chart 以上做 ring 或是 bar都可以 H2 系列的只要出Bar就好」, after 「應該是這樣 除非指定」:
    // one file is to fit H2, H2-half, H3-half and H3 without being written twice).
    ...(tileOf(def) === undefined
      ? {}
      : {
          tile: (input: ModuleInput, box: ChartBox) => {
            const t = tileOf(def) as UserTile
            const percent = asNumber(def, input, t.percent)
            return barTile(box, fill(def, input, t.words), fill(def, input, t.value), percent, tone(t.colour, percent))
          },
        }),
  }
}
