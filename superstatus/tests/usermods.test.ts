import { describe, expect, test } from 'claude-code/testing'

import { checkUserModule, toUserModule, USER_MOD_FORMAT, USER_MOD_ID } from '../hooks/usermods'
import { EN, translator } from '../hooks/lang'
import type { ModuleInput } from '../hooks/modules'

// A user's own module, read from a .json in .claude/superstatus/modules (the owner 2026-10-19 s43 「步驟固定、內容彈性」, his B:
// the same mechanism the language folder already uses). The engine refuses every way of turning text into code (s43 lab,
// docs/measures.md), so a module file is DATA: the commands to run, how to pull numbers out of what they printed, and the
// lines to show. Checked here on its text alone, as checkLang and checkProfile are; the folder itself is register.tsx's.

const t = translator(EN)
const good = {
  format: 1,
  id: 'user.gpu',
  name: { en: 'GPU', 'zh-TW': '顯卡' },
  about: { en: "this box's GPU" },
  role: 'tile',
  runs: [['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits']],
  values: { use: { from: 'run:0', line: 1, col: 1 } },
  lines: ['GPU {use}%'],
}
const text = (over: Record<string, unknown> = {}) => JSON.stringify({ ...good, ...over })

// what superstatus hands a module: each command's output by its argv joined with spaces
const input = (runs: Record<string, string | undefined>, files: Record<string, string | undefined> = {}): ModuleInput =>
  ({ runs, files, t, session: { tools: 0, version: '0.7', journal: [] } }) as unknown as ModuleInput

describe('a user module file, checked on its text', () => {
  test('a good file is taken, and says so with no reason', () => {
    const check = checkUserModule(text())
    expect(check.ok).toBe(true)
  })

  test('text that is not JSON is refused as json', () => {
    expect(checkUserModule('{ nope')).toEqual({ ok: false, why: 'usermod.why.json' })
  })

  test('another format number is refused, and the file says which it is and which is wanted', () => {
    expect(checkUserModule(text({ format: 2 }))).toEqual({ ok: false, why: 'usermod.why.format', vars: { got: '2', want: USER_MOD_FORMAT } })
  })

  test('no format number at all is refused the same way, as ?', () => {
    const raw = JSON.parse(text()) as Record<string, unknown>
    delete raw['format']
    expect(checkUserModule(JSON.stringify(raw))).toEqual({ ok: false, why: 'usermod.why.format', vars: { got: '?', want: USER_MOD_FORMAT } })
  })

  test("an id that does not start with user. is refused: a user's module can never take a built-in's name", () => {
    expect(checkUserModule(text({ id: 'host.gpu67' }))).toEqual({ ok: false, why: 'usermod.why.id' })
    expect(checkUserModule(text({ id: 'session.ctx' }))).toEqual({ ok: false, why: 'usermod.why.id' })
  })

  test('an id with capitals or spaces is refused', () => {
    expect(checkUserModule(text({ id: 'user.GPU' }))).toEqual({ ok: false, why: 'usermod.why.id' })
    expect(checkUserModule(text({ id: 'user.my gpu' }))).toEqual({ ok: false, why: 'usermod.why.id' })
  })

  test('a role other than tile is refused in format 1, and the file says which it got', () => {
    expect(checkUserModule(text({ role: 'button' }))).toEqual({ ok: false, why: 'usermod.why.role', vars: { got: 'button' } })
  })

  test('no lines, or an empty one, is refused', () => {
    expect(checkUserModule(text({ lines: [] }))).toEqual({ ok: false, why: 'usermod.why.lines' })
    expect(checkUserModule(text({ lines: ['  '] }))).toEqual({ ok: false, why: 'usermod.why.lines' })
  })

  test('a command that is not a list of words is refused', () => {
    expect(checkUserModule(text({ runs: ['nvidia-smi'] }))).toEqual({ ok: false, why: 'usermod.why.runs' })
    expect(checkUserModule(text({ runs: [[]] }))).toEqual({ ok: false, why: 'usermod.why.runs' })
    expect(checkUserModule(text({ runs: [['df', 3]] }))).toEqual({ ok: false, why: 'usermod.why.runs' })
  })

  test('a path that is not absolute is refused', () => {
    expect(checkUserModule(text({ reads: ['proc/uptime'] }))).toEqual({ ok: false, why: 'usermod.why.reads' })
  })

  test('a value taken from a command that is not there is refused, and the file names it', () => {
    expect(checkUserModule(text({ values: { use: { from: 'run:1', line: 1, col: 1 } } }))).toEqual({ ok: false, why: 'usermod.why.from', vars: { name: 'use', from: 'run:1' } })
    expect(checkUserModule(text({ values: { use: { from: 'read:0', line: 1, col: 1 } } }))).toEqual({ ok: false, why: 'usermod.why.from', vars: { name: 'use', from: 'read:0' } })
  })

  test('a line naming a value the file does not declare is refused, and the file names it', () => {
    expect(checkUserModule(text({ lines: ['GPU {use}% · VRAM {mem}'] }))).toEqual({ ok: false, why: 'usermod.why.value', vars: { name: 'mem' } })
  })

  test('a line or col below 1, or a scale of zero, is refused', () => {
    expect(checkUserModule(text({ values: { use: { from: 'run:0', line: 0, col: 1 } } }))).toEqual({ ok: false, why: 'usermod.why.pick', vars: { name: 'use' } })
    expect(checkUserModule(text({ values: { use: { from: 'run:0', line: 1, col: 0 } } }))).toEqual({ ok: false, why: 'usermod.why.pick', vars: { name: 'use' } })
    expect(checkUserModule(text({ values: { use: { from: 'run:0', line: 1, col: 1, scale: 0 } } }))).toEqual({ ok: false, why: 'usermod.why.pick', vars: { name: 'use' } })
  })
})

describe('the module a good file makes', () => {
  const made = () => {
    const check = checkUserModule(text())
    if (!check.ok) throw new Error(`refused: ${check.why}`)
    return toUserModule(check.def)
  }

  test('it carries the file\'s id, is a tile, and is listed under the user group', () => {
    const m = made()
    expect(`${m.id} ${m.role} ${m.group}`).toBe('user.gpu tile user')
  })

  test('its commands are passed through unchanged, so superstatus runs exactly what the file said', () => {
    expect(made().runs).toEqual([['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits']])
  })

  test('its name is English, and a language the file names is used when that language is on', () => {
    expect(made().name).toBe('GPU')
  })

  test('a line fills the value from the named line and column of what the command printed', () => {
    const m = made()
    expect(m.lines?.(input({ 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits': '37, 2048, 16384\n' }))).toEqual(['GPU 37%'])
  })

  test('a scale divides the number before it is shown', () => {
    const check = checkUserModule(text({ values: { use: { from: 'run:0', line: 1, col: 2, scale: 1024 } }, lines: ['VRAM {use}G'] }))
    if (!check.ok) throw new Error(`refused: ${check.why}`)
    expect(toUserModule(check.def).lines?.(input({ 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits': '37, 2048, 16384\n' }))).toEqual(['VRAM 2G'])
  })

  test('a command that could not be run shows ?, never a number from an earlier read', () => {
    const m = made()
    expect(m.lines?.(input({}))).toEqual(['GPU ?%'])
  })

  test('a line asked for that is not there shows ?, and so does a column that is not a number', () => {
    const m = made()
    expect(m.lines?.(input({ 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits': '\n' }))).toEqual(['GPU ?%'])
    expect(m.lines?.(input({ 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits': '[N/A], 2048\n' }))).toEqual(['GPU ?%'])
  })

  test('a blank line is not a line: a command that printed one first still has its numbers on line 1 (s43 mutant M12)', () => {
    const m = made()
    expect(m.lines?.(input({ 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits': '\n37, 2048, 16384\n' }))).toEqual(['GPU 37%'])
  })

  test('USER_MOD_ID is the rule the id must pass, so the pane and the check cannot drift apart', () => {
    expect([USER_MOD_ID.test('user.gpu'), USER_MOD_ID.test('host.gpu'), USER_MOD_ID.test('user.')]).toEqual([true, false, false])
  })
})

// s43, his 「好快點弄好包0.71」: a module file picks a chart by name. The drawing itself is chart.ts's, the same
// functions his office Mac's four modules already use; the file only says which shape and which numbers.
describe('a chart a module file asks for by name', () => {
  const BOX = { width: 280, height: 118 }
  const base = {
    format: 1, id: 'user.gpu', name: 'GPU', about: 'the GPUs', role: 'tile',
    runs: [['nvidia-smi', '--q']],
    values: { g0: { from: 'run:0', line: 1, col: 1 }, g1: { from: 'run:0', line: 2, col: 1 } },
    lines: ['GPU {g0}% · {g1}%'],
  }
  const of = (over: object) => {
    const check = checkUserModule(JSON.stringify({ ...base, ...over }))
    if (!check.ok) throw new Error(`refused: ${check.why}`)
    return toUserModule(check.def)
  }
  const refusal = (over: object) => checkUserModule(JSON.stringify({ ...base, ...over }))
  const fed = (text: string) => input({ 'nvidia-smi --q': text })
  const drawing = (source: string) => source.replace(/<style>[^<]*<\/style>/, '')
  const RINGS = { shape: 'rings', head: '67 GPU', items: [{ label: 'G0', percent: '{g0}', value: '{g0}%' }, { label: 'G1', percent: '{g1}', value: '{g1}%' }] }

  test('a file with no chart makes a module with no chart: lines only, as before', () => {
    const m = of({})
    expect([m.chart, m.tile]).toEqual([undefined, undefined])
  })

  test('rings: one ring an item, the head drawn, each ring showing its own number', () => {
    const svg = drawing(of({ chart: RINGS }).chart?.(fed('37\n82\n'), BOX) ?? '')
    // a ring is a track circle and, when it has a percent, an arc circle
    expect([...svg.matchAll(/<circle/g)]).toHaveLength(4)
    expect(svg).toContain('67 GPU')
    expect(svg).toContain('>37%<')
    expect(svg).toContain('>82%<')
    expect(svg).toContain('>G0<')
  })

  test('rings: a number that could not be read draws the track with no arc, and shows ?', () => {
    const svg = drawing(of({ chart: RINGS }).chart?.(fed('37\n'), BOX) ?? '')
    expect([...svg.matchAll(/<circle/g)]).toHaveLength(3)
    expect(svg).toContain('>?%<')
  })

  test('rings: a foot line is drawn under them, with its values filled in', () => {
    const svg = drawing(of({ chart: { ...RINGS, foot: 'two cards, busiest {g1}%' } }).chart?.(fed('37\n82\n'), BOX) ?? '')
    expect(svg).toContain('two cards, busiest 82%')
  })

  test('bars: one row an item, each with its label and value', () => {
    const svg = drawing(of({ chart: { shape: 'bars', items: [{ label: 'G0', percent: '{g0}', value: '{g0}%' }] } }).chart?.(fed('37\n'), BOX) ?? '')
    expect(svg).toContain('>G0<')
    expect(svg).toContain('>37%<')
    expect([...svg.matchAll(/<rect/g)].length).toBeGreaterThan(1)
  })

  test('tile: the H2 small card shows the words and the value with a bar under them', () => {
    const svg = drawing(of({ tile: { words: 'GPU', value: '{g0}%', percent: '{g0}' } }).tile?.(fed('37\n'), BOX) ?? '')
    expect(svg).toContain('>GPU<')
    expect(svg).toContain('>37%<')
  })

  test('a file that declares a chart and no tile gets the H2 small card for free: it draws, it is not the text line (s43, Alex 「應該是這樣 除非指定」)', () => {
    const m = of({ chart: RINGS })
    expect(typeof m.tile).toBe('function')
    const svg = drawing(m.tile?.(fed('37\n82\n'), { width: 206, height: 46 }) ?? '')
    expect(svg).toContain('>37%<')
    expect(svg.startsWith('<svg')).toBe(true)
  })

  test('the free H2 card takes the chart\'s head for its words, or the first item\'s label when there is no head', () => {
    expect(drawing(of({ chart: RINGS }).tile?.(fed('37\n82\n'), { width: 206, height: 46 }) ?? '')).toContain('>67 GPU<')
    const noHead = { shape: 'bars', items: [{ label: 'CPU', percent: '{g0}', value: '{g0}%' }] }
    expect(drawing(of({ chart: noHead }).tile?.(fed('37\n'), { width: 206, height: 46 }) ?? '')).toContain('>CPU<')
  })

  test('a file that writes its own tile keeps it: the free one never overrides what the file said', () => {
    const m = of({ chart: RINGS, tile: { words: 'mine', value: '{g1}%', percent: '{g1}' } })
    expect(drawing(m.tile?.(fed('37\n82\n'), { width: 206, height: 46 }) ?? '')).toContain('>mine<')
    expect(drawing(m.tile?.(fed('37\n82\n'), { width: 206, height: 46 }) ?? '')).toContain('>82%<')
  })

  test('a file with no chart still gets no tile: a module of plain lines is unchanged', () => {
    expect(of({}).tile).toBeUndefined()
  })

  test('a shape this superstatus does not draw is refused, and the file says which it asked for', () => {
    expect(refusal({ chart: { shape: 'pie', items: [{ label: 'G0', percent: '{g0}', value: '{g0}%' }] } })).toEqual({ ok: false, why: 'usermod.why.shape', vars: { got: 'pie' } })
  })

  test('a chart with nothing in it is refused', () => {
    expect(refusal({ chart: { shape: 'rings', items: [] } })).toEqual({ ok: false, why: 'usermod.why.items' })
  })

  test('a chart naming a value the file never declares is refused, as a line is', () => {
    expect(refusal({ chart: { shape: 'rings', items: [{ label: 'G0', percent: '{nope}', value: '{g0}%' }] } })).toEqual({ ok: false, why: 'usermod.why.value', vars: { name: 'nope' } })
    expect(refusal({ chart: { ...RINGS, foot: 'VRAM {mem}' } })).toEqual({ ok: false, why: 'usermod.why.value', vars: { name: 'mem' } })
    expect(refusal({ tile: { words: 'GPU', value: '{mem}', percent: '{g0}' } })).toEqual({ ok: false, why: 'usermod.why.value', vars: { name: 'mem' } })
  })
})

// s43: a user's module declares its own rhythm by name, exactly as a built-in carries one, so a card of it needs nothing set.
describe('a rhythm a module file declares', () => {
  const base = { format: 1, id: 'user.gpu', name: 'GPU', about: 'the GPU', role: 'tile', runs: [['nvidia-smi', '--q']],
    values: { use: { from: 'run:0', line: 1, col: 1 } }, lines: ['GPU {use}%'] }
  const made = (over: object) => {
    const check = checkUserModule(JSON.stringify({ ...base, ...over }))
    if (!check.ok) throw new Error(`refused: ${check.why}`)
    return toUserModule(check.def)
  }
  const refusal = (over: object) => checkUserModule(JSON.stringify({ ...base, ...over }))

  test('the four words become the seconds behind them', () => {
    expect([made({ every: 'fast' }).every, made({ every: 'normal' }).every, made({ every: 'slow' }).every, made({ every: 'turn' }).every]).toEqual([10, 60, 300, 0])
  })

  test('a file that says nothing carries no rhythm, and the minute stands', () => {
    expect(made({}).every).toBeUndefined()
  })

  test('a word this superstatus does not know is refused, and the file says which it asked for', () => {
    expect(refusal({ every: 'hourly' })).toEqual({ ok: false, why: 'usermod.why.every', vars: { got: 'hourly' } })
  })

  test('a number in place of a word is refused: the file picks a rhythm, it does not type seconds', () => {
    expect(refusal({ every: 30 })).toEqual({ ok: false, why: 'usermod.why.every', vars: { got: '30' } })
  })
})
