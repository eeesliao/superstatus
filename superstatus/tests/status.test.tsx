import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bandLabel, ESTIMATE_SPARE, estimateEm, fixed, MEASURED_EM, textEm } from '../hooks/labels'
import { BUILT_IN, EN, translator } from '../hooks/lang'
import { MODULES } from '../hooks/modules'

// What session-status must do (the owner, 2026-10-09 s27: 「資訊類型的放A」):
//  - one status line with text symbols: operator, block, tool calls, ctx, 5h, 7d, score band, pending pitfalls,
//    branch, uncommitted changes, fast-forward, and an optional note
//  - reads only the newest journal, MEMORY.md and Score.md; runs only three read-only git commands
//  - counts this session's main-loop tool calls from the stored rows (seeded once from the conversation);
//    a subagent's calls do not count; every row passes through unchanged; it never hooks tool.call
//  - /ss turns items on and off (git = branch, dirty, ff), sets a note, switches symbols to words; kept in the store
//  - anything it cannot read shows 未確認 or ?, never an empty line

const CWD = '/w'
const GIT_BRANCH = ['git', 'rev-parse', '--abbrev-ref', 'HEAD']
const GIT_DIRTY = ['git', 'status', '--porcelain']
const GIT_FF = ['git', 'merge-base', '--is-ancestor', 'HEAD', 'master']
const GIT_FF_MAIN = ['git', 'merge-base', '--is-ancestor', 'HEAD', 'main']
// the reverse direction: master is an ancestor of HEAD, so master can be fast-forwarded to HEAD
const GIT_CAN = ['git', 'merge-base', '--is-ancestor', 'master', 'HEAD']
const GIT_CAN_MAIN = ['git', 'merge-base', '--is-ancestor', 'main', 'HEAD']
const ALL_GIT = [GIT_BRANCH, GIT_DIRTY, GIT_FF, GIT_FF_MAIN, GIT_CAN, GIT_CAN_MAIN].map(a => a.join(' '))
const PRESENT = { isFullscreen: false, columns: 120 }
const FULL =
  '◉ Alex  ▣ B5  ⌗ 3  ◑ ctx 剩 50%  ◔ 5h 23%  ○ 7d 8%  ★ D  △ 2  ⎇ claude-mod-dev-04cc81  ± 2  ✓ 已快轉'

type Entry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }
type World = {
  files: Record<string, string>
  dir: Entry[]
  git: Record<string, { exitCode: number; stdout: string } | 'throw'>
  usage: unknown
  messages: unknown[]
  store: Record<string, unknown>
  status: (string | undefined)[]
  ran: string[][]
  runInit: Record<string, unknown>[]
  read: string[]
  // every path asked whether it exists (s37: a path never asked for is never read)
  checked: string[]
  now?: number
  // the test answers $.clock with mock.clock instead
  mockClock?: boolean
  opened: string[]
  // each pane's title as last opened, by its id
  titles: Record<string, string>
  closed: string[]
  commands: string[]
  registered: string[]
  // what each registered command's description says, by name
  described: Record<string, string>
  prompts: { text: string; asUser?: boolean }[]
  commandDeny?: string
  noBreakdown?: boolean
  listError?: string
  // other folders $.fs.list answers (s34: the language folder), by path
  dirs?: Record<string, Entry[]>
  usageError?: string
  // the surface cannot place a pane (ui.open answers isPlaced false)
  paneRefused?: boolean
  // what $.ui.toast showed, in order
  toasts: string[]
  // the built-in /reload-plugins refuses (s33)
  reloadRefused?: boolean
  // what $.fs.write wrote, in order (s36: profiles); the file lands in files and in its folder's dirs listing
  written?: string[]
  // $.fs.write refuses (a full disk, a folder it cannot make)
  writeError?: string
  // the tools the mod declared for the model (s41: the card tools), as $.tool.register got them
  tools?: { name: string; description: string; inputSchema?: Record<string, unknown>; isDeferred?: unknown }[]
}

function file(name: string, mtimeMs: number): Entry {
  return { name, kind: 'file', size: 10, mtimeMs, isLink: false }
}

function world(): World {
  return {
    files: {
      '/w/.claude/journal_2026-10-09_alex-s27.md': '0 WHO — Alex (answered the identity question; full scope)\n1 ADD — x\n',
      '/w/.claude/journal_2026-10-08_anna.md': '0 WHO — Anna (older)\n',
      '/w/MEMORY.md': [
        '## Active',
        'current_block: 5',
        '  · a narrative line that mentions a pitfall [PENDING] in passing does not count',
        '[PENDING] [2026-10-09] trap one — cause — (source: s27)',
        '- [PENDING] [2026-10-08] trap two — cause — (source: s26)',
      ].join('\n'),
      '/w/Score.md': '# Score\nscore_band: D\n',
    },
    dir: [
      file('journal_2026-10-08_anna.md', 1000),
      file('journal_2026-10-09_alex-s27.md', 2000),
      file('settings.json', 9000),
    ],
    git: {
      [GIT_BRANCH.join(' ')]: { exitCode: 0, stdout: 'claude/claude-mod-dev-04cc81\n' },
      [GIT_DIRTY.join(' ')]: { exitCode: 0, stdout: ' M a.md\n?? b.md\n' },
      [GIT_FF.join(' ')]: { exitCode: 0, stdout: '' },
    },
    usage: {
      startedAt: 0,
      context: { window: 200000, tokens: 82800, percent: 41.4 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23.2 },
        { kind: 'seven_day', percentUsed: 8 },
      ],
    },
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'two calls' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
          { type: 'tool_use', id: 't2', name: 'Read', input: {} },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'Edit', input: {} }] },
    ],
    store: { settings: { off: [], note: '', icons: true } },
    status: [],
    ran: [],
    runInit: [],
    read: [],
    checked: [],
    opened: [],
    titles: {},
    closed: [],
    commands: [],
    registered: [],
    described: {},
    prompts: [],
    toasts: [],
  }
}

// The test's hooks stand for the engine beneath the plugin. A call on $ answers { value }; an engine event its result.
function engine(on: On, w: World) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('command.register', ($, e) => {
    w.registered.push(e.name)
    w.described[e.name] = e.description ?? ''
    return { value: { command: e.name } }
  })
  on('ui.status', ($, e) => {
    w.status.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => {
    w.checked.push(e.path)
    return { value: e.path in w.files || (e.path === '/w/.claude' && w.dir.length > 0) || (w.dirs !== undefined && e.path in w.dirs) }
  })
  on('fs.list', ($, e) =>
    w.listError
      ? { deny: w.listError }
      : e.path === '/w/.claude'
        ? { value: w.dir }
        : w.dirs?.[e.path] !== undefined
          ? { value: w.dirs[e.path] }
          : { deny: `no such dir ${e.path}` },
  )
  on('fs.read', ($, e) => {
    w.read.push(e.path)
    const text = w.files[e.path]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    if (w.writeError) return { deny: w.writeError }
    ;(w.written ??= []).push(e.path)
    w.files[e.path] = e.text
    const slash = e.path.lastIndexOf('/')
    const folder = e.path.slice(0, slash)
    const name = e.path.slice(slash + 1)
    w.dirs = { ...(w.dirs ?? {}), [folder]: [...(w.dirs?.[folder] ?? []).filter(f => f.name !== name), file(name, w.now ?? 0)] }
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    w.ran.push([...e.argv])
    w.runInit.push({ ...(e.init ?? {}) })
    // rm -f -- <path> (s36: deleting a profile) takes the file out of the world
    if (e.argv[0] === 'rm') {
      const path = e.argv[e.argv.length - 1] ?? ''
      delete w.files[path]
      const slash = path.lastIndexOf('/')
      const folder = path.slice(0, slash)
      if (w.dirs?.[folder] !== undefined) w.dirs = { ...w.dirs, [folder]: w.dirs[folder].filter(f => f.name !== path.slice(slash + 1)) }
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const answer = w.git[e.argv.join(' ')]
    if (answer === undefined || answer === 'throw') return { deny: 'cannot start' }
    return { value: { ...answer, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // With { breakdown } the answer carries /context's rows: the compaction buffer is 33,000 of a 200,000 window,
  // so compaction starts at 167,000 tokens; 82,800 used leaves (167,000 - 82,800) / 167,000 = 50%.
  on('session.usage', ($, e) => {
    if (w.usageError) return { deny: w.usageError }
    const usage = w.usage as { context: Record<string, unknown> }
    if (!e.breakdown || w.noBreakdown) return { value: usage }
    const breakdown = {
      categories: [
        { name: 'Messages', tokens: 80000, color: 'x', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 87000, color: 'x', isDeferred: false, kind: 'free' },
        { name: 'Autocompact buffer', tokens: 33000, color: 'x', isDeferred: false, kind: 'buffer' },
      ],
      totalTokens: 80000, maxTokens: 200000, rawMaxTokens: 200000, percentage: 40, autocompactSource: 'auto',
    }
    return { value: { ...usage, context: { ...usage.context, breakdown } } }
  })
  on('session.messages', () => ({ value: w.messages }))
  // another mod's command, as the 開關卡 sends it
  on('command.run', { command: 'probe' }, ($, e) => {
    // a command.run hook answers a result, not { deny }: a failing command throws, and the caller's promise rejects
    if (w.commandDeny) throw new Error(w.commandDeny)
    w.commands.push(`probe ${e.args}`.trim())
    return { text: e.args === 'off' ? '探針：關' : '探針：開' }
  })
  // the engine's own /reload-plugins, as $.command.run reaches it (s33)
  on('command.run', { command: 'reload-plugins' }, () => {
    if (w.reloadRefused) throw new Error('reload-plugins refused')
    w.commands.push('reload-plugins')
    return { text: '' }
  })
  on('prompt.submit', ($, e) => {
    w.prompts.push({ text: e.text, asUser: (e.origin as { asUser?: boolean }).asUser })
    return { text: e.text }
  })
  if (!w.mockClock) on('clock.now', () => (w.now === undefined ? { deny: 'no clock in this test' } : { value: w.now }))
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    w.titles[e.id] = e.title
    if (w.paneRefused) return { value: { isPlaced: false, reason: 'no pane here' } }
    return { value: { isPlaced: true } }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.close', ($, e) => {
    w.closed.push(e.id)
    return { value: undefined }
  })
  on('tool.register', ($, e) => {
    ;(w.tools ??= []).push({ ...e })
    return { value: { tool: `mcp__superstatus__${e.name}` } }
  })
  on('store.get', ($, e) => ({ value: w.store[e.key] }))
  on('store.set', ($, e) => {
    w.store[e.key] = e.value
    return { value: undefined }
  })
  // session.append: the kit's own bottom stores the row (a test hook may not answer it without next)
  on('turn.complete', ($, e) => ({ text: e.answer }))
}

async function start($: Engine) {
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
}

function last(w: World) {
  return w.status[w.status.length - 1]
}

async function sl($: Engine, args: string) {
  return $.command.run({ command: 'ss', args, origin: { kind: 'composer' }, presentation: PRESENT })
}

function row(blocks: unknown[], agentId?: string) {
  return {
    message: { type: 'assistant' as const, role: 'assistant' as const, content: blocks as never },
    door: 'response' as const,
    origin: { kind: 'model' as const, model: 'claude-opus-5-5' },
    uuid: `u-${Math.random()}`,
    ...(agentId ? { agentId } : {}),
  }
}

const TOOL = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: {} })

// the owner 2026-10-09 s29: by eE v0.1 went on the status line, then off it (「拿掉」) when the version became a button first in TouchBar
// (「by eE v0.1 新增一個版本號的按鈕 放在第一個」); the mod's own text was also a different size from the engine's superstatus in front.
test('the status line has no by eE v0.1 in front: the 版本號 card\'s version (v.0.85 since the s45 store fixes, his 「版本修正成 v0.85」; v.0.8 from s45, the first public release, his v0.8 Beta; v.0.7.5 from s43; v.0.7 since s42, the touchbar paging seen on his desktop (the version rule of s40); v.0.6 from s40, Alex 「目前SS版本號應該要往前到0.6了」; v.0.3 from s35, 「好全小寫 superstatus@ccssm」), then the items', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  expect(w.status[w.status.length - 1]).not.toContain('by eE')
  expect(w.status[w.status.length - 1]).toBe('v.0.85  Alex  進度 5  目前剩下 50%  五小時 23%  每週 8%  ✓ 已快轉')
})

test('with every item off the status line is cleared', async ($, on) => {
  const w = world()
  w.store = { settings: { off: [...DEFAULT_ORDER], note: '', icons: false } }
  engine(on, w)
  await start($)

  expect(w.status.length).toBeGreaterThan(0)
  expect(w.status[w.status.length - 1]).toBeUndefined()
})

test('with nothing stored, the line shows the operator name, 進度, 目前剩下, 額度 in words, then whether master can be fast-forwarded (Alex 2026-10-09)', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  // the owner 2026-10-09: the 5-hour quota reads 五小時 (it was 目前 for a while), the 7-day one 每週; context shows what is left before compaction
  expect(last(w)).toBe('v.0.85  Alex  進度 5  目前剩下 50%  五小時 23%  每週 8%  ✓ 已快轉')
})

test('on load it shows every item with text symbols and runs only the three read-only git commands', async ($, on) => {
  const w = world()
  engine(on, w)
  await start($)

  // 版本號 (v.0.85) is first on the line since s29
  expect(last(w)).toBe(`v.0.85  ${FULL}`)
  for (const argv of w.ran) {
    expect(ALL_GIT).toContain(argv.join(' '))
  }
  expect(w.ran.length).toBeGreaterThan(0)
})

test('it reads only the newest journal, MEMORY.md and Score.md', async ($, on) => {
  const w = world()
  engine(on, w)
  await start($)

  for (const path of w.read) {
    expect(['/w/.claude/journal_2026-10-09_alex-s27.md', '/w/MEMORY.md', '/w/Score.md']).toContain(path)
  }
  expect(w.read).toContain('/w/.claude/journal_2026-10-09_alex-s27.md')
})

test('main-loop tool calls are counted as rows are stored; a subagent does not count; rows pass unchanged', async ($, on) => {
  const w = world()
  engine(on, w)
  await start($)

  const mine = row([{ type: 'text', text: 'x' }, TOOL('t4'), TOOL('t5')])
  const stored = await $.session.append(mine)
  expect(stored.message).toEqual(mine.message)
  expect(last(w)).toContain('⌗ 5')

  await $.session.append(row([TOOL('s1')], 'agent-1'))
  expect(last(w)).toContain('⌗ 5')

  // a reload (session.start again) keeps the count instead of seeding it again
  await start($)
  expect(last(w)).toContain('⌗ 5')
})

test('/ss turns items off and on, git is a group, a note shows, icons off shows words, and the choice is stored', async ($, on) => {
  const w = world()
  w.paneRefused = true // the listing row: bare /ss where no pane can be placed (s30)
  engine(on, w)
  await start($)

  const list = await sl($, '')
  // no heading of its own that repeats the mod's name (the owner 2026-10-09)
  expect(list.text?.startsWith('項目（名稱、開／關、目前的值）：')).toBe(true)
  // the owner 2026-10-09 s28: the mod is named superstatus (the status line at the bottom shows it in front)
  expect(list.text).not.toContain('superstatus')
  expect(list.text).toContain('ctx')
  expect(list.text).toContain('開')
  // the owner 2026-10-09 s28 「壓縮門檻 97% 也刪掉不需要了」: the threshold is still read (目前剩下 is counted from it) but not shown
  expect(list.text).not.toContain('壓縮門檻')
  // symbols are on in this test: 目前剩下 reads ctx 剩
  expect(list.text).toContain('ctx　開　◑ ctx 剩 50%')
  expect(list.text).not.toContain('來源')
  expect(list.text).not.toContain('tokens')

  await sl($, 'off ctx')
  expect(last(w)).not.toContain('ctx')

  await sl($, 'off git')
  expect(last(w)).not.toContain('⎇')
  expect(last(w)).not.toContain('±')
  expect(last(w)).not.toContain('快轉')

  await sl($, 'note 今天先做 UPS')
  expect(last(w)?.endsWith('✎ 今天先做 UPS')).toBe(true)

  await sl($, 'icons off')
  expect(last(w)?.startsWith('v.0.85  Alex  進度 5  工具 3')).toBe(true)
  expect(last(w)).toContain('備註 今天先做 UPS')

  await sl($, 'on ctx')
  expect(last(w)).toContain('目前剩下 50%')

  expect(w.store['settings']).toEqual({ off: ['branch', 'dirty', 'ff'], note: '今天先做 UPS', icons: false, order: DEFAULT_ORDER, cards: [], collapsed: false, aboveOrder: [], aboveCollapsed: false, touchCollapsed: false, h3Collapsed: false, h2Collapsed: false, h3HalfCollapsed: false, h3FullCollapsed: false, h2HalfCollapsed: false, h2FullCollapsed: false, removed: [], aboveOff: [] })
})

test('what is left before compaction follows each stored row', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  ;(w.usage as { context: { tokens: number } }).context.tokens = 117000
  await $.session.append(row([TOOL('t9')]))
  // (167,000 - 117,000) / 167,000 = 29.9% -> 30%
  expect(last(w)).toContain('目前剩下 30%')
})

// the owner 2026-10-09: bare /ss is an interface, one drawing for phone and desktop (Box, Text and Button exist on all four).
const FOUR = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const PANEL = { command: 'ss', args: '', text: 'superstatus: 項目…', isErrored: false }
// s36 (the owner 「你先做我們再細修」 on the 編輯 table): the desktop's 編輯 draws the cards as a grid to drag (a Client region); the arrows,
// the numbers and 刪除 under each card stay on the surfaces with no Client region (the phone, VS Code) and the terminal: the tests of
// those read them on the phone, which draws the panel as the desktop did.
const SORT_SURFACE = 'mobile' as const
// the owner 2026-10-09 「高亮跟反灰」: no 開／關 words. An item that is on is lit (a primary button, a bright card border),
// one that is off is greyed out (a secondary button, a grey border); the button carries the item's name.
const NAME_OF: Record<string, string> = {
  who: '操作者', block: '進度', tools: '工具次數', ctx: '目前剩下', '5h': '五小時', '7d': '每週',
  score: '分數', pending: '待決議', branch: '分支', dirty: '待存檔', ff: '快轉', icons: '符號',
}
// The name without the layout spaces (full-width U+3000, en space U+2002), and a label's width in Chinese characters.
const bare = (text: string | undefined) => text?.replace(/[\u3000\u2002\u2005]/g, '')
// a picture's drawing: its source less the day rules every picture carries since s39 (which name every colour of the palette)
const drawingOf = (source: string) => source.replace(/<style>[^<]*<\/style>/, '')
// U+3000 is one character wide, U+2002 half a character, U+2005 a quarter.
const em = (text: string) => [...text].reduce((sum, c) => sum + (c === '\u2002' ? 0.5 : c === '\u2005' ? 0.25 : 1), 0)
// A label without the en and quarter spaces at its ends (a word padded to a width, s37), its inside kept.
const unpadded = (text: string) => text.replace(/^[\u2002\u2005]+|[\u2002\u2005]+$/g, '')
// A band button's label starts with its place in superscript digits in place of one en space (s28): put the en space back.
const unnumbered = (text: string | undefined) => (text === undefined ? undefined : '\u2002' + text.replace(/^[⁰¹²³⁴⁵⁶⁷⁸⁹]+/, ''))
// Every name button is 5.5 characters wide: four characters and three half-character gaps (the owner 2026-10-09).
const BUTTON_EM = 5.5
type Found = { text: string; props: Record<string, unknown> } | undefined
type Mount = { find: (q: object) => Promise<Found> }
async function look(ui: Mount, key: string) {
  const button = await ui.find({ type: 'Button', key: `toggle-${key}` })
  const card = await ui.find({ type: 'Box', key: `card-${key}` })

  return { name: bare(button?.text), variant: button?.props['variant'], border: card?.props['borderColor'] }
}
const LIT = (key: string) => ({ name: NAME_OF[key], variant: 'primary', border: 'text' })
const GREY = (key: string) => ({ name: NAME_OF[key], variant: 'secondary', border: 'subtle' })

// The default order of the items: the status line's own (the owner can move them).
// 版本號 (ver) first since s29
const DEFAULT_ORDER = ['ver', 'who', 'block', 'tools', 'ctx', '5h', '7d', 'score', 'pending', 'branch', 'dirty', 'ff']
const WITH_BUTTON_ON = ['who', 'block', 'ctx', '5h', '7d', 'ff']
const WITH_BUTTON_OFF = ['tools', 'score', 'pending', 'branch', 'dirty']

test('bare /ss is a panel of on/off buttons with no mod name in front, drawn the same on all four surfaces', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  for (const surface of FOUR) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
    expect(await ui.find({ type: 'Text', text: /^superstatus:/ })).toBeUndefined()
    // the owner 2026-10-09 s28: the 亮的是開 sentence gave way to the status line itself, beside session-status
    expect(await ui.find({ type: 'Text', text: /亮的是開，灰的是關/ })).toBeUndefined()
    // the owner 2026-10-09 s28: the header reads Status Line (sl before; the mod keeps its name; only what is shown changes)
    expect(await ui.find({ type: 'Text', text: /^StatusLine$/ })).toBeDefined()
    for (const key of WITH_BUTTON_ON) expect(await look(ui, key)).toEqual(LIT(key))
    for (const key of WITH_BUTTON_OFF) expect(await look(ui, key)).toEqual(GREY(key))
    expect(await look(ui, 'icons')).toEqual(GREY('icons'))
    expect(await ui.find({ type: 'Text', text: /^(開|關)$/ })).toBeUndefined()
    // the owner 2026-10-09 「按鈕大小可以固定」: every name is padded with full-width spaces to four characters
    for (const key of [...WITH_BUTTON_ON, ...WITH_BUTTON_OFF, 'icons']) {
      expect(em((await ui.find({ type: 'Button', key: `toggle-${key}` }))?.text ?? '')).toBe(BUTTON_EM)
    }
    await ui.unmount()
  }
})

test('pressing a button turns the item off and on, on the status line and in the panel, and keeps the choice', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })

    await ui.press({ key: 'toggle-ctx' })
    expect(last(w)).not.toContain('目前剩下')
    expect(await look(ui, 'ctx')).toEqual(GREY('ctx'))
    expect((w.store['settings'] as { off: string[] }).off).toContain('ctx')

    await ui.press({ key: 'toggle-ctx' })
    expect(last(w)).toContain('目前剩下 50%')
    expect(await look(ui, 'ctx')).toEqual(LIT('ctx'))
    await ui.unmount()
  }

  // every button is wired to its own item: 工具次數 is off by default, 操作者 is on
  const own = await $.ui.mount({ plugin: 'superstatus', surface: 'mobile', component: 'CommandOutput', props: PANEL })
  await own.press({ key: 'toggle-tools' })
  expect(last(w)).toContain('工具 3')
  expect(last(w)).toContain('目前剩下 50%')
  await own.press({ key: 'toggle-who' })
  expect(last(w)?.startsWith('Alex')).toBe(false)
  expect(last(w)).toContain('目前剩下 50%')
  await own.press({ key: 'toggle-who' })
  await own.press({ key: 'toggle-tools' })

  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  await ui.press({ key: 'toggle-icons' })
  expect(last(w)).toContain('◉ Alex')
  expect(await look(ui, 'icons')).toEqual(LIT('icons'))
})

// the owner 2026-10-09 「照示意圖做」: a framed panel in three groups, bars for 目前剩下 / 五小時 / 每週 coloured by how full they are.
const BARS = { type: 'Text', text: /[█░]/ }

test('the panel is one rounded card per item in one row, no groups, no frame around it all, the same on all four surfaces', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  for (const surface of FOUR) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
    expect((await ui.find({ type: 'Box' }))?.props['borderStyle']).toBeUndefined()
    for (const key of [...WITH_BUTTON_ON, ...WITH_BUTTON_OFF]) {
      expect((await ui.find({ type: 'Box', key: `card-${key}` }))?.props['borderStyle']).toBe('round')
    }
    // the owner 2026-10-09 picked C: no groups, the items in one order, the 符號 card last
    for (const group of [/^用量$/, /^這一場$/, /^專案$/]) expect(await ui.find({ type: 'Text', text: group })).toBeUndefined()
    const cards = (await ui.findAll({ type: 'Box' })).map(b => String(b.key)).filter(k => k.startsWith('card-'))
    expect(cards).toEqual([...DEFAULT_ORDER, 'icons'].map(k => `card-${k}`))
    // no threshold line (the owner 2026-10-09 s28)
    expect(await ui.find({ type: 'Text', text: /壓縮門檻/ })).toBeUndefined()
    await ui.unmount()
  }
})

// the owner 2026-10-09 「你直接用svg好了」: where the surface has Svg the bars are thin SVG lines; the terminal has no Svg
// and keeps ten text blocks. Svg is a leaf (no Buttons inside), so the labels and the on/off buttons stay native.
const HEX = { success: '#3fb950', warning: '#d29922', error: '#f85149' }

test('terminal: 目前剩下, 五小時 and 每週 get a ten-block bar coloured green, yellow or red', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  const fine = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'CommandOutput', props: PANEL })
  expect(await fine.findAll({ type: 'Svg' })).toHaveLength(0)
  const bars = await fine.findAll(BARS)
  expect(bars.map(b => b.text)).toEqual(['█████░░░░░', '██░░░░░░░░', '█░░░░░░░░░'])
  expect(bars.map(b => b.props['color'])).toEqual(['success', 'success', 'success'])
  // on the 快轉 card (the header carries the status line, 已快轉 included, since s28)
  const ffCard = await fine.find({ type: 'Box', key: 'card-ff' })
  expect(walk(ffCard?.children).find(el => el.type === 'Text' && /已快轉/.test(String(el.children?.[0])))?.props['color']).toBe('success')
})

// Every card is a dial now (the owner 2026-10-09 「照這個做」); the three rings are the dials named 目前剩下, 五小時, 每週.
const RING_ALT = /^(目前剩下|五小時|每週) /

// the owner 2026-10-09 (Apple Watch rings, then 「有缺口」): 72 px ring open at the bottom, 270 degrees = 136.7 of the circumference
// 182.2; the arc = the percentage of those 136.7; the percent inside
// a dark disc of its own, a gap under the ring, then the name.
test('desktop and vscode: 目前剩下, 五小時 and 每週 are rings with the percent inside and a gap, then the name, under them', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
    expect(await ui.findAll(BARS)).toHaveLength(0)
    const rings = (await ui.findAll({ type: 'Svg' })).filter(r => RING_ALT.test(String(r.props['alt'])))
    expect(rings.map(r => r.props['alt'])).toEqual(['目前剩下 50%', '五小時 23%', '每週 8%'])
    // the first circle is the track (always 136.7), the last the arc: 50.4% -> 68.9, 23.2% -> 31.7, 8% -> 10.9
    const arc = (src: string) => [...src.matchAll(/stroke-dasharray="([\d.]+) /g)].pop()?.[1]
    expect(rings.map(r => arc(drawingOf(String(r.props['source']))))).toEqual(['68.9', '31.7', '10.9'])
    for (const r of rings) {
      // open at the bottom: both circles start at the bottom left
      expect([...drawingOf(String(r.props['source'])).matchAll(/rotate\(135 36 36\)/g)]).toHaveLength(2)
      expect(drawingOf(String(r.props['source']))).toContain('stroke-dasharray="136.7 182.2"')
    }
    const inside = (src: string) => />(\d+%)<\/text>/.exec(src)?.[1]
    expect(rings.map(r => inside(drawingOf(String(r.props['source']))))).toEqual(['50%', '23%', '8%'])
    for (const r of rings) expect(drawingOf(String(r.props['source']))).toContain(HEX.success)

    // the name sits under the ring after a one-row gap
    for (const [key, name] of [['ctx', '目前剩下'], ['5h', '五小時'], ['7d', '每週']]) {
      const under = await ui.find({ type: 'Box', key: `name-${key}` })
      expect(under?.props['marginTop']).toBe(1)
      expect(bare(under?.text)).toBe(name)
    }
  }
})

test('a ring at 0% has no arc and a ring at 100% is a full circle', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  // 目前剩下 0% (tokens past the threshold), 五小時 0%, 每週 100%
  w.usage = {
    startedAt: 0,
    context: { window: 200000, tokens: 170000, percent: 85 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 0 },
      { kind: 'seven_day', percentUsed: 100 },
    ],
  }
  engine(on, w)
  await start($)

  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const sources = (await ui.findAll({ type: 'Svg' })).filter(r => RING_ALT.test(String(r.props['alt']))).map(r => drawingOf(String(r.props['source'])))
  // no coloured arc at 0% (a round cap would draw a dot), the whole 270 degrees at 100%
  expect(sources[0]).not.toMatch(/stroke="#(3fb950|d29922|f85149)"/)
  expect(sources[1]).not.toMatch(/stroke="#(3fb950|d29922|f85149)"/)
  expect(sources[2]).toContain('stroke="#f85149" stroke-width="8" stroke-linecap="round" stroke-dasharray="136.7 182.2"')
})

test('the colours turn yellow and red with how full each one is, in the rings and in the text blocks', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  // 目前剩下 5% ((167,000 - 158,650) / 167,000), 五小時 70%, 每週 90%
  w.usage = {
    startedAt: 0,
    context: { window: 200000, tokens: 158650, percent: 79 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 70 },
      { kind: 'seven_day', percentUsed: 90 },
    ],
  }
  engine(on, w)
  await start($)

  const desk = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const arcColour = (src: string) => /stroke="(#[0-9a-f]{6})" stroke-width="8" stroke-linecap/.exec(src)?.[1]
  const colours = (await desk.findAll({ type: 'Svg' })).filter(r => RING_ALT.test(String(r.props['alt']))).map(r => arcColour(drawingOf(String(r.props['source']))))
  expect(colours).toEqual([HEX.error, HEX.warning, HEX.error])

  const term = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'CommandOutput', props: PANEL })
  expect((await term.findAll(BARS)).map(b => b.props['color'])).toEqual(['error', 'warning', 'error'])
})

test('a value that could not be read shows no bar and no NaN, on terminal and desktop', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  w.usage = { startedAt: 0, context: { window: 200000 }, rateLimits: [] }
  engine(on, w)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
    expect(await ui.findAll(BARS)).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /NaN/ })).toBeUndefined()
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: /^\?$/ })).toBeDefined()
    } else {
      const rings = (await ui.findAll({ type: 'Svg' })).filter(r => RING_ALT.test(String(r.props['alt'])))
      expect(rings.map(r => r.props['alt'])).toEqual(['目前剩下 ?', '五小時 ?', '每週 ?'])
      for (const r of rings) {
        expect(drawingOf(String(r.props['source']))).toContain('>?</text>')
        expect(drawingOf(String(r.props['source']))).not.toMatch(/stroke="#(3fb950|d29922|f85149)"/)
      }
    }
    expect(await ui.find({ type: 'Button', key: 'toggle-ctx' })).toBeDefined()
  }
})

test('the pending item reads 待 on the line and 待決議 in the panel (Alex 2026-10-09)', async ($, on) => {
  const w = world()
  w.store = { settings: { off: [], note: '', icons: false } }
  engine(on, w)
  await start($)

  expect(last(w)).toContain('待 2')
  expect(last(w)).not.toContain('坑')
  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  expect(bare((await ui.find({ type: 'Button', key: 'toggle-pending' }))?.text)).toBe('待決議')
  expect(await ui.find({ type: 'Text', text: /待判/ })).toBeUndefined()
})

test('the changed-files item reads 可存 on the line and 待存檔 in the panel (Alex 2026-10-09)', async ($, on) => {
  const w = world()
  w.store = { settings: { off: [], note: '', icons: false } }
  engine(on, w)
  await start($)

  // two files in git status --porcelain
  expect(last(w)).toContain('可存 2')
  expect(last(w)).not.toContain('改 2')
  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  expect(bare((await ui.find({ type: 'Button', key: 'toggle-dirty' }))?.text)).toBe('待存檔')
  expect(await ui.find({ type: 'Text', text: /未提交/ })).toBeUndefined()
})

// the owner 2026-10-09 「把所有框框大小對齊 目前剩下那欄的大小」: every card is as wide as the ring (72 px) and as tall as a ring card.
// A ring card is a 72 px picture, one row of margin and a button; any other card is a value and a button, which measured
// 61 px shorter on the owner's desktop (screenshot 2026-10-09), so transparent 72 px wide spacers add those 61 px around the value.
type El = { type: string; props: Record<string, unknown>; children?: unknown[] }
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) for (const c of node) walk(c, out)
  else if (node && typeof node === 'object' && 'type' in node) {
    const el = node as El
    out.push(el)
    walk(el.children ?? [], out)
  }

  return out
}

test('every card is the same shape: one 72 px dial, the name under it after one row of margin', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
    for (const key of [...WITH_BUTTON_ON, ...WITH_BUTTON_OFF, 'icons']) {
      const card = await ui.find({ type: 'Box', key: `card-${key}` })
      // the small number badge is a picture too; the dial is the one 72 px wide
      const pictures = walk(card?.children).filter(el => el.type === 'Svg' && el.props['width'] === 72)
      expect(pictures).toHaveLength(1)
      expect(pictures[0]?.props['width']).toBe(72)
      expect(pictures[0]?.props['height']).toBe(72)
      expect((await ui.find({ type: 'Box', key: `name-${key}` }))?.props['marginTop']).toBe(1)
    }
    await ui.unmount()
  }
})

// the owner 2026-10-13 s36 「按鈕裡面加的那個小白框拿掉」 (A: the frame round each card's name button, added in s33 「直接幫卡片裡面的按鈕畫一個
// 白外框」): the name button stands in its plain room under the dial, no frame; the card's own border still says lit or grey.
test('the name button has no frame of its own: its room under the dial has no border, on every card', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
    for (const key of [...WITH_BUTTON_ON, ...WITH_BUTTON_OFF, 'icons']) {
      const room = await ui.find({ type: 'Box', key: `name-${key}` })
      expect(room).toBeDefined()
      expect(room?.props['borderStyle']).toBeUndefined()
      expect(room?.props['borderColor']).toBeUndefined()
      expect(room?.props['marginTop']).toBe(1)
    }
    expect((await ui.find({ type: 'Box', key: 'card-ctx' }))?.props['borderStyle']).toBe('round')
    await ui.unmount()
  }
})

// the owner 2026-10-09 s29 「status line 這邊的卡片長寬都要寫死固定」「沒有內容的時候元素也不能跑位」 (screenshot 1.webp: the 進度 card, with no
// source in the project, had a dim name and no button, was 20 px narrower and moved the cards after it): every Status Line card is made
// of the same fixed-size parts, a 72 px dial and a 5.5-character name button, whether or not it has something to show.
test('a card with nothing to show has the same parts as every other card: one 72 px dial and the name button, in the panel and the pane', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  w.files['/w/MEMORY.md'] = String(w.files['/w/MEMORY.md']).replace('current_block: 5\n', '')
  engine(on, w)
  await start($)

  const sites = [
    await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL }),
    await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', requestId: 'ss-panel',
      props: { title: '設定SS', isFocused: false, bodyColumns: 80, placement: 'dock' } as never }),
  ]
  for (const ui of sites) {
    expect((await ui.findAll({ type: 'Svg' })).find(d => d.props['alt'] === '進度 沒有')).toBeDefined()
    for (const key of ['who', 'block', 'ctx']) {
      const card = await ui.find({ type: 'Box', key: `card-${key}` })
      const parts = walk(card?.children).filter(el => el.type === 'Svg' || el.type === 'Button' || el.type === 'Text')
      expect(parts.map(el => el.type)).toEqual(['Svg', 'Button'])
      expect(parts[0]?.props['width']).toBe(72)
      expect(parts[1]?.props['label']).toBe(fixed(NAME_OF[key] ?? ''))
    }
    // lit = on (「高亮跟反灰」), with or without something to show
    expect((await ui.find({ type: 'Box', key: 'card-block' }))?.props['borderColor']).toBe(
      (await ui.find({ type: 'Box', key: 'card-who' }))?.props['borderColor'])
  }
  // the terminal draws text in place of the dial, and the same name button
  const terminal = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'CommandOutput', props: PANEL })
  expect(bare((await terminal.find({ type: 'Button', key: 'toggle-block' }))?.text)).toBe('進度')
  expect(await terminal.find({ type: 'Text', text: /^進度$/ })).toBeUndefined()
})

// the owner 2026-10-09 「照這個做」: the value is inside the disc; 快轉 and 待決議 above 0 get a full arc in their tone.
test('every dial carries its value inside the disc; 快轉 has a full green arc, 待決議 above 0 a full yellow one, plain values none', async ($, on) => {
  const w = world()
  // everything on: an item that is off is grey, whatever its colour would be
  w.store = { settings: { off: [], note: '', icons: false } }
  engine(on, w)
  await start($)

  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const dials = (await ui.findAll({ type: 'Svg' })).filter(d => d.props['width'] === 72)
  expect(dials.map(d => d.props['alt'])).toEqual([
    '版本號 v.0.85', '操作者 Alex', '進度 5', '工具次數 3', '目前剩下 50%', '五小時 23%', '每週 8%', '分數 D', '待決議 2', '分支 分支路徑', '待存檔 2', '快轉 已快轉', '符號 用文字',
  ])
  const source = (alt: string) => drawingOf(String(dials.find(d => d.props['alt'] === alt)?.props['source']))
  const COLOURED = /stroke="#(3fb950|d29922|f85149)"/
  expect(source('操作者 Alex')).toContain('>Alex</text>')
  expect(source('操作者 Alex')).not.toMatch(COLOURED)
  expect(source('分支 分支路徑')).toContain('>分支路徑</text>')
  expect(source('快轉 已快轉')).toContain('stroke="#3fb950" stroke-width="8" stroke-linecap="round" stroke-dasharray="136.7 182.2"')
  expect(source('待決議 2')).toContain('stroke="#d29922" stroke-width="8" stroke-linecap="round" stroke-dasharray="136.7 182.2"')
  expect(source('進度 5')).not.toMatch(COLOURED)
  expect(source('待存檔 2')).not.toMatch(COLOURED)
})

test('an item that is off is greyed out in the picture too: a grey arc and grey text, whatever its tone would be', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  // 待決議 is off by default and counts 2 (it would be yellow); 目前剩下 is on (green)
  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const dials = await ui.findAll({ type: 'Svg' })
  const off = drawingOf(String(dials.find(d => d.props['alt'] === '待決議 2')?.props['source']))
  expect(off).toContain('stroke="#808080" stroke-width="8" stroke-linecap="round" stroke-dasharray="136.7 182.2"')
  expect(off).not.toContain('#d29922')
  expect(off).toContain('fill="#8a8a8a"')
  const on_ = drawingOf(String(dials.find(d => d.props['alt'] === '目前剩下 50%')?.props['source']))
  expect(on_).toContain('fill="#f2f2f2"')
})

test('a value that comes from a file is escaped before it goes into the picture', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  w.files['/w/.claude/journal_2026-10-09_alex-s27.md'] = '0 WHO — <b>&x (odd)\n'
  engine(on, w)
  await start($)

  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const who = drawingOf(String((await ui.findAll({ type: 'Svg' })).find(d => String(d.props['alt']).startsWith('操作者'))?.props['source']))
  expect(who).toContain('&lt;b&gt;&amp;x</text>')
  expect(who).not.toContain('<b>')
})

// the owner 2026-10-09 「內容的部分也置中對其」: not only the card's own Box, every column inside it centres its items.
test('everything inside a card is centred, on terminal and desktop', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
    for (const key of [...WITH_BUTTON_ON, ...WITH_BUTTON_OFF, 'icons']) {
      const card = await ui.find({ type: 'Box', key: `card-${key}` })
      expect(card?.props['alignItems']).toBe('center')
      const columns = walk(card?.children).filter(el => el.type === 'Box' && el.props['flexDirection'] === 'column')
      for (const column of columns) expect(column.props['alignItems']).toBe('center')
    }
  }
})

// the owner 2026-10-09 picked C: 排序 shows ← → under every card; the order is shared with the status line.
const ORDER_OF = async (ui: Mount & { findAll: (q: object) => Promise<{ key?: string }[]> }) =>
  (await ui.findAll({ type: 'Box' })).map(b => String(b.key)).filter(k => k.startsWith('card-')).map(k => k.slice(5)).filter(k => k !== 'icons')

describe('sorting the cards', () => {
  // s36 the owner 「可以用編輯按鈕鎖定拖曳的動作嗎」: 排序 reads 編輯 (it locks the drag on the desktop)
  test('a 編輯 button (排序 until s36), four characters wide; no arrows until it is pressed, none under the 符號 card', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    const sort = await ui.find({ type: 'Button', key: 'sort' })
    expect(bare(sort?.text)).toBe('編輯')
    expect(em(sort?.text ?? '')).toBe(BUTTON_EM)
    expect(sort?.props['variant']).toBe('secondary')
    expect(await ui.find({ type: 'Button', key: 'left-who' })).toBeUndefined()

    await ui.press({ key: 'sort' })
    expect((await ui.find({ type: 'Button', key: 'sort' }))?.props['variant']).toBe('primary')
    for (const key of DEFAULT_ORDER) {
      expect(bare((await ui.find({ type: 'Button', key: `left-${key}` }))?.text)).toBe('←')
      expect(bare((await ui.find({ type: 'Button', key: `right-${key}` }))?.text)).toBe('→')
    }
    expect(await ui.find({ type: 'Button', key: 'left-icons' })).toBeUndefined()
    // the two ends cannot move further: dim
    // 版本號 is first since s29
    expect((await ui.find({ type: 'Button', key: 'left-ver' }))?.props['dimColor']).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'left-who' }))?.props['dimColor']).toBe(false)
    expect((await ui.find({ type: 'Button', key: 'right-ff' }))?.props['dimColor']).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'left-block' }))?.props['dimColor']).toBe(false)

    await ui.press({ key: 'sort' })
    expect(await ui.find({ type: 'Button', key: 'left-who' })).toBeUndefined()
  })

  // the owner 2026-10-09 「箭頭跟上面按鈕太貼了 間距要跟箭頭中間預設的一樣」: the arrows are as far below the name as they are from each other.
  test('the ← → row sits below the name button at the same distance as the gap between the two arrows', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    for (const surface of ['terminal', SORT_SURFACE] as const) {
      const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
      await ui.press({ key: 'sort' })
      for (const key of DEFAULT_ORDER) {
        const row = await ui.find({ type: 'Box', key: `move-${key}` })
        expect(row?.props['gap']).toBeGreaterThan(0)
        expect(row?.props['marginTop']).toBe(row?.props['gap'])
      }
      // the sort mode is shared by every open panel: turn it off again for the next surface
      await ui.press({ key: 'sort' })
    }
  })

  // the owner 2026-10-09 「箭頭左右邊緣可以對其按鈕左右邊緣嗎」: the outer edges of the ← → pair line up with the edges of the name button.
  // Measured in his screenshot (2000 px wide): a character is E = 27 px (the centres of neighbouring characters are 1.5 E apart),
  // a button has 13.5 px of its own on each side, the arrow glyph is 23.5 px, the gap between the two arrows (one cell) 19 px.
  test('the ← → pair is as wide as the name button above it, to within 3 px', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'sort' })
    const E = 27
    const side = 13.5
    const glyph = 23.5
    const gap = 19
    for (const key of DEFAULT_ORDER) {
      const left = (await ui.find({ type: 'Button', key: `left-${key}` }))?.text ?? ''
      const right = (await ui.find({ type: 'Button', key: `right-${key}` }))?.text ?? ''
      expect(left).toBe('\u2002←\u2002')
      expect(right).toBe('\u2002→\u2002')
      const arrow = (label: string) => glyph + 2 * side + (em(label) - 1) * E
      const pair = arrow(left) + arrow(right) + gap
      const name = BUTTON_EM * E + 2 * side
      expect(Math.abs(pair - name)).toBeLessThan(3)
    }
  })

  test('→ and ← swap a card with its neighbour; the cards, the status line and the store follow', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'sort' })

    await ui.press({ key: 'right-who' })
    // 版本號 stays first (s29)
    expect(await ORDER_OF(ui)).toEqual(['ver', 'block', 'who', 'tools', 'ctx', '5h', '7d', 'score', 'pending', 'branch', 'dirty', 'ff'])
    expect(last(w)?.startsWith('v.0.85  進度 5  Alex')).toBe(true)
    expect((w.store['settings'] as { order: string[] }).order.slice(0, 4)).toEqual(['ver', 'block', 'who', 'tools'])

    await ui.press({ key: 'left-ctx' })
    expect((await ORDER_OF(ui)).slice(0, 5)).toEqual(['ver', 'block', 'who', 'ctx', 'tools'])
    // 工具次數 is off by default, so 目前剩下 follows the owner directly
    expect(last(w)).toContain('Alex  目前剩下 50%')
    expect((await ui.findAll({ type: 'Text', text: last(w) ?? '' })).length).toBeGreaterThan(0)

    // the two ends do nothing (版本號 is first since s29)
    const before = await ORDER_OF(ui)
    await ui.press({ key: 'left-ver' })
    await ui.press({ key: 'right-ff' })
    expect(await ORDER_OF(ui)).toEqual(before)
  })

  // the owner 2026-10-09: a 預設 button beside 排序 puts the order back; only the order.
  test('預設 puts the order back and leaves what is on, the note and the symbols alone', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    const def = await ui.find({ type: 'Button', key: 'default-order' })
    expect(bare(def?.text)).toBe('預設')
    expect(em(def?.text ?? '')).toBe(BUTTON_EM)
    expect(def?.props['dimColor']).toBe(true)

    await ui.press({ key: 'sort' })
    await ui.press({ key: 'right-who' })
    await ui.press({ key: 'toggle-ctx' })
    expect((await ui.find({ type: 'Button', key: 'default-order' }))?.props['dimColor']).toBe(false)
    expect(last(w)?.startsWith('v.0.85  進度 5  Alex')).toBe(true)

    await ui.press({ key: 'default-order' })
    expect(await ORDER_OF(ui)).toEqual(DEFAULT_ORDER)
    expect(last(w)?.startsWith('v.0.85  Alex  進度 5')).toBe(true)
    const stored = w.store['settings'] as { order: string[]; off: string[] }
    expect(stored.order).toEqual(DEFAULT_ORDER)
    expect(stored.off).toContain('ctx')
    expect((await ui.find({ type: 'Button', key: 'default-order' }))?.props['dimColor']).toBe(true)

    // already the default: nothing changes
    await ui.press({ key: 'default-order' })
    expect(await ORDER_OF(ui)).toEqual(DEFAULT_ORDER)
  })

  // the owner 2026-10-09: the card's place in the order, 1 and up, at its top left corner in full-width digits (１ ２ … １１: they
  // keep clear of the corner); the 符號 card is not in the order.
  const fw = (n: number) => [...String(n)].map(d => String.fromCharCode(0xff10 + Number(d))).join('')
  test('the numbers show only while 排序 is on: every card has its place in the order at the top left, and they follow a move', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    for (const surface of ['terminal', SORT_SURFACE] as const) {
      const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
      // Whole cells are about 11 px tall and the engine takes whole cells only, so on a surface with pictures the number is a small
      // SVG badge placed in pixels (the owner 2026-10-09 「太往下了」); the terminal has cells and keeps a Text.
      const numbers = async () => {
        const out: Record<string, string> = {}
        for (const key of DEFAULT_ORDER) {
          const box = await ui.find({ type: 'Box', key: `number-${key}` })
          const badge = walk(box?.children).find(el => el.type === 'Svg')
          out[key] = surface === 'terminal' ? String(box?.text) : String(badge?.props['alt'])
        }
        return out
      }
      // the owner 2026-10-09 「數字改按排序才會出現」: none until 排序 is pressed
      for (const key of DEFAULT_ORDER) expect(await ui.find({ type: 'Box', key: `number-${key}` })).toBeUndefined()
      await ui.press({ key: 'sort' })
      expect(await numbers()).toEqual(Object.fromEntries(DEFAULT_ORDER.map((k, i) => [k, fw(i + 1)])))
      // 12th since 版本號 is first (s29)
      expect((await numbers())['ff']).toBe('１２')
      expect((await numbers())['block']).not.toMatch(/[0-9]/)
      // the first card's corner: 版本號 since s29
      const corner = await ui.find({ type: 'Box', key: 'number-ver' })
      expect(corner?.props['position']).toBe('absolute')
      expect(corner?.props['top']).toBe(0)
      expect(corner?.props['left']).toBe(surface === 'terminal' ? 1 : 0)
      expect((await ui.find({ type: 'Box', key: 'card-who' }))?.props['position']).toBe('relative')
      expect(await ui.find({ type: 'Box', key: 'number-icons' })).toBeUndefined()
      if (surface === 'desktop') {
        const badge = walk(corner?.children).find(el => el.type === 'Svg')
        // the digit is drawn at a pixel position of its own and carries the dim colour
        const text = /<text x="([\d.]+)" y="([\d.]+)"[^>]*>１<\/text>/.exec(drawingOf(String(badge?.props['source'])))
        expect(text).not.toBeNull()
        // the owner 2026-10-09 「與上方間距調成跟左方一樣」: the digit's ink is as far from the top edge as from the left edge. Measured
        // with Noto Sans CJK at 14 px: the ink of a full-width digit starts 3.2 px in from its box and rises 10.4 px above the baseline.
        const inkFromLeft = Number(text?.[1]) + 3.2
        const inkFromTop = Number(text?.[2]) - 10.4
        expect(Math.abs(inkFromLeft - inkFromTop)).toBeLessThan(0.05)
        expect(inkFromLeft).toBeGreaterThan(8)
        // two digits (１１) still fit in the picture
        expect(Number(badge?.props['width'])).toBeGreaterThanOrEqual(Number(text?.[1]) + 28)
        // the picture's own width is the element's, or the second digit would be cut off
        expect(drawingOf(String(badge?.props['source']))).toContain(`<svg xmlns="http://www.w3.org/2000/svg" width="${badge?.props['width']}" height="${badge?.props['height']}"`)
      }

      await ui.press({ key: 'right-who' })
      const moved = await numbers()
      // 版本號 keeps １ (s29)
      expect(moved['ver']).toBe('１')
      expect(moved['block']).toBe('２')
      expect(moved['who']).toBe('３')
      expect(moved['tools']).toBe('４')
      await ui.press({ key: 'default-order' })
      await ui.press({ key: 'sort' })
      // and gone again when 排序 is turned off
      expect(await ui.find({ type: 'Box', key: 'number-who' })).toBeUndefined()
    }
  })

  test('the order kept in the store comes back; unknown names are dropped and missing ones go to the end', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, order: ['ff', 'who', 'nonsense', 'who'] } }
    engine(on, w)
    await start($)

    // an order kept before s29 gets 版本號 first
    expect(last(w)?.startsWith('v.0.85  ✓ 已快轉  Alex  進度 5')).toBe(true)
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'CommandOutput', props: PANEL })
    expect(await ORDER_OF(ui)).toEqual(['ver', 'ff', 'who', 'block', 'tools', 'ctx', '5h', '7d', 'score', 'pending', 'branch', 'dirty'])
  })
})

// the owner 2026-10-09 「一排卡片改顯示4個」: four cards to a row; the 12 cards (符號 last) make three rows.
test('the cards stand four to a row', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
    const perRow: number[] = []
    for (let i = 0; i < 6; i++) {
      const row = await ui.find({ type: 'Box', key: `row-${i}` })
      if (row === undefined) break
      expect(row.props['flexDirection']).toBe('row')
      perRow.push(walk(row.children).filter(el => el.type === 'Box' && String(el.props['key']).startsWith('card-')).length)
    }
    // thirteen cards since 版本號 (s29): the last row holds one
    expect(perRow).toEqual([4, 4, 4, 1])
    expect(await ui.find({ type: 'Box', key: 'row-4' })).toBeUndefined()
  }
})

test('the branch card shows 分支路徑, not the long branch name', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
    const card = await ui.find({ type: 'Box', key: 'card-branch' })
    if (surface === 'terminal') {
      expect(walk(card?.children).filter(el => el.type === 'Text').map(t => String(t.children?.[0]))).toContain('分支路徑')
    } else {
      expect(drawingOf(String(walk(card?.children).find(el => el.type === 'Svg' && el.props['width'] === 72)?.props['source']))).toContain('>分支路徑</text>')
    }
    expect(await ui.find({ type: 'Text', text: /claude-mod-dev/ })).toBeUndefined()
  }
})

// the owner 2026-10-09 s28: 預覽 (what the status line at the bottom of the window shows) moved up beside session-status, in place of
// the 狀態列 sentence; there is no section of its own under the cards any more.
test('the header prints the status line as it reads now, and follows a button press', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  expect(await ui.find({ type: 'Text', text: /^status line$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^預覽$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /用 \/ss note/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^備註/ })).toBeUndefined()
  const before = last(w) ?? ''
  expect(before).toContain('目前剩下 50%')
  expect((await ui.findAll({ type: 'Text', text: before })).length).toBeGreaterThan(0)

  await ui.press({ key: 'toggle-ctx' })
  const after = last(w) ?? ''
  expect(after).not.toContain('目前剩下')
  expect((await ui.findAll({ type: 'Text', text: after })).length).toBeGreaterThan(0)
})

// the owner 2026-10-09 「置中分散對齊 從1~4個字的規範」: every name is laid out in a width of four Chinese characters.
// U+3000 is one character wide, U+2002 (en space) half a character.
describe('button names: a fixed half-character gap, centred in a width of 5.5 characters', () => {
  // U+2002 half a character (the gap, and the gap between the ← → buttons), U+3000 one, U+2005 a quarter.
  test('4 characters: three gaps, nothing to pad', () => {
    expect(fixed('工具次數')).toBe('工\u2002具\u2002次\u2002數')
  })
  test('3 characters: two gaps, three quarters of a character on each side', () => {
    expect(fixed('操作者')).toBe('\u2002\u2005操\u2002作\u2002者\u2002\u2005')
    expect(fixed('待決議')).toBe('\u2002\u2005待\u2002決\u2002議\u2002\u2005')
  })
  test('2 characters: one gap, one and a half characters on each side', () => {
    // en spaces only since s28 (a trailing U+3000 is dropped on the desktop)
    expect(fixed('每週')).toBe('\u2002\u2002\u2002每\u2002週\u2002\u2002\u2002')
    expect(fixed('進度')).toBe('\u2002\u2002\u2002進\u2002度\u2002\u2002\u2002')
  })
  test('1 character: two and a quarter characters on each side', () => {
    expect(fixed('快')).toBe('\u2002\u2002\u2002\u2002\u2005快\u2002\u2002\u2002\u2002\u2005')
  })
  test('every length from 1 to 4 comes out 5.5 characters wide, the same gap between characters, the characters in order', () => {
    for (const label of ['快', '每週', '操作者', '工具次數']) {
      expect(em(fixed(label))).toBe(BUTTON_EM)
      expect(bare(fixed(label))).toBe(label)
      // between two characters there is always exactly one en space and nothing else
      const chars = [...label]
      for (let i = 0; i < chars.length - 1; i++) expect(fixed(label)).toContain(`${chars[i]}\u2002${chars[i + 1]}`)
    }
  })
  test('an empty name or one longer than four characters is left as it is', () => {
    expect(fixed('')).toBe('')
    expect(fixed('這個名稱太長')).toBe('這個名稱太長')
  })
})

// the owner 2026-10-09: after a hot reload his /ss showed 這個專案沒有 and ? everywhere: nothing had read the files, git or the usage, and the
// module's folder was empty. Whatever the reload does with session.start, the first thing that needs the facts reads them.
test('after a reload without session.start, the panel and /ss read the folder and the facts when they are first drawn', async ($, on) => {
  const w = world()
  w.paneRefused = true // the listing row: bare /ss where no pane can be placed (s30)
  w.store = { language: 'zh-TW' }
  engine(on, w)
  // no start($): the module is freshly loaded and session.start has not reached it

  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const alts = (await ui.findAll({ type: 'Svg' })).filter(d => d.props['width'] === 72).map(d => String(d.props['alt']))
  expect(alts).toContain('操作者 Alex')
  expect(alts).toContain('進度 5')
  expect(alts).toContain('目前剩下 50%')
  expect(alts).toContain('五小時 23%')
  expect(alts).toContain('快轉 已快轉')

  const list = await sl($, '')
  expect(list.text).toContain('who　開　Alex')
  // the threshold was read: 目前剩下 is counted from it
  expect(list.text).toContain('ctx　開　目前剩下 50%')
})

test('after a reload without session.start, a bare /ss typed first reads the facts too', async ($, on) => {
  const w = world()
  w.paneRefused = true // the listing row: bare /ss where no pane can be placed (s30)
  w.store = { language: 'zh-TW' }
  engine(on, w)

  const list = await sl($, '')
  expect(list.text).toContain('who　開　Alex')
  expect(list.text).toContain('ctx　開　目前剩下 50%')
  expect(list.text).not.toContain('壓縮門檻')
})

// the owner 2026-10-09: on his desktop every read failed after a reload and the mod showed 這個專案沒有, hiding why. A file that is simply not
// there is not a failure; a read that fails says what failed.
test('a read that fails says what failed, in /ss and in the panel; a file that is not there is no failure', async ($, on) => {
  const w = world()
  w.paneRefused = true // the listing row: bare /ss where no pane can be placed (s30)
  w.store = { language: 'zh-TW' }
  w.listError = 'EACCES: permission denied, scandir /w/.claude'
  w.usageError = 'the usage is not available now'
  engine(on, w)

  const list = await sl($, '')
  expect(list.text).toContain('讀取問題')
  expect(list.text).toContain('EACCES')
  expect(list.text).toContain('usage')

  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  expect((await ui.find({ type: 'Text', text: /讀取問題/ }))?.text).toContain('EACCES')
})

test('nothing is reported when the files are simply not there (another project)', async ($, on) => {
  const w = world()
  w.paneRefused = true // the listing row: bare /ss where no pane can be placed (s30)
  w.store = { language: 'zh-TW' }
  w.files = {}
  w.dir = []
  engine(on, w)

  const list = await sl($, '')
  expect(list.text).not.toContain('讀取問題')
  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  expect(await ui.find({ type: 'Text', text: /讀取問題/ })).toBeUndefined()
})

// s27 drew a dim name and no button here; the owner 2026-10-09 s29 「沒有內容的時候元素也不能跑位」: the same name button as every card, which turns
// the item on and off like any other (the choice is kept for a project that has the source).
test('an item the project has no source for: a 沒有 dial and the same name button, which still turns it on and off', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  w.files = {}
  w.dir = [file('settings.json', 9000)]
  w.git = { [GIT_BRANCH.join(' ')]: 'throw' }
  engine(on, w)
  await start($)

  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'mobile', component: 'CommandOutput', props: PANEL })
  expect(bare((await ui.find({ type: 'Button', key: 'toggle-score' }))?.text)).toBe('分數')
  expect(bare((await ui.find({ type: 'Button', key: 'toggle-who' }))?.text)).toBe('操作者')
  const dial = (await ui.findAll({ type: 'Svg' })).find(d => d.props['alt'] === '分數 沒有')
  expect(drawingOf(String(dial?.props['source']))).toContain('>沒有</text>')
  expect(await ui.find({ type: 'Text', text: /^分數$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'toggle-ctx' })).toBeDefined()

  const isOff = () => (w.store['settings'] as { off: string[] } | undefined)?.off.includes('who') ?? false
  expect(isOff()).toBe(false)
  await ui.press({ key: 'toggle-who' })
  expect(isOff()).toBe(true)
})

test('a /ss reply that carries arguments is plain text: no buttons, no mod name in front', async ($, on) => {
  const w = world()
  engine(on, w)
  await start($)

  for (const surface of FOUR) {
    const ui = await $.ui.mount({
      plugin: 'superstatus', surface, component: 'CommandOutput',
      props: { command: 'ss', args: 'off ctx', text: 'superstatus: 已更新：off ctx', isErrored: false },
    })
    expect(await ui.find({ type: 'Button', key: 'toggle-ctx' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /已更新：off ctx/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^superstatus:/ })).toBeUndefined()
  }
})

test('settings kept in the store come back on load', async ($, on) => {
  const w = world()
  w.store['settings'] = { off: ['tools'], note: 'x', icons: true }
  engine(on, w)
  await start($)

  expect(last(w)).not.toContain('⌗')
  expect(last(w)?.endsWith('✎ x')).toBe(true)
})

test('in a project without the journal and score files or git, those items do not appear; usage still shows ? (通用)', async ($, on) => {
  const w = world()
  w.dir = [file('settings.json', 9000)]
  w.files = {}
  w.git = { [GIT_BRANCH.join(' ')]: 'throw', [GIT_DIRTY.join(' ')]: { exitCode: 128, stdout: '' } }
  w.usage = { startedAt: 0, context: { window: 200000 }, rateLimits: [] }
  engine(on, w)
  await start($)

  expect(last(w)).toBe('v.0.85  ⌗ 3  ctx 剩 ?  5h ?  7d ?')
})

test('only the items a project has appear: MEMORY.md without Score.md shows 進度 and 坑, no 分數', async ($, on) => {
  const w = world()
  delete w.files['/w/Score.md']
  w.dir = [file('settings.json', 9000)]
  engine(on, w)
  await start($)

  const line = last(w) ?? ''
  expect(line).toContain('▣ B5')
  expect(line).toContain('△ 2')
  expect(line).not.toContain('★')
  expect(line).not.toContain('◉')
})

test('a repo whose main branch is main: fast-forward is checked against main (read-only merge-base)', async ($, on) => {
  const w = world()
  w.git[GIT_FF.join(' ')] = { exitCode: 128, stdout: '' }
  w.git[GIT_FF_MAIN.join(' ')] = { exitCode: 0, stdout: '' }
  engine(on, w)
  await start($)

  expect(last(w)).toContain('✓ 已快轉')
  for (const argv of w.ran) {
    expect(ALL_GIT).toContain(argv.join(' '))
  }
})

// Fast-forward, after 每週: done (HEAD is in the base), can (the base is in HEAD), cannot (diverged), unknown.
// A symbol and a word in both modes (the owner 2026-10-09).
const FF_CASES: [string, Record<string, { exitCode: number; stdout: string }>, string, string][] = [
  ['already in master', { [GIT_FF.join(' ')]: { exitCode: 0, stdout: '' } }, '✓ 已快轉', '已快轉'],
  ['master can be fast-forwarded', { [GIT_FF.join(' ')]: { exitCode: 1, stdout: '' }, [GIT_CAN.join(' ')]: { exitCode: 0, stdout: '' } }, '↑ 可快轉', '可快轉'],
  ['master has commits this branch lacks', { [GIT_FF.join(' ')]: { exitCode: 1, stdout: '' }, [GIT_CAN.join(' ')]: { exitCode: 1, stdout: '' } }, '✕ 不能快轉', '不能快轉'],
  ['no master: main can be fast-forwarded', { [GIT_FF.join(' ')]: { exitCode: 128, stdout: '' }, [GIT_FF_MAIN.join(' ')]: { exitCode: 1, stdout: '' }, [GIT_CAN_MAIN.join(' ')]: { exitCode: 0, stdout: '' } }, '↑ 可快轉', '可快轉'],
  ['neither master nor main', { [GIT_FF.join(' ')]: { exitCode: 128, stdout: '' }, [GIT_FF_MAIN.join(' ')]: { exitCode: 128, stdout: '' } }, '? 快轉', '?'],
]
for (const [name, git, shown, dialText] of FF_CASES) {
  test(`fast-forward: ${name} shows ${shown}`, async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    w.git = { [GIT_BRANCH.join(' ')]: { exitCode: 0, stdout: 'x\n' }, [GIT_DIRTY.join(' ')]: { exitCode: 0, stdout: '' }, ...git }
    engine(on, w)
    await start($)

    expect(last(w)?.endsWith(`每週 8%  ${shown}`)).toBe(true)
    for (const argv of w.ran) expect(ALL_GIT).toContain(argv.join(' '))
    // the same state on the 快轉 dial
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const ff = (await ui.findAll({ type: 'Svg' })).find(d => String(d.props['alt']).startsWith('快轉'))
    expect(drawingOf(String(ff?.props['source']))).toContain(`>${dialText}</text>`)
  })
}

test('the files and git are read again when a turn ends', async ($, on) => {
  const w = world()
  engine(on, w)
  await start($)

  w.files['/w/MEMORY.md'] = 'current_block: 6\n'
  w.git[GIT_FF.join(' ')] = { exitCode: 1, stdout: '' }
  w.git[GIT_CAN.join(' ')] = { exitCode: 1, stdout: '' }
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  expect(last(w)).toContain('▣ B6')
  expect(last(w)).toContain('△ 0')
  expect(last(w)).toContain('✕ 不能快轉')
})

// the owner 2026-10-09 s28: a 新增卡片 button beside 排序 opens a pane on the right (option 3, 「我先看看怎麼顯示」); the pane offers
// the kind (文字卡 only: a command card waits for its own security talk), a name and a text; 加入 adds a card that turns on
// and off and sorts like the others.
const ADD_PANE = { title: '新增卡片', isFocused: false, bodyColumns: 40, placement: 'dock' } as never
const addPane = ($: Engine) =>
  $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', props: ADD_PANE, requestId: 'sl-add' })

describe('adding a card', () => {
  test('a 新增卡片 button sits beside 排序 and 預設, as wide as they are, and opens the 新增卡片 pane', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const add = await ui.find({ type: 'Button', key: 'add-card' })
    expect(bare(add?.text)).toBe('新增卡片')
    // as wide as 編輯 and 預設 (5.5 characters until s37; on the desktop a column since Claude Design step 2, tested there)
    const sort = await ui.find({ type: 'Button', key: 'sort' })
    const reset = await ui.find({ type: 'Button', key: 'default-order' })
    // 編輯 a quarter shorter since s38 (lit, its label is bold: padded ESTIMATE_SPARE short on the desktop)
    expect([em(add?.text ?? ''), em(sort?.text ?? '') + ESTIMATE_SPARE]).toEqual([em(reset?.text ?? ''), em(reset?.text ?? '')])
    const keys = (await ui.findAll({ type: 'Button' })).map(b => String((b as { key?: string }).key ?? b.props['key']))
    expect(keys.indexOf('add-card')).toBe(keys.indexOf('default-order') + 1)

    await ui.press({ key: 'add-card' })
    expect(w.opened).toEqual(['sl-add'])
  })

  test('the pane holds a kind (four of them), a name, a text, 加入 and 取消', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    const kind = await pane.find({ type: 'Select', key: 'add-kind' })
    expect(kind?.props['options']).toEqual([
      { value: 'text', label: '文字卡' },
      { value: 'countdown', label: '倒數卡' },
      { value: 'file', label: '檔案卡' },
      { value: 'command', label: '指令卡' },
      { value: 'switch', label: '開關卡' },
      { value: 'button', label: '按鈕卡' },
      { value: 'module', label: '模組卡' },
    ])
    expect(await pane.find({ type: 'Input', key: 'add-name' })).toBeDefined()
    expect(await pane.find({ type: 'Input', key: 'add-text' })).toBeDefined()
    expect(bare((await pane.find({ type: 'Button', key: 'add-ok' }))?.text)).toBe('加入')
    expect(bare((await pane.find({ type: 'Button', key: 'add-cancel' }))?.text)).toBe('取消')
  })

  test('加入 adds a lit card at the end, on the status line and in the store, and closes the pane', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.input({ key: 'add-name', text: '下一步', kind: 'change' })
    await pane.input({ key: 'add-text', text: '等 Anna 回覆' })
    await pane.press({ key: 'add-ok' })

    expect(w.closed).toEqual(['sl-add'])
    expect(last(w)?.endsWith('✓ 已快轉  下一步 等 Anna 回覆')).toBe(true)
    const stored = w.store['settings'] as { cards: { id: string; name: string; text: string }[]; order: string[] }
    expect(stored.cards).toEqual([{ id: 'c1', kind: 'text', name: '下一步', text: '等 Anna 回覆', prefix: '' }])
    expect(stored.order[stored.order.length - 1]).toBe('c1')

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(bare((await ui.find({ type: 'Button', key: 'toggle-c1' }))?.text)).toBe('下一步')
    expect((await ui.find({ type: 'Button', key: 'toggle-c1' }))?.props['variant']).toBe('primary')
    expect(await ORDER_OF(ui)).toEqual([...DEFAULT_ORDER, 'c1'])
    // the fields start empty again for the next card
    await pane.unmount()
    const again = await addPane($)
    expect((await again.find({ type: 'Input', key: 'add-name' }))?.props['value'] ?? '').toBe('')
  })

  test('加入 with no name adds nothing and says so in the pane', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.input({ key: 'add-text', text: '只有內容', kind: 'change' })
    await pane.press({ key: 'add-ok' })

    expect(w.closed).toEqual([])
    expect(await pane.find({ type: 'Text', text: /先打名稱/ })).toBeDefined()
    expect((w.store['settings'] as { cards?: unknown[] } | undefined)?.cards ?? []).toEqual([])
  })

  test('取消 closes the pane and adds nothing', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.input({ key: 'add-name', text: '暫時', kind: 'change' })
    await pane.press({ key: 'add-cancel' })

    expect(w.closed).toEqual(['sl-add'])
    expect((w.store['settings'] as { cards?: unknown[] } | undefined)?.cards ?? []).toEqual([])
  })

  test('an added card turns off and on, sorts, keeps its place through 預設, and comes back from the store', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER, 'c1'], cards: [{ id: 'c1', name: '下一步', text: '等回覆' }] } }
    engine(on, w)
    await start($)

    expect(last(w)?.endsWith('下一步 等回覆')).toBe(true)
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })
    expect(last(w)).not.toContain('下一步')
    await ui.press({ key: 'toggle-c1' })
    expect(last(w)).toContain('下一步 等回覆')

    await ui.press({ key: 'sort' })
    await ui.press({ key: 'left-c1' })
    expect((await ORDER_OF(ui)).slice(-2)).toEqual(['c1', 'ff'])
    await ui.press({ key: 'default-order' })
    expect(await ORDER_OF(ui)).toEqual([...DEFAULT_ORDER, 'c1'])
  })
})

// the owner 2026-10-09 s28 「全加」: four kinds. 倒數卡 counts the days to a date (Taiwan time), 檔案卡 shows what follows a given start
// on a line of a file inside the project, 指令卡 the first line a bash command prints (3 s at most, its own folder). The three
// update when a turn ends.
// 2026-10-09 12:00 in Taiwan
const NOON_1009 = Date.UTC(2026, 9, 9, 4)
const dialAlt = async (ui: { findAll: (q: object) => Promise<{ props: Record<string, unknown> }[]> }, name: string) =>
  (await ui.findAll({ type: 'Svg' })).map(d => String(d.props['alt'])).find(a => a.startsWith(`${name} `))
async function addCard(pane: Awaited<ReturnType<typeof addPane>>, fields: { kind: string; name: string; text: string; prefix?: string }) {
  await pane.select({ key: 'add-kind', value: fields.kind })
  await pane.input({ key: 'add-name', text: fields.name, kind: 'change' })
  await pane.input({ key: 'add-text', text: fields.text, kind: 'change' })
  if (fields.prefix !== undefined) await pane.input({ key: 'add-prefix', text: fields.prefix, kind: 'change' })
  await pane.press({ key: 'add-ok' })
}

describe('the other kinds of card', () => {
  test('倒數卡: the days left to the date, on the status line and in the dial', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    w.now = NOON_1009
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await addCard(pane, { kind: 'countdown', name: '網域到期', text: '2027-08-27' })
    expect(last(w)?.endsWith('網域到期 還有 322 天')).toBe(true)
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await dialAlt(ui, '網域到期')).toBe('網域到期 322天')
  })

  test('倒數卡: 今天 on the day, 過了 after it, and it follows the clock when a turn ends', async ($, on) => {
    const w = world()
    w.now = NOON_1009
    w.store = { settings: { off: [], note: '', icons: false, cards: [
      { id: 'c1', kind: 'countdown', name: '今天', text: '2026-10-09' },
      { id: 'c2', kind: 'countdown', name: '過去', text: '2026-10-06' },
    ] } }
    engine(on, w)
    await start($)

    expect(last(w)).toContain('今天 今天')
    expect(last(w)).toContain('過去 過了 3 天')
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await dialAlt(ui, '過去')).toBe('過去 過3天')

    // 07:00 on 10-09 in Taiwan is still 10-08 in UTC: the day is Taiwan's
    w.now = Date.UTC(2026, 9, 8, 23)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    expect(last(w)).toContain('今天 今天')

    w.now = NOON_1009 + 86400000
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    expect(last(w)).toContain('今天 過了 1 天')
  })

  test('倒數卡: a date that is not YYYY-MM-DD, or not a real day, is refused in the pane', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    w.now = NOON_1009
    engine(on, w)
    await start($)

    const pane = await addPane($)
    for (const bad of ['2027/08/27', '2027-02-30', '']) {
      await addCard(pane, { kind: 'countdown', name: '到期', text: bad })
      expect(await pane.find({ type: 'Text', text: /日期/ })).toBeDefined()
    }
    expect(w.closed).toEqual([])
    expect((w.store['settings'] as { cards?: unknown[] } | undefined)?.cards ?? []).toEqual([])
  })

  test('檔案卡: what follows the start on the first line that begins with it; 沒有檔案 and 找不到 when not there', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await addCard(pane, { kind: 'file', name: '工作塊', text: 'MEMORY.md', prefix: 'current_block:' })
    expect(last(w)?.endsWith('工作塊 5')).toBe(true)
    expect(w.read).toContain('/w/MEMORY.md')

    await pane.unmount()
    const again = await addPane($)
    await addCard(again, { kind: 'file', name: '缺行', text: 'MEMORY.md', prefix: 'nothing_here:' })
    await again.unmount()
    const third = await addPane($)
    await addCard(third, { kind: 'file', name: '缺檔', text: 'docs/none.md', prefix: 'x' })
    await third.unmount()
    // a line that only mentions the start in its middle does not count: the line must begin with it
    const fourth = await addPane($)
    await addCard(fourth, { kind: 'file', name: '待決', text: 'MEMORY.md', prefix: '[PENDING]' })
    expect(last(w)).toContain('待決 [2026-10-09] trap one')
    expect(last(w)).toContain('缺行 找不到')
    expect(last(w)).toContain('缺檔 沒有檔案')

    // it follows the file when a turn ends
    w.files['/w/MEMORY.md'] = 'current_block: 6\n'
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    expect(last(w)).toContain('工作塊 6')
  })

  test('檔案卡: a path outside the project, or no start, is refused in the pane', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    for (const [path, prefix] of [['/etc/passwd', 'root'], ['../other/MEMORY.md', 'x'], ['docs/../../x', 'x'], ['MEMORY.md', ''], ['', 'x']]) {
      await addCard(pane, { kind: 'file', name: '檔', text: path as string, prefix: prefix as string })
      expect(await pane.find({ type: 'Text', text: /路徑|開頭/ })).toBeDefined()
    }
    expect(w.closed).toEqual([])
    expect(w.read).not.toContain('/etc/passwd')
  })

  test('指令卡: bash -c in the project folder, 3 s at most, the first line it prints; 失敗 and 逾時 when it goes wrong', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    w.git['bash -c df -h / | tail -1'] = { exitCode: 0, stdout: '\n/dev/sda1  50G  20G  30G  40% /\nmore\n' }
    w.git['bash -c false'] = { exitCode: 1, stdout: '' }
    w.git['bash -c sleep 9'] = 'throw'
    engine(on, w)
    await start($)

    const pane = await addPane($)
    // the warning is in the pane while 指令卡 is picked
    await pane.select({ key: 'add-kind', value: 'command' })
    expect(await pane.find({ type: 'Text', text: /每回合結束都會執行一次/ })).toBeDefined()
    await addCard(pane, { kind: 'command', name: '磁碟', text: 'df -h / | tail -1' })
    const at = w.ran.findIndex(a => a.join(' ') === 'bash -c df -h / | tail -1')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(w.runInit[at]).toEqual({ cwd: '/w', timeoutMs: 3000 })
    expect(last(w)?.endsWith('磁碟 /dev/sda1 50G 20G 30G 40% /')).toBe(true)

    await pane.unmount()
    const two = await addPane($)
    await addCard(two, { kind: 'command', name: '壞', text: 'false' })
    await two.unmount()
    const three = await addPane($)
    await addCard(three, { kind: 'command', name: '慢', text: 'sleep 9' })
    expect(last(w)).toContain('壞 失敗')
    expect(last(w)).toContain('慢 逾時')

    // and again when a turn ends
    const before = w.ran.filter(a => a[0] === 'bash').length
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    expect(w.ran.filter(a => a[0] === 'bash').length).toBe(before + 3)
  })

  test('a value is cut to 40 characters on the line, and the dial shows its first four', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, cards: [{ id: 'c1', kind: 'command', name: '長', text: 'long' }] } }
    w.git['bash -c long'] = { exitCode: 0, stdout: `${'一二三四五六七八九十'.repeat(5)}\n` }
    engine(on, w)
    await start($)

    expect(last(w)?.endsWith(`長 ${'一二三四五六七八九十'.repeat(4)}`)).toBe(true)
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await dialAlt(ui, '長')).toBe('長 一二三四')
  })
})

// the owner 2026-10-09 s28 「你先做我看一下」: 開關卡. Its name button sends one slash command (another mod's, as $.command.run, tried
// with switch-lab: it works, adds a row to the conversation, starts no turn): the 關 one while the card is lit, the 開 one while it
// is grey. The card remembers what it sent last; it does not ask the other mod. Not on the status line: it is a button, not a fact.
describe('開關卡', () => {
  async function addSwitch($: Engine, fields: { name: string; command: string; on: string; off: string }) {
    const pane = await addPane($)
    await pane.select({ key: 'add-kind', value: 'switch' })
    await pane.input({ key: 'add-name', text: fields.name, kind: 'change' })
    await pane.input({ key: 'add-text', text: fields.command, kind: 'change' })
    await pane.input({ key: 'add-prefix', text: fields.on, kind: 'change' })
    await pane.input({ key: 'add-off', text: fields.off, kind: 'change' })
    await pane.press({ key: 'add-ok' })
    return pane
  }

  test('the pane asks for the command and its 開 and 關 arguments; the card starts lit, says 開, and stays off the status line', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.select({ key: 'add-kind', value: 'switch' })
    // a field's label: on the field (the form off the desktop) or, since s39 (Status Line's pane on the desktop laid out in columns), in the
    // column before it
    const labelOf = async (input: string, row: string) =>
      ((await pane.find({ type: 'Input', key: input }))?.props['label'] as string | undefined) ??
      walk(((await pane.find({ type: 'Box', key: `${row}-label` })) as El | undefined)?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))[0]
    expect(await labelOf('add-text', 'add-row-text')).toBe('指令')
    expect(await labelOf('add-prefix', 'add-row-prefix')).toBe('開')
    expect(await labelOf('add-off', 'add-row-off')).toBe('關')
    await pane.unmount()

    await addSwitch($, { name: '探針', command: '/probe', on: '', off: 'off' })
    expect(w.closed).toEqual(['sl-add'])
    const stored = w.store['settings'] as { cards: Record<string, unknown>[] }
    expect(stored.cards[0]).toMatchObject({ id: 'c1', kind: 'switch', name: '探針', text: 'probe', onArgs: '', offArgs: 'off' })
    // adding it sends nothing
    expect(w.commands).toEqual([])
    expect(last(w)).not.toContain('探針')

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect((await ui.find({ type: 'Button', key: 'toggle-c1' }))?.props['variant']).toBe('primary')
    expect(await dialAlt(ui, '探針')).toBe('探針 開')
  })

  test('pressing the name sends the 關 command while lit and the 開 one while grey, and the card follows', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)
    await addSwitch($, { name: '探針', command: 'probe', on: '', off: 'off' })

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })
    expect(w.commands).toEqual(['probe off'])
    expect((await ui.find({ type: 'Button', key: 'toggle-c1' }))?.props['variant']).toBe('secondary')
    expect(await dialAlt(ui, '探針')).toBe('探針 關')
    expect(last(w)).not.toContain('探針')

    await ui.press({ key: 'toggle-c1' })
    expect(w.commands).toEqual(['probe off', 'probe'])
    expect(await dialAlt(ui, '探針')).toBe('探針 開')
  })

  test('a command that is refused leaves the card as it was and says why in the panel', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)
    await addSwitch($, { name: '探針', command: 'probe', on: '', off: 'off' })

    w.commandDeny = 'no such command'
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })
    expect((await ui.find({ type: 'Button', key: 'toggle-c1' }))?.props['variant']).toBe('primary')
    expect(await ui.find({ type: 'Text', text: /^探針：\/probe off 沒有送出（.+）$/ })).toBeDefined()

    // the next press that works clears the line
    w.commandDeny = undefined
    await ui.press({ key: 'toggle-c1' })
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeUndefined()
  })

  test('an empty command, or one with a space in its name, is refused in the pane', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    for (const command of ['', '/', 'probe off']) {
      const pane = await addSwitch($, { name: '探針', command, on: '', off: 'off' })
      expect(await pane.find({ type: 'Text', text: /指令/ })).toBeDefined()
      await pane.unmount()
    }
    expect(w.closed).toEqual([])
  })
})

// the owner 2026-10-09 s28 「做刪除卡片」: while 排序 is on, an added card has a 刪除 button under its arrows (the built-in ones have
// none); the first press asks (確定刪除), the second removes the card from the panel, the status line and the store. Turning 排序
// off takes the question back.
// the owner 2026-10-09 s29 「版本號只要在 status line」 (go on the read-back): the version is a 13th Status Line card, 版本號, first; its dial and
// the status line say v.0.85 (from the code); it turns on and off like any card and is the one card that cannot be deleted. The other
// twelve (符號 included) are deleted with 刪除 while sorting; 預設 brings all thirteen back in the default order.
describe('the 版本號 card, and deleting the built-in cards', () => {
  test('a 13th card, 版本號, first: its dial says v.0.85, its name button 版本號, lit; the status line starts with v.0.85', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    expect(last(w)).toBe('v.0.85  Alex  進度 5  目前剩下 50%  五小時 23%  每週 8%  ✓ 已快轉')
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const cards = walk([await ui.drawn()]).filter(el => el.type === 'Box' && String(el.props?.['key']).startsWith('card-'))
      .map(el => String(el.props['key']))
    expect(cards[0]).toBe('card-ver')
    expect(cards.length).toBe(13)
    expect((await ui.findAll({ type: 'Svg' })).find(d => d.props['alt'] === '版本號 v.0.85')).toBeDefined()
    const name = await ui.find({ type: 'Button', key: 'toggle-ver' })
    expect(bare(name?.text)).toBe('版本號')
    expect(name?.props['variant']).toBe('primary')
    await ui.press({ key: 'toggle-ver' })
    expect(last(w)).toBe('Alex  進度 5  目前剩下 50%  五小時 23%  每週 8%  ✓ 已快轉')
  })

  test('a stored order without 版本號 (before s29) gets it first', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, order: ['ff', 'who', 'block', 'tools', 'ctx', '5h', '7d', 'score', 'pending', 'branch', 'dirty'] } }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'toggle-tools' })
    expect((w.store['settings'] as { order: string[] }).order.slice(0, 3)).toEqual(['ver', 'ff', 'who'])
  })

  test('two presses of 刪除 take a built-in card off the panel and the status line; 符號 too; 預設 brings them all back in order', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, order: ['ver', 'block', 'who', 'tools', 'ctx', '5h', '7d', 'score', 'pending', 'branch', 'dirty', 'ff'] } }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'delete-who' })
    expect(bare((await ui.find({ type: 'Button', key: 'delete-who' }))?.text)).toBe('確定刪除')
    await ui.press({ key: 'delete-who' })
    expect(await ui.find({ type: 'Box', key: 'card-who' })).toBeUndefined()
    expect(last(w)).not.toContain('Alex')
    await ui.press({ key: 'delete-icons' })
    await ui.press({ key: 'delete-icons' })
    expect(await ui.find({ type: 'Box', key: 'card-icons' })).toBeUndefined()
    expect((w.store['settings'] as { removed: string[] }).removed).toEqual(['who', 'icons'])
    // a move passes over a deleted card
    await ui.press({ key: 'left-tools' })
    expect((w.store['settings'] as { order: string[] }).order.slice(0, 4)).toEqual(['ver', 'tools', 'who', 'block'])

    expect((await ui.find({ type: 'Button', key: 'default-order' }))?.props['dimColor']).toBe(false)
    await ui.press({ key: 'default-order' })
    const stored = w.store['settings'] as { removed: string[]; order: string[] }
    expect(stored.removed).toEqual([])
    expect(stored.order).toEqual(DEFAULT_ORDER)
    expect(await ui.find({ type: 'Box', key: 'card-who' })).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'card-icons' })).toBeDefined()
    expect(last(w)).toContain('Alex')
    expect((await ui.find({ type: 'Button', key: 'default-order' }))?.props['dimColor']).toBe(true)
  })

  test('with the order as it was and one card deleted, 預設 is not dim, and brings it back', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], removed: ['tools'] } }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect((await ui.find({ type: 'Button', key: 'default-order' }))?.props['dimColor']).toBe(false)
    await ui.press({ key: 'default-order' })
    expect(await ui.find({ type: 'Box', key: 'card-tools' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'default-order' }))?.props['dimColor']).toBe(true)
  })

  test('a deleted card stays deleted after a reload', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, removed: ['who', 'icons', 'ver', 'nonsense'] } }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await ui.find({ type: 'Box', key: 'card-who' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'card-icons' })).toBeUndefined()
    // 版本號 cannot be deleted, an unknown name is dropped
    expect(await ui.find({ type: 'Box', key: 'card-ver' })).toBeDefined()
    expect(last(w)?.startsWith('v.0.85  進度 5')).toBe(true)
  })
})

describe('deleting a card', () => {
  const TWO = { off: [], note: '', icons: false, order: [...DEFAULT_ORDER, 'c1', 'c2'], cards: [
    { id: 'c1', kind: 'text', name: '下一步', text: '等回覆', prefix: '' },
    { id: 'c2', kind: 'switch', name: '探針', text: 'probe', prefix: '', onArgs: '', offArgs: 'off' },
  ] }

  // s28: 刪除 under added cards only; the owner 2026-10-09 s29 「把Status line 的預設12張卡片也開放刪除按鈕 只有版本號不能刪」: every card but 版本號
  test('a 刪除 button under every card but 版本號, and only while 排序 is on', async ($, on) => {
    const w = world()
    w.store = { settings: structuredClone(TWO) }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    expect(await ui.find({ type: 'Button', key: 'delete-c1' })).toBeUndefined()
    await ui.press({ key: 'sort' })
    expect(bare((await ui.find({ type: 'Button', key: 'delete-c1' }))?.text)).toBe('刪除')
    expect(bare((await ui.find({ type: 'Button', key: 'delete-c2' }))?.text)).toBe('刪除')
    for (const key of DEFAULT_ORDER.filter(k => k !== 'ver')) expect(bare((await ui.find({ type: 'Button', key: `delete-${key}` }))?.text)).toBe('刪除')
    expect(bare((await ui.find({ type: 'Button', key: 'delete-icons' }))?.text)).toBe('刪除')
    expect(await ui.find({ type: 'Button', key: 'delete-ver' })).toBeUndefined()
    await ui.press({ key: 'sort' })
    expect(await ui.find({ type: 'Button', key: 'delete-who' })).toBeUndefined()
  })

  test('the first press asks, the second removes the card from the panel, the status line and the store', async ($, on) => {
    const w = world()
    w.store = { settings: structuredClone({ ...TWO, off: ['c2'] }) }
    engine(on, w)
    await start($)

    expect(last(w)).toContain('下一步 等回覆')
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'delete-c1' })
    expect(bare((await ui.find({ type: 'Button', key: 'delete-c1' }))?.text)).toBe('確定刪除')
    expect(await ui.find({ type: 'Box', key: 'card-c1' })).toBeDefined()

    await ui.press({ key: 'delete-c1' })
    expect(await ui.find({ type: 'Box', key: 'card-c1' })).toBeUndefined()
    expect(last(w)).not.toContain('下一步')
    const stored = w.store['settings'] as { cards: { id: string }[]; order: string[]; off: string[] }
    expect(stored.cards.map(c => c.id)).toEqual(['c2'])
    expect(stored.order).toEqual([...DEFAULT_ORDER, 'c2'])

    // a switch card that is off goes with its place in off; it sends nothing on the way
    await ui.press({ key: 'delete-c2' })
    await ui.press({ key: 'delete-c2' })
    expect((w.store['settings'] as { off: string[] }).off).not.toContain('c2')
    expect(w.commands).toEqual([])
  })

  test('turning 排序 off takes the question back', async ($, on) => {
    const w = world()
    w.store = { settings: structuredClone(TWO) }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'delete-c1' })
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'sort' })
    expect(bare((await ui.find({ type: 'Button', key: 'delete-c1' }))?.text)).toBe('刪除')
    // asking about one card and then pressing another's asks about that one instead
    await ui.press({ key: 'delete-c1' })
    await ui.press({ key: 'delete-c2' })
    expect(bare((await ui.find({ type: 'Button', key: 'delete-c1' }))?.text)).toBe('刪除')
    expect(bare((await ui.find({ type: 'Button', key: 'delete-c2' }))?.text)).toBe('確定刪除')
    expect(await ui.find({ type: 'Box', key: 'card-c1' })).toBeDefined()
  })

  test('the /ss text list names an added card and its kind, a 開關卡 too', async ($, on) => {
    const w = world()
    w.paneRefused = true // the listing row: bare /ss where no pane can be placed (s30)
    w.store = { settings: structuredClone(TWO) }
    engine(on, w)
    await start($)

    const out = await sl($, '')
    expect(out.text).toContain('c1（下一步）　開　下一步 等回覆')
    expect(out.text).toContain('c2（探針）　開　開關卡 /probe')
    expect(out.text).not.toContain('這個專案沒有')
  })
})

// the owner 2026-10-09 s28 「名稱長度擋四個字」: a name over four characters is refused in the pane (every name button is four wide).
test('a name of more than four characters is refused in the pane; four is fine', async ($, on) => {
  const w = world()
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  const pane = await addPane($)
  await pane.input({ key: 'add-name', text: '網域到期日', kind: 'change' })
  await pane.input({ key: 'add-text', text: 'x', kind: 'change' })
  await pane.press({ key: 'add-ok' })
  expect(await pane.find({ type: 'Text', text: /名稱最多四個字/ })).toBeDefined()
  expect(w.closed).toEqual([])
  expect((w.store['settings'] as { cards?: unknown[] } | undefined)?.cards ?? []).toEqual([])

  await pane.input({ key: 'add-name', text: '網域到期', kind: 'change' })
  await pane.press({ key: 'add-ok' })
  expect(w.closed).toEqual(['sl-add'])
  expect((w.store['settings'] as { cards: { name: string }[] }).cards.map(c => c.name)).toEqual(['網域到期'])
})

// the owner 2026-10-09 s28 「錯誤訊息不會自動消失嗎」「5秒」: the yellow line of a 開關卡 that sent nothing goes after 5 seconds, and at
// once when that card is deleted.
describe('the 開關卡 error line goes away', () => {
  const ONE = { off: [], note: '', icons: false, order: [...DEFAULT_ORDER, 'c1', 'c2', 'c3'], cards: [
    { id: 'c1', kind: 'switch', name: '手機', text: 'probe', prefix: '', onArgs: '', offArgs: 'off' },
    { id: 'c2', kind: 'text', name: '備忘', text: 'x', prefix: '' },
    { id: 'c3', kind: 'switch', name: '第二', text: 'probe', prefix: '', onArgs: '', offArgs: 'off' },
  ] }

  test('after 5 seconds, not before', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = { settings: structuredClone(ONE) }
    w.mockClock = true
    w.commandDeny = 'no command named /probe'
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeDefined()
    await clock.advance(4999)
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeDefined()
    await clock.advance(1)
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeUndefined()
  })

  test('a second failure gets its own 5 seconds: the first timer does not take the newer line away', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = { settings: structuredClone(ONE) }
    w.mockClock = true
    w.commandDeny = 'refused'
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })
    await clock.advance(3000)
    await ui.press({ key: 'toggle-c3' })
    await clock.advance(2000)
    expect(await ui.find({ type: 'Text', text: /^第二：.*沒有送出/ })).toBeDefined()
    await clock.advance(3000)
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeUndefined()
  })

  test('the same card failing twice: the line stays 5 seconds after the second failure', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = { settings: structuredClone(ONE) }
    w.mockClock = true
    w.commandDeny = 'refused'
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })
    await clock.advance(3000)
    await ui.press({ key: 'toggle-c1' })
    await clock.advance(2000)
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeDefined()
    await clock.advance(3000)
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeUndefined()
  })

  // the owner 2026-10-09 s28 「這邊還是沒有消失」: the line lives in $.state, which a hot reload keeps, while the timer and the card it is
  // about are the old module's and are gone; a line from before the 5 s code had no timer at all. A reload fires session.start
  // again, so session.start clears the line.
  test('a reload (session.start again) clears a line whose timer is gone', async ($, on) => {
    mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = { settings: structuredClone(ONE) }
    w.mockClock = true
    w.commandDeny = 'refused'
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeDefined()
    await start($)
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeUndefined()
  })

  test('deleting the card takes its line away at once; deleting another card does not', async ($, on) => {
    mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = { settings: structuredClone(ONE) }
    w.mockClock = true
    w.commandDeny = 'no command named /probe'
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'delete-c2' })
    await ui.press({ key: 'delete-c2' })
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeDefined()
    await ui.press({ key: 'delete-c1' })
    await ui.press({ key: 'delete-c1' })
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeUndefined()
  })
})

// the owner 2026-10-09 s28 「加個欄位名稱在狀態列旁邊 session-status 做小箭頭可以收納 下段做 status line 放在12格下面」, 「做記得 先跟狀態列一樣大」:
// a section name 「session-status」 beside 狀態列 with a small arrow that folds the cards away and back; the fold is remembered.
// Below the cards, the section 「status line」. Both names are bold like 狀態列 (weight semibold since s40, Claude Code 2.1.299). 「箭頭字元大一點」: a Button has no font size, so the
// arrow is the full-size triangle (▼ ▶), not the small one (▾ ▸).
describe('the Status Line section folds', () => {
  test('the header reads ▼ Status Line (semibold) and then the status line as it reads now; nothing under the cards', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const header = await ui.find({ type: 'Box', key: 'header' })
    const inHeader = walk(header?.children)
    const fold = inHeader.find(el => el.type === 'Button' && el.props['key'] === 'fold')
    expect(fold?.props['label']).toBe('▼')
    const names = inHeader.filter(el => el.type === 'Text').map(t => ({ text: String(t.children?.[0]), weight: t.props?.['weight'] }))
    expect(names[0]).toEqual({ text: 'StatusLine', weight: 'semibold' })
    expect(names[1]?.text).toBe(last(w))
    expect(names[1]?.weight).toBeUndefined()
    expect(names.length).toBe(2)
    const top = (await ui.drawn()).children as { props: Record<string, unknown> }[]
    const keys = top.map(el => String(el.props['key']))
    expect(keys.indexOf('header')).toBeLessThan(keys.indexOf('cards'))
    expect(keys).not.toContain('status-line')
  })

  test('the arrow folds the cards away and back; the status line in the header stays; the fold is stored and comes back', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Box', key: 'row-0' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'fold' }))?.props['label']).toBe('▶')
    expect((await ui.findAll({ type: 'Text', text: last(w) ?? '' })).length).toBeGreaterThan(0)
    expect((w.store['settings'] as { collapsed: boolean }).collapsed).toBe(true)
    // the status line itself is not changed by folding
    expect(last(w)).toContain('目前剩下 50%')

    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Box', key: 'row-0' })).toBeDefined()
    expect((w.store['settings'] as { collapsed: boolean }).collapsed).toBe(false)
  })

  test('a fold kept in the store is folded when the session starts', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, collapsed: true } }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await ui.find({ type: 'Box', key: 'row-0' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'fold' }))?.props['label']).toBe('▶')
  })
})

// the owner 2026-10-09 s28 「把這三個按鈕移到 展開的裡面靠右 最右邊邊緣對其 目前剩下的卡片右側」: 排序 預設 新增卡片 sit in the folding
// part, above the cards, pushed right; the cards part is only as wide as its widest row (four cards), so the right edge of 新增卡片
// lines up with the right edge of the fourth card (目前剩下 by default). Folded, they go with the cards.
describe('the three buttons sit in the folding part, on the right', () => {
  test('in the cards part, first, in a row pushed to the right; the cards part shrinks to its rows; none in the header', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    // the desktop's row stands in the panel's columns since s37 (Claude Design step 2): its own test, below
    for (const surface of ['terminal', 'vscode'] as const) {
      const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
      const header = await ui.find({ type: 'Box', key: 'header' })
      const inHeader = walk(header?.children).filter(el => el.type === 'Button').map(b => String(b.props['key']))
      expect(inHeader).toEqual(['fold'])

      const cards = await ui.find({ type: 'Box', key: 'cards' })
      expect(cards?.props['alignSelf']).toBe('flex-start')
      const first = (cards?.children as El[] | undefined)?.[0]
      expect(first?.props['key']).toBe('tools-row')
      expect(first?.props['flexDirection']).toBe('row')
      expect(first?.props['justifyContent']).toBe('flex-end')
      expect(walk(first?.children).filter(el => el.type === 'Button').map(b => String(b.props['key']))).toEqual(['sort', 'default-order', 'add-card'])
      // the fourth card of the first row is 目前剩下 by default
      const row0 = await ui.find({ type: 'Box', key: 'row-0' })
      // 版本號 first since s29: the fourth card is 工具次數
      expect(String((row0?.children as El[] | undefined)?.[3]?.props['key'])).toBe('card-tools')
      await ui.unmount()
    }
  })

  test('folded, the three buttons go with the cards', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'fold' })
    for (const key of ['sort', 'default-order', 'add-card']) expect(await ui.find({ type: 'Button', key })).toBeUndefined()
    await ui.press({ key: 'fold' })
    for (const key of ['sort', 'default-order', 'add-card']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  })
})

// the owner 2026-10-09 s28 「sl 指令也要改成 ss」: the command is /ss (the mod is superstatus); /sl is gone.
test('the command is /ss, and its help says /ss', async ($, on) => {
  const w = world()
  w.paneRefused = true // the listing row: bare /ss where no pane can be placed (s30)
  w.store = { language: 'zh-TW' }
  engine(on, w)
  await start($)

  expect(w.registered).toEqual(['ss'])
  const list = await sl($, '')
  expect(list.text).toContain('/ss on <項目>')
  expect(list.text).not.toContain('/sl')
  const wrong = await sl($, 'nonsense')
  expect(wrong.text).toContain('/ss')
  expect(wrong.text).not.toContain('/sl')
})

// the owner 2026-10-15 s39: his /ss off answered 「No item .」 (the open bug 「/ss on|off 沒給名稱時回空白名稱」; 「OK，先修 /ss on|off 沒給名稱時
// 的回覆，照規則先寫測試」). With no item, /ss on or off says an item is wanted, with the verb typed and an example, in the panel's language,
// and changes nothing; a wrong item is answered as before.
const ITEMS = 'ver who block tools ctx 5h 7d score pending branch dirty ff'
const NEED_ITEM: [string, (verb: string) => string, string][] = [
  ['en', verb => `Name an item: /ss ${verb} <item>, e.g. /ss ${verb} ver. Items: ${ITEMS}, or git (= branch dirty ff)`, `No item foo. Items: ${ITEMS}, or git (= branch dirty ff)`],
  ['zh-TW', verb => `要接一個項目：/ss ${verb} <項目>，例如 /ss ${verb} ver。項目：${ITEMS}，或 git（= branch dirty ff）`, `沒有這個項目：foo。項目：${ITEMS}，或 git（= branch dirty ff）`],
  ['ja', verb => `項目を指定してください：/ss ${verb} <項目>、例：/ss ${verb} ver。項目：${ITEMS}、または git（= branch dirty ff）`, `項目 foo はありません。項目：${ITEMS}、または git（= branch dirty ff）`],
]
for (const [language, needItem, noFoo] of NEED_ITEM) {
  test(`/ss on or off with no item asks for one, with an example, and changes nothing (${language})`, async ($, on) => {
    const w = world()
    w.store = { language }
    engine(on, w)
    await start($)
    await sl($, 'off ctx')
    const store = JSON.stringify(w.store)
    const line = last(w)

    expect((await sl($, 'off')).text).toBe(needItem('off'))
    expect((await sl($, 'on')).text).toBe(needItem('on'))
    // a space after the verb is no item either (the arguments are trimmed)
    expect((await sl($, 'off   ')).text).toBe(needItem('off'))
    expect(JSON.stringify(w.store)).toBe(store)
    expect(last(w)).toBe(line)

    expect((await sl($, 'off foo')).text).toBe(noFoo)
  })
}

// the owner 2026-10-09 s28 「做個同一層級的 AbovePrompt」「我要放不同功能 但是一樣是卡片式管理」「可以」: a second section, AbovePrompt,
// beside Status Line in rank: its own fold, its own cards (none at first). s30: its row of 排序 預設 新增卡片 became three block switches
// (TouchBar showinfo showchart); cards are added from TouchBar's 新增卡片, a text card landing at the AbovePrompt level.
// What is on in it shows in the band above the prompt; the status line does not carry it.
describe('the AbovePrompt section', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never
  const engineBand = (on: Parameters<Parameters<typeof test>[1]>[1]) =>
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['engine band'] }) as never)

  // a text card from showinfo's 新增卡片 (TouchBar's until s38: H1 offers no text card since Claude Design step 5)
  async function addAbove($: Engine, name: string, text: string) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'h2-add-card' })
    await ui.unmount()
    const pane = await addPane($)
    await pane.select({ key: 'add-kind', value: 'text' })
    await pane.input({ key: 'add-name', text: name, kind: 'change' })
    await pane.input({ key: 'add-text', text, kind: 'change' })
    await pane.press({ key: 'add-ok' })
    await pane.unmount()
  }

  test('a second section under the Status Line cards: its own arrow, its name, its three switches, no cards yet', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const keys = ((await ui.drawn()).children as El[]).map(el => String(el.props?.['key']))
    expect(keys.indexOf('cards')).toBeLessThan(keys.indexOf('above-header'))
    expect(keys.indexOf('above-header')).toBeLessThan(keys.indexOf('above-cards'))
    const header = walk((await ui.find({ type: 'Box', key: 'above-header' }))?.children)
    expect(header.find(el => el.type === 'Button')?.props['key']).toBe('above-fold')
    expect(header.find(el => el.type === 'Button')?.props['label']).toBe('▼')
    expect(header.filter(el => el.type === 'Text').map(t => ({ text: String(t.children?.[0]), weight: t.props?.['weight'] }))[0]).toEqual({ text: 'AbovePrompt', weight: 'semibold' })
    const tools = await ui.find({ type: 'Box', key: 'above-tools-row' })
    // on the desktop in the band's order since s37 (Claude Design step 3; s34's three rows elsewhere)
    expect(walk(tools?.children).filter(el => el.type === 'Button').map(b => String(b.props['key']))).toEqual(STACKED)
    expect((await ui.find({ type: 'Box', key: 'above-cards' }))?.props['alignSelf']).toBe('flex-start')
    // s33: the header shows the band made small in place of its text line: eight empty boxes, no button (on VS Code; the desktop's draws
    // shown blocks with cards alone since s37, Claude Design step 4, and with no card says so in a line); the terminal says it
    expect(await ui.find({ type: 'Text', text: '還沒有卡片：按新增卡片加入' })).toBeDefined()
    const vscode = await $.ui.mount({ plugin: 'superstatus', surface: 'vscode', component: 'CommandOutput', props: PANEL })
    expect(await vscode.find({ type: 'Text', text: /還沒有卡片/ })).toBeUndefined()
    const preview = drawingOf(String(walk((await vscode.find({ type: 'Box', key: 'above-preview' }))?.children).find(el => el.type === 'Svg')?.props['source']))
    expect((preview.match(/stroke-dasharray/g) ?? []).length).toBe(8)
    expect(preview).not.toContain('class="pill"')
    const terminal = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'CommandOutput', props: PANEL })
    expect(await terminal.find({ type: 'Text', text: /還沒有卡片/ })).toBeDefined()
  })

  // the owner 2026-10-09 s30 「放甲把預設三個按鈕換成 TouchBar showinfo showchart 先暫定這三個」「這三顆都是代表未來這三個區塊一次開關的功能」:
  // AbovePrompt's row holds three switches, one per block of the band; lit = the block shows above the prompt, grey = folded away; kept.
  const BLOCKS = () => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2', 'c3'], cards: [
    { id: 'c1', kind: 'text', name: '提醒', text: 'a', prefix: '', section: 'above' },
    { id: 'c2', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
    { id: 'c3', kind: 'button', name: '暫存', text: '--S', prefix: '', section: 'above' },
  ] } })
  const SWITCHES = ['above-show-chart', 'above-show-chart-half', 'above-show-chart-full', 'above-show-info', 'above-show-info-half', 'above-show-info-full', 'above-show-touch']
  // the desktop's order since s37 (Claude Design step 3, the owner 「OK，照設計的順序開始第 3 步」): the band's, top to bottom, as the menus
  const STACKED = ['above-show-chart-full', 'above-show-chart-half', 'above-show-chart', 'above-show-info-full', 'above-show-info-half', 'above-show-info', 'above-show-touch']

  // s34 (the owner 「開關按鈕現在會有 showchart showchart-half showchart-full / showinfo showinfo-half showinfo-full / touchbar(改成全小寫)」「按鈕大小要
  // 固定不要跑掉」): seven switches in his three rows, each in a plain room of one width, its label padded to one width, so none moves or grows.
  // on VS Code since s37: the desktop's switches are a name and a Shown/Hidden button (Claude Design step 3), tested there
  test('AbovePrompt\'s switches: seven in three rows (showchart -half -full, showinfo -half -full, touchbar), one size, all lit at first; no 排序 預設 新增卡片', async ($, on) => {
    const w = world()
    w.store = BLOCKS()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'vscode', component: 'CommandOutput', props: PANEL })
    const tools = walk((await ui.find({ type: 'Box', key: 'above-tools-row' }))?.children).filter(el => el.type === 'Button')
    expect(tools.map(b => String(b.props['key']))).toEqual(SWITCHES)
    expect(tools.map(b => bare(String(b.props['label'])))).toEqual(['showchart', 'showchart-half', 'showchart-full', 'showinfo', 'showinfo-half', 'showinfo-full', 'touchbar'])
    expect(tools.map(b => b.props['dimColor'])).toEqual([false, false, false, false, false, false, false])
    const rows = await Promise.all([0, 1, 2].map(async i =>
      walk((await ui.find({ type: 'Box', key: `above-switch-row-${i}` }))?.children).filter(el => el.type === 'Button').map(b => String(b.props['key']))))
    expect(rows).toEqual([SWITCHES.slice(0, 3), SWITCHES.slice(3, 6), SWITCHES.slice(6)])
    // one size: every label padded to the widest's width, every button in a plain room of one width that holds it (s34 lab: a pane button is
    // 1.73 cells a character and 1.56 of its own)
    // each label's own width as measured on the owner's 7.webp (characters of 15.1 px; lower-case letters are narrower than s29's 0.575), and
    // the en and quarter spaces padded on: the seven within a quarter of a character (the 7.webp pills were 121-141 px)
    const MEASURED: Record<string, number> = { showchart: 4.98, 'showchart-half': 7.19, 'showchart-full': 6.92, showinfo: 4.28, 'showinfo-half': 6.49,
      'showinfo-full': 6.16, touchbar: 4.28 }
    const widths = tools.map(b => {
      const label = String(b.props['label'])
      return Number(MEASURED[String(bare(label))]) + textEm(label) - textEm(String(bare(label)))
    })
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.25)
    // a pane button is 1.62 cells a character and 2.19 of its own (the lab's 5.5-character button, 103.5 px, and its 15.1 px characters)
    const rooms = await Promise.all(SWITCHES.map(key => ui.find({ type: 'Box', key: key.replace('above-show-', 'above-switch-') })))
    expect(new Set(rooms.map(r => r?.props['width'])).size).toBe(1)
    expect(Number(rooms[0]?.props['width'])).toBeGreaterThanOrEqual(Math.ceil(Math.max(...widths) * 1.62 + 2.19))
    for (const room of rooms) {
      expect(room?.props['borderStyle']).toBeUndefined()
      expect(room?.props['justifyContent']).toBe('center')
    }
    for (const key of ['above-sort', 'above-default-order', 'above-add-card']) {
      expect(await ui.find({ type: 'Button', key })).toBeUndefined()
    }
  })

  test('TouchBar folds the band\'s buttons away at once and back; the text line stays; kept in the store', async ($, on) => {
    const w = world()
    w.store = BLOCKS()
    engine(on, w)
    engineBand(on)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect((await band.findAll({ type: 'Button' })).length).toBe(2)
    await ui.press({ key: 'above-show-touch' })
    expect((w.store['settings'] as { aboveOff: string[] }).aboveOff).toEqual(['touch'])
    expect((await ui.find({ type: 'Button', key: 'above-show-touch' }))?.props['dimColor']).toBe(true)
    expect(await band.find({ type: 'Button' })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: '提醒 a' })).toBeDefined()
    await ui.press({ key: 'above-show-touch' })
    expect((w.store['settings'] as { aboveOff: string[] }).aboveOff).toEqual([])
    expect((await band.findAll({ type: 'Button' })).length).toBe(2)
  })

  test('showinfo folds the text line away, the buttons stay; with both off the band is the engine\'s', async ($, on) => {
    const w = world()
    w.store = BLOCKS()
    engine(on, w)
    engineBand(on)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    await ui.press({ key: 'above-show-info' })
    expect(await band.find({ type: 'Text', text: '提醒 a' })).toBeUndefined()
    expect((await band.findAll({ type: 'Button' })).length).toBe(2)
    await ui.press({ key: 'above-show-touch' })
    expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  })

  test('showchart greys and is kept; with no H1 card the band does not change', async ($, on) => {
    const w = world()
    w.store = BLOCKS()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'above-show-chart' })
    expect((w.store['settings'] as { aboveOff: string[] }).aboveOff).toEqual(['chart'])
    expect((await ui.find({ type: 'Button', key: 'above-show-chart' }))?.props['dimColor']).toBe(true)
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect((await band.findAll({ type: 'Button' })).length).toBe(2)
    expect(await band.find({ type: 'Text', text: '提醒 a' })).toBeDefined()
  })

  test('each new switch folds its own block of the band and is kept; a kept new name comes back', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2', 'c3'], cards: [
      { id: 'c1', kind: 'text', name: '半圖', text: 'a', prefix: '', section: 'above', size: 'H3-half' },
      { id: 'c2', kind: 'text', name: '全資', text: 'b', prefix: '', section: 'above', size: 'H2-full' },
      { id: 'c3', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
    ] } }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await band.find({ type: 'Box', key: 'band-tile-c1' })).toBeDefined()
    expect(await band.find({ type: 'Box', key: 'band-tile-c2' })).toBeDefined()
    await ui.press({ key: 'above-show-chart-half' })
    expect((w.store['settings'] as { aboveOff: string[] }).aboveOff).toEqual(['chart-half'])
    expect((await ui.find({ type: 'Button', key: 'above-show-chart-half' }))?.props['dimColor']).toBe(true)
    expect(await band.find({ type: 'Box', key: 'band-tile-c1' })).toBeUndefined()
    expect(await band.find({ type: 'Box', key: 'band-tile-c2' })).toBeDefined()
    await ui.press({ key: 'above-show-info-full' })
    expect((w.store['settings'] as { aboveOff: string[] }).aboveOff).toEqual(['chart-half', 'info-full'])
    expect(await band.find({ type: 'Box', key: 'band-tile-c2' })).toBeUndefined()
    expect((await band.findAll({ type: 'Button' })).length).toBe(1)
  })

  test('a folded block kept in the store is folded when the session starts; an unknown name is dropped', async ($, on) => {
    const w = world()
    w.store = BLOCKS()
    ;(w.store['settings'] as { aboveOff?: string[] }).aboveOff = ['touch', 'nonsense', 'chart-full']
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await band.find({ type: 'Button' })).toBeUndefined()
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect((await ui.find({ type: 'Button', key: 'above-show-touch' }))?.props['dimColor']).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'above-show-info' }))?.props['dimColor']).toBe(false)
    expect((await ui.find({ type: 'Button', key: 'above-show-chart-full' }))?.props['dimColor']).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'above-show-chart-half' }))?.props['dimColor']).toBe(false)
  })

  test('a text card added from showinfo\'s 新增卡片 lands in AbovePrompt: in its cards, on the band above the prompt, not on the status line', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    engineBand(on)
    await start($)

    await addAbove($, '提醒', '等 Anna')
    const stored = w.store['settings'] as { cards: { id: string; section?: string }[]; aboveOrder: string[]; order: string[] }
    expect(stored.cards).toEqual([expect.objectContaining({ id: 'c1', section: 'above' })])
    expect(stored.aboveOrder).toEqual(['c1'])
    expect(stored.order).not.toContain('c1')
    expect(last(w)).not.toContain('提醒')

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    // ruling 2026-10-10 s29: a text card is a display, in showinfo (H2)
    const inAbove = walk((await ui.find({ type: 'Box', key: 'h2-cards' }))?.children).map(el => String(el.props?.['key']))
    expect(inAbove).toContain('card-c1')
    const inStatus = walk((await ui.find({ type: 'Box', key: 'cards' }))?.children).map(el => String(el.props?.['key']))
    expect(inStatus).not.toContain('card-c1')
    // AbovePrompt's own line (the empty menus' lines since Claude Design step 8 name their menu first)
    expect(await ui.find({ type: 'Text', text: /^還沒有卡片/ })).toBeUndefined()

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await band.find({ type: 'Text', text: '提醒 等 Anna' })).toBeDefined()
    // turned off, the band is the engine's again
    await ui.press({ key: 'toggle-c1' })
    expect(await band.find({ type: 'Text', text: /提醒/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  })

  test('新增卡片 from the Status Line section still adds to the status line', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'touch-add-card' })
    await ui.press({ key: 'add-card' })
    const pane = await addPane($)
    await pane.input({ key: 'add-name', text: '下方', kind: 'change' })
    await pane.input({ key: 'add-text', text: 'x', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    expect(last(w)).toContain('下方 x')
    expect((w.store['settings'] as { aboveOrder: string[] }).aboveOrder).toEqual([])
  })

  test('Status Line\'s 排序 shows no arrows under AbovePrompt\'s text cards; their order shows in the band', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c2', 'c1'], cards: [
      { id: 'c1', kind: 'text', name: '一', text: 'a', prefix: '', section: 'above' },
      { id: 'c2', kind: 'text', name: '二', text: 'b', prefix: '', section: 'above' },
    ] } }
    engine(on, w)
    engineBand(on)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'sort' })
    expect(await ui.find({ type: 'Button', key: 'left-who' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'left-c1' })).toBeUndefined()
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    // ruling 2026-10-10 s29: each text card is an H2 tile, in the order
    const tiles = walk(((await band.drawn()) as { children?: unknown }).children).map(el => String(el.props?.['key'])).filter(k => k.startsWith('band-tile-'))
    expect(tiles).toEqual(['band-tile-c2', 'band-tile-c1'])
  })

  test('the AbovePrompt fold is its own and is kept', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [
      { id: 'c1', kind: 'text', name: '一', text: 'a', prefix: '', section: 'above' },
    ] } }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'above-fold' })
    expect(await ui.find({ type: 'Box', key: 'above-cards' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'cards' })).toBeDefined()
    expect((w.store['settings'] as { aboveCollapsed: boolean }).aboveCollapsed).toBe(true)
    await ui.press({ key: 'above-fold' })
    expect(await ui.find({ type: 'Box', key: 'above-cards' })).toBeDefined()
    expect((w.store['settings'] as { aboveCollapsed: boolean }).aboveCollapsed).toBe(false)
  })

  test('an AbovePrompt fold kept in the store is folded when the session starts', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, aboveCollapsed: true } }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await ui.find({ type: 'Box', key: 'above-cards' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'above-fold' }))?.props['label']).toBe('▶')
  })

  test('a survey holds the band: the section yields to it', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [
      { id: 'c1', kind: 'text', name: '一', text: 'a', prefix: '', section: 'above' },
    ] } }
    engine(on, w)
    engineBand(on)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: true, isWorking: false, maxRows: 10, bodyColumns: 80 } as never })
    expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  })
})

// the owner 2026-10-09 s29, sketch docs/sketches/2026-10-09_s29_aboveprompt-touchbar.jpg: AbovePrompt is layered; its first layer, the bottom
// of the band, is TouchBar, the row of buttons (「TouchBar 就是 指現在的這些按鈕的部分」「第一層最底下就是 TouchBar」). In the panel TouchBar
// is a second level under AbovePrompt (「增加次級菜單」) with its own fold, 排序 預設 新增卡片 and the 按鈕卡, all one width (「全部一樣寬」);
// AbovePrompt's header shows a picture of the band; the text cards stay at the AbovePrompt level.
describe('TouchBar, the first layer of AbovePrompt', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never
  const MIXED = () => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c2', 'c1', 'c3', 'c4'], cards: [
    { id: 'c1', kind: 'text', name: '提醒', text: 'a', prefix: '', section: 'above' },
    { id: 'c2', kind: 'button', name: '設定SS', text: '/ss', prefix: '', section: 'above' },
    { id: 'c3', kind: 'button', name: '暫存', text: '--S', prefix: '', section: 'above' },
    { id: 'c4', kind: 'button', name: '關的', text: '--h', prefix: '', section: 'above' },
  ] } })
  const keysIn = async (ui: { find: (q: object) => Promise<Found> }, box: string) =>
    walk(((await ui.find({ type: 'Box', key: box })) as { children?: unknown } | undefined)?.children).map(el => String(el.props?.['key']))

  test('a second level under AbovePrompt: its own arrow, its name, its own three buttons, indented; the 按鈕卡 are there, the text cards stay above', async ($, on) => {
    const w = world()
    w.store = MIXED()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const header = walk((await ui.find({ type: 'Box', key: 'touch-header' }))?.children)
    expect(header.find(el => el.type === 'Button')?.props['key']).toBe('touch-fold')
    expect(header.find(el => el.type === 'Button')?.props['label']).toBe('▼')
    expect(header.filter(el => el.type === 'Text').map(t => ({ text: String(t.children?.[0]), weight: t.props?.['weight'] }))[0]).toEqual({ text: 'touchbar', weight: 'semibold' })
    // indented: its header row (s33: the menu's column itself is not, so its header row can end where four cards end); its cards stand in
    // the panel's columns on the desktop since s37 (Claude Design step 3)
    expect(Number((await ui.find({ type: 'Box', key: 'touch-header' }))?.props['paddingLeft'])).toBeGreaterThan(0)
    expect(Number((await ui.find({ type: 'Box', key: 'touch-cards' }))?.props['marginLeft'] ?? 0)).toBe(0)
    const tools = await ui.find({ type: 'Box', key: 'touch-tools-row' })
    expect(walk(tools?.children).filter(el => el.type === 'Button').map(b => String(b.props['key']))).toEqual(['touch-sort', 'touch-default-order', 'touch-add-card'])
    const inTouch = await keysIn(ui, 'touch-cards')
    const inAbove = await keysIn(ui, 'above-cards')
    expect(['card-c2', 'card-c3', 'card-c4'].every(k => inTouch.includes(k))).toBe(true)
    expect(inTouch).not.toContain('card-c1')
    // ruling 2026-10-10 s29: the text card is a display, in showinfo (H2), not at the AbovePrompt level
    expect(inAbove).not.toContain('card-c1')
    expect(await keysIn(ui, 'h2-cards')).toContain('card-c1')
    expect(inAbove.some(k => ['card-c2', 'card-c3', 'card-c4'].includes(k))).toBe(false)
    // TouchBar sits inside the AbovePrompt section, after its own cards
    const top = ((await ui.drawn()).children as El[]).map(el => String(el.props?.['key']))
    expect(top.indexOf('above-cards')).toBeLessThan(top.indexOf('touch'))
  })

  // the owner 2026-10-10 s33 「touchbar 次級菜單 旁邊 把AP旁邊touchBar資訊顯示在這裡」: the picture of the buttons moved from AbovePrompt's header to
  // TouchBar's
  test('TouchBar\'s header holds a picture of the band\'s buttons: those on, in order, numbered, in a rounded frame', async ($, on) => {
    const w = world()
    w.store = MIXED()
    ;(w.store['settings'] as { off: string[] }).off = ['c4']
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    // 300 units wide (s29: the old full width 456 less the ~133 the arrow and the name take); what does not fit ends in +N
    const header = walk((await ui.find({ type: 'Box', key: 'touch-header' }))?.children)
    expect(header.some(el => el.type === 'Box' && el.props?.['key'] === 'touch-band')).toBe(true)
    expect(walk((await ui.find({ type: 'Box', key: 'above-header' }))?.children).some(el => el.props?.['key'] === 'touch-band')).toBe(false)
    const picture = walk((await ui.find({ type: 'Box', key: 'touch-band' }))?.children).find(el => el.type === 'Svg')
    expect(picture?.props['width']).toBe(300)
    expect(picture?.props['alt']).toBe('touchbar ¹設定SS ²暫存')
    const source = drawingOf(String(picture?.props['source']))
    expect(source).toContain('>¹設定SS</text>')
    expect(source).toContain('>²暫存</text>')
    expect(source).not.toContain('關的')
    expect(source).toMatch(/<rect[^>]* rx="1[0-9]"/)
    // the header no longer says （全部關閉）, and the text line is gone from it (s33: the picture of the band in its place)
    expect(await ui.find({ type: 'Text', text: /全部關閉/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '提醒 a' })).toBeUndefined()
    const terminal = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'CommandOutput', props: PANEL })
    expect(await terminal.find({ type: 'Text', text: '[¹設定SS] [²暫存]' })).toBeDefined()
    // folded, AbovePrompt keeps its header and its picture of the band; TouchBar and its picture fold away with it
    await ui.press({ key: 'above-fold' })
    expect(await ui.find({ type: 'Box', key: 'above-preview' })).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'touch-band' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'touch' })).toBeUndefined()
  })

  test('with buttons on and no text card, AbovePrompt\'s header does not say （全部關閉）', async ($, on) => {
    const w = world()
    w.store = MIXED()
    const st = w.store['settings'] as { aboveOrder: string[]; cards: { id: string }[] }
    st.cards = st.cards.filter(c => c.id !== 'c1')
    st.aboveOrder = ['c2', 'c3', 'c4']
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await ui.find({ type: 'Text', text: /全部關閉/ })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'touch-band' })).toBeDefined()
  })

  // s29: the version was a button first in TouchBar for a while, then moved to Status Line (「版本號只要在 status line」)
  test('TouchBar holds no version button: the 按鈕卡 are numbered from ¹, in the band and in the picture', async ($, on) => {
    const w = world()
    w.store = MIXED()
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await band.find({ type: 'Button', key: 'band-version' })).toBeUndefined()
    expect((await band.find({ type: 'Button', key: 'band-c2' }))?.text).toMatch(/^¹/)
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const picture = walk((await ui.find({ type: 'Box', key: 'touch-band' }))?.children).find(el => el.type === 'Svg')
    expect(String(picture?.props['alt']).startsWith('touchbar ¹設定SS')).toBe(true)
  })

  test('no version button while TouchBar has no button on: an empty band stays the engine\'s', async ($, on) => {
    const w = world()
    w.store = MIXED()
    ;(w.store['settings'] as { off: string[] }).off = ['c1', 'c2', 'c3', 'c4']
    engine(on, w)
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['engine band'] }) as never)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await band.find({ type: 'Button', key: 'band-version' })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  })

  test('a text card on and every button off: the text line, and no version button alone under it', async ($, on) => {
    const w = world()
    w.store = MIXED()
    ;(w.store['settings'] as { off: string[] }).off = ['c2', 'c3', 'c4']
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await band.find({ type: 'Text', text: '提醒 a' })).toBeDefined()
    expect(await band.find({ type: 'Button', key: 'band-version' })).toBeUndefined()
  })

  test('the picture beside TouchBar shows the buttons that fit in 300 units and +N for the rest', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
      aboveOrder: Array.from({ length: 12 }, (_, i) => `c${i + 1}`),
      // three long names, then short ones: the fourth shape would end in the room kept for +N
      cards: Array.from({ length: 12 }, (_, i) => ({ id: `c${i + 1}`, kind: 'button', name: i < 3 ? '確定分數' : '說明', text: '--h', prefix: '', section: 'above' })) } }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const source = drawingOf(String(walk((await ui.find({ type: 'Box', key: 'touch-band' }))?.children).find(el => el.type === 'Svg')?.props['source']))
    const shapes = (source.match(/<rect [^>]*rx="6"/g) ?? []).length
    expect(shapes).toBeGreaterThan(0)
    expect(shapes).toBeLessThan(12)
    expect(source).toContain(`>+${12 - shapes}</text>`)
    // every shape ends inside the frame
    for (const m of source.matchAll(/<rect x="([\d.]+)" y="7" width="([\d.]+)"/g)) expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(300 - 8)
    // and the +N too (two digits at 11 px are under 22 units)
    const more = /<text x="([\d.]+)"[^>]*>\+\d+<\/text>/.exec(source)
    expect(Number(more?.[1]) + 22).toBeLessThanOrEqual(300 - 8)
  })

  test('TouchBar\'s fold is its own and is kept', async ($, on) => {
    const w = world()
    w.store = MIXED()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'touch-fold' })
    expect(await ui.find({ type: 'Box', key: 'touch-cards' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'touch-header' })).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'above-cards' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'touch-fold' }))?.props['label']).toBe('▶')
    expect((w.store['settings'] as { touchCollapsed: boolean }).touchCollapsed).toBe(true)
  })

  test('a TouchBar fold kept in the store is folded when the session starts', async ($, on) => {
    const w = world()
    w.store = MIXED()
    ;(w.store['settings'] as { touchCollapsed?: boolean }).touchCollapsed = true
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await ui.find({ type: 'Box', key: 'touch-cards' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'touch-fold' }))?.props['label']).toBe('▶')
  })

  test('TouchBar\'s 新增卡片 opens the pane set to 按鈕卡, and the card lands in TouchBar', async ($, on) => {
    const w = world()
    w.store = MIXED()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'touch-add-card' })
    expect(w.opened).toEqual(['sl-add'])
    const pane = await addPane($)
    // on the desktop the field's label is a column of its own beside it (Claude Design step 5, s38)
    expect(walk((await pane.find({ type: 'Box', key: 'add-row-text' }))?.children).filter(el => el.type === 'Text').map(el => ((el.children ?? []) as unknown[]).join(''))).toEqual(['送出'])
    await pane.input({ key: 'add-name', text: '說明', kind: 'change' })
    await pane.input({ key: 'add-text', text: '--h', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    expect((w.store['settings'] as { cards: object[] }).cards[4]).toMatchObject({ id: 'c5', kind: 'button', section: 'above' })
    expect(await keysIn(ui, 'touch-cards')).toContain('card-c5')
  })

  test('TouchBar sorts on its own: arrows under its cards only, a move passes over the text cards, places count TouchBar alone, its 預設 orders its cards alone', async ($, on) => {
    const w = world()
    w.store = MIXED()
    ;(w.store['settings'] as { aboveOrder: string[] }).aboveOrder = ['c3', 'c1', 'c2', 'c4']
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'touch-sort' })
    expect(await ui.find({ type: 'Button', key: 'left-c3' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'left-c1' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'left-who' })).toBeUndefined()
    // c3 is first in TouchBar: its left arrow is dim; c2 is second
    expect((await ui.find({ type: 'Button', key: 'left-c3' }))?.props['dimColor']).toBe(true)
    const badge = walk((await ui.find({ type: 'Box', key: 'number-c2' }))?.children).find(el => el.type === 'Svg')
    expect(badge?.props['alt']).toBe('２')

    await ui.press({ key: 'right-c3' })
    const order = () => (w.store['settings'] as { aboveOrder: string[] }).aboveOrder
    expect(order()).toEqual(['c2', 'c1', 'c3', 'c4'])
    await ui.press({ key: 'touch-default-order' })
    expect(order()).toEqual(['c2', 'c1', 'c3', 'c4'])
    await ui.press({ key: 'right-c2' })
    expect(order()).toEqual(['c3', 'c1', 'c2', 'c4'])
    expect((await ui.find({ type: 'Button', key: 'touch-default-order' }))?.props['dimColor']).toBe(false)
    await ui.press({ key: 'touch-default-order' })
    expect(order()).toEqual(['c2', 'c1', 'c3', 'c4'])
    expect((await ui.find({ type: 'Button', key: 'touch-default-order' }))?.props['dimColor']).toBe(true)

    // s30: AbovePrompt has no 排序 of its own: its text card never shows arrows
    expect(await ui.find({ type: 'Button', key: 'left-c1' })).toBeUndefined()
  })
})

// the owner 2026-10-09 s28 「這塊要做按鈕 但管理那邊的規則一樣是卡片式管理」「先把我 --h 的功能做成按鈕我來按按看」: a 按鈕卡 in the AbovePrompt
// section is a real button in the band above the prompt. Pressed, it sends what it holds: a / command as that command, anything
// else as if the owner typed it (--h then reads as his own --h). H3 (one row, the probe's band height) and the middle width for now.
describe('按鈕卡', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never
  const withButtons = (cards: object[]) => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: cards.map(c => (c as { id: string }).id), cards } })

  test('added from TouchBar\'s 新增卡片, it is a button in the band, with the width of a name button', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'touch-add-card' })
    const pane = await addPane($)
    await pane.select({ key: 'add-kind', value: 'button' })
    // on the desktop the field's label is a column of its own beside it (Claude Design step 5, s38)
    expect(walk((await pane.find({ type: 'Box', key: 'add-row-text' }))?.children).filter(el => el.type === 'Text').map(el => ((el.children ?? []) as unknown[]).join(''))).toEqual(['送出'])
    await pane.input({ key: 'add-name', text: '說明', kind: 'change' })
    await pane.input({ key: 'add-text', text: '--h', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    expect((w.store['settings'] as { cards: object[] }).cards[0]).toMatchObject({ id: 'c1', kind: 'button', name: '說明', text: '--h', section: 'above' })

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    const b = await band.find({ type: 'Button', key: 'band-c1' })
    expect(bare(unnumbered(b?.text))).toBe('說明')
    // 4.5 characters since 「把寬度縮小到可以放12個」 (s29: padded by bandLabel, the number counted)
    expect(Math.abs(textEm(b?.text ?? '') - 4.5)).toBeLessThanOrEqual(0.125)
    // not on the status line; its card holds the size button in the middle (the owner 2026-10-09 s28), not a dial
    expect(last(w)).not.toContain('說明')
    // ruling 2026-10-10 s29: a 按鈕卡 is always H1 and has no size button
    expect(await ui.find({ type: 'Button', key: 'size-c1' })).toBeUndefined()
  })

  test('pressed, plain text is sent as if typed (asUser), a / command as that command', async ($, on) => {
    const w = world()
    w.store = withButtons([
      { id: 'c1', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
      { id: 'c2', kind: 'button', name: '探針關', text: '/probe off', prefix: '', section: 'above' },
    ])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    await band.press({ key: 'band-c1' })
    expect(w.prompts).toEqual([{ text: '--h', asUser: true }])
    await band.press({ key: 'band-c2' })
    expect(w.commands).toEqual(['probe off'])
    expect(w.prompts.length).toBe(1)
  })

  // the owner 2026-10-09 s28 「按鈕3 改成 /ss 的功能 顯示設定SS」: the button sent /ss and the engine answered "superstatus registered /ss but
  // no command.run hook answered it" ($.command.run skips the calling mod's own hooks). Its own /ss opens the panel in a pane instead.
  test('a 按鈕卡 sending this mod\'s own bare /ss opens the /ss panel in a pane, the same panel, and runs no command', async ($, on) => {
    const w = world()
    w.store = withButtons([{ id: 'c1', kind: 'button', name: '設定SS', text: '/ss', prefix: '', section: 'above' }])
    engine(on, w)
    // a /ss the mod runs through $.command.run passes its own hook by and lands here
    on('command.run', { command: 'ss' }, ($, e) => {
      w.commands.push(`ss ${e.args}`.trim())
      return { text: '' }
    })
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    let thrown = ''
    await band.press({ key: 'band-c1' }).catch((error: unknown) => {
      thrown = String(error)
    })
    expect(thrown).toBe('')

    expect(w.opened).toEqual(['ss-panel'])
    expect(w.commands).toEqual([])
    expect(w.prompts).toEqual([])
    const pane = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', requestId: 'ss-panel',
      props: { title: '設定SS', isFocused: false, bodyColumns: 80, placement: 'dock' } as never })
    for (const key of ['fold', 'sort', 'default-order', 'add-card', 'above-fold', 'above-show-touch', 'toggle-who']) {
      expect(await pane.find({ type: 'Button', key })).toBeDefined()
    }
    expect(await pane.find({ type: 'Text', text: 'StatusLine' })).toBeDefined()
  })

  // the owner 2026-10-09 s30 「設定要到pane裡面記得不用出現在對話了」: a typed bare /ss opens the panel in its pane, as 設定SS does, and
  // leaves no row in the conversation.
  test('a typed bare /ss opens the /ss panel in its pane and prints no row', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const out = await sl($, '')
    expect(out.text).toBeUndefined()
    expect(w.opened).toEqual(['ss-panel'])
    // the command's help says what a bare /ss does now
    expect(w.described['ss']).toContain('/ss 開設定面板')
    expect(w.described['ss']).not.toContain('列出')
    const pane = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', requestId: 'ss-panel',
      props: { title: 'superstatus', isFocused: true, bodyColumns: 80, placement: 'dock' } as never })
    for (const key of ['fold', 'sort', 'default-order', 'add-card', 'above-fold', 'toggle-who']) {
      expect(await pane.find({ type: 'Button', key })).toBeDefined()
    }
  })

  test('where no pane can be placed, a bare /ss prints the listing row as before', async ($, on) => {
    const w = world()
    w.paneRefused = true
    engine(on, w)
    await start($)

    const out = await sl($, '')
    expect(w.opened).toEqual(['ss-panel'])
    expect(out.text).toContain('項目（名稱、開／關、目前的值）')
  })

  test('/ss with arguments still answers in the conversation and opens no pane', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const out = await sl($, 'off ctx')
    expect(out.text).toBe('已更新：off ctx')
    expect(w.opened).toEqual([])
  })

  test('a 按鈕卡 sending /ss with arguments opens no pane', async ($, on) => {
    const w = world()
    w.mockClock = true
    w.store = withButtons([{ id: 'c1', kind: 'button', name: '關git', text: '/ss off git', prefix: '', section: 'above' }])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    await band.press({ key: 'band-c1' })
    expect(w.opened).toEqual([])
  })

  test('buttons and text cards share the band in the section order; an off button is not drawn', async ($, on) => {
    const w = world()
    w.store = withButtons([
      { id: 'c1', kind: 'text', name: '提醒', text: 'x', prefix: '', section: 'above' },
      { id: 'c2', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
      { id: 'c3', kind: 'button', name: '關的', text: '--h', prefix: '', section: 'above' },
    ])
    ;(w.store['settings'] as { off: string[] }).off = ['c3']
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    const drawn = walk([await band.drawn()]).filter(el => el.type === 'Text' || el.type === 'Button')
      .map(el => (el.type === 'Button' ? `[${bare(unnumbered(String(el.props['label'])))}]` : String(el.children?.[0])))
    expect(drawn).toEqual(['提醒 x', '[說明]'])
  })

  test('a 按鈕卡 needs something to send', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.select({ key: 'add-kind', value: 'button' })
    await pane.input({ key: 'add-name', text: '空', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    expect(await pane.find({ type: 'Text', text: /送出/ })).toBeDefined()
    expect(w.closed).toEqual([])
  })
})

// the owner 2026-10-09 s28 「AbovePrompt 的卡片 中間要顯示 小中大 按下去會循環切換大小」 (a size button on a card, kept); s30 H1-H3; then the ruling of
// 2026-10-10 s29 (「我的規則H1是按鈕 H23 是像是dashboard那樣展示資訊的部分」, picture docs/sketches/2026-10-10_s29_h123-bounds.png): a 按鈕卡 is always
// H1, the button row, and has no size button; any other AbovePrompt card (text, countdown, file, command) is a display, H2 or H3: its size
// button goes H2 → H3 → H2, kept; a new one, and one kept with no size or an old one, is H2.
describe('the size of an AbovePrompt display card', () => {
  const ONE = { settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2'], cards: [
    { id: 'c1', kind: 'text', name: '提醒', text: 'x', prefix: '', section: 'above' },
    { id: 'c2', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
  ] } }

  // s34 (the owner 「照表開工」, the table's size button): through all six display sizes, from the bottom of the band up
  test('H2 at first; each press goes H2 → H2-half → H2-full → H3 → H3-half → H3-full → H2; kept in the store', async ($, on) => {
    const w = world()
    w.store = structuredClone(ONE)
    engine(on, w)
    await start($)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
      const size = async () => bare((await ui.find({ type: 'Button', key: 'size-c1' }))?.text)
      expect(await size()).toBe('H2')
      for (const next of ['H2-half', 'H2-full', 'H3', 'H3-half', 'H3-full']) {
        await ui.press({ key: 'size-c1' })
        expect(await size()).toBe(next)
        expect((w.store['settings'] as { cards: { size?: string }[] }).cards[0]?.size).toBe(next)
      }
      await ui.press({ key: 'size-c1' })
      expect(await size()).toBe('H2')
      // the size button sits inside the card, above its name button
      const inCard = walk((await ui.find({ type: 'Box', key: 'card-c1' }))?.children).filter(el => el.type === 'Button').map(b => String(b.props['key']))
      expect(inCard.indexOf('size-c1')).toBeLessThan(inCard.indexOf('toggle-c1'))
      await ui.unmount()
    }
  })

  test('a display card is headed by its name, above the size button; a 按鈕卡 has neither', async ($, on) => {
    const w = world()
    w.store = structuredClone(ONE)
    engine(on, w)
    await start($)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
      const inCard = walk((await ui.find({ type: 'Box', key: 'card-c1' }))?.children)
      // a Text keeps no key once drawn: the name sits in a Box keyed head-c1
      const head = walk(inCard.find(el => el.props?.['key'] === 'head-c1')?.children).find(el => el.type === 'Text')
      expect(String(head?.children?.[0])).toBe('提醒')
      expect(head?.props['weight']).toBe('semibold')
      const order = inCard.map(el => String(el.props?.['key']))
      expect(order.indexOf('head-c1')).toBeLessThan(order.indexOf('size-c1'))
      expect(await ui.find({ type: 'Button', key: 'size-c2' })).toBeUndefined()
      expect(walk((await ui.find({ type: 'Box', key: 'card-c2' }))?.children).some(el => el.props?.['key'] === 'head-c2')).toBe(false)
      await ui.unmount()
    }
  })

  test('a kept H3 comes back; a kept 小 中 大 or H1 on a display card is H2; a 按鈕卡 kept with a size is still in the button row', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2', 'c3', 'c4', 'c5'], cards: [
      { id: 'c1', kind: 'text', name: '一', text: 'a', prefix: '', section: 'above', size: 'H3' },
      { id: 'c2', kind: 'text', name: '二', text: 'b', prefix: '', section: 'above', size: '大' },
      { id: 'c3', kind: 'text', name: '三', text: 'c', prefix: '', section: 'above', size: 'H1' },
      { id: 'c4', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above', size: 'H2' },
      { id: 'c5', kind: 'button', name: '暫存', text: '--S', prefix: '', section: 'above', size: 'H3' },
      { id: 'c6', kind: 'text', name: '六', text: 'f', prefix: '', section: 'above', size: 'H3-half' },
      { id: 'c7', kind: 'text', name: '七', text: 'g', prefix: '', section: 'above', size: 'H2-full' },
    ] } }
    ;(w.store['settings'] as { aboveOrder: string[] }).aboveOrder.push('c6', 'c7')
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(bare((await ui.find({ type: 'Button', key: 'size-c6' }))?.text)).toBe('H3-half')
    expect(bare((await ui.find({ type: 'Button', key: 'size-c7' }))?.text)).toBe('H2-full')
    expect(bare((await ui.find({ type: 'Button', key: 'size-c1' }))?.text)).toBe('H3')
    expect(bare((await ui.find({ type: 'Button', key: 'size-c2' }))?.text)).toBe('H2')
    expect(bare((await ui.find({ type: 'Button', key: 'size-c3' }))?.text)).toBe('H2')
    expect(await ui.find({ type: 'Button', key: 'size-c4' })).toBeUndefined()
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never })
    const row = walk((await band.find({ type: 'Box', key: 'band-buttons' }))?.children).filter(el => el.type === 'Button').map(b => String(b.props['key']))
    expect(row).toEqual(['band-c4', 'band-c5'])
  })
})

// The ruling of 2026-10-10 s29 (the owner's picture over 13.webp, docs/sketches/2026-10-10_s29_h123-bounds.png, 「對，就是這樣排」): bottom to top,
// H1 the button row (the 12 buttons, the anchor of every row's bounds), H2 one row of 5 display tiles, H3 3: like a dashboard, not
// buttons. Every row spans the 1st button's left edge to the 12th's right edge, its tiles one size and spread; a button gap between rows and
// tiles. H3 is the rest (6 rows), H2 3 rows. A tile is a dashed frame (the slot's bounds) showing its card's name and value on its bottom.
describe('the band in H1 H2 H3 regions', () => {
  const ABOVE = (columns: number) => ({ hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: columns }) as never
  // t2 / t3: a text card at H2 / H3, t2h t2f t3h t3f at their half and full; b: a 按鈕卡
  const SIZE_OF_SPEC: Record<string, string> = { t2: 'H2', t3: 'H3', t2h: 'H2-half', t2f: 'H2-full', t3h: 'H3-half', t3f: 'H3-full' }
  const mixed = (specs: string[]) => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: specs.map((_, i) => `c${i + 1}`),
    cards: specs.map((spec, i) => (spec === 'b'
      ? { id: `c${i + 1}`, kind: 'button', name: `鈕${i + 1}`, text: '--h', prefix: '', section: 'above' }
      : { id: `c${i + 1}`, kind: 'text', name: `框${i + 1}`, text: '顯示', prefix: '', section: 'above', size: SIZE_OF_SPEC[spec] ?? 'H2' })) } })
  const keysOf = async (band: { drawn: () => Promise<unknown> }) => walk(((await band.drawn()) as { children?: unknown }).children)
    .filter(el => el.type === 'Box').map(el => String(el.props?.['key']))

  test('H3 tiles on top, H2 below, then the H1 button row; a tile is a dashed frame showing its card, no button; the buttons numbered from ¹', async ($, on) => {
    const w = world()
    w.store = mixed(['t3', 't2', 'b', 't3', 'b'])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE(119) })
    const keys = await keysOf(band)
    expect(keys.indexOf('band-H3')).toBeLessThan(keys.indexOf('band-H2'))
    expect(keys.indexOf('band-H2')).toBeLessThan(keys.indexOf('band-buttons'))
    // a row spans what the button row spans: at 119 cells with its head cell, 118 inside: H3 (118 - 2) / 3 = 38, H2 (118 - 4) / 5 = 22
    expect((await band.find({ type: 'Box', key: 'band-tile-c1' }))?.props['width']).toBe(38)
    expect((await band.find({ type: 'Box', key: 'band-tile-c2' }))?.props['width']).toBe(22)
    // H3 the rest, 8 rows (12 less H2's 3 and the button row); each frame half a row short of its slot (「框123456 下方都縮一點」)
    expect((await band.find({ type: 'Box', key: 'band-tile-c1' }))?.props['height']).toBe(8)
    const frame = await band.find({ type: 'Box', key: 'band-frame-c1' })
    expect(frame?.props['height']).toBe(7.5)
    expect(frame?.props['borderStyle']).toBe('dashed')
    expect(frame?.props['flexDirection']).toBe('column')
    expect(frame?.props['justifyContent']).toBe('flex-end')
    expect(frame?.props['alignItems']).toBe('center')
    expect((await band.find({ type: 'Box', key: 'band-frame-c2' }))?.props['height']).toBe(2.5)
    expect(walk(frame?.children).some(el => el.type === 'Button')).toBe(false)
    expect(walk(frame?.children).some(el => el.type === 'Text' && String(el.children?.[0]) === '框1 顯示')).toBe(true)
    for (const key of ['band-H3-row-0', 'band-H2-row-0']) {
      const row = await band.find({ type: 'Box', key })
      expect(row?.props['width']).toBe(119)
      expect(row?.props['paddingLeft']).toBe((await band.find({ type: 'Box', key: 'band-buttons' }))?.props['paddingLeft'])
      expect(row?.props['justifyContent']).toBe('space-between')
      expect(row?.props['flexShrink']).toBe(0)
    }
    // a row short of tiles keeps their places with blanks of the same size
    // (the places themselves: since s39 an empty one holds a dashed frame, band-blank-frame-…)
    const h3Row = walk((await band.find({ type: 'Box', key: 'band-H3-row-0' }))?.children).filter(el => el.type === 'Box' && /^band-(tile-|blank-H)/.test(String(el.props?.['key'])))
    expect(h3Row.map(el => el.props['width'])).toEqual([38, 38, 38])
    expect(h3Row.map(el => String(el.props['key']).startsWith('band-blank-'))).toEqual([false, false, true])
    const row = walk((await band.find({ type: 'Box', key: 'band-buttons' }))?.children).filter(el => el.type === 'Button')
    expect(row.map(b => String(b.props['key']))).toEqual(['band-c3', 'band-c5'])
    expect(String(row[0]?.props['label']).startsWith('¹')).toBe(true)
    expect(String(row[1]?.props['label']).startsWith('²')).toBe(true)
  })

  // s34 (the owner 「half 就是寬度抓按鈕1最左側到按鈕6最右側，這是第一個，第二個就抓按鈕7最左側到按鈕12最右側」「full 就是寬度抓按鈕1最左側到按鈕12
  // 最右側」, heights 「跟原本固定」, stacked in the order of the menus, 「上下疊」): showchart-full on top, then -half, showchart, showinfo-full,
  // -half, showinfo, the buttons. Past the band's 12 rows nothing is dropped: the band scrolls (「讓他捲動」).
  test('half and full rows stack from the top H3-full, H3-half, H3, H2-full, H2-half, H2, the buttons; half is two to a row, full one; heights as H3 and H2', async ($, on) => {
    const w = world()
    w.store = mixed(['t2', 't2h', 't2f', 't3', 't3h', 't3f', 'b', 't3h', 't3h'])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE(119) })
    const keys = await keysOf(band)
    const order = ['band-H3-full', 'band-H3-half', 'band-H3', 'band-H2-full', 'band-H2-half', 'band-H2', 'band-buttons'].map(k => keys.indexOf(k))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // 118 cells inside the head cell: a half tile (118 - 1) / 2 = 58, a full one 118
    expect((await band.find({ type: 'Box', key: 'band-tile-c5' }))?.props).toMatchObject({ width: 58, height: 8 })
    expect((await band.find({ type: 'Box', key: 'band-tile-c6' }))?.props).toMatchObject({ width: 118, height: 8 })
    expect((await band.find({ type: 'Box', key: 'band-tile-c2' }))?.props).toMatchObject({ width: 58, height: 3 })
    expect((await band.find({ type: 'Box', key: 'band-tile-c3' }))?.props).toMatchObject({ width: 118, height: 3 })
    expect((await band.find({ type: 'Box', key: 'band-frame-c3' }))?.props['height']).toBe(2.5)
    const tilesIn = async (key: string) =>
      walk((await band.find({ type: 'Box', key }))?.children).filter(el => String(el.props?.['key']).startsWith('band-tile-')).map(el => String(el.props['key']))
    expect(await tilesIn('band-H3-half-row-0')).toEqual(['band-tile-c5', 'band-tile-c8'])
    expect(await tilesIn('band-H3-half-row-1')).toEqual(['band-tile-c9'])
    expect((await band.find({ type: 'Box', key: 'band-H3-half-row-0' }))?.props).toMatchObject({ width: 119, height: 8, justifyContent: 'space-between' })
  })

  test('H3 tiles stand three to a row, H2 five; the next one starts a new row', async ($, on) => {
    const w = world()
    w.store = mixed(['t3', 't3', 't3', 't3', 't2', 't2', 't2', 't2', 't2', 't2'])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE(119) })
    const tilesIn = async (key: string) =>
      walk((await band.find({ type: 'Box', key }))?.children).filter(el => String(el.props?.['key']).startsWith('band-tile-')).length
    expect(await tilesIn('band-H3-row-0')).toBe(3)
    expect(await tilesIn('band-H3-row-1')).toBe(1)
    expect(await tilesIn('band-H2-row-0')).toBe(5)
    expect(await tilesIn('band-H2-row-1')).toBe(1)
    expect(await band.find({ type: 'Box', key: 'band-buttons' })).toBeUndefined()
  })

  test('with buttons alone there is no tile region: the band as today', async ($, on) => {
    const w = world()
    w.store = mixed(['b', 'b'])
    engine(on, w)
    await start($)

    const keys = await keysOf(await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE(119) }))
    expect(keys).not.toContain('band-H3')
    expect(keys).not.toContain('band-H2')
    expect(keys).toContain('band-buttons')
  })

  // 「框123456 下方都縮一點就可以了」「縮的範圍就是 H1 按鈕1 2的空間」「框123 不要貼著框456」: the room between rows is inside each slot, half a row
  // under its frame (a blank Svg between the regions did not show on the desktop); nothing else stands between them
  test('the rows of tiles keep their slot\'s rows, each frame half a row short; no blank between regions', async ($, on) => {
    const w = world()
    w.store = mixed(['t3', 't3', 't3', 't3', 't2', 'b'])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE(119) })
    const keys = (await keysOf(band)).filter(k => k.startsWith('band-H') || k === 'band-buttons' || k.includes('gap'))
    expect(keys).toEqual(['band-H3', 'band-H3-row-0', 'band-H3-row-1', 'band-H2', 'band-H2-row-0', 'band-buttons'])
    expect((await band.find({ type: 'Box', key: 'band-H3-row-1' }))?.props['height']).toBe(8)
    expect((await band.find({ type: 'Box', key: 'band-H2-row-0' }))?.props['height']).toBe(3)
    expect((await band.find({ type: 'Box', key: 'band-frame-c4' }))?.props['height']).toBe(7.5)
    expect((await band.find({ type: 'Box', key: 'band-frame-c5' }))?.props['height']).toBe(2.5)
  })

  test('showchart folds H3 away, showinfo H2, TouchBar the button row; each leaves the others', async ($, on) => {
    const w = world()
    w.store = mixed(['t3', 't2', 'b'])
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE(119) })
    const regions = async () => (await keysOf(band)).filter(k => ['band-H3', 'band-H2', 'band-buttons'].includes(k))
    expect(await regions()).toEqual(['band-H3', 'band-H2', 'band-buttons'])
    await ui.press({ key: 'above-show-chart' })
    expect(await regions()).toEqual(['band-H2', 'band-buttons'])
    await ui.press({ key: 'above-show-chart' })
    await ui.press({ key: 'above-show-info' })
    expect(await regions()).toEqual(['band-H3', 'band-buttons'])
    await ui.press({ key: 'above-show-info' })
    await ui.press({ key: 'above-show-touch' })
    expect(await regions()).toEqual(['band-H3', 'band-H2'])
  })

  test('a button press in the row sends what its card holds', async ($, on) => {
    const w = world()
    w.store = mixed(['t3', 'b'])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE(119) })
    await band.press({ key: 'band-c2' })
    expect(w.prompts).toEqual([{ text: '--h', asUser: true }])
  })
})

// the owner 2026-10-09 s28: H3 42 was drawn as a round frame around the band button (box-lab 乙), then 「你把說明的白框拿掉」: no frame; the
// button stands in the band as it is (one row). s39 「空區塊不要畫，只補一列裡的空格就好」: the six display blocks shown by default hold no card
// here, so none of them draws a frame either.
test('a band button stands in the band without a frame, and is pressed', async ($, on) => {
  const w = world()
  w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [
    { id: 'c1', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
  ] } }
  engine(on, w)
  await start($)

  const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never })
  expect(await band.find({ type: 'Box', key: 'band-frame-c1' })).toBeUndefined()
  expect(walk([await band.drawn()]).some(el => el.type === 'Box' && el.props?.['borderStyle'] !== undefined)).toBe(false)
  await band.press({ key: 'band-c1' })
  expect(w.prompts).toEqual([{ text: '--h', asUser: true }])
})

// the owner 2026-10-09 s28 「把寬度縮小到可以放12個」: in his window 11 band buttons of 5.5 characters fit and the 12th was cut (each 147 px,
// gaps 18, band 1830, in his screenshot). A band button is laid out in 4.5 characters: about 125 px, twelve with their gaps about 1698.
// The /ss panel's name buttons keep 5.5.
test('a band button is laid out 4.5 characters wide; the panel name buttons stay 5.5', async ($, on) => {
  const w = world()
  w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2'], cards: [
    { id: 'c1', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
    { id: 'c2', kind: 'button', name: '一二三', text: '--h', prefix: '', section: 'above' },
  ] } }
  engine(on, w)
  await start($)

  const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never })
  // s29: padded by bandLabel to the own size, the number counted
  expect(Math.abs(textEm((await band.find({ type: 'Button', key: 'band-c1' }))?.text ?? '') - 4.5)).toBeLessThanOrEqual(0.125)
  // three characters: 0.25 of padding on each side, a quarter space, which the number takes
  expect((await band.find({ type: 'Button', key: 'band-c2' }))?.text).toBe(bandLabel(2, '一二三', 4.5))
  expect(em(fixed('一二三', 4.5))).toBe(4.5)
  expect(bare(unnumbered((await band.find({ type: 'Button', key: 'band-c1' }))?.text))).toBe('說明')
  const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  expect(em((await ui.find({ type: 'Button', key: 'toggle-c1' }))?.text ?? '')).toBe(BUTTON_EM)
})

// the owner 2026-10-09 s28 「先定義好頭尾間距要跟第一個一樣」「對 先做」: measured on his desktop (one screenshot, the band 119 cells): a band
// button of 4.5 characters is about 8.6 cells, the gap between two 1 cell. The band shows as many whole buttons as its cells hold (no
// half-cut button), spread over the whole width so the last stands at the right edge as the first does at the left. The rest wait
// for paging.
// The band's width in cells was shown for a while (2026-10-09 s28) to take these measures; removed once they were taken (「拿掉格寬那行」).
describe('the button row of the band', () => {
  const many = (n: number) => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: Array.from({ length: n }, (_, i) => `c${i + 1}`),
    cards: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' })) } })
  const bandOf = async ($: Engine, columns: number) =>
    $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columns } as never })

  // s28: 12 of 16 spread over 119 cells, 6 at 60; since s29 7 or more buttons stand in fixed slots (see 'the band with 7 or more buttons')
  // s34: 1.51 cells a character, 1.83 a button (8.webp): seven slots of 14% at 60 (eight of 12%, 7.08 cells, cannot hold ¹ 說 明, 2.84)
  test('16 buttons: 12 at their own size at 119 cells, spread; at 60 it pages (s41)', async ($, on) => {
    const w = world()
    w.store = many(16)
    engine(on, w)
    await start($)

    const wide = await bandOf($, 119)
    expect((await wide.findAll({ type: 'Button' })).length).toBe(12)
    const row = await wide.find({ type: 'Box', key: 'band-buttons' })
    expect(row?.props['justifyContent']).toBe('space-between')
    expect(row?.props['width']).toBe(119)
    await wide.unmount()
    const narrow = await bandOf($, 60)
    // s41: past what fits it pages (A): ‹ and › at the ends, the page's slots numbers of cells
    const keys = (await narrow.findAll({ type: 'Button' })).map(b => String((b as { key?: string }).key ?? b.props['key']))
    expect([keys[0], keys[keys.length - 1]]).toEqual(['band-page-prev', 'band-page-next'])
    expect(typeof (await narrow.find({ type: 'Box', key: 'band-slot-0' }))?.props['width']).toBe('number')
  })

  // s28 stood fewer buttons from the left; since s29's stages they spread edge to edge at their own size, the 1-cell gap the least
  test('fewer buttons than fit: their own size, spread edge to edge, the 1-cell gap the least', async ($, on) => {
    const w = world()
    w.store = many(3)
    engine(on, w)
    await start($)

    const band = await bandOf($, 119)
    expect((await band.findAll({ type: 'Button' })).length).toBe(3)
    const row = await band.find({ type: 'Box', key: 'band-buttons' })
    expect(row?.props['justifyContent']).toBe('space-between')
    expect(row?.props['gap']).toBe(1)
  })
})

// the owner 2026-10-09 s29 (screenshots 3-8: dragging the window made the 12 buttons jump; 「大小才是重點 內容被擠掉一點沒關係」; the slots
// on 10-12.webp; then 「全開的時候用原本的算法 開始縮的時候用第二種 剩下五顆的時候切回第一種」, 「你試試看」): the band has three stages.
// (1) The buttons fit at their own size (4.5 characters: 1.83 + 4.5 x 1.51 = 8.6 cells, s34's 8.webp; s29 had 7.6): spread edge to edge.
// (2) They do not: slots of a whole percentage share the row (less 1 cell of padding on the left, 1 on each slot's right), every label
//     padded to its slot, so every button is one size and shrinks with the window; a slot keeps the number and 3.5 characters, or there
//     are fewer slots. (3) That leaves 5 or fewer: back to the own size, as many as fit (5 at the switch).
// The same padding (bandLabel) in all three: a four-character name is no wider than a two-character one.
describe('the band in three stages', () => {
  const NAMES12 = ['設定SS', '快轉', '確定分數', '執行', 'Lab', '說明', '說明', '說明', '說明', '說明', '暫存', '存檔交接']
  const named = (names: string[]) => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: names.map((_, i) => `c${i + 1}`),
    cards: names.map((name, i) => ({ id: `c${i + 1}`, kind: 'button', name, text: '--h', prefix: '', section: 'above' })) } })
  const bandOf = async ($: Engine, columns: number) =>
    $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columns } as never })
  const labels = async (band: { findAll: (q: object) => Promise<{ props: Record<string, unknown> }[]> }) =>
    (await band.findAll({ type: 'Button' })).map(b => String(b.props['label']))
  const slotsOf = async (band: { find: (q: object) => Promise<unknown> }) =>
    walk(((await band.find({ type: 'Box', key: 'band-buttons' })) as { children?: unknown } | undefined)?.children)
      .filter(el => el.type === 'Box' && String(el.props?.['key']).startsWith('band-slot-'))
  const OWN = 4.5
  // s41 (the owner 「go，照這 7 個預設做」): a band that cannot show all its lit buttons pages (A by default) where s29's stages left the rest out: ‹
  // first, › last; the page's slots one width in cells and the whole row within the band (each arrow reckoned at 1.83 + 0.575 x 1.51 and a
  // gap); every label on the page padded alike, none past the widest own size of all (¹²存檔交接 4.68)
  const paged = async (band: Awaited<ReturnType<typeof bandOf>>, columns: number) => {
    const keys = (await band.findAll({ type: 'Button' })).map(b => String((b as { key?: string }).key ?? b.props['key']))
    expect([keys[0], keys[keys.length - 1]]).toEqual(['band-page-prev', 'band-page-next'])
    const widths = (await slotsOf(band)).map(el => el.props?.['width'])
    expect(widths.length).toBeGreaterThan(0)
    expect(new Set(widths).size).toBe(1)
    expect(typeof widths[0]).toBe('number')
    expect(widths.length * Number(widths[0]) + 2 * (1.83 + 0.575 * 1.51 + 1)).toBeLessThanOrEqual(columns)
    const onPage = (await labels(band)).filter(l => l !== '‹' && l !== '›')
    // padded with en and quarter spaces: two labels on a page within a quarter of a character of each other
    for (const l of onPage) expect(Math.abs(textEm(l) - textEm(onPage[0] as string))).toBeLessThanOrEqual(0.25)
    for (const l of onPage) expect(textEm(l)).toBeLessThanOrEqual(4.68 + 0.125)
    expect(onPage.some(l => l.includes('…'))).toBe(false)
    return onPage
  }

  // s34 (the owner 「先處理按鈕列」; 8.webp: ten buttons 75-81 px at about 88 cells, the tenth cut off by the band's edge; 1.webp: names cut to one
  // character by the desktop). Phase 1 printed whole labels at every width: the desktop cut them, the buttons wider than s29's calibration
  // said. 8.webp: a band character 14.1 px (確定分數's glyphs 14 px apart), a 4.59-character label 80 px, 9.35 px a cell: 1.51 cells a
  // character and 1.64 of the button's own, an eighth of a character more for the quarter spaces' rounding. The counts below are an
  // independent model of the stages with those numbers.
  const TEN = ['設定SS', '快轉', '確定分數', '執行', 'Lab', '-10', '-20', '+10', '重新載入', '+20']

  test('Alex\'s ten at 88 cells (8.webp): since s41 it pages, every name whole from 設定SS on, none cut; at 96 all ten at their own size', async ($, on) => {
    const w = world()
    w.store = named(TEN)
    engine(on, w)
    await start($)

    const at88 = await bandOf($, 88)
    const shown = (await paged(at88, 88)).map(l => bare(unnumbered(l)))
    expect(shown.length).toBeGreaterThan(5)
    expect(shown).toEqual(TEN.slice(0, shown.length))
    await at88.unmount()
    await paged(await bandOf($, 80), 80)
    const at96 = await bandOf($, 96)
    expect(await slotsOf(at96)).toEqual([])
    expect((await labels(at96)).length).toBe(10)
  })

  test('stage 1, 12 buttons at 119 cells: their own size, one size for every name, spread edge to edge, no slots', async ($, on) => {
    const w = world()
    w.store = named(NAMES12)
    engine(on, w)
    await start($)

    const band = await bandOf($, 119)
    const row = await band.find({ type: 'Box', key: 'band-buttons' })
    expect(row?.props['justifyContent']).toBe('space-between')
    expect(row?.props['width']).toBe(119)
    expect(row?.props['gap']).toBe(1)
    expect(await slotsOf(band)).toEqual([])
    const all = await labels(band)
    expect(all.length).toBe(12)
    // one size: padded to the widest (¹²存檔交接, 4.68), at least 4.5
    const ems = all.map(textEm)
    expect(Math.max(...ems) - Math.min(...ems)).toBeLessThanOrEqual(0.25)
    expect(Math.min(...ems)).toBeGreaterThanOrEqual(OWN - 0.125)
    expect(all[0]?.startsWith('¹')).toBe(true)
  })

  // s28 「頭尾間距要跟第一個一樣」; measured s30 1.webp: head 8 px, tail 15 px, gaps 13-14 (the desktop's own margins differ at the two
  // ends, the row touching both). One cell before the first button (about 9 px) brings the head to the tail; where the buttons fill the row
  // to the cell it is left out, so no stage and no count changes.
  test('stage 1 keeps one cell before the first button when it has room; a row filled to the cell keeps none', async ($, on) => {
    const w = world()
    w.store = named(NAMES12)
    engine(on, w)
    await start($)

    const wide = await bandOf($, 119)
    expect((await wide.find({ type: 'Box', key: 'band-buttons' }))?.props['paddingLeft']).toBe(1)
    await wide.unmount()
    // 12 padded to ¹²存檔交接 (4.68) need 12 x (1.83 + 4.68 x 1.51) + 11 = 117.76 cells: at 118 they fit, the head cell does not
    const tight = await bandOf($, 118)
    const row = await tight.find({ type: 'Box', key: 'band-buttons' })
    expect(row?.props['justifyContent']).toBe('space-between')
    expect(row?.props['paddingLeft'] ?? 0).toBe(0)
    expect((await labels(tight)).length).toBe(12)
  })

  test('stage 1 at any width they fit, wide included: no more packing to the left (it jumped at 124 cells)', async ($, on) => {
    const w = world()
    w.store = named(NAMES12)
    engine(on, w)
    await start($)

    // 12 at the own size need about 118 cells (padded to ¹²存檔交接, 4.68 characters)
    for (const columns of [118, 124, 160]) {
      const band = await bandOf($, columns)
      expect((await band.find({ type: 'Box', key: 'band-buttons' }))?.props['justifyContent']).toBe('space-between')
      expect((await labels(band)).length).toBe(12)
      await band.unmount()
    }
  })

  // a slot holds the least label of every card in it (the number, two characters, a gap and … when cut: ³確 定 … is 4.34 characters, 1 +
  // 1.83 + 4.34 x 1.51 = 9.38 cells with the gap): at 95 cells 11 slots of 9% (8.46 cells) cannot hold it, 10 of 10% (9.4) hold the first 10
  test('12 buttons at 95 cells: since s41 it pages, every label on the page padded to its slot', async ($, on) => {
    const w = world()
    w.store = named(NAMES12)
    engine(on, w)
    await start($)

    expect((await paged(await bandOf($, 95), 95)).length).toBeGreaterThan(5)
  })

  // s29: with names of at most 4 characters the cut form (字 字 …, 4 characters with … counted whole) is no narrower than the name
  // without its gaps, so a slot that holds the cut form shows the whole name: the owner's 12 drop one by one rather than shrink
  test('75 cells: since s41 it pages; a four-character name shows whole, without its gaps; no …', async ($, on) => {
    const w = world()
    w.store = named(NAMES12)
    engine(on, w)
    await start($)

    const all = await paged(await bandOf($, 75), 75)
    expect(all[2]).toContain('確定分數')
    expect(bare(all[0])).toBe('¹設定SS')
  })

  test('60 cells: since s41 it pages, the slots fewer and each holding its least label', async ($, on) => {
    const w = world()
    w.store = named(NAMES12)
    engine(on, w)
    await start($)

    expect((await paged(await bandOf($, 60), 60)).length).toBeGreaterThan(0)
  })

  test('50 cells: since s41 it pages at the own size, as many as fit', async ($, on) => {
    const w = world()
    w.store = named(NAMES12)
    engine(on, w)
    await start($)

    expect((await paged(await bandOf($, 50), 50)).length).toBeGreaterThan(0)
  })

  // a slot holds the least form, 字 字 … (4 characters), not the whole name without gaps (3): twelve three-character names at 60 cells
  // need 2.83 + 4.34 x 1.51 = 9.38 cells a slot: 6 slots of 16% (9.44), not 7 of 14% (8.26); the whole names would have allowed 7
  test('a slot keeps room for the least form of its name: twelve three-character names at 60 cells page, none cut', async ($, on) => {
    const w = world()
    w.store = named(Array.from({ length: 12 }, () => '一二三'))
    engine(on, w)
    await start($)

    expect((await paged(await bandOf($, 60), 60)).length).toBeGreaterThan(0)
  })

  test('5 buttons in a wide band: stage 1, their own size, spread edge to edge', async ($, on) => {
    const w = world()
    w.store = named(NAMES12.slice(0, 5))
    engine(on, w)
    await start($)

    const band = await bandOf($, 119)
    expect((await band.find({ type: 'Box', key: 'band-buttons' }))?.props['justifyContent']).toBe('space-between')
    expect((await labels(band)).length).toBe(5)
  })

  test('a 13th button is not drawn: 12 at most, in every stage', async ($, on) => {
    const w = world()
    w.store = named([...NAMES12, '多的'])
    engine(on, w)
    await start($)

    for (const columns of [160, 95]) {
      const band = await bandOf($, columns)
      expect((await band.findAll({ type: 'Button' })).length).toBeLessThanOrEqual(12)
      expect(await band.find({ type: 'Button', key: 'band-c13' })).toBeUndefined()
      await band.unmount()
    }
  })
})

describe('how wide a label is (band slots, s29)', () => {
  test('a Chinese character is 1, a Latin letter or digit 0.575, a superscript digit 0.34, an en space 0.5, a quarter space 0.25', () => {
    expect(textEm('說明')).toBe(2)
    expect(Math.abs(textEm('SS') - 1.15)).toBeLessThan(1e-9)
    expect(Math.abs(textEm('Lab') - 1.725)).toBeLessThan(1e-9)
    expect(Math.abs(textEm('¹') - 0.34)).toBeLessThan(1e-9)
    expect(Math.abs(textEm('¹⁰') - 0.68)).toBeLessThan(1e-9)
    expect(textEm('\u2002')).toBe(0.5)
    expect(textEm('\u2005')).toBe(0.25)
  })

  test('a band label: the number first, the name centred with its half-character gaps, padded to the width asked', () => {
    const label = bandLabel(2, '快轉', 6)
    expect(label.startsWith('²')).toBe(true)
    expect(label.includes('快\u2002轉')).toBe(true)
    expect(Math.abs(textEm(label) - 6)).toBeLessThanOrEqual(0.125)
  })

  test('a name too wide with its gaps loses them; too wide without them, it keeps its first two characters, a gap and …', () => {
    const tight = bandLabel(3, '確定分數', 4.6)
    expect(tight.includes('確定分數')).toBe(true)
    expect(Math.abs(textEm(tight) - 4.6)).toBeLessThanOrEqual(0.125)
    // too wide even without its gaps: its least form, unpadded (the number, two characters, a gap and …)
    expect(bandLabel(3, '確定分數', 4)).toBe('³確\u2002定\u2002…')
  })

  // the owner 2026-10-09 s29 「字最少不包含前面的數字要留前兩個字 一個字的時候¹字 兩個字的時候²字 字 三個字的時候³字 字… 四個字的時候⁴字 字…」,
  // then 「最小的時候又超過字數就是¹字 字 …」: a half gap before … too
  test('the least a label shows: its number, its first two characters half a character apart, and a gap and … when the name was cut', () => {
    expect(bandLabel(1, '字', 0.5)).toBe('¹字')
    expect(bandLabel(2, '字字', 0.5)).toBe('²字\u2002字')
    expect(bandLabel(3, '字字字', 0.5)).toBe('³字\u2002字\u2002…')
    expect(bandLabel(4, '字字字字', 0.5)).toBe('⁴字\u2002字\u2002…')
    expect(bandLabel(12, '存檔交接', 0.5)).toBe('¹²存\u2002檔\u2002…')
    // … counts as a whole character until measured on the desktop
    expect(textEm('…')).toBe(1)
  })
})

// the owner 2026-10-09 s28 「每個按鈕裡面的文字都跑掉」: in the 4.5-character band buttons the name stood 30 px from the left edge and 16 from
// the right (his screenshot), while the 5.5 panel buttons were centred (36 / 36). A 4.5 label ended in a full-width space (U+3000), which
// the desktop drops at the end of a label; the 5.5 labels end in an en space and kept it (box-lab C kept en spaces on both sides).
// The padding is made of en spaces only: no label carries U+3000, the widths stay.
test('no button label carries a full-width space; every width stays', () => {
  for (const width of [4.5, 5.5]) {
    for (const name of ['字', '字字', '字字字', '字字字字']) {
      const label = fixed(name, width)
      expect(label.includes('　')).toBe(false)
      const natural = [...name].length + ([...name].length - 1) / 2
      expect(em(label)).toBe(Math.max(width, natural))
      // the same padding on both sides
      const lead = label.length - label.trimStart().length
      const tail = label.length - label.trimEnd().length
      expect(lead).toBe(tail)
    }
  }
})

// the owner 2026-10-09 s28 「這些按鈕左上角可以有編號嗎 用 ¹²³⁴⁵⁶⁷⁸⁹⁰」, 「A」: the band button's place in its row, in superscript digits, as the
// first thing on its label; it takes the place of the first en space of the left padding, so the button keeps its width.
test('a band button starts with its place in superscript digits, in place of the first en space', async ($, on) => {
  const n = 6
  const w = world()
  w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: Array.from({ length: n }, (_, i) => `c${i + 1}`),
    cards: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, kind: 'button', name: i === 0 ? '存' : '說明', text: '--h', prefix: '', section: 'above' })) } }
  engine(on, w)
  await start($)

  const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 119 } as never })
  const label = async (i: number) => String((await band.find({ type: 'Button', key: `band-c${i}` }))?.props['label'])
  // s29: the stages pad with bandLabel (number first, the name centred in the own size, 4.5 here)
  expect(await label(1)).toBe(bandLabel(1, '存', 4.5))
  expect(await label(2)).toBe(bandLabel(2, '說明', 4.5))
  expect(await label(6)).toBe(bandLabel(6, '說明', 4.5))
  expect((await label(2)).startsWith('²')).toBe(true)
  expect(bare((await label(2)).slice(1))).toBe('說明')
})

// s29: with 12 buttons (fixed slots) the number still leads the label, two digits from ¹⁰
test('in the slots too, every label starts with its place in superscript digits', async ($, on) => {
  const n = 12
  const w = world()
  w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: Array.from({ length: n }, (_, i) => `c${i + 1}`),
    cards: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, kind: 'button', name: i === 0 ? '存' : '說明', text: '--h', prefix: '', section: 'above' })) } }
  engine(on, w)
  await start($)

  const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 119 } as never })
  const label = async (i: number) => String((await band.find({ type: 'Button', key: `band-c${i}` }))?.props['label'])
  expect((await label(1)).startsWith('¹')).toBe(true)
  expect(bare((await label(1)).slice(1))).toBe('存')
  expect((await label(10)).startsWith('¹⁰')).toBe(true)
  expect(bare((await label(10)).slice(2))).toBe('說明')
  expect((await label(12)).startsWith('¹²')).toBe(true)
})

// the owner 2026-10-09 s30 「SS 裡面新增幾個同級菜單跟 touchbar 一樣的給我看」, 「H2 菜單 showinfo」, 「H1 菜單 showchart」, renumbered by the ruling of
// 2026-10-10 s29: under AbovePrompt, in the band's order, showchart (H3), showinfo (H2) and TouchBar (H1), each with its own fold (kept), 排序 預設
// 新增卡片 and its cards: the display cards of its size, or the 按鈕卡. A display card's size button moves it between showinfo and showchart; their
// 新增卡片 opens the pane for a 文字卡 of their size.
describe('the showchart and showinfo menus beside TouchBar', () => {
  const MENUS = () => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c3', 'c4', 'c2'], cards: [
    { id: 'c1', kind: 'text', name: '圖一', text: 'a', prefix: '', section: 'above', size: 'H3' },
    { id: 'c2', kind: 'text', name: '資訊', text: 'b', prefix: '', section: 'above' },
    { id: 'c3', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
    { id: 'c4', kind: 'text', name: '圖二', text: 'c', prefix: '', section: 'above', size: 'H3' },
  ] } })
  const cardsIn = async (ui: { find: (q: object) => Promise<{ children?: unknown } | undefined> }, key: string) =>
    walk((await ui.find({ type: 'Box', key }))?.children).map(el => String(el.props?.['key'])).filter(k => k.startsWith('card-'))

  test('three menus under AbovePrompt in the band\'s order, showchart showinfo TouchBar, each with its fold, 排序 預設 新增卡片 and its own cards', async ($, on) => {
    const w = world()
    w.store = MENUS()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const keys = ((await ui.drawn()).children as El[]).map(el => String(el.props?.['key']))
    expect(keys.indexOf('h3')).toBeGreaterThan(keys.indexOf('above-cards'))
    expect(keys.indexOf('h3')).toBeLessThan(keys.indexOf('h2'))
    expect(keys.indexOf('h2')).toBeLessThan(keys.indexOf('touch'))
    for (const menu of ['h3', 'h2']) {
      for (const part of ['fold', 'sort', 'default-order', 'add-card']) expect(await ui.find({ type: 'Button', key: `${menu}-${part}` })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: 'showchart' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'showinfo' })).toBeDefined()
    expect(await cardsIn(ui, 'h3-cards')).toEqual(['card-c1', 'card-c4'])
    expect(await cardsIn(ui, 'h2-cards')).toEqual(['card-c2'])
    expect(await cardsIn(ui, 'touch-cards')).toEqual(['card-c3'])
    // the display cards are not listed again at the AbovePrompt level
    expect(await cardsIn(ui, 'above-cards')).toEqual([])
  })

  test('a size press moves a display card to the next menu up: showinfo, showinfo-half, showinfo-full, showchart', async ($, on) => {
    const w = world()
    w.store = MENUS()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'size-c2' })
    expect(await cardsIn(ui, 'h2-cards')).toEqual([])
    expect(await cardsIn(ui, 'h2half-cards')).toEqual(['card-c2'])
    await ui.press({ key: 'size-c2' })
    expect(await cardsIn(ui, 'h2full-cards')).toEqual(['card-c2'])
    await ui.press({ key: 'size-c2' })
    expect(await cardsIn(ui, 'h3-cards')).toEqual(['card-c1', 'card-c4', 'card-c2'])
  })

  // s34 (the owner 「次級菜單現在會有 showchart-full showchart-half showchart showinfo-full showinfo-half showinfo touchbar (改成全小寫)」「對，菜單照由上到下
  // 疊的位置」): seven menus, in the band's order from the top, each as showchart and showinfo are
  const SEVEN = () => {
    const st = MENUS()
    st.settings.cards.push(
      { id: 'c5', kind: 'text', name: '半圖', text: 'd', prefix: '', section: 'above', size: 'H3-half' },
      { id: 'c6', kind: 'text', name: '全資', text: 'e', prefix: '', section: 'above', size: 'H2-full' },
      { id: 'c7', kind: 'text', name: '半資', text: 'f', prefix: '', section: 'above', size: 'H2-half' },
      { id: 'c8', kind: 'text', name: '半二', text: 'g', prefix: '', section: 'above', size: 'H3-half' },
    )
    st.settings.aboveOrder.push('c5', 'c6', 'c7', 'c8')
    return st
  }
  const MENU_KEYS = ['h3full', 'h3half', 'h3', 'h2full', 'h2half', 'h2', 'touch']

  test('seven menus under AbovePrompt from the band\'s top: showchart-full -half showchart, showinfo-full -half showinfo, touchbar; each its own', async ($, on) => {
    const w = world()
    w.store = SEVEN()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const keys = ((await ui.drawn()).children as El[]).map(el => String(el.props?.['key']))
    const at = MENU_KEYS.map(k => keys.indexOf(k))
    expect(at.every(i => i > keys.indexOf('above-cards'))).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    for (const menu of MENU_KEYS) {
      for (const part of ['fold', 'sort', 'default-order', 'add-card']) expect(await ui.find({ type: 'Button', key: `${menu}-${part}` })).toBeDefined()
    }
    for (const name of ['showchart-full', 'showchart-half', 'showchart', 'showinfo-full', 'showinfo-half', 'showinfo', 'touchbar']) {
      expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: 'TouchBar' })).toBeUndefined()
    expect(await cardsIn(ui, 'h3full-cards')).toEqual([])
    expect(await cardsIn(ui, 'h3half-cards')).toEqual(['card-c5', 'card-c8'])
    expect(await cardsIn(ui, 'h2full-cards')).toEqual(['card-c6'])
    expect(await cardsIn(ui, 'h2half-cards')).toEqual(['card-c7'])
    expect(await cardsIn(ui, 'h2-cards')).toEqual(['card-c2'])
  })

  test('the folds of the new menus kept in the store are folded when the session starts', async ($, on) => {
    const w = world()
    w.store = SEVEN()
    Object.assign(w.store['settings'] as object, { h3FullCollapsed: true, h3HalfCollapsed: true, h2FullCollapsed: true, h2HalfCollapsed: true })
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    for (const menu of ['h3full', 'h3half', 'h2full', 'h2half']) {
      expect(await ui.find({ type: 'Box', key: `${menu}-cards` })).toBeUndefined()
      expect((await ui.find({ type: 'Button', key: `${menu}-fold` }))?.props['label']).toBe('▶')
    }
    expect(await ui.find({ type: 'Box', key: 'h3-cards' })).toBeDefined()
  })

  test('a new menu folds on its own and keeps it; it sorts its own cards; its 新增卡片 adds a 文字卡 at its size', async ($, on) => {
    const w = world()
    // room in each block the adds go to: only a lit card takes a place (Claude Design step 5, s38), so H3-half's c8 and H2-full's c6 are off
    const seven = SEVEN()
    seven.settings.off.push('c6', 'c8')
    w.store = seven
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    const st = () => w.store['settings'] as Record<string, unknown>
    for (const [menu, flag] of [['h3full', 'h3FullCollapsed'], ['h3half', 'h3HalfCollapsed'], ['h2full', 'h2FullCollapsed'], ['h2half', 'h2HalfCollapsed']] as const) {
      await ui.press({ key: `${menu}-fold` })
      expect(await ui.find({ type: 'Box', key: `${menu}-cards` })).toBeUndefined()
      expect(st()[flag]).toBe(true)
      await ui.press({ key: `${menu}-fold` })
      expect(st()[flag]).toBe(false)
    }
    await ui.press({ key: 'h3half-sort' })
    expect(await ui.find({ type: 'Button', key: 'left-c5' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'left-c1' })).toBeUndefined()
    await ui.press({ key: 'right-c5' })
    expect((st()['aboveOrder'] as string[]).filter(k => k === 'c5' || k === 'c8')).toEqual(['c8', 'c5'])
    await ui.press({ key: 'h3half-sort' })
    for (const [menu, size] of [['h3half', 'H3-half'], ['h3full', 'H3-full'], ['h2half', 'H2-half'], ['h2full', 'H2-full']] as const) {
      await ui.press({ key: `${menu}-add-card` })
      const pane = await addPane($)
      expect((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['value']).toBe('text')
      const before = (st()['cards'] as unknown[]).length
      await pane.input({ key: 'add-name', text: '新的', kind: 'change' })
      await pane.input({ key: 'add-text', text: '顯示', kind: 'change' })
      await pane.press({ key: 'add-ok' })
      await pane.unmount()
      const cards = st()['cards'] as { kind: string; size?: string; section?: string }[]
      expect(cards).toHaveLength(before + 1)
      expect(cards[cards.length - 1]).toMatchObject({ kind: 'text', section: 'above', size })
    }
    expect((await cardsIn(ui, 'h3full-cards')).length).toBe(1)
  })

  test('each menu folds on its own and keeps it', async ($, on) => {
    const w = world()
    w.store = MENUS()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'h3-fold' })
    expect(await ui.find({ type: 'Box', key: 'h3-cards' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'h2-cards' })).toBeDefined()
    expect((w.store['settings'] as { h3Collapsed: boolean }).h3Collapsed).toBe(true)
    await ui.press({ key: 'h2-fold' })
    expect((w.store['settings'] as { h2Collapsed: boolean }).h2Collapsed).toBe(true)
    expect(await ui.find({ type: 'Box', key: 'touch-cards' })).toBeDefined()
  })

  test('each menu sorts its own cards: arrows under them alone, a move passes over the others, its 預設 orders them alone', async ($, on) => {
    const w = world()
    w.store = MENUS()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: SORT_SURFACE, component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'h3-sort' })
    expect(await ui.find({ type: 'Button', key: 'left-c1' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'left-c3' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'left-c2' })).toBeUndefined()
    const order = () => (w.store['settings'] as { aboveOrder: string[] }).aboveOrder
    await ui.press({ key: 'right-c1' })
    expect(order()).toEqual(['c4', 'c3', 'c1', 'c2'])
    expect((await ui.find({ type: 'Button', key: 'h3-default-order' }))?.props['dimColor']).toBe(false)
    await ui.press({ key: 'h3-default-order' })
    expect(order()).toEqual(['c1', 'c3', 'c4', 'c2'])
  })

  test('showinfo\'s 新增卡片 adds a 文字卡 at H2, showchart\'s at H3', async ($, on) => {
    const w = world()
    w.store = MENUS()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    for (const [menu, size] of [['h2', 'H2'], ['h3', 'H3']] as const) {
      await ui.press({ key: `${menu}-add-card` })
      const pane = await addPane($)
      expect((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['value']).toBe('text')
      await pane.input({ key: 'add-name', text: '新的', kind: 'change' })
      await pane.input({ key: 'add-text', text: '顯示', kind: 'change' })
      await pane.press({ key: 'add-ok' })
      await pane.unmount()
      const cards = (w.store['settings'] as { cards: { kind: string; size?: string; section?: string }[] }).cards
      expect(cards[cards.length - 1]).toMatchObject({ kind: 'text', section: 'above', size })
    }
    expect(await cardsIn(ui, 'h2-cards')).toEqual(['card-c2', 'card-c5'])
    expect(await cardsIn(ui, 'h3-cards')).toEqual(['card-c1', 'card-c4', 'card-c6'])
  })
})

// the owner 2026-10-10 s33 「把9按鈕設定為重新載入讓我開發階段可以快速進展一點」「OK 甲」: /ss reload reads the store and the project's files
// again, so a store written by hand shows in the running session (otherwise the mod's state, still the old settings, is drawn and the
// next press writes it over the file: s31 nodes 17 and 19). A 按鈕卡 that sends /ss reload does the same from the band: the mod's own
// command does not go through $.command.run, which skips this mod's hooks.
describe('/ss reload', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never
  const withButtons = (names: string[]) => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: names.map((_, i) => `c${i + 1}`),
    cards: names.map((name, i) => ({ id: `c${i + 1}`, kind: 'button', name, text: i === 0 ? '/ss reload' : '--h', prefix: '', section: 'above' })) } })
  const labels = async (band: { findAll: (q: object) => Promise<{ props: Record<string, unknown> }[]> }) =>
    (await band.findAll({ type: 'Button' })).map(b => bare(unnumbered(String(b.props['label']))))

  test('a store written by hand shows after /ss reload, and the next change keeps it', async ($, on) => {
    const w = world()
    w.store = withButtons(['重新載入', '說明'])
    engine(on, w)
    await start($)
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await labels(band)).toEqual(['重新載入', '說明'])

    w.store = withButtons(['重新載入', '-10'])
    // the running mod still draws what it read at the start
    expect(await labels(band)).toEqual(['重新載入', '說明'])
    const out = await sl($, 'reload')
    expect(out.text).toBe('已重新載入')
    expect(await labels(band)).toEqual(['重新載入', '-10'])

    await sl($, 'icons on')
    const kept = (w.store['settings'] as { cards: { name: string }[]; icons: boolean })
    expect(kept.cards.map(c => c.name)).toEqual(['重新載入', '-10'])
    expect(kept.icons).toBe(true)
  })

  test('/ss reload reads the project\'s files again: the status line follows them', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)
    expect(last(w)).toContain('★ D')

    w.files['/w/Score.md'] = '# Score\nscore_band: C\n'
    await sl($, 'reload')
    expect(last(w)).toContain('★ C')
  })

  test('the band\'s 重新載入 button reloads in place, then the plugins (/reload-plugins); nothing typed, no error line', async ($, on) => {
    const w = world()
    w.store = withButtons(['重新載入', '說明'])
    engine(on, w)
    await start($)
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })

    w.store = withButtons(['重新載入', '-10'])
    await band.press({ key: 'band-c1' })
    expect(await labels(band)).toEqual(['重新載入', '-10'])
    expect(w.prompts).toEqual([])
    expect(w.commands).toEqual(['reload-plugins'])
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await ui.find({ type: 'Text', text: /沒有送出/ })).toBeUndefined()
  })

  test('/ss reload is in the usage line and in the command\'s description', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)
    expect((await sl($, 'nonsense')).text).toContain('/ss reload')
    expect(w.described['ss']).toContain('/ss reload')
    // and in the listing a bare /ss prints where no pane can be placed
    w.paneRefused = true
    expect((await sl($, '')).text).toContain('/ss reload')
  })
})

// the owner 2026-10-10 s33 「每個框都是一個模組，每個按鈕可以是模組也可以是hook也可以是轉發執行命令」「框1~8是各種模組，按鈕1~12是各種模組」: a 模組卡
// keeps a module's id. A tile module draws its lines in its tile (H3 up to five, H2 the first); a button module stands in the button row and
// does what its press asks. superstatus reads the files and runs the commands a module names (docs/modules.md).
describe('模組卡', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const PROC: Record<string, string> = {
    '/proc/sys/kernel/hostname': 'box\n',
    '/proc/sys/kernel/osrelease': '7.0.14-14-gen\n',
    '/proc/uptime': '609056.37 1\n',
    '/proc/cpuinfo': 'processor\t: 0\nprocessor\t: 1\n',
    '/sys/class/thermal/thermal_zone0/temp': '27800\n',
    '/proc/loadavg': '0.50 0.40 0.30 1/2 3\n',
    '/proc/meminfo': 'MemTotal: 1048576 kB\nMemAvailable: 524288 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n',
  }
  const DF_ARGV = ['df', '-P', '-k', '-l', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'overlay', '-x', 'squashfs', '-x', 'efivarfs']
  const DF_TEXT = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/a 1048576 524288 524288 50% /\n'
  const mod = (id: string, module: string, extra: object = {}) => ({ id, kind: 'module', name: '框', text: module, prefix: '', section: 'above', ...extra })
  const withCards = (cards: object[]) => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: cards.map(c => (c as { id: string }).id), cards } })
  type Found = { children?: unknown; props: Record<string, unknown> } | undefined
  const tileLines = async (band: { find: (q: object) => Promise<Found> }, id: string) =>
    walk((await band.find({ type: 'Box', key: `band-frame-${id}` }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))
  const buttonLabels = async (band: { findAll: (q: object) => Promise<{ props: Record<string, unknown> }[]> }) =>
    (await band.findAll({ type: 'Button' })).map(b => bare(unnumbered(String(b.props['label']))))
  const procWorld = (cards: object[]) => {
    const w = world()
    w.store = withCards(cards)
    Object.assign(w.files, PROC)
    return w
  }

  test('an H3 模組卡 draws its module\'s lines in its tile; the files the module names are read', async ($, on) => {
    const w = procWorld([mod('c1', 'host.overview', { size: 'H3' })])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await tileLines(band, 'c1')).toEqual(['主機 box', '核心 7.0.14-14-gen', '開機 7 天 1 小時', 'CPU 2 核', '溫度 27.8°C'])
    expect(w.read).toContain('/proc/sys/kernel/hostname')
    expect(w.read).toContain('/sys/class/thermal/thermal_zone0/temp')
  })

  test('an H2 模組卡 draws the first line only', async ($, on) => {
    const w = procWorld([mod('c1', 'host.overview')])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await tileLines(band, 'c1')).toEqual(['主機 box'])
  })

  // s34: the half and full rows are as tall as their series, so they show as many lines: an H3 series tile five, an H2 series tile the first
  test('an H3-half or H3-full 模組卡 draws its lines as H3 does; an H2-half or H2-full the first line only', async ($, on) => {
    const w = procWorld([mod('c1', 'host.overview', { size: 'H3-half' }), mod('c2', 'host.overview', { size: 'H3-full' }),
      mod('c3', 'host.overview', { size: 'H2-half' }), mod('c4', 'host.overview', { size: 'H2-full' })])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    for (const id of ['c1', 'c2']) expect((await tileLines(band, id)).length).toBe(5)
    for (const id of ['c3', 'c4']) expect(await tileLines(band, id)).toEqual(['主機 box'])
  })

  test('a module\'s command runs as its argv, in the project, for at most 3 s; a command that fails shows ?', async ($, on) => {
    const w = procWorld([mod('c1', 'host.disk', { size: 'H3' })])
    w.git[DF_ARGV.join(' ')] = { exitCode: 0, stdout: DF_TEXT }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await tileLines(band, 'c1')).toEqual(['磁碟 / 50%', '/ 50% 0.5/1.0G'])
    const at = w.ran.findIndex(argv => argv.join(' ') === DF_ARGV.join(' '))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(w.runInit[at]).toMatchObject({ cwd: CWD })
    expect(Number(w.runInit[at]?.['timeoutMs'])).toBeLessThanOrEqual(3000)

    // a command that ends in failure counts as nothing read, whatever it printed before
    w.git[DF_ARGV.join(' ')] = { exitCode: 1, stdout: DF_TEXT }
    await sl($, 'reload')
    expect(await tileLines(band, 'c1')).toEqual(['磁碟 ?'])
  })

  test('a session module follows the tool count as rows are stored, before the turn ends', async ($, on) => {
    const w = procWorld([mod('c1', 'session.tools')])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await tileLines(band, 'c1')).toEqual(['工具 3 次'])
    await $.session.append(row([TOOL('t9')]))
    expect(await tileLines(band, 'c1')).toEqual(['工具 4 次'])
  })

  test('the files are read again at /ss reload and at the end of a turn', async ($, on) => {
    const w = procWorld([mod('c1', 'host.overview')])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    w.files['/proc/sys/kernel/hostname'] = 'pve2\n'
    await sl($, 'reload')
    expect(await tileLines(band, 'c1')).toEqual(['主機 pve2'])
    w.files['/proc/sys/kernel/hostname'] = 'pve3\n'
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    expect(await tileLines(band, 'c1')).toEqual(['主機 pve3'])
  })

  test('a 模組卡 whose module is not there says so in its tile; the store keeps it and the panel still draws', async ($, on) => {
    const w = procWorld([mod('c1', 'nope.gone')])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await tileLines(band, 'c1')).toEqual(['沒有這個模組 nope.gone'])
    await sl($, 'icons on')
    expect((w.store['settings'] as { cards: { text: string; kind: string }[] }).cards[0]).toMatchObject({ kind: 'module', text: 'nope.gone' })
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(await ui.find({ type: 'Box', key: 'card-c1' })).toBeDefined()
  })

  test('a button module stands in the button row, numbered with the 按鈕卡, never in a tile; nothing is typed when it is pressed', async ($, on) => {
    const w = procWorld([
      { id: 'c1', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
      mod('c2', 'action.reload', { name: '重新載入' }),
      mod('c3', 'host.snapshot', { name: '主機快照' }),
    ])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await buttonLabels(band)).toEqual(['說明', '重新載入', '主機快照'])
    expect((await band.find({ type: 'Button', key: 'band-c3' }))?.props['label']).toMatch(/^³/)
    expect(await band.find({ type: 'Box', key: 'band-frame-c2' })).toBeUndefined()

    await band.press({ key: 'band-c3' })
    expect(w.toasts).toEqual(['box · 負載 0.50 · 記憶體 50% · / ?'])

    w.store = withCards([
      { id: 'c1', kind: 'button', name: '-10', text: '--adj -10', prefix: '', section: 'above' },
      mod('c2', 'action.reload', { name: '重新載入' }),
    ])
    await band.press({ key: 'band-c2' })
    expect(await buttonLabels(band)).toEqual(['-10', '重新載入'])
    expect(w.prompts).toEqual([])
  })

  test('分數 reads Score.md\'s total and band, 日誌 the newest journal\'s last five lines, the newest first', async ($, on) => {
    const w = procWorld([mod('c1', 'session.score', { size: 'H3' }), mod('c2', 'session.journal', { size: 'H3' })])
    w.files['/w/Score.md'] = '# Score\nscore_total: -6\nscore_band: D\n'
    w.files['/w/.claude/journal_2026-10-09_alex-s27.md'] = ['0 WHO — Alex (x)', '1 ADD — a', '2 LAUNCH — b', '3 PASS — c', '4 FIX — d', '5 CLOSE — e', ''].join('\n')
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await tileLines(band, 'c1')).toEqual(['分數 -6 · D', '待決議 2'])
    expect(await tileLines(band, 'c2')).toEqual(['5 CLOSE — e', '4 FIX — d', '3 PASS — c', '2 LAUNCH — b', '1 ADD — a'])
  })

  test('the 設定 module opens the /ss panel', async ($, on) => {
    const w = procWorld([mod('c1', 'action.panel', { name: '設定' })])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    await band.press({ key: 'band-c1' })
    expect(w.opened).toContain('ss-panel')
  })

  test('in the panel a tile module is a display (showinfo or showchart, its size button); a button module is TouchBar\'s', async ($, on) => {
    const w = procWorld([mod('c1', 'host.overview', { size: 'H3' }), mod('c2', 'session.ctx'), mod('c3', 'action.reload', { name: '重新載入' })])
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const cardsIn = async (key: string) => walk((await ui.find({ type: 'Box', key }))?.children).map(el => String(el.props?.['key'])).filter(k => k.startsWith('card-'))
    expect(await cardsIn('h3-cards')).toEqual(['card-c1'])
    expect(await cardsIn('h2-cards')).toEqual(['card-c2'])
    expect(await cardsIn('touch-cards')).toEqual(['card-c3'])
    expect(await ui.find({ type: 'Button', key: 'size-c1' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'size-c3' })).toBeUndefined()
  })

  test('新增卡片 offers 模組卡 with a list of the modules; an empty name takes the module\'s; showchart\'s lands at H3', async ($, on) => {
    const w = procWorld([])
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'h3-add-card' })
    const pane = await addPane($)
    expect(await pane.find({ type: 'Select', key: 'add-module' })).toBeUndefined()
    await pane.select({ key: 'add-kind', value: 'module' })
    const list = await pane.find({ type: 'Select', key: 'add-module' })
    const options = list?.props['options'] as { value: string; label: string }[]
    expect(options.map(o => o.value)).toContain('host.disk')
    expect(options.find(o => o.value === 'host.disk')?.label).toContain('磁碟')
    await pane.select({ key: 'add-module', value: 'host.disk' })
    // s35: it runs GNU df and the POSIX one (a Mac): the warning names df once
    expect(await pane.find({ type: 'Text', text: /主機上執行 df（只讀/ })).toBeDefined()
    await pane.press({ key: 'add-ok' })
    const cards = (w.store['settings'] as { cards: object[] }).cards
    expect(cards[cards.length - 1]).toMatchObject({ kind: 'module', text: 'host.disk', name: '磁碟', section: 'above', size: 'H3' })
  })

  test('TouchBar\'s 新增卡片 lists the button modules; a module card is added under the name typed', async ($, on) => {
    const w = procWorld([])
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'touch-add-card' })
    const pane = await addPane($)
    await pane.select({ key: 'add-kind', value: 'module' })
    const options = (await pane.find({ type: 'Select', key: 'add-module' }))?.props['options'] as { value: string }[]
    expect(options.map(o => o.value)).toEqual(['host.snapshot', 'session.snapshot', 'action.reload', 'action.panel'])
    await pane.select({ key: 'add-module', value: 'action.reload' })
    await pane.input({ key: 'add-name', text: '重載', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    const cards = (w.store['settings'] as { cards: object[] }).cards
    expect(cards[cards.length - 1]).toMatchObject({ kind: 'module', text: 'action.reload', name: '重載', section: 'above' })
  })
})

// the owner 2026-10-10 s33 「每個按鈕可以是…轉發執行命令」: a 按鈕卡 whose text starts with ! runs the rest on the host (bash, in the project, at
// most 5 s: a press may take 10 s) and shows the last line it printed in a toast; nothing is typed.
describe('a 按鈕卡 that runs a command on the host', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const bang = (text: string) => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'],
    cards: [{ id: 'c1', kind: 'button', name: '磁碟', text, prefix: '', section: 'above' }] } })

  test('the last line it printed shows in a toast', async ($, on) => {
    const w = world()
    w.store = bang('!df -h /')
    w.git['bash -c df -h /'] = { exitCode: 0, stdout: 'Filesystem Size Used\n/dev/a 94G 35G\n\n' }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    await band.press({ key: 'band-c1' })
    const at = w.ran.findIndex(argv => argv.join(' ') === 'bash -c df -h /')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(w.runInit[at]).toMatchObject({ cwd: CWD })
    expect(Number(w.runInit[at]?.['timeoutMs'])).toBeLessThanOrEqual(5000)
    expect(w.toasts).toEqual(['磁碟：/dev/a 94G 35G'])
    expect(w.prompts).toEqual([])
  })

  test('a command that fails or cannot start says so in the toast', async ($, on) => {
    const w = world()
    w.store = bang('!false')
    w.git['bash -c false'] = { exitCode: 1, stdout: '' }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    await band.press({ key: 'band-c1' })
    expect(w.toasts).toEqual(['磁碟：失敗（結束碼 1）'])
    delete w.git['bash -c false']
    await band.press({ key: 'band-c1' })
    expect(w.toasts[1]).toMatch(/^磁碟：沒有執行（.+）$/)
  })

  test('the 新增卡片 pane warns that a ! button runs on the host', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.select({ key: 'add-kind', value: 'button' })
    expect(await pane.find({ type: 'Text', text: /主機/ })).toBeUndefined()
    await pane.input({ key: 'add-text', text: '!uptime', kind: 'change' })
    expect(await pane.find({ type: 'Text', text: /按下去會在主機上執行/ })).toBeDefined()
  })
})

// The tiles are a dashboard (s33): the tile modules are read again every minute while the session is open, not only when a turn ends; a
// 指令卡 still runs once a turn (its pane says so), and with no tile module on nothing is read on the minute.
describe('the tiles every minute', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const cards = (list: object[], off: string[] = []) => ({ settings: { off, note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: list.map(c => (c as { id: string }).id), cards: list } })
  const overview = { id: 'c1', kind: 'module', name: '主機', text: 'host.overview', prefix: '', section: 'above' }
  const echo = { id: 'c2', kind: 'command', name: '指令', text: 'echo hi', prefix: '', section: 'above' }
  type Found = { children?: unknown } | undefined
  const firstLine = async (band: { find: (q: object) => Promise<Found> }) =>
    walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))[0]

  test('a tile module is read again after a minute, and every minute after; a 指令卡 is not run on the minute', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = cards([overview, echo])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    w.git['bash -c echo hi'] = { exitCode: 0, stdout: 'hi\n' }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await firstLine(band)).toBe('主機 box')
    const echoes = () => w.ran.filter(argv => argv.join(' ') === 'bash -c echo hi').length
    const before = echoes()
    w.files['/proc/sys/kernel/hostname'] = 'pve2\n'
    await clock.advance(59999)
    expect(await firstLine(band)).toBe('主機 box')
    await clock.advance(1)
    expect(await firstLine(band)).toBe('主機 pve2')
    w.files['/proc/sys/kernel/hostname'] = 'pve3\n'
    await clock.advance(60000)
    expect(await firstLine(band)).toBe('主機 pve3')
    expect(echoes()).toBe(before)
  })

  test('with no tile module on, nothing is read, at the start or on the minute', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = cards([overview], ['c1'])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    // an off 模組卡 is not read at all: not at the start, not on the minute
    expect(w.read).not.toContain('/proc/sys/kernel/hostname')
    const reads = w.read.length
    await clock.advance(120000)
    expect(w.read.length).toBe(reads)
  })

  test('an off 模組卡 turned on in the panel is read at once', async ($, on) => {
    const w = world()
    w.store = cards([overview], ['c1'])
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await firstLine(band)).toBe('主機 box')
  })

  test('a second session.start (a reload) leaves one minute timer, not two', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = cards([overview])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)
    await start($)

    const count = () => w.read.filter(p => p === '/proc/sys/kernel/hostname').length
    const before = count()
    await clock.advance(60000)
    expect(count()).toBe(before + 1)
  })
})

// s31 nodes 17 and 19, s33 03:38:52: a store written under a running mod (by hand, or by another window) was undone by the next press, which
// wrote the mod's old settings over it. Before a change is written, a store that moved since this mod last read or wrote it is taken first.
describe('a store that moved underneath', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const oneButton = (name: string, text: string) => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: ['c1'], cards: [{ id: 'c1', kind: 'button', name, text, prefix: '', section: 'above' }] } })
  type Stored = { cards: { name: string; text: string }[]; icons: boolean; off: string[] }

  test('a press takes the newer store first and changes it, never writing the old settings back', async ($, on) => {
    const w = world()
    w.store = oneButton('說明', '--h')
    engine(on, w)
    await start($)

    w.store = oneButton('-10', '--adj -10')
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-ctx' })
    const kept = w.store['settings'] as Stored
    expect(kept.cards.map(c => `${c.name} ${c.text}`)).toEqual(['-10 --adj -10'])
    expect(kept.off).toContain('ctx')
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(bare(unnumbered(String((await band.find({ type: 'Button', key: 'band-c1' }))?.props['label'])))).toBe('-10')
  })

  test('a /ss argument does the same', async ($, on) => {
    const w = world()
    w.store = oneButton('說明', '--h')
    engine(on, w)
    await start($)

    w.store = oneButton('-10', '--adj -10')
    await sl($, 'icons on')
    const kept = w.store['settings'] as Stored
    expect(kept.cards[0]?.name).toBe('-10')
    expect(kept.icons).toBe(true)
  })

  test('a card added in the 新增卡片 pane joins the newer store, and stays', async ($, on) => {
    const w = world()
    w.store = oneButton('說明', '--h')
    engine(on, w)
    await start($)

    w.store = oneButton('-10', '--adj -10')
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'touch-add-card' })
    const pane = await addPane($)
    await pane.input({ key: 'add-name', text: '執行', kind: 'change' })
    await pane.input({ key: 'add-text', text: 'go', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    expect((w.store['settings'] as Stored).cards.map(c => `${c.name} ${c.text}`)).toEqual(['-10 --adj -10', '執行 go'])
  })

  test('the mod\'s own writes do not count as a move: two presses in a row both land', async ($, on) => {
    const w = world()
    w.store = oneButton('說明', '--h')
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-ctx' })
    await ui.press({ key: 'toggle-5h' })
    expect((w.store['settings'] as Stored).off).toEqual(expect.arrayContaining(['ctx', '5h']))
  })
})

// the owner 2026-10-10 s33 「你可以做個重新加載的按鈕在pane嗎不用每次都讓我開新對話」: a mod loaded from .claude/skills is not reloaded while the
// session runs (s33 node 28); Claude Code's own text: "edits there take effect after /reload-plugins". The panel's 重新載入 (and the band's,
// and the 重新載入 module) read the store and the files again, then run the built-in /reload-plugins through $.command.run, which runs a
// built-in as if typed. A typed /ss reload only reads (a command run from inside a command's hook could wait on itself).
describe('reloading the plugins', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const store = (name: string) => ({ settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'],
    cards: [{ id: 'c1', kind: 'button', name, text: '--h', prefix: '', section: 'above' }] } })
  const label = async (band: { find: (q: object) => Promise<{ props: Record<string, unknown> } | undefined> }) =>
    bare(unnumbered(String((await band.find({ type: 'Button', key: 'band-c1' }))?.props['label'])))

  test('the panel\'s first row is a 重新載入 button: it reads the store again, then runs /reload-plugins; nothing typed', async ($, on) => {
    const w = world()
    w.store = store('說明')
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const top = ((await ui.drawn()).children as El[]).map(el => String(el.props?.['key']))
    expect(top[0]).toBe('panel-tools')
    expect(bare((await ui.find({ type: 'Button', key: 'panel-reload' }))?.text)).toBe('重新載入')

    w.store = store('-10')
    await ui.press({ key: 'panel-reload' })
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await label(band)).toBe('-10')
    expect(w.commands).toEqual(['reload-plugins'])
    expect(w.prompts).toEqual([])
  })

  test('the 重新載入 module runs /reload-plugins too', async ($, on) => {
    const w = world()
    w.store = { settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'],
      cards: [{ id: 'c1', kind: 'module', name: '重新載入', text: 'action.reload', prefix: '', section: 'above' }] } }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    await band.press({ key: 'band-c1' })
    expect(w.commands).toEqual(['reload-plugins'])
  })

  test('a /reload-plugins that is refused says so in a toast; the store was read all the same', async ($, on) => {
    const w = world()
    w.store = store('說明')
    w.reloadRefused = true
    engine(on, w)
    await start($)

    w.store = store('-10')
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'panel-reload' })
    expect(w.toasts).toEqual([expect.stringMatching(/^重新載入：設定已重讀，程式沒有重新載入（.+）$/)])
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(await label(band)).toBe('-10')
  })

  test('a typed /ss reload only reads the store and the files', async ($, on) => {
    const w = world()
    w.store = store('說明')
    engine(on, w)
    await start($)

    await sl($, 'reload')
    expect(w.commands).toEqual([])
    expect(w.toasts).toEqual([])
  })
})


// the owner 2026-10-10 s33 (the pane): 「AP 旁邊這邊畫個Aboveprompt 的縮小版 prieview 把現在的顯示替代」「showchart 次級菜單旁邊畫三個方框分散對齊分別
// 代表框1~3」「showinfo 次級菜單旁邊畫五個框分散對齊分別代表框 4~8」「touchbar 次級菜單 旁邊 把AP旁邊touchBar資訊顯示在這裡」, each 「最右邊對其上方快轉
// 卡片的右側」: four picture rows, 300 units each, at the right end of a full row of four cards. No number decides that end: each picture row
// stands in a column with a zero-high row of four ghost cards made of a card's own parts (its round frame, its padding, its fixed-width name
// button), so the column is exactly as wide as a row of four cards, on any window.
describe('the pictures beside AbovePrompt and its menus', () => {
  const STORE = () => ({ settings: { off: ['c9'] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11'], cards: [
      { id: 'c1', kind: 'text', name: '框一', text: 'a', prefix: '', section: 'above', size: 'H3' },
      { id: 'c2', kind: 'text', name: '框二', text: 'a', prefix: '', section: 'above', size: 'H3' },
      { id: 'c3', kind: 'text', name: '框三', text: 'a', prefix: '', section: 'above', size: 'H3' },
      { id: 'c4', kind: 'text', name: '框四', text: 'a', prefix: '', section: 'above', size: 'H2' },
      { id: 'c5', kind: 'text', name: '框五', text: 'a', prefix: '', section: 'above', size: 'H2' },
      { id: 'c6', kind: 'text', name: '框六', text: 'a', prefix: '', section: 'above', size: 'H2' },
      { id: 'c7', kind: 'text', name: '框七', text: 'a', prefix: '', section: 'above', size: 'H2' },
      { id: 'c8', kind: 'text', name: '框八', text: 'a', prefix: '', section: 'above', size: 'H2' },
      { id: 'c9', kind: 'text', name: '關的', text: 'a', prefix: '', section: 'above', size: 'H2' },
      { id: 'c10', kind: 'button', name: '設定SS', text: '/ss', prefix: '', section: 'above' },
      { id: 'c11', kind: 'button', name: '-10', text: '--adj -10', prefix: '', section: 'above' },
    ] } })
  type Node = { type: string; props: Record<string, unknown>; children?: unknown[] }
  const boxOf = async (ui: { find: (q: object) => Promise<unknown> }, key: string) => (await ui.find({ type: 'Box', key })) as Node | undefined
  const svgIn = async (ui: { find: (q: object) => Promise<unknown> }, key: string) => walk((await boxOf(ui, key))?.children).find(el => el.type === 'Svg')
  const panel = async ($: Engine, surface: 'desktop' | 'terminal' | 'vscode' = 'desktop') =>
    $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })

  // the owner 2026-10-10 s33 (1.png: 設定SS and Lab cards narrower, the TouchBar picture 40 px short of the fourth card) 「不是說好pane裡面的卡片都是
  // 一張一排要對齊嗎字變少的時候也要可以對齊」「直接幫卡片裡面的按鈕畫一個白外框，這樣是不是就會強制一樣大了」: every card is 13 cells, its name
  // button in a frame of 11 (white while lit, grey while off); a picture row is four cards and their three gaps, 55 cells, the picture at its
  // right end. One number on both sides, so they end together; the ghost cards of before measured 240 px against the cards' 251 on his desktop.
  // s34 (the owner's 1.webp: every name cut to one character, 版 …, 目 …; his lab 2.webp): the desktop pads a bordered Box that names no padding
  // about 14.5 px a side, and a 5.5-character button (103-104 px) is a hair over 11 cells. Each width stands on a plain Box (the card's 13
  // cells, the name's room of 12), each border on a Box around it, and the white frame names paddingX 0.
  // s36 the owner 「按鈕裡面加的那個小白框拿掉」: the white frame is gone; the room of 12 cells stays, so no name is cut
  test('every card is one width, its name in a room of 12 cells with no frame: no Box has both a width and a border', async ($, on) => {
    const w = world()
    w.store = STORE()
    ;(w.store['settings'] as { off: string[] }).off = ['c9', 'tools']
    engine(on, w)
    await start($)

    const ui = await panel($)
    for (const key of ['ctx', 'tools', 'icons', 'c1', 'c10', 'c11']) {
      const card = await boxOf(ui, `card-${key}`)
      expect(card?.props).toMatchObject({ borderStyle: 'round', paddingX: 1 })
      expect(card?.props['width']).toBeUndefined()
      const inner = await boxOf(ui, `body-${key}`)
      expect(inner?.props).toMatchObject({ width: 13, flexDirection: 'column', alignItems: 'center' })
      expect(inner?.props['borderStyle']).toBeUndefined()
      const frame = await boxOf(ui, `name-${key}`)
      expect(frame?.props).toMatchObject({ marginTop: 1 })
      expect(frame?.props['borderStyle']).toBeUndefined()
      expect(frame?.props['width']).toBeUndefined()
      const room = await boxOf(ui, `name-room-${key}`)
      expect(room?.props).toMatchObject({ width: 12, justifyContent: 'center' })
      expect(room?.props['borderStyle']).toBeUndefined()
      expect(walk(room?.children).some(el => el.type === 'Button' && String(el.props['key']).startsWith('toggle-'))).toBe(true)
    }
    // lit or grey shows on the card's own border
    expect((await boxOf(ui, 'card-ctx'))?.props['borderColor']).toBe('text')
    expect((await boxOf(ui, 'card-tools'))?.props['borderColor']).toBe('subtle')
    // the dial and the name are the card's, inside its width
    expect(walk((await boxOf(ui, 'body-ctx'))?.children).some(el => el.type === 'Svg')).toBe(true)
    // nothing in the pane has both a width and a border
    const both = walk([await ui.drawn()]).filter(el => el.type === 'Box' && el.props['width'] !== undefined && el.props['borderStyle'] !== undefined)
    expect(both.map(el => el.props['key'])).toEqual([])
    // a picture row is four cards (13 + 2 of padding, about 1 px of border a side) and three gaps: 64 cells, a menu's indent inside it, so
    // all four pictures end where the Status Line's 快轉 card ends (ruling s33; 4.webp: AbovePrompt's at 1766, the cards' 1765)
    for (const [row, indent] of [['above-header', 0], ['h3full-header', 2], ['h3half-header', 2], ['h3-header', 2], ['h2full-header', 2],
      ['h2half-header', 2], ['h2-header', 2], ['touch-header', 2]] as const) {
      expect((await boxOf(ui, row))?.props).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between', width: 64 })
      expect((await boxOf(ui, row))?.props['paddingLeft'] ?? 0).toBe(indent)
    }
    expect(await boxOf(ui, 'above-header-ghost')).toBeUndefined()
    // the cards of a menu stand in the panel's columns on the desktop since s37 (Claude Design step 3), its header still indented
    expect((await boxOf(ui, 'h3-cards'))?.props['marginLeft'] ?? 0).toBe(0)
    // the terminal keeps its cards as wide as what they hold, with no frame
    const terminal = await panel($, 'terminal')
    expect((await boxOf(terminal, 'card-ctx'))?.props['width']).toBeUndefined()
    expect(await boxOf(terminal, 'name-ctx')).toBeUndefined()
  })

  // on VS Code since s37: the desktop's picture has a row of its own (Claude Design step 4), tested there
  test('AbovePrompt\'s picture is the band made small: three tiles, five tiles, the buttons; the old text line is gone', async ($, on) => {
    const w = world()
    w.store = STORE()
    engine(on, w)
    await start($)

    const ui = await panel($, 'vscode')
    const picture = await svgIn(ui, 'above-preview')
    expect(picture?.props['width']).toBe(300)
    expect(picture?.props['alt']).toBe('AbovePrompt：框一 框二 框三｜框四 框五 框六 框七 框八｜¹設定SS ²-10')
    const source = drawingOf(String(picture?.props['source']))
    // three plus five dashed tiles, and a pill per button that is on
    expect((source.match(/stroke-dasharray/g) ?? []).length).toBe(8)
    expect((source.match(/<rect [^>]*class="pill"/g) ?? []).length).toBe(2)
    for (const name of ['框一', '框三', '框四', '框八']) expect(source).toContain(`>${name}</text>`)
    expect(source).not.toContain('關的')
    expect(walk((await boxOf(ui, 'above-header'))?.children).some(el => el.type === 'Text' && /框一 a/.test(String(el.children?.[0])))).toBe(false)
  })

  test('showchart\'s picture is three boxes, showinfo\'s five, spread edge to edge, named for the cards in them; TouchBar\'s the buttons', async ($, on) => {
    const w = world()
    w.store = STORE()
    engine(on, w)
    await start($)

    const ui = await panel($)
    const h3 = await svgIn(ui, 'h3-band')
    const h2 = await svgIn(ui, 'h2-band')
    expect(h3?.props).toMatchObject({ width: 300, alt: 'showchart 框一 框二 框三' })
    expect(h2?.props).toMatchObject({ width: 300, alt: 'showinfo 框四 框五 框六 框七 框八' })
    const boxes = (source: string) => [...source.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*stroke-dasharray/g)].map(m => [Number(m[1]), Number(m[2])])
    for (const [svg, n] of [[h3, 3], [h2, 5]] as const) {
      const b = boxes(drawingOf(String(svg?.props['source'])))
      expect(b).toHaveLength(n)
      // spread edge to edge: the first starts and the last ends a frame's width from the picture's ends, all one size, equal gaps
      expect(b[0]?.[0]).toBe(1)
      expect(Math.abs(Number(b[n - 1]?.[0]) + Number(b[n - 1]?.[1]) - 299)).toBeLessThan(1e-6)
      expect(new Set(b.map(x => Number(x[1]).toFixed(3))).size).toBe(1)
    }
    expect(String((await svgIn(ui, 'touch-band'))?.props['alt'])).toBe('touchbar ¹設定SS ²-10')
  })

  // s34 (the table: 「half 畫 2 個框，full 畫 1 個框」; AbovePrompt's picture draws the new blocks only when they hold a card, showchart and
  // showinfo as before, so it does not stack seven layers)
  const WITH_NEW = () => {
    const st = STORE()
    st.settings.cards.push(
      { id: 'c12', kind: 'text', name: '半一', text: 'a', prefix: '', section: 'above', size: 'H3-half' },
      { id: 'c13', kind: 'text', name: '全一', text: 'a', prefix: '', section: 'above', size: 'H2-full' },
    )
    st.settings.aboveOrder.push('c12', 'c13')
    return st
  }

  test('the half menus\' pictures are two boxes, the full ones one, spread edge to edge and named for their cards', async ($, on) => {
    const w = world()
    w.store = WITH_NEW()
    engine(on, w)
    await start($)

    // on VS Code: since Claude Design step 8 (s38) the desktop draws no picture beside a menu with no card
    const ui = await panel($, 'vscode')
    const boxes = (source: string) => [...source.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*stroke-dasharray/g)].map(m => [Number(m[1]), Number(m[2])])
    for (const [key, n, alt] of [['h3half-band', 2, 'showchart-half 半一'], ['h3full-band', 1, 'showchart-full'], ['h2half-band', 2, 'showinfo-half'],
      ['h2full-band', 1, 'showinfo-full 全一']] as const) {
      const svg = await svgIn(ui, key)
      expect(svg?.props).toMatchObject({ width: 300, alt })
      const b = boxes(drawingOf(String(svg?.props['source'])))
      expect(b).toHaveLength(n)
      expect(b[0]?.[0]).toBe(1)
      expect(Math.abs(Number(b[n - 1]?.[0]) + Number(b[n - 1]?.[1]) - 299)).toBeLessThan(1e-6)
    }
  })

  // on VS Code since s37 (the desktop's: Claude Design step 4)
  test('AbovePrompt\'s picture adds a new block only when it holds a card, in the band\'s order, and grows to hold it', async ($, on) => {
    const w = world()
    w.store = WITH_NEW()
    engine(on, w)
    await start($)

    const ui = await panel($, 'vscode')
    const picture = await svgIn(ui, 'above-preview')
    expect(picture?.props['alt']).toBe('AbovePrompt：半一｜框一 框二 框三｜全一｜框四 框五 框六 框七 框八｜¹設定SS ²-10')
    const source = drawingOf(String(picture?.props['source']))
    // showchart-half 2, showchart 3, showinfo-full 1, showinfo 5; no showchart-full nor showinfo-half: they hold no card
    expect((source.match(/stroke-dasharray/g) ?? []).length).toBe(11)
    const at = (name: string) => source.indexOf(`>${name}</text>`)
    expect(at('半一')).toBeLessThan(at('框一'))
    expect(at('框三')).toBeLessThan(at('全一'))
    expect(at('全一')).toBeLessThan(at('框四'))
    expect(Number(picture?.props['height'])).toBeGreaterThan(80)
    expect(source).toContain(`height="${picture?.props['height']}"`)
  })

  test('a block folded away by its switch is dimmed in the pictures; a box with no card is drawn empty', async ($, on) => {
    const w = world()
    w.store = STORE()
    const st = w.store['settings'] as { aboveOff?: string[]; off: string[] }
    st.aboveOff = ['chart']
    st.off = ['c9', 'c3']
    engine(on, w)
    await start($)

    const ui = await panel($)
    const h3 = drawingOf(String((await svgIn(ui, 'h3-band'))?.props['source']))
    expect(h3).toContain('opacity="0.35"')
    expect(h3).not.toContain('>框三</text>')
    expect((h3.match(/stroke-dasharray/g) ?? []).length).toBe(3)
    expect(drawingOf(String((await svgIn(ui, 'h2-band'))?.props['source']))).not.toContain('opacity="0.35"')
  })

  test('the terminal has no pictures: the names in brackets, no ghost rows', async ($, on) => {
    const w = world()
    w.store = STORE()
    engine(on, w)
    await start($)

    const ui = await panel($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '[框一] [框二] [框三]' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[框四] [框五] [框六] [框七] [框八]' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[¹設定SS] [²-10]' })).toBeDefined()
    expect(await boxOf(ui, 'above-header-ghost')).toBeUndefined()
    expect((await boxOf(ui, 'above-header'))?.props['width']).toBeUndefined()
  })
})

// s34 (the owner 「做繁體中文(zh-TW) English 日文 還有 新增語言」「英文 是預設 繁中跟日文 是可以設計一個語言文件未來可以開放自己翻譯自己新增的…
// (要做版本防呆）」「寬度名稱定義在語言檔裡面…中文目前定義四個中文字母 英文我們也測試看看」, then 「好，照這樣開工」): the interface in a language
// file; English where nothing was ever stored, 繁中 where settings were stored before languages (the owner's); his own names and sends and the
// system names never translated; a user's language file from .claude/superstatus/lang, a wrong format refused, missing strings English.
describe('languages', () => {
  const LANG_DIR = `${CWD}/.claude/superstatus/lang`
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never
  const entry = (name: string): Entry => ({ name, kind: 'file', size: 10, mtimeMs: 1, isLink: false })
  const panelOf = ($: Engine) => $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const label = async (ui: { find: (q: object) => Promise<{ text?: string } | undefined> }, key: string) => bare((await ui.find({ type: 'Button', key }))?.text)

  test('with nothing stored the panel is English: Sort, Default, Add card, Reload, the built-in cards, the status line', async ($, on) => {
    const w = world()
    w.store = {}
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    expect(await label(ui, 'sort')).toBe('Edit')
    expect(await label(ui, 'default-order')).toBe('Default')
    expect(await label(ui, 'add-card')).toBe('Add card')
    expect(await label(ui, 'panel-reload')).toBe('Reload')
    expect(await label(ui, 'toggle-ver')).toBe('Version')
    expect(await label(ui, 'toggle-who')).toBe('Operator')
    expect(await ui.find({ type: 'Text', text: '排序' })).toBeUndefined()
    expect(last(w)).not.toMatch(/目前剩下|進度/)
  })

  // s35 (the installer's end-to-end run): a fresh install wrote its first settings without a language, so the next session read
  // 「settings kept before languages」 and opened in 繁中; s34's rule keeps English the default (「英文 是預設」)
  test('a fresh install stays English after its first change and a new session', async ($, on) => {
    const w = world()
    w.store = {}
    engine(on, w)
    await start($)
    await sl($, 'off tools')
    expect(w.store['language']).toBe('en')
    await start($)

    const ui = await panelOf($)
    expect(await label(ui, 'sort')).toBe('Edit')
  })

  // s35 final review: the fix above wrote the language this session speaks over a pick made meanwhile in another session
  test('a language picked in another session is not overwritten by this session\'s first change', async ($, on) => {
    const w = world()
    w.store = {}
    engine(on, w)
    await start($)
    w.store['language'] = 'ja'
    await sl($, 'off tools')
    expect(w.store['language']).toBe('ja')
  })

  // s35 final review: the owner's store (settings from before languages), the panel drawn before session.start (a reload): its first change
  // must not fix English in the store; the next session still opens in 繁中
  test('a store from before languages, changed before session.start, still opens in 繁中 at the next start', async ($, on) => {
    const w = world()
    engine(on, w)
    await panelOf($)
    await sl($, 'off tools')
    await start($)
    const ui = await panelOf($)
    expect(await label(ui, 'sort')).toBe('編輯')
  })

  test('settings stored before languages (Alex\'s) open in 繁中', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    expect(await label(ui, 'sort')).toBe('編輯')
    expect(await label(ui, 'panel-reload')).toBe('重新載入')
    expect(await label(ui, 'toggle-ver')).toBe('版本號')
  })

  test('a language list beside 重新載入: English and 繁體中文; a pick is kept in the store and redraws the panel and the line', async ($, on) => {
    const w = world()
    w.store = {}
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    const select = (await ui.find({ type: 'Select', key: 'language' })) as { props: Record<string, unknown> } | undefined
    expect(select?.props['value']).toBe('en')
    expect((select?.props['options'] as { value: string; label: string }[]).slice(0, 2)).toEqual([
      { value: 'en', label: 'English' },
      { value: 'zh-TW', label: '繁體中文' },
    ])
    const tools = walk((await ui.find({ type: 'Box', key: 'panel-tools' }))?.children).map(el => String(el.props?.['key']))
    expect(tools.indexOf('language')).toBeLessThan(tools.indexOf('panel-reload'))
    await ui.select({ key: 'language', value: 'zh-TW' })
    expect(w.store['language']).toBe('zh-TW')
    expect(await label(ui, 'sort')).toBe('編輯')
    expect(last(w)).toContain('目前剩下')
    await ui.select({ key: 'language', value: 'en' })
    expect(w.store['language']).toBe('en')
    expect(await label(ui, 'sort')).toBe('Edit')
  })

  test('新增語言 reads .claude/superstatus/lang: a good file is offered, its missing strings English and counted; a wrong format is refused and named', async ($, on) => {
    const w = world()
    w.store = {}
    w.dirs = { [LANG_DIR]: [entry('fr.json'), entry('bad.json'), entry('odd.json'), entry('notes.txt')] }
    w.files[`${LANG_DIR}/odd.json`] = JSON.stringify({ format: 1, code: '../fr ench', name: 'Odd', strings: {} })
    w.files[`${LANG_DIR}/fr.json`] = JSON.stringify({ format: 1, code: 'fr', name: 'Français', rules: { nameMax: 9 }, strings: { 'btn.sort': 'Trier' } })
    w.files[`${LANG_DIR}/bad.json`] = JSON.stringify({ format: 99, code: 'xx', name: 'Bad', strings: {} })
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    // the list's last option (Claude Design step 1, s37; s34's 新增語言 button before it)
    const listed = ((await ui.find({ type: 'Select', key: 'language' })) as { props: Record<string, unknown> } | undefined)?.props['options'] as { value: string }[]
    await ui.select({ key: 'language', value: listed[listed.length - 1]?.value ?? '' })
    const options = ((await ui.find({ type: 'Select', key: 'language' })) as { props: Record<string, unknown> } | undefined)?.props['options'] as { value: string }[]
    expect(options.map(o => o.value)).toContain('fr')
    expect(options.map(o => o.value)).not.toContain('xx')
    expect(await ui.find({ type: 'Text', text: /bad\.json/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /odd\.json not applied: a wrong language code/ })).toBeDefined()
    expect(options.map(o => o.value)).not.toContain('../fr ench')
    await ui.select({ key: 'language', value: 'fr' })
    expect(await label(ui, 'sort')).toBe('Trier')
    expect(await label(ui, 'default-order')).toBe('Default')
    expect(await ui.find({ type: 'Text', text: /fr lacks \d+ strings/ })).toBeDefined()
  })

  test('a user\'s file of a built-in\'s code takes its place: a translator fixes 繁中 without touching superstatus', async ($, on) => {
    const w = world()
    w.dirs = { [LANG_DIR]: [entry('zh-TW.json')] }
    w.files[`${LANG_DIR}/zh-TW.json`] = JSON.stringify({ format: 1, code: 'zh-TW', name: '繁體中文（我的）', rules: { nameMax: 4 }, strings: { 'btn.sort': '排列' } })
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    expect(await label(ui, 'sort')).toBe('排列')
    const options = ((await ui.find({ type: 'Select', key: 'language' })) as { props: Record<string, unknown> } | undefined)?.props['options'] as { value: string; label: string }[]
    expect(options.filter(o => o.value === 'zh-TW')).toEqual([{ value: 'zh-TW', label: '繁體中文（我的）' }])
  })

  // the owner s34 「10個應該也不影響吧很少有單字超過10個字母的吧」: English ten (11.webp: ten lower-case letters about 100 px in a 112 px room)
  test('the name rule comes from the language: 繁中 four characters, English ten', async ($, on) => {
    const w = world()
    w.store = {}
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    const tryName = async (name: string) => {
      await ui.press({ key: 'add-card' })
      const pane = await addPane($)
      await pane.input({ key: 'add-name', text: name, kind: 'change' })
      await pane.input({ key: 'add-text', text: 'x', kind: 'change' })
      await pane.press({ key: 'add-ok' })
      const error = (await pane.findAll({ type: 'Text' })).map(t => String(t.text ?? '')).find(t => /at most|最多/.test(t))
      await pane.unmount()
      return error
    }
    expect(await tryName('abcdefghijk')).toMatch(/10/)
    expect(await tryName('abcdefghij')).toBeUndefined()
    await ui.select({ key: 'language', value: 'zh-TW' })
    expect(await tryName('一二三四五')).toBe('名稱最多四個字，現在是 5 個字')
  })

  test('Alex\'s own names and sends stay as he wrote them; the system names read the same in English', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [
      { id: 'c1', kind: 'button', name: '設定SS', text: '/ss', prefix: '', section: 'above' },
    ] } }
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    expect(await label(ui, 'toggle-c1')).toBe('設定SS')
    for (const name of ['StatusLine', 'AbovePrompt', 'showchart-full', 'showinfo', 'touchbar']) expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
  })

  // the owner's 11.webp (s34): 「S o r t」: the half gaps 繁中 keeps between characters (s28 「字距固定」) split an English word
  test('English interface buttons keep their words whole: Sort, Add, Cancel are not spaced out; 繁中 keeps its gaps', async ($, on) => {
    const w = world()
    w.store = {}
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    // the word whole inside the spaces that make it a column wide (s37, Claude Design step 2)
    expect(unpadded(String((await ui.find({ type: 'Button', key: 'sort' }))?.props['label']))).toBe('Edit')
    await ui.press({ key: 'add-card' })
    const pane = await addPane($)
    // since s39 Status Line's pane on the desktop is laid out in columns: the words whole inside a column's padding
    expect(unpadded(String((await pane.find({ type: 'Button', key: 'add-ok' }))?.props['label']))).toBe('Add')
    expect(unpadded(String((await pane.find({ type: 'Button', key: 'add-cancel' }))?.props['label']))).toBe('Cancel')
    await pane.unmount()
    await ui.select({ key: 'language', value: 'zh-TW' })
    expect(String((await ui.find({ type: 'Button', key: 'sort' }))?.props['label'])).toContain('編\u2002輯')
  })

  test('the built-in modules speak the language: host.overview in English', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [
      { id: 'c1', kind: 'module', name: 'Host', text: 'host.overview', prefix: '', section: 'above', size: 'H3' },
    ] } }
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    w.files['/proc/uptime'] = '609056.37 1\n'
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    const lines = walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))
    expect(lines[0]).toBe('host box')
    expect(lines[2]).toBe('up 7 d 1 h')
  })

  // s35 (the owner 「1 不空格」, on 「日文的介面詞和卡片名稱，要不要改成跟英文一樣整個字不空格（ツール、ブランチ），繁中維持現在的空半格？」): the half
  // gaps are 繁中's (s28 「字距固定」); a Japanese panel keeps its words whole, kanji-only ones too (操作者), and 繁中 keeps its gaps
  test('a 日本語 panel keeps its words whole: interface words and the built-in cards\' names; 繁中 keeps its gaps', async ($, on) => {
    const w = world()
    w.store = { language: 'ja' }
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    const raw = async (key: string) => String((await ui.find({ type: 'Button', key }))?.props['label'])
    // whole inside the spaces that make it a column wide (s37, Claude Design step 2)
    expect(unpadded(await raw('sort'))).toBe('編集')
    expect(await raw('toggle-tools')).toBe('ツール')
    expect(await raw('toggle-who')).toBe('操作者')
    expect(await raw('toggle-block')).toBe('進捗')
    await ui.select({ key: 'language', value: 'zh-TW' })
    expect(await raw('sort')).toContain('編 輯')
    expect(await raw('toggle-who')).toContain('操 作 者')
  })

  test('a name with kana in it is kept whole in any panel and in the band; a Chinese name keeps its gaps', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER, 'c1', 'c2'], aboveOrder: ['c3'], cards: [
      { id: 'c1', kind: 'text', name: 'メーター', text: 'x', prefix: '' },
      { id: 'c2', kind: 'text', name: '快轉', text: 'y', prefix: '' },
      { id: 'c3', kind: 'button', name: 'ホスト状態', text: 'go', prefix: '', section: 'above' },
    ] } }
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    expect((await ui.find({ type: 'Button', key: 'toggle-c1' }))?.props['label']).toBe('メーター')
    expect(String((await ui.find({ type: 'Button', key: 'toggle-c2' }))?.props['label'])).toContain('快 轉')
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    expect(String((await band.find({ type: 'Button', key: 'band-c3' }))?.props['label'])).toContain('ホスト状態')
    expect(fixed('ツール')).toBe('ツール')
    // cut whole too: 「メー …」, never 「メ ー …」
    expect(bandLabel(1, 'メーター', 4)).toContain('¹メー …')
    expect(bandLabel(1, 'メーター', 4)).not.toContain('メ ー')
  })

  // s35 (the owner 「好，先做日文」): 日本語, the third built-in language
  test('日本語 is third in the list; a pick speaks it: the tools row, the built-in cards, the status line', async ($, on) => {
    const w = world()
    w.store = {}
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    const options = ((await ui.find({ type: 'Select', key: 'language' })) as { props: Record<string, unknown> } | undefined)?.props['options'] as { value: string; label: string }[]
    expect(options[2]).toEqual({ value: 'ja', label: '日本語' })
    await ui.select({ key: 'language', value: 'ja' })
    expect(w.store['language']).toBe('ja')
    expect(await label(ui, 'sort')).toBe('編集')
    expect(await label(ui, 'default-order')).toBe('デフォルト')
    expect(await label(ui, 'add-card')).toBe('カード追加')
    expect(await label(ui, 'panel-reload')).toBe('再読み込み')
    expect(await label(ui, 'toggle-ver')).toBe('バージョン')
    expect(await label(ui, 'toggle-branch')).toBe('ブランチ')
    expect(last(w)).toContain('進捗 5  残り 50%  5時間 23%  週間 8%  ✓ 早送り済み')
    expect(last(w)).not.toMatch(/目前剩下|context/)
  })

  // the owner s35 「未來新加的功能沒有翻譯與研就先直接用英文顯示」: a new feature's words may be in English alone; a built-in language that lacks
  // a key shows English there (as a user's file does, s34). What a file must not hold: a key English has not (never shown), a {name}
  // English does not fill (shown as written).
  test('a built-in language may lack a key (English shows), never holds a key or a {name} that English lacks', () => {
    const ja = BUILT_IN.find(l => l.code === 'ja') ?? EN
    const { 'btn.sort': _sort, ...rest } = ja.strings
    expect(translator({ ...ja, strings: rest })('btn.sort')).toBe('Edit')
    const names = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]))
    for (const lang of BUILT_IN) {
      for (const key of Object.keys(lang.strings)) expect(`${lang.code} ${key} ${key in EN.strings}`).toBe(`${lang.code} ${key} true`)
      for (const [key, value] of Object.entries(lang.strings)) {
        const english = names(EN.strings[key] ?? '')
        for (const name of names(value)) expect(`${lang.code} ${key} {${name}}: ${english.has(name)}`).toBe(`${lang.code} ${key} {${name}}: true`)
      }
    }
  })

  // a built-in card's name stands in the same 12-cell room as a user's (s34); held to the language's own rule it is never cut
  test('the built-in cards\' names keep to each language\'s name rule', () => {
    const cards = ['ver', 'who', 'block', 'tools', 'ctx', '5h', '7d', 'score', 'pending', 'branch', 'dirty', 'ff', 'icons']
    for (const lang of BUILT_IN) for (const key of cards) expect(`${lang.code} ${key} ${[...(lang.strings[`card.${key}`] ?? '?????????????????????')].length <= lang.rules.nameMax}`).toBe(`${lang.code} ${key} true`)
  })

  // the owner s35 「好，日文上限 5 個字」 (katakana words: バージョン, モジュール); five without gaps about 96 px in the 112 px room by s34's
  // 15.1 px a character and 20.5 px a button (kana not yet measured)
  test('日本語\'s name rule: five characters', async ($, on) => {
    const w = world()
    w.store = { language: 'ja' }
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    const tryName = async (name: string) => {
      await ui.press({ key: 'add-card' })
      const pane = await addPane($)
      await pane.input({ key: 'add-name', text: name, kind: 'change' })
      await pane.input({ key: 'add-text', text: 'x', kind: 'change' })
      await pane.press({ key: 'add-ok' })
      const error = (await pane.findAll({ type: 'Text' })).map(t => String(t.text ?? '')).find(t => /最大|at most/.test(t))
      await pane.unmount()
      return error
    }
    expect(await tryName('一二三四五六')).toBe('名前は最大 5 文字です。今は 6 文字です')
    expect(await tryName('一二三四五')).toBeUndefined()
  })

  test('host.usage in English writes its swap with plain brackets', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [
      { id: 'c1', kind: 'module', name: 'Usage', text: 'host.usage', prefix: '', section: 'above', size: 'H3' },
    ] } }
    w.files['/proc/meminfo'] = 'MemTotal: 1048576 kB\nMemAvailable: 524288 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n'
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    const lines = walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))
    expect(lines).toContain('swap 50% (0.5 / 1.0 GiB)')
  })
})

// s35 (the owner 「我剛剛把H2~H3-Full 的卡片都刪掉了，你建立符合那些格子會使用的範例卡片給我，H3 以上的可以畫一些圖表或是做成漂亮一點的介面給我看嗎」):
// a chart module draws its picture in an H3, H3-half or H3-full tile; an H2 tile and the terminal keep its lines. /ss examples puts example
// cards in the six display blocks (a store written by hand under a running mod is written over: s31), and turns those blocks on.
describe('charts and examples', () => {
  type Card = { id: string; kind: string; name: string; text: string; size?: string }
  const ABOVE = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const module = (id: string, text: string, size: string) => ({ id, kind: 'module', name: id, text, prefix: '', section: 'above', size })
  const frameIn = async (band: { find: (q: object) => Promise<unknown> }, id: string) =>
    walk(((await band.find({ type: 'Box', key: `band-frame-${id}` })) as El | undefined)?.children)
  // s39, the owner's 6.png (a picture's markup 206 CSS px drawn 354 screenshot px: 1.72 a CSS px): a cell 7.94 CSS px (an H3 frame 396 px over
  // 29 cells), a row 18.84 (an H2 frame 81 px, 2.5 rows) to 19.07 (an H3 frame 246 px, 7.5 rows). A picture fills its frame when its markup
  // is no narrower than the frame (the desktop draws a wider one down to it, its height in proportion) and, so drawn, no taller than the
  // frame at its shortest and no shorter than 97% of it at its tallest.
  const fills = (size: string | undefined, cells: number, rows: number) => {
    const [w, h] = String(size).split(' x ').map(Number) as [number, number]
    const drawnH = (h * Math.min(1, (cells * 7.94) / w))
    return [w >= cells * 7.94, drawnH <= rows * 18.84 && drawnH >= 0.97 * rows * 19.07]
  }

  test('a chart in an H3 tile is its picture, no size of its own given (its markup\'s width up to the tile), its lines the alt; in an H2 tile its first line', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2', 'c3'], cards: [
      module('c1', 'session.gauges', 'H3'), module('c2', 'session.gauges', 'H2'), module('c3', 'session.journal', 'H3'),
    ] } }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    const svg = (await frameIn(band, 'c1')).find(el => el.type === 'Svg')
    expect(svg?.props['alt']).toBe('目前剩下 50% · 五小時 23% · 每週 8%')
    expect(svg?.props['width']).toBeUndefined()
    expect(svg?.props['height']).toBeUndefined()
    // the H3 tile is (119 - 2 gaps) / 3 = 39 cells; the markup is narrower than 39 cells of 8.1 px and wider than half of them
    const width = Number(/width="(\d+)"/.exec(drawingOf(String(svg?.props['source'])))?.[1])
    expect(width).toBeLessThan(39 * 8.1)
    expect(width).toBeGreaterThan(39 * 4)
    const h2 = await frameIn(band, 'c2')
    expect(h2.find(el => el.type === 'Svg')).toBeUndefined()
    expect(h2.filter(el => el.type === 'Text').map(el => String(el.children?.[0]))).toEqual(['目前剩下 50%'])
    // a module with no chart keeps its lines in an H3 tile
    expect((await frameIn(band, 'c3')).find(el => el.type === 'Svg')).toBeUndefined()

    const terminal = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'AbovePrompt', props: ABOVE })
    const lines = await frameIn(terminal, 'c1')
    expect(lines.find(el => el.type === 'Svg')).toBeUndefined()
    expect(lines.filter(el => el.type === 'Text').map(el => String(el.children?.[0]))).toEqual(['目前剩下 50%', '五小時 23%', '每週 8%'])
  })

  // s39 (the owner 「showinfo 系列的小卡…做成小圖表圓形或成小方條」, then B on the mock): on the desktop a module that draws a tile is a small
  // picture in an H2, H2-half or H2-full tile, in the room chartBox gives 3 rows; one that draws none keeps its first line; VS Code, the phone
  // and the terminal keep the first line (「不改：手機和終端機」)
  test('on the desktop an H2 tile of a module that draws one is its picture, its lines the alt; elsewhere its first line', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2', 'c3', 'c4'], cards: [
      module('c1', 'session.ctx', 'H2'), module('c2', 'host.load', 'H2-half'), module('c3', 'session.gauges', 'H2'), module('c4', 'session.git', 'H2-full'),
    ] } }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    const sizeOf = async (id: string) => {
      const svg = (await frameIn(band, id)).find(el => el.type === 'Svg')
      return /width="(\d+)" height="(\d+)"/.exec(drawingOf(String(svg?.props['source'])))?.slice(1).join(' x ')
    }
    // 119 columns less the head cell the band keeps with no button too: an H2 tile (118 - 4 gaps) / 5 = 22 cells, H2-half (118 - 1) / 2 = 58,
    // H2-full 118; the picture fills its frame, 2.5 rows (s39 below: 「有內容之後 色塊要填滿細線方框的size」)
    expect(fills(await sizeOf('c1'), 22, 2.5)).toEqual([true, true])
    expect(fills(await sizeOf('c2'), 58, 2.5)).toEqual([true, true])
    expect(fills(await sizeOf('c4'), 118, 2.5)).toEqual([true, true])
    const c1 = (await frameIn(band, 'c1')).find(el => el.type === 'Svg')
    expect(String(c1?.props['alt']).startsWith('目前剩下 50%')).toBe(true)
    expect(c1?.props['width']).toBeUndefined()
    expect((await frameIn(band, 'c1')).filter(el => el.type === 'Text')).toEqual([])
    const c3 = await frameIn(band, 'c3')
    expect(c3.find(el => el.type === 'Svg')).toBeUndefined()
    expect(c3.filter(el => el.type === 'Text').map(el => String(el.children?.[0]))).toEqual(['目前剩下 50%'])

    for (const surface of ['vscode', 'mobile', 'terminal'] as const) {
      const other = await $.ui.mount({ plugin: 'superstatus', surface, component: 'AbovePrompt', props: ABOVE })
      const frame = await frameIn(other, 'c1')
      expect([surface, frame.find(el => el.type === 'Svg')]).toEqual([surface, undefined])
      expect([surface, frame.filter(el => el.type === 'Text').map(el => String(el.children?.[0]))]).toEqual([surface, ['目前剩下 50%']])
      await other.unmount()
    }
  })

  // s39 (the owner's 6.png 「方匡內跟底色塊為什麼有間距?」, then 「平常的時候（無卡片/無文字/無圖表/只有文字）有細線方框可以顯示卡片位置 / 有內容之後
  // 色塊要填滿細線方框的size」「對，照這樣做，先寫測試」): a tile showing a picture draws no dashed line and its picture takes the frame's
  // whole size; a tile of words keeps the dashed frame; an empty place in a row is a dashed frame of the same size, holding nothing.
  test('a picture fills its frame with no dashed line; words keep the dashed frame; an empty place in a row is a dashed frame', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2', 'c3', 'c4'], cards: [
      module('c1', 'session.gauges', 'H3'), module('c2', 'session.journal', 'H3'), module('c3', 'session.ctx', 'H2'),
      { id: 'c4', kind: 'text', name: '備註', text: '今天', prefix: '', section: 'above', size: 'H2' },
    ] } }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    const frameOf = async (id: string) => (await band.find({ type: 'Box', key: `band-frame-${id}` })) as El | undefined
    const markup = async (id: string) => {
      const svg = (await frameIn(band, id)).find(el => el.type === 'Svg')
      return /width="(\d+)" height="(\d+)"/.exec(drawingOf(String(svg?.props['source'])))?.slice(1).join(' x ')
    }
    // H3 (118 - 2) / 3 = 38 cells, 7.5 rows; H2 22 cells, 2.5 rows
    expect((await frameOf('c1'))?.props['borderStyle']).toBeUndefined()
    expect((await frameOf('c1'))?.props['height']).toBe(7.5)
    expect(fills(await markup('c1'), 38, 7.5)).toEqual([true, true])
    expect((await frameOf('c3'))?.props['borderStyle']).toBeUndefined()
    expect(fills(await markup('c3'), 22, 2.5)).toEqual([true, true])
    // words: the journal (no picture of its own) and a text card keep the dashed frame
    expect((await frameOf('c2'))?.props['borderStyle']).toBe('dashed')
    expect((await frameOf('c4'))?.props['borderStyle']).toBe('dashed')
    // the H3 row's third place and H2's last three are empty: each a dashed frame of the tile's size, half a row short, holding nothing
    const blanks = walk([await band.drawn()]).filter(el => el.type === 'Box' && String(el.props?.['key']).startsWith('band-blank-frame-'))
    expect(blanks.map(el => String(el.props['key']))).toEqual(['band-blank-frame-H3-0-2', 'band-blank-frame-H2-0-2', 'band-blank-frame-H2-0-3', 'band-blank-frame-H2-0-4'])
    expect(blanks.map(el => [el.props['borderStyle'], el.props['height'], (el.children ?? []).length])).toEqual([
      ['dashed', 7.5, 0], ['dashed', 2.5, 0], ['dashed', 2.5, 0], ['dashed', 2.5, 0],
    ])
    const h3Blank = (await band.find({ type: 'Box', key: 'band-blank-H3-0-2' })) as El | undefined
    expect([h3Blank?.props['width'], h3Blank?.props['height']]).toEqual([38, 8])

    // the terminal draws no picture: the gauges keep their lines in the dashed frame
    const terminal = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'AbovePrompt', props: ABOVE })
    expect(((await terminal.find({ type: 'Box', key: 'band-frame-c1' })) as El | undefined)?.props['borderStyle']).toBe('dashed')
    await terminal.unmount()
  })

  test('the timeline reads every event of the newest journal', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [module('c1', 'session.timeline', 'H3-full')] } }
    w.files['/w/.claude/journal_2026-10-09_alex-s27.md'] = ['0 WHO — Alex', '1 ADD — x', '2 LAUNCH — y', 'a note that is not an event', '3 PASS — z', ''].join('\n')
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    const source = drawingOf(String((await frameIn(band, 'c1')).find(el => el.type === 'Svg')?.props['source']))
    expect([...source.matchAll(/data-event="([^"]+)"/g)].map(m => m[1])).toEqual(['0 WHO', '1 ADD', '2 LAUNCH', '3 PASS'])
  })

  test('/ss examples puts example cards in the six display blocks and turns those blocks on; a second time adds none', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], aboveOff: ['chart', 'info', 'chart-full', 'touch'], cards: [
      { id: 'c1', kind: 'button', name: '設定SS', text: '/ss', prefix: '', section: 'above' },
    ] } }
    engine(on, w)
    await start($)

    expect((await sl($, 'examples')).text).toBe('加入 14 張範例卡片，六個顯示區塊已打開')
    const st = w.store['settings'] as { cards: Card[]; aboveOrder: string[]; aboveOff: string[] }
    expect(st.cards.filter(c => c.kind === 'module').map(c => `${c.size} ${c.text} ${c.name}`)).toEqual([
      'H2 session.ctx 目前剩下', 'H2 session.5h 五小時', 'H2 session.7d 每週', 'H2 session.git 分支', 'H2 session.score 分數',
      'H2-half host.overview 主機', 'H2-half host.load 負載', 'H2-full session.journal 日誌',
      'H3 session.gauges 額度儀表', 'H3 host.resources 主機資源', 'H3 session.scorecard 分數卡',
      'H3-half session.commits 提交活動', 'H3-half host.diskchart 磁碟圖', 'H3-full session.timeline 時間軸',
    ])
    expect(st.aboveOrder).toEqual(['c1', ...Array.from({ length: 14 }, (_, k) => `c${k + 2}`)])
    expect(st.aboveOff).toEqual(['touch'])
    expect((await sl($, 'examples')).text).toBe('加入 0 張範例卡片，六個顯示區塊已打開')
    expect((w.store['settings'] as { cards: Card[] }).cards.length).toBe(15)
  })
})

// Profiles (the owner 2026-10-12 s36 「我要做個Profile 存檔跟載入的機制 要直接在Pane 可以匯入匯出」, the design left to Claude, then 「go」): a
// Profile button in the panel's first row opens the Profile pane. A profile is one .json file in the folder
// <CLAUDE_CONFIG_DIR or ~/.claude>/superstatus/profiles of the machine the session runs on: 存檔 writes the whole look under a name (an
// existing name asks again), the list shows each file (name, cards, when), 載入 first lists the cards that run things and asks again,
// then saves the look before it as 載入前 and takes the profile's look and language; 刪除 asks again; the file is the export, a file put
// in the folder and 重新整理 the import (the kit has no upload, download or clipboard to a remote surface).
describe('profiles', () => {
  const CONFIG_DIR = ['sh', '-c', 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"'].join(' ')
  const DIR = '/home/k/.claude/superstatus/profiles'
  // 2026-10-12 17:40 in Taiwan
  const AT = Date.UTC(2026, 9, 12, 9, 40)
  const PROFILE_PANE = { title: 'Profile', isFocused: false, bodyColumns: 60, placement: 'dock' } as never
  const MINE = { off: [], note: '', icons: false, order: [...DEFAULT_ORDER, 'c1'], cards: [{ id: 'c1', kind: 'text', name: '下一步', text: '等回覆', prefix: '' }] }
  const THEIRS = {
    off: [], note: '', icons: false, order: [...DEFAULT_ORDER, 'c1'], aboveOrder: ['c2', 'c3'],
    cards: [
      { id: 'c1', kind: 'text', name: 'Next', text: 'wait', prefix: '' },
      { id: 'c2', kind: 'command', name: '負載', text: 'uptime', prefix: '', section: 'above', size: 'H2' },
      { id: 'c3', kind: 'button', name: '快照', text: '!vzdump 100', prefix: '', section: 'above' },
    ],
  }
  const profileText = (name: string, settings: unknown, language = 'zh-TW', format = 1) =>
    `${JSON.stringify({ kind: 'superstatus-profile', format, name, savedAt: '2026-10-11T01:00:00.000Z', version: '0.3', language, settings }, null, 2)}\n`
  const profileWorld = () => {
    const w = world()
    w.store = { language: 'zh-TW', settings: MINE }
    w.git[CONFIG_DIR] = { exitCode: 0, stdout: '/home/k/.claude' }
    w.now = AT
    return w
  }
  const put = (w: World, name: string, text: string) => {
    w.files[`${DIR}/${name}`] = text
    w.dirs = { ...(w.dirs ?? {}), [DIR]: [...(w.dirs?.[DIR] ?? []), file(name, 1)] }
  }
  async function profilePane($: Engine) {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'profile' })
    return $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', props: PROFILE_PANE, requestId: 'ss-profile' })
  }
  const texts = async (pane: { findAll: (q: object) => Promise<{ text?: string }[]> }) => (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '')

  test('a Profile button in the panel\'s first row, before 重新載入, opens the Profile pane, which names its folder', async ($, on) => {
    const w = profileWorld()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    // the first row's buttons, in the order drawn (after the language list; s37 Claude Design step 1: the width switch in 新增語言's place)
    const row = ['panel-layout', 'profile', 'panel-reload']
    expect((await ui.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => row.includes(k))).toEqual(row)
    expect(bare((await ui.find({ type: 'Button', key: 'profile' }))?.text)).toBe('Profile')

    const pane = await profilePane($)
    expect(w.opened).toContain('ss-profile')
    // on the desktop the folder's path is in a field (Claude Design step 6, s38)
    expect((await pane.find({ type: 'Input', key: 'profile-dir' }))?.props['value']).toBe(DIR)
    // the design's line since Claude Design step 8 (s38)
    expect((await texts(pane)).some(t => t.startsWith('還沒有存檔'))).toBe(true)
    expect(await pane.find({ type: 'Input', key: 'profile-name' })).toBeDefined()
    expect(bare((await pane.find({ type: 'Button', key: 'profile-save' }))?.text)).toBe('存檔')
    expect(bare((await pane.find({ type: 'Button', key: 'profile-refresh' }))?.text)).toBe('重新整理')
  })

  test('存檔 writes the whole look and the language under the name typed, in the folder, and lists it', async ($, on) => {
    const w = profileWorld()
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.input({ key: 'profile-name', text: '工作', kind: 'change' })
    await pane.press({ key: 'profile-save' })

    expect(w.written).toEqual([`${DIR}/工作.json`])
    const saved = JSON.parse(w.files[`${DIR}/工作.json`] ?? '{}') as { kind: string; format: number; name: string; savedAt: string; version: string; language: string; settings: { cards: unknown[]; order: string[]; off: string[] } }
    expect([saved.kind, saved.format, saved.name, saved.savedAt, saved.version, saved.language]).toEqual(['superstatus-profile', 1, '工作', '2026-10-12T09:40:00.000Z', '0.85', 'zh-TW'])
    expect(saved.settings.cards).toEqual(MINE.cards)
    expect(saved.settings.order).toEqual(MINE.order)
    expect(saved.settings.off).toEqual([])
    const shown = await texts(pane)
    expect(shown).toContain('工作')
    // 13 built-in cards and one added
    expect(shown).toContain('14 張卡片 · 10-12 17:40')
    expect(shown).toContain(`已存：${DIR}/工作.json`)
  })

  test('存檔 needs a name of at most 30 characters that a file can carry; otherwise nothing is written and the pane says why', async ($, on) => {
    const w = profileWorld()
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.press({ key: 'profile-save' })
    expect(await texts(pane)).toContain('先打 Profile 名稱，再按存檔')
    await pane.input({ key: 'profile-name', text: 'a/b', kind: 'change' })
    await pane.press({ key: 'profile-save' })
    expect((await texts(pane)).some(t => t.startsWith('名稱不能有'))).toBe(true)
    await pane.input({ key: 'profile-name', text: 'x'.repeat(31), kind: 'change' })
    await pane.press({ key: 'profile-save' })
    expect(await texts(pane)).toContain('名稱最多 30 個字（現在 31 個）')
    expect(w.written ?? []).toEqual([])
  })

  test('存檔 under a name already saved asks again; the second press writes over it', async ($, on) => {
    const w = profileWorld()
    put(w, '工作.json', profileText('工作', THEIRS))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.input({ key: 'profile-name', text: '工作', kind: 'change' })
    await pane.press({ key: 'profile-save' })
    expect(bare((await pane.find({ type: 'Button', key: 'profile-save' }))?.text)).toBe('確定覆蓋')
    expect(w.written ?? []).toEqual([])

    await pane.press({ key: 'profile-save' })
    expect(w.written).toEqual([`${DIR}/工作.json`])
    expect((JSON.parse(w.files[`${DIR}/工作.json`] ?? '{}') as { settings: { cards: unknown[] } }).settings.cards).toEqual(MINE.cards)
    expect(bare((await pane.find({ type: 'Button', key: 'profile-save' }))?.text)).toBe('存檔')
  })

  test('the list: each good file by name with its cards and time; a refused file with why; other files passed over', async ($, on) => {
    const w = profileWorld()
    put(w, '工作.json', profileText('工作', THEIRS))
    put(w, '壞.json', '{ not json')
    put(w, '新.json', profileText('新', THEIRS, 'zh-TW', 2))
    put(w, 'readme.txt', 'x')
    engine(on, w)
    await start($)

    const shown = await texts(await profilePane($))
    expect(shown).toContain('工作')
    // 13 built-in cards and three added; saved 2026-10-11 01:00 UTC
    expect(shown).toContain('16 張卡片 · 10-11 09:00')
    expect(shown).toContain('壞.json：讀不進來（不是 JSON）')
    expect(shown).toContain('新.json：讀不進來（格式 2，這版 superstatus 讀格式 1：請更新 superstatus）')
    expect(shown.some(t => t.includes('readme'))).toBe(false)
  })

  test('載入 first lists the cards in the profile that run things and asks again; nothing changes yet', async ($, on) => {
    const w = profileWorld()
    put(w, '工作.json', profileText('工作', THEIRS))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.press({ key: 'profile-load-0' })
    // the question has its own button on the desktop (Claude Design step 6, s38)
    expect(bare((await pane.find({ type: 'Button', key: 'profile-yes-load' }))?.text)).toBe('確定載入')
    const shown = await texts(pane)
    expect(shown).toContain('這個 Profile 裡會執行東西的卡片：')
    // on the desktop a card a row in three columns: its kind, its name, what it runs (Claude Design step 6, s38)
    expect(shown.filter(t => ['指令卡', '負載', 'uptime', '按鈕卡', '快照', '!vzdump 100'].includes(t))).toEqual(['指令卡', '負載', 'uptime', '按鈕卡', '快照', '!vzdump 100'])
    expect(w.store['settings']).toEqual(MINE)
    expect(w.written ?? []).toEqual([])
  })

  test('the second press saves the look before it as before-load (載入前 until s38: the decided name of the design), then takes the profile\'s look and language', async ($, on) => {
    const w = profileWorld()
    put(w, '工作.json', profileText('工作', THEIRS, 'en'))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.press({ key: 'profile-load-0' })
    await pane.press({ key: 'profile-load-0' })

    expect(w.written).toEqual([`${DIR}/before-load.json`])
    const before = JSON.parse(w.files[`${DIR}/before-load.json`] ?? '{}') as { name: string; language: string; settings: { cards: unknown[] } }
    expect([before.name, before.language]).toEqual(['before-load', 'zh-TW'])
    expect(before.settings.cards).toEqual(MINE.cards)
    const st = w.store['settings'] as { cards: unknown[]; order: string[]; aboveOrder: string[] }
    expect(st.cards).toEqual(THEIRS.cards)
    expect(st.order).toEqual(THEIRS.order)
    expect(st.aboveOrder).toEqual(THEIRS.aboveOrder)
    expect(w.store['language']).toBe('en')
    expect(last(w)).toContain('Next wait')
    expect(last(w)).not.toContain('下一步')
    expect((await texts(pane)).some(t => t.startsWith('Loaded 工作'))).toBe(true)
  })

  test('a load stops when the look before it cannot be saved: nothing is taken and the pane says why', async ($, on) => {
    const w = profileWorld()
    put(w, '工作.json', profileText('工作', THEIRS, 'en'))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    w.writeError = 'disk full'
    await pane.press({ key: 'profile-load-0' })
    await pane.press({ key: 'profile-load-0' })

    expect(w.store['settings']).toEqual(MINE)
    expect(w.store['language']).toBe('zh-TW')
    expect((await texts(pane)).some(t => t.startsWith('沒有存檔（') && t.includes('disk full'))).toBe(true)
  })

  test('a profile with no card that runs anything still takes two presses, and says it holds none', async ($, on) => {
    const w = profileWorld()
    put(w, '家.json', profileText('家', MINE))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.press({ key: 'profile-load-0' })
    expect(await texts(pane)).toContain('這個 Profile 裡沒有會執行東西的卡片')
    // the question has its own button on the desktop (Claude Design step 6, s38)
    expect(bare((await pane.find({ type: 'Button', key: 'profile-yes-load' }))?.text)).toBe('確定載入')
  })

  test('刪除 asks again; the second press removes the file and its row', async ($, on) => {
    const w = profileWorld()
    put(w, '工作.json', profileText('工作', THEIRS))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.press({ key: 'profile-delete-0' })
    expect(bare((await pane.find({ type: 'Button', key: 'profile-yes-delete' }))?.text)).toBe('確定刪除')
    expect(w.ran.some(a => a[0] === 'rm')).toBe(false)

    await pane.press({ key: 'profile-delete-0' })
    expect(w.ran).toContainEqual(['rm', '-f', '--', `${DIR}/工作.json`])
    const shown = await texts(pane)
    expect(shown).not.toContain('工作')
    expect(shown).toContain('已刪除 工作')
  })

  test('重新整理 reads the folder again: a profile file put there from another machine shows (the import)', async ($, on) => {
    const w = profileWorld()
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    expect(await texts(pane)).not.toContain('工作')
    put(w, '工作.json', profileText('工作', THEIRS))
    await pane.press({ key: 'profile-refresh' })
    expect(await texts(pane)).toContain('工作')
  })

  test('where the folder cannot be found, the pane says so and 存檔 writes nothing', async ($, on) => {
    const w = profileWorld()
    w.git[CONFIG_DIR] = 'throw'
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    expect((await texts(pane)).some(t => t.startsWith('找不到 Profile 資料夾'))).toBe(true)
    await pane.input({ key: 'profile-name', text: '工作', kind: 'change' })
    await pane.press({ key: 'profile-save' })
    expect(w.written ?? []).toEqual([])
  })

  // Claude Design's step 1 (HANDOFF 「寬版／窄版狀態存進 profile」): the width is kept with the cards, so a profile carries it
  test('a profile carries the panel\'s width: one saved narrow says so, before-load too, and a profile from before widths loads wide', async ($, on) => {
    const w = profileWorld()
    w.store = { ...w.store, settings: { ...MINE, narrow: true } }
    put(w, '寬.json', profileText('寬', MINE))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.input({ key: 'profile-name', text: '窄', kind: 'change' })
    await pane.press({ key: 'profile-save' })
    expect((JSON.parse(w.files[`${DIR}/窄.json`] ?? '{}') as { settings: { narrow?: boolean } }).settings.narrow).toBe(true)

    await pane.press({ key: 'profile-load-0' })
    await pane.press({ key: 'profile-load-0' })
    expect((JSON.parse(w.files[`${DIR}/before-load.json`] ?? '{}') as { settings: { narrow?: boolean } }).settings.narrow).toBe(true)
    expect((w.store['settings'] as { narrow?: boolean }).narrow ?? false).toBe(false)
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect((await ui.drawn()).props['width']).toBe(64)
  })

  // Claude Design step 6 (s38, the owner 「好你直接照計劃一路跑」 on the plan; the design's screen 3 and its decided list): on the desktop the Profile
  // pane stands in the panel's columns: the name field two columns wide with no label of its own, Save in the fourth, the hint under it; each
  // profile its name two columns wide, its cards and time on the line under it, Load and Delete in the third and fourth columns; Load asks in a
  // box (the cards that run things in three columns, the look saved as before-load first, Yes, load and Cancel), Delete under its row (Yes,
  // delete and Cancel); the folder's path in a field beside Refresh, the export and import lines under it. Elsewhere the pane as before.
  const EN_WORLD = () => {
    const w = profileWorld()
    w.store = { language: 'en', settings: MINE }
    return w
  }
  const widthsOf = async (pane: { find: (q: object) => Promise<unknown> }, key: string) =>
    ((((await pane.find({ type: 'Box', key })) as El | undefined)?.children ?? []) as El[]).map(c => c.props['width'])
  const textsIn = async (pane: { find: (q: object) => Promise<unknown> }, key: string) =>
    walk(((await pane.find({ type: 'Box', key })) as El | undefined)?.children).filter(el => el.type === 'Text').map(el => ((el.children ?? []) as unknown[]).join(''))

  test('on the desktop: the name field two columns wide with no label of its own, Save in the fourth column, the hint under them', async ($, on) => {
    const w = EN_WORLD()
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    expect(await widthsOf(pane, 'profile-new')).toEqual([15, 31, 15])
    expect(await textsIn(pane, 'profile-new')).toEqual(['Name'])
    expect((await pane.find({ type: 'Input', key: 'profile-name' }))?.props['label']).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: 'Up to 30 characters. A name in use asks: Yes, replace.' })).toBeDefined()
  })

  test('each profile: its name two columns wide, its cards and time on the line under it, Load and Delete in the third and fourth columns', async ($, on) => {
    const w = EN_WORLD()
    put(w, 'work.json', profileText('work', THEIRS))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    expect(await textsIn(pane, 'profile-head')).toEqual(['Profiles', '1 file'])
    expect(await widthsOf(pane, 'profile-row-0-top')).toEqual([31, 15, 15])
    expect(await textsIn(pane, 'profile-row-0-top')).toEqual(['work'])
    // the 13 built-in cards and its three
    expect(await textsIn(pane, 'profile-row-0-meta')).toEqual(['16 cards · 10-11 09:00'])
  })

  test('Load asks in a box: the cards that run things in three columns, the look saved as before-load first, Yes, load and Cancel', async ($, on) => {
    const w = EN_WORLD()
    put(w, 'work.json', profileText('work', THEIRS))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.press({ key: 'profile-load-0' })
    const box = (await pane.find({ type: 'Box', key: 'profile-confirm-0' })) as El | undefined
    expect(box?.props['borderColor']).toBe('warning')
    expect(await widthsOf(pane, 'profile-run-0-0')).toEqual([13, 15, 29])
    expect(await textsIn(pane, 'profile-run-0-0')).toEqual(['Command', '負載', 'uptime'])
    expect(await textsIn(pane, 'profile-run-0-1')).toEqual(['Button', '快照', '!vzdump 100'])
    expect(await pane.find({ type: 'Text', text: 'Your current look is saved as before-load first.' })).toBeDefined()
    expect(unpadded((await pane.find({ type: 'Button', key: 'profile-yes-load' }))?.text ?? '')).toBe('Yes, load')
    // in the third and fourth columns, as Load and Delete above (s38 5.png: pushed to the panel's edge they stood a cell right of them)
    expect(await widthsOf(pane, 'profile-confirm-0-buttons')).toEqual([15, 15, 15, 15])
    expect(await textsIn(pane, 'profile-confirm-0-buttons')).toEqual([])
    // Cancel takes the question back; nothing was written
    await pane.press({ key: 'profile-cancel' })
    expect(await pane.find({ type: 'Box', key: 'profile-confirm-0' })).toBeUndefined()
    expect(w.written ?? []).toEqual([])
    // Yes, load saves the look before it as before-load, then loads
    await pane.press({ key: 'profile-load-0' })
    await pane.press({ key: 'profile-yes-load' })
    expect(w.written).toEqual([`${DIR}/before-load.json`])
    expect((w.store['settings'] as { cards: unknown[] }).cards).toEqual(THEIRS.cards)
  })

  test('Delete asks under its row: Delete <file>? with Yes, delete and Cancel; Yes, delete removes it', async ($, on) => {
    const w = EN_WORLD()
    put(w, 'work.json', profileText('work', THEIRS))
    engine(on, w)
    await start($)

    const pane = await profilePane($)
    await pane.press({ key: 'profile-delete-0' })
    expect(await pane.find({ type: 'Text', text: 'Delete work.json?' })).toBeDefined()
    expect(unpadded((await pane.find({ type: 'Button', key: 'profile-yes-delete' }))?.text ?? '')).toBe('Yes, delete')
    // the question in the first two columns, its buttons in the third and fourth: one row as wide as the four
    expect(await widthsOf(pane, 'profile-delete-0-ask')).toEqual([31, 15, 15])
    await pane.press({ key: 'profile-cancel' })
    expect(await pane.find({ type: 'Text', text: 'Delete work.json?' })).toBeUndefined()
    await pane.press({ key: 'profile-delete-0' })
    await pane.press({ key: 'profile-yes-delete' })
    expect(w.files[`${DIR}/work.json`]).toBeUndefined()
  })

  test('the folder\'s path in a field beside Refresh, the export and import lines under it; narrow, the field\'s label above it', async ($, on) => {
    const w = EN_WORLD()
    engine(on, w)
    await start($)

    let pane = await profilePane($)
    expect(await widthsOf(pane, 'profile-folder')).toEqual([15, 31, 15])
    expect((await pane.find({ type: 'Input', key: 'profile-dir' }))?.props['value']).toBe(DIR)
    // the field shows as much of the path as its own width holds (s38 5.png): the whole path on a line under it (the owner 「好，加那行完整路徑」)
    expect(await pane.find({ type: 'Text', text: DIR })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Export: take the .json file from this folder.' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Import: put a .json file in this folder, then press Refresh.' })).toBeDefined()
    await pane.unmount()
    w.store = { language: 'en', settings: { ...MINE, narrow: true } }
    await sl($, 'reload')
    pane = await profilePane($)
    expect((await pane.find({ type: 'Box', key: 'profile-folder' }))?.props['flexDirection']).toBe('column')
  })

  test('VS Code keeps the pane as before: the field\'s own label, Load asking on the button', async ($, on) => {
    const w = EN_WORLD()
    put(w, 'work.json', profileText('work', THEIRS))
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'profile' })
    const pane = await $.ui.mount({ plugin: 'superstatus', surface: 'vscode', component: 'Pane', props: PROFILE_PANE, requestId: 'ss-profile' })
    expect((await pane.find({ type: 'Input', key: 'profile-name' }))?.props['label']).toBe('Name')
    await pane.press({ key: 'profile-load-0' })
    expect(unpadded((await pane.find({ type: 'Button', key: 'profile-load-0' }))?.text ?? '')).toBe('Yes, load')
  })
})

// 編輯 on the desktop (the owner 2026-10-12 s36: 「拖卡片換順序」, 「可以用編輯按鈕鎖定拖曳的動作嗎？按編輯才可以拖」, 「← → 箭頭 保留」,
// 「我想像之前一樣維持刪除按鈕」, then 「你先做我們再細修」; drag-lab measured on his desktop, docs/measures.md): while a section's 編輯 is on,
// the desktop draws that section's cards as a grid in a Client region (sortgrid.tsx): each card its place and name, 15 cells wide and 3 rows
// high, a cell apart, four to a row, with ← 刪除 → under it in 2 rows (6 rows a card row). A card is dragged to another place; a click on a
// card the owner added turns its name into a field (Enter keeps a name within the language's rule); ← → move it a place; 刪除 asks again
// (確定刪除). 版本號 has no 刪除, 符號 stands last and does not move. What the grid does reaches the mod as a post and is kept by change().
describe('編輯 on the desktop: the cards as a grid to drag', () => {
  const desk = ($: Engine) => $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const gridTexts = async (ui: Awaited<ReturnType<typeof desk>>, grid = 'grid-status') =>
    (await ui.findAll({ type: 'Text', in: grid })).map(t => t.text)
  // a card's top left cell in the grid: 16 cells a column, 6 rows a card row
  const at = (place: number) => ({ x: ((place - 1) % 4) * 16 + 2, y: Math.floor((place - 1) / 4) * 6 + 1 })
  const drag = async (ui: Awaited<ReturnType<typeof desk>>, from: number, to: number, grid = 'grid-status') => {
    await ui.pointer({ type: 'down', ...at(from), button: 'left', in: grid })
    await ui.pointer({ type: 'move', ...at(to), button: 'left', in: grid })
    await ui.pointer({ type: 'up', ...at(to), button: 'left', in: grid })
  }
  const click = async (ui: Awaited<ReturnType<typeof desk>>, place: number, grid = 'grid-status') => {
    await ui.pointer({ type: 'down', ...at(place), button: 'left', in: grid })
    await ui.pointer({ type: 'up', ...at(place), button: 'left', in: grid })
  }
  const MINE = { off: [], note: '', icons: false, order: [...DEFAULT_ORDER, 'c1'], cards: [{ id: 'c1', kind: 'text', name: '下一步', text: '等回覆', prefix: '' }] }

  test('no grid until 編輯 is pressed; then a grid in place of the cards: no arrows, numbers or 刪除 of the old kind; off again, the cards are back', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await desk($)
    expect(bare((await ui.find({ type: 'Button', key: 'sort' }))?.text)).toBe('編輯')
    expect(await ui.find({ type: 'Client', key: 'grid-status' })).toBeUndefined()
    await ui.press({ key: 'sort' })
    const grid = await ui.find({ type: 'Client', key: 'grid-status' })
    // the engine reports the module by its path under the plugin's folder
    expect(grid?.props['module']).toBe('hooks/sortgrid.tsx')
    expect(await ui.find({ type: 'Button', key: 'left-who' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'delete-who' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'toggle-who' })).toBeUndefined()
    await ui.press({ key: 'sort' })
    expect(await ui.find({ type: 'Client', key: 'grid-status' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'toggle-who' })).toBeDefined()
  })

  test('the grid: each card its place and name in the order, 符號 last with no place; ← → under all but 符號, 刪除 under all but 版本號', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    const texts = await gridTexts(ui)
    // the names the panel's name buttons carry (NAME_OF; 版本號 is not in it)
    // 固定 under 版本號 since Claude Design step 7 (s38) is not a name
    expect(texts.filter(t => t !== '固定').slice(0, 13)).toEqual([...DEFAULT_ORDER.map((k, i) => `${i + 1} ${k === 'ver' ? '版本號' : NAME_OF[k]}`), '符號'])
    const keys = (await ui.findAll({ type: 'Button', in: 'grid-status' })).map(b => String(b.key))
    expect(keys.filter(k => k.endsWith('-ver'))).toEqual([])
    expect(keys.filter(k => k.endsWith('-who'))).toEqual(['grid-left-who', 'grid-delete-who', 'grid-right-who'])
    expect(keys.filter(k => k.endsWith('-icons'))).toEqual(['grid-delete-icons'])
    expect(bare((await ui.find({ type: 'Button', key: 'grid-delete-who', in: 'grid-status' }))?.text)).toBe('刪除')
    // the ends cannot move further: dim
    expect((await ui.find({ type: 'Button', key: 'grid-left-who', in: 'grid-status' }))?.props['dimColor']).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'grid-right-ff', in: 'grid-status' }))?.props['dimColor']).toBe(true)
  })

  test('→ under 操作者 swaps it with 進度: the store, the status line and the grid follow', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'grid-right-who' })
    expect((w.store['settings'] as { order: string[] }).order.slice(0, 3)).toEqual(['ver', 'block', 'who'])
    expect(last(w)).toBe('v.0.85  進度 5  Alex  目前剩下 50%  五小時 23%  每週 8%  ✓ 已快轉')
    expect((await gridTexts(ui)).filter(t => t !== '固定').slice(0, 3)).toEqual(['1 版本號', '2 進度', '3 操作者'])
  })

  test('← under 進度 moves it before 操作者; ← on the first card does nothing', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'grid-left-block' })
    expect((w.store['settings'] as { order: string[] }).order.slice(0, 3)).toEqual(['ver', 'block', 'who'])
    // the first card that moves is the one after 版本號 (fixed first, Claude Design step 7, s38)
    await ui.press({ key: 'grid-left-block' })
    expect((w.store['settings'] as { order: string[] }).order.slice(0, 3)).toEqual(['ver', 'block', 'who'])
  })

  test('a card dragged away and back, let go on itself, is a drag, not a click: no field opens and the order stays', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: MINE }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    await ui.pointer({ type: 'down', ...at(13), button: 'left', in: 'grid-status' })
    await ui.pointer({ type: 'move', ...at(12), button: 'left', in: 'grid-status' })
    await ui.pointer({ type: 'move', ...at(13), button: 'left', in: 'grid-status' })
    await ui.pointer({ type: 'up', ...at(13), button: 'left', in: 'grid-status' })
    expect(await ui.find({ type: 'Input', key: 'grid-rename', in: 'grid-status' })).toBeUndefined()
    expect((w.store['settings'] as { order: string[] }).order).toEqual(MINE.order)
  })

  test('a card dragged from place 2 and let go over place 4 lands there; a card dragged onto 符號 goes last before it', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    await drag(ui, 2, 4)
    expect((w.store['settings'] as { order: string[] }).order.slice(0, 5)).toEqual(['ver', 'block', 'tools', 'who', 'ctx'])
    expect((await gridTexts(ui)).filter(t => t !== '固定').slice(0, 4)).toEqual(['1 版本號', '2 進度', '3 工具次數', '4 操作者'])
    // 版本號 is fixed first since Claude Design step 7 (s38): dragged to the end, it stays
    await drag(ui, 1, 13)
    expect((w.store['settings'] as { order: string[] }).order[0]).toBe('ver')
  })

  test('刪除 asks again (確定刪除); the second press takes a built-in card off; an added card goes for good', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: MINE }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'grid-delete-who' })
    expect(bare((await ui.find({ type: 'Button', key: 'grid-delete-who', in: 'grid-status' }))?.text)).toBe('確定刪除')
    expect((w.store['settings'] as { removed?: string[] }).removed ?? []).toEqual([])
    await ui.press({ key: 'grid-delete-who' })
    expect((w.store['settings'] as { removed: string[] }).removed).toEqual(['who'])
    await ui.press({ key: 'grid-delete-c1' })
    await ui.press({ key: 'grid-delete-c1' })
    const st = w.store['settings'] as { cards: unknown[]; order: string[] }
    expect(st.cards).toEqual([])
    expect(st.order).not.toContain('c1')
    expect((await gridTexts(ui)).some(t => t.endsWith('操作者') || t.endsWith('下一步'))).toBe(false)
  })

  test('a click on a card Alex added turns its name into a field; Enter keeps a name within the rule; a built-in card is not renamed', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: MINE }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    // 下一步 is place 13 (after the twelve), 符號 after it
    await click(ui, 13)
    expect((await ui.find({ type: 'Input', key: 'grid-rename', in: 'grid-status' }))?.props['value']).toBe('下一步')
    await ui.input({ key: 'grid-rename', text: '一二三四五' })
    expect(await gridTexts(ui)).toContain('名稱最多四個字，現在是 5 個字')
    expect((w.store['settings'] as { cards: { name: string }[] }).cards[0]?.name).toBe('下一步')
    await ui.input({ key: 'grid-rename', text: '回覆' })
    expect((w.store['settings'] as { cards: { name: string }[] }).cards[0]?.name).toBe('回覆')
    expect(last(w)?.endsWith('回覆 等回覆')).toBe(true)
    expect(await gridTexts(ui)).toContain('13 回覆')

    await click(ui, 2)
    expect(await ui.find({ type: 'Input', key: 'grid-rename', in: 'grid-status' })).toBeUndefined()
    expect(await gridTexts(ui)).toContain('內建卡片的名稱跟著語言，不能改名')
  })

  test('the mod keeps only what a grid may do: a move of a card from another section, or a rename of a built-in card, changes nothing', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: MINE }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    const before = JSON.stringify(w.store['settings'])
    await ui.post({ move: { key: 'c9', to: 0 } }, { in: 'grid-status' })
    await ui.post({ rename: { key: 'who', name: '我' } }, { in: 'grid-status' })
    await ui.post({ rename: { key: 'c1', name: '太長的名字' } }, { in: 'grid-status' })
    await ui.post({ remove: 'ver' }, { in: 'grid-status' })
    expect(JSON.stringify(w.store['settings'])).toBe(before)
  })

  // Claude Design step 7 (s38; its decided list: 「編輯時 Version 固定在第一個，不能移也不能刪」): 版本號 stands first in the grid, the word
  // 固定 under it in place of ← 刪除 →; no drag, arrow or post moves it or puts a card before it; a hint over the grid says what a drag and
  // a click do
  test('版本號 stands first and fixed: 固定 under it, no ← → or 刪除; ← on the card after it is dim and does nothing; a hint over the grid', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    const keys = (await ui.findAll({ type: 'Button', in: 'grid-status' })).map(b => String(b.key))
    expect(keys.filter(k => k.endsWith('-ver'))).toEqual([])
    expect(await gridTexts(ui)).toContain('固定')
    expect((await gridTexts(ui)).slice(0, 2)).toEqual(['1 版本號', '固定'])
    expect((await ui.find({ type: 'Button', key: 'grid-left-who', in: 'grid-status' }))?.props['dimColor']).toBe(true)
    await ui.press({ key: 'grid-left-who', in: 'grid-status' })
    expect((w.store['settings'] as { order: string[] } | undefined)?.order?.[0] ?? 'ver').toBe('ver')
    expect(await ui.find({ type: 'Text', text: '拖曳卡片換位置；點你自己加的卡片可以改名。' })).toBeDefined()
  })

  test('an order kept with 版本號 elsewhere (the phone\'s arrows still move it) is drawn with 版本號 first', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: ['who', 'block', 'ver', ...DEFAULT_ORDER.slice(3)], cards: [] } }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    expect((await gridTexts(ui)).slice(0, 4)).toEqual(['1 版本號', '固定', '2 操作者', '3 進度'])
  })

  test('a drag does not move 版本號; a card let go over it lands second; a post that would move it, or put a card before it, keeps it first', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await desk($)
    await ui.press({ key: 'sort' })
    const order = () => (w.store['settings'] as { order: string[] } | undefined)?.order ?? DEFAULT_ORDER
    await drag(ui, 1, 5)
    expect(order()).toEqual(DEFAULT_ORDER)
    // held over another place, the grid draws the cards so, 版本號 still first
    await ui.pointer({ type: 'down', ...at(3), button: 'left', in: 'grid-status' })
    await ui.pointer({ type: 'move', ...at(2), button: 'left', in: 'grid-status' })
    expect((await gridTexts(ui)).filter(t => t !== '固定').slice(0, 3)).toEqual(['1 版本號', '2 進度', '3 操作者'])
    await ui.pointer({ type: 'up', ...at(2), button: 'left', in: 'grid-status' })
    await drag(ui, 4, 1)
    expect(order().slice(0, 4)).toEqual(['ver', 'tools', 'block', 'who'])
    await ui.post({ move: { key: 'ver', to: 3 } }, { in: 'grid-status' })
    expect(order()[0]).toBe('ver')
    await ui.post({ move: { key: 'ctx', to: 0 } }, { in: 'grid-status' })
    expect(order().slice(0, 2)).toEqual(['ver', 'ctx'])
  })

  test('TouchBar\'s 編輯 draws its own grid; a drag there moves its cards among themselves, the other AbovePrompt cards keep their places', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c3', 'c2'], cards: [
      { id: 'c1', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
      { id: 'c2', kind: 'button', name: '存檔', text: '--S', prefix: '', section: 'above' },
      { id: 'c3', kind: 'text', name: '下一步', text: '等', prefix: '', section: 'above', size: 'H2' },
    ] } }
    engine(on, w)
    await start($)

    const ui = await desk($)
    expect(await ui.find({ type: 'Client', key: 'grid-H1' })).toBeUndefined()
    await ui.press({ key: 'touch-sort' })
    expect(await ui.find({ type: 'Client', key: 'grid-H1' })).toBeDefined()
    expect(await ui.find({ type: 'Client', key: 'grid-status' })).toBeUndefined()
    expect((await gridTexts(ui, 'grid-H1')).slice(0, 2)).toEqual(['1 說明', '2 存檔'])
    await drag(ui, 2, 1, 'grid-H1')
    expect((w.store['settings'] as { aboveOrder: string[] }).aboveOrder).toEqual(['c2', 'c3', 'c1'])
  })
})

// Claude Design's pane design, step 1 (docs/design/pane-mocks-1013, HANDOFF step 1 「根 Box 寫死寬度…頂列放進根 Box 裡；頂列改成 [語言 Select
// （最後一項 Add language…）][Narrow view/Wide view][Profile][Reload]，寬版／窄版狀態存進 profile」; the owner 2026-10-13 s37 「OK，用 64／32 開始做第
// 1 步」: a card measures 15.2 cells, so four and three gaps need 64, two and one 32): on the desktop the panel is 64 cells wide, four cards to
// a row, or 32 narrow, two to a row; its first row is inside it, from the left, a column of 15 cells each a cell apart: the language list
// (no label; its last option, Add language…, reads the folder and keeps the language in use), the switch named after the width it turns to,
// Profile, Reload; narrow, two by two. The width is kept with the cards. The phone, VS Code and the terminal draw as before.
describe('the panel\'s width and first row on the desktop (Claude Design step 1)', () => {
  const LANG_DIR = `${CWD}/.claude/superstatus/lang`
  const entry = (name: string): Entry => ({ name, kind: 'file', size: 10, mtimeMs: 1, isLink: false })
  const panelOn = ($: Engine, surface: (typeof FOUR)[number] = 'desktop') =>
    $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
  type Panel = Awaited<ReturnType<typeof panelOn>>
  const width = async (ui: Panel) => (await ui.drawn()).props['width']
  const textOf = async (ui: Panel, key: string) => bare((await ui.find({ type: 'Button', key }))?.text)
  // the first row as drawn: its rows, each a list of columns (the column's width, the key of what it holds)
  const firstRow = async (ui: Panel) =>
    (((await ui.find({ type: 'Box', key: 'panel-tools' })) as El | undefined)?.children as El[] | undefined ?? []).map(r => ({
      gap: r.props['gap'],
      columns: ((r.children ?? []) as El[]).map(c => `${String(c.props['width'])} ${String(((c.children ?? []) as El[])[0]?.props['key'])}`),
    }))
  const cardsIn = async (ui: Panel, key: string) => (((await ui.find({ type: 'Box', key })) as El | undefined)?.children ?? []).length
  const languageList = async (ui: Panel) => (await ui.find({ type: 'Select', key: 'language' })) as { props: Record<string, unknown> } | undefined

  test('wide, the panel is 64 cells; the first row heads it, from the left: the language list with no label, Narrow view, Profile, Reload, a column of 15 cells each, a cell apart', async ($, on) => {
    const w = world()
    w.store = {}
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(await width(ui)).toBe(64)
    expect(String(((await ui.drawn()).children as El[])[0]?.props['key'])).toBe('panel-tools')
    expect(await firstRow(ui)).toEqual([{ gap: 1, columns: ['15 language', '15 panel-layout', '15 profile', '15 panel-reload'] }])
    expect((await languageList(ui))?.props['label']).toBeUndefined()
    expect(await textOf(ui, 'panel-layout')).toBe('Narrow view')
    expect(await ui.find({ type: 'Button', key: 'add-language' })).toBeUndefined()
    expect(await cardsIn(ui, 'row-0')).toBe(4)
  })

  // s39 (the owner's 9.png 「窄版的三個按鈕可以改到下方Profile 那行三個按鈕並排嗎」, then 「窄版三顆按鈕用乙（照字寬、左右撐開），先寫測試」 on two
  // mocks): narrow, the language list stands alone in its column, then Wide view, Profile and Reload on one row at their own widths (no
  // padding), the first at the left edge and the last at the right; whole in the three languages (再読み込み would be cut in a third)
  for (const [language, labels] of [['en', ['Wide view', 'Profile', 'Reload']], ['zh-TW', ['寬版', 'Profile', '重新載入']], ['ja', ['広い表示', 'Profile', '再読み込み']]] as const) {
    test(`narrow, the language list alone, then the three buttons at their own widths, spread edge to edge (${language})`, async ($, on) => {
      const w = world()
      w.store = { language }
      engine(on, w)
      await start($)

      const ui = await panelOn($)
      await ui.press({ key: 'panel-layout' })
      expect(await width(ui)).toBe(32)
      const rows = (((await ui.find({ type: 'Box', key: 'panel-tools' })) as El | undefined)?.children ?? []) as El[]
      expect(rows.map(r => String(r.props['key']))).toEqual(['panel-tools-0', 'panel-tools-buttons'])
      expect((await firstRow(ui))[0]).toEqual({ gap: 1, columns: ['15 language'] })
      const row = rows[1] as El
      expect([row.props['width'], row.props['flexDirection'], row.props['justifyContent']]).toEqual([32, 'row', 'space-between'])
      const buttons = (row.children ?? []) as El[]
      expect(buttons.map(b => [b.type, String(b.props['key']), b.props['label']])).toEqual([
        ['Button', 'panel-layout', labels[0]], ['Button', 'profile', labels[1]], ['Button', 'panel-reload', labels[2]],
      ])
      // each whole: its width by the letter-by-letter estimate with the spare (or as measured), 15.5 px a character and a button's own 20.5,
      // the three and two cells between them inside 32 cells of 9.53 px
      const room = labels.reduce((sum, l) => sum + ((MEASURED_EM[l] ?? estimateEm(l)) + ESTIMATE_SPARE) * 15.5 + 20.5, 0) + 2 * 9.53
      expect(room).toBeLessThanOrEqual(32 * 9.53)
      // the switch still turns the width back: wide, the four columns as before
      await ui.press({ key: 'panel-layout' })
      expect(await width(ui)).toBe(64)
      expect(await firstRow(ui)).toEqual([{ gap: 1, columns: ['15 language', '15 panel-layout', '15 profile', '15 panel-reload'] }])
    })
  }

  test('the language list ends with Add language…: picked, it reads the folder (a new file offered, the line says so) and the language in use stays', async ($, on) => {
    const w = world()
    w.store = {}
    engine(on, w)
    await start($)
    // put there after the session started, so only the pick can have read it
    w.dirs = { [LANG_DIR]: [entry('fr.json')] }
    w.files[`${LANG_DIR}/fr.json`] = JSON.stringify({ format: 1, code: 'fr', name: 'Français', rules: { nameMax: 9 }, strings: { 'btn.sort': 'Trier' } })

    const ui = await panelOn($)
    const options = (await languageList(ui))?.props['options'] as { value: string; label: string }[]
    const add = options[options.length - 1]
    expect(add?.label).toBe('Add language…')
    expect(options.map(o => o.value)).not.toContain('fr')
    await ui.select({ key: 'language', value: add?.value ?? '' })
    expect(((await languageList(ui))?.props['options'] as { value: string }[]).map(o => o.value)).toContain('fr')
    expect(await ui.find({ type: 'Text', text: /Loaded fr/ })).toBeDefined()
    expect((await languageList(ui))?.props['value']).toBe('en')
    expect(w.store['language']).toBeUndefined()
    expect(await textOf(ui, 'sort')).toBe('Edit')
  })

  test('in 繁中 the switch reads 窄版 and the last option 新增語言…', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(await textOf(ui, 'panel-layout')).toBe('窄版')
    const options = (await languageList(ui))?.props['options'] as { label: string }[]
    expect(options[options.length - 1]?.label).toBe('新增語言…')
  })

  test('Narrow view: 32 cells, two cards to a row (the menus\' too), the first row two by two, the switch reads Wide view; kept in the store and at the next start; Wide view turns it back', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: true, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2', 'c3'], cards: [
      { id: 'c1', kind: 'button', name: 'Help', text: '--h', prefix: '', section: 'above' },
      { id: 'c2', kind: 'button', name: 'Save', text: '--S', prefix: '', section: 'above' },
      { id: 'c3', kind: 'button', name: 'Load', text: '--L', prefix: '', section: 'above' },
    ] } }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(await cardsIn(ui, 'touch-row-0')).toBe(3)
    await ui.press({ key: 'panel-layout' })
    expect(await width(ui)).toBe(32)
    expect(await cardsIn(ui, 'row-0')).toBe(2)
    expect(await cardsIn(ui, 'touch-row-0')).toBe(2)
    // s39 (乙, below): the language list alone, the three buttons on the next row
    expect((await firstRow(ui))[0]).toEqual({ gap: 1, columns: ['15 language'] })
    expect(await ui.find({ type: 'Box', key: 'panel-tools-buttons' })).toBeDefined()
    expect(await textOf(ui, 'panel-layout')).toBe('Wide view')
    expect((w.store['settings'] as { narrow?: boolean }).narrow).toBe(true)

    await start($)
    const again = await panelOn($)
    expect(await width(again)).toBe(32)
    await again.press({ key: 'panel-layout' })
    expect(await width(again)).toBe(64)
    expect(await cardsIn(again, 'row-0')).toBe(4)
    expect((w.store['settings'] as { narrow?: boolean }).narrow ?? false).toBe(false)
  })

  test('narrow, the 編輯 grid is two cards to a row, 31 cells wide, and a drag lands where two columns put it', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], narrow: true } }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    await ui.press({ key: 'sort' })
    const grid = (await ui.find({ type: 'Client', key: 'grid-status' })) as { props: Record<string, unknown> } | undefined
    expect(grid?.props['width']).toBe(31)
    // twelve cards and 符號: seven rows of six, and the grid's line
    expect(grid?.props['height']).toBe(7 * 6 + 1)
    // and the region draws them so: two to its first row
    expect(((await ui.find({ type: 'Box', key: 'grid-row-0', in: 'grid-status' })) as El | undefined)?.children?.length).toBe(2)
    // the fourth card (工具次數) is the second row's first: 16 cells a column, 6 rows a card row
    const at = (place: number) => ({ x: ((place - 1) % 2) * 16 + 2, y: Math.floor((place - 1) / 2) * 6 + 1 })
    await ui.pointer({ type: 'down', ...at(4), button: 'left', in: 'grid-status' })
    await ui.pointer({ type: 'move', ...at(1), button: 'left', in: 'grid-status' })
    await ui.pointer({ type: 'up', ...at(1), button: 'left', in: 'grid-status' })
    // let go over 版本號, it lands second: 版本號 stays first (Claude Design step 7, s38)
    expect((w.store['settings'] as { order: string[] }).order.slice(0, 3)).toEqual(['ver', 'tools', 'who'])
  })

  test('the phone, VS Code and the terminal draw as before: no set width, no switch, 新增語言 a button, four cards to a row even when kept narrow', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: true, order: [...DEFAULT_ORDER], narrow: true } }
    engine(on, w)
    await start($)

    for (const surface of ['mobile', 'vscode', 'terminal'] as const) {
      const ui = await panelOn($, surface)
      expect([surface, await width(ui)]).toEqual([surface, undefined])
      expect([surface, await ui.find({ type: 'Button', key: 'panel-layout' })]).toEqual([surface, undefined])
      expect([surface, await textOf(ui, 'add-language')]).toEqual([surface, '新增語言'])
      expect([surface, await cardsIn(ui, 'row-0')]).toEqual([surface, 4])
    }
  })
})

// Claude Design's pane design, step 2 (HANDOFF 「卡片外的按鈕統一跟卡片同寬…用 en space（U+2002）加 quarter space（U+2005）撐寬，每個標籤、每種
// 語言要補幾個做成一張表」; the owner 2026-10-14 s37 「OK，開始第 2 步，先做 lab」 on 15 cells, not 15.2, and the tools rows in the columns): on the
// desktop every button outside a card is one column wide, its label padded to 15 cells (7.90 characters: 15 x 9.53 px less a button's own
// 20.5, in characters of 15.5 px; s36 10.webp), never past it; 編輯 預設 新增卡片 stand in the columns, right-aligned (narrow, two by two),
// StatusLine's and each menu's (the menu's out of its indent). The widths below are the desktop's, measured on pad-lab (s37 4.webp): a
// Chinese or kana character 1, an en space 0.5, a quarter space 0.25, each Latin word its own measure.
describe('buttons outside the cards one column wide on the desktop (Claude Design step 2)', () => {
  const MEASURED: Record<string, number> = { 'Narrow view': 5.85, 'Wide view': 4.79, Profile: 3.01, Reload: 3.17, Edit: 1.85, Default: 3.41, 'Add card': 4.23 }
  const TARGET = (15 * 9.53 - 20.5) / 15.5
  const drawnEm = (label: string) => {
    const word = label.replace(/^[\u2002\u2005]+|[\u2002\u2005]+$/g, '')
    return em(label) - em(word) + (MEASURED[word] ?? em(word))
  }
  const panelOn = ($: Engine, surface: (typeof FOUR)[number] = 'desktop') =>
    $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
  type Panel = Awaited<ReturnType<typeof panelOn>>
  const label = async (ui: Panel, key: string) => String((await ui.find({ type: 'Button', key }))?.props['label'])
  // a row of buttons in columns: its rows, each the columns' width and what each holds ('-' an empty column)
  const columns = async (ui: Panel, key: string) =>
    (((await ui.find({ type: 'Box', key })) as El | undefined)?.children as El[] | undefined ?? []).map(r =>
      ((r.children ?? []) as El[]).map(c => `${String(c.props['width'])} ${String(((c.children ?? []) as El[])[0]?.props['key'] ?? '-')}`),
    )
  const OUTSIDE = ['panel-layout', 'profile', 'panel-reload', 'sort', 'default-order', 'add-card']
  const MENU = { language: 'en', settings: { off: [], note: '', icons: true, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [
    { id: 'c1', kind: 'button', name: 'Help', text: '--h', prefix: '', section: 'above' },
  ] } }

  test('every button outside the cards is padded to one column, in English, 繁中 and 日本語', async ($, on) => {
    const w = world()
    engine(on, w)
    // each language as kept in the store, read at a session's start
    for (const language of ['en', 'zh-TW', 'ja']) {
      w.store = { language }
      await start($)

      const ui = await panelOn($)
      for (const key of OUTSIDE) {
        const width = drawnEm(await label(ui, key))
        // 編輯 / Edit / 編集 is lit while on, drawn bold and so wider than measured: padded ESTIMATE_SPARE short (s38 6.webp, Edit cut with …)
        const target = key === 'sort' ? TARGET - ESTIMATE_SPARE : TARGET
        expect([language, key, width <= target + 1e-9 && width > target - 0.25]).toEqual([language, key, true])
      }
    }
  })

  // s37 11.webp: the lit 「Shown」 drawn 142 px and cut with … (its own width over 3.01 characters, from the cut button; Hidden measured 3.37
  // whole): 0.575 a letter undercounts a word with a w. A word not measured is padded from a letter-by-letter estimate with a quarter of a
  // character to spare, so a real width up to that much over the estimate still fits
  // the estimate checked against every word measured on the desktop (4.webp, 11.webp): it may overcount, it undercounts by less than its spare
  test('the letter-by-letter estimate undercounts no measured word by as much as its spare', () => {
    for (const [word, measured] of Object.entries(MEASURED_EM)) {
      expect([word, estimateEm(word) > measured - ESTIMATE_SPARE]).toEqual([word, true])
    }
    expect(ESTIMATE_SPARE).toBe(0.25)
    // a Chinese or kana character and the spaces are what they are made to be
    expect(estimateEm('編\u2002輯\u2005')).toBe(2.75)
  })

  // a user's language: its words estimated, each padded a spare short of the column (s37)
  test('a word of a user\'s language is padded from the estimate, a quarter of a character short of the column', async ($, on) => {
    const dir = `${CWD}/.claude/superstatus/lang`
    const w = world()
    w.store = { language: 'fr' }
    w.dirs = { [dir]: [{ name: 'fr.json', kind: 'file', size: 10, mtimeMs: 1, isLink: false }] }
    w.files[`${dir}/fr.json`] = JSON.stringify({ format: 1, code: 'fr', name: 'Français', rules: { nameMax: 9 }, strings: { 'btn.sort': 'Trier', 'btn.default': 'Défaut' } })
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    for (const [key, word] of [['sort', 'Trier'], ['default-order', 'Défaut']] as const) {
      const text = await label(ui, key)
      expect(unpadded(text)).toBe(word)
      const width = em(text) - em(word) + estimateEm(word)
      expect([word, width <= TARGET - ESTIMATE_SPARE + 1e-9 && width > TARGET - ESTIMATE_SPARE - 0.25]).toEqual([word, true])
    }
  })

  test('English Shown and Hidden stay inside their column: Hidden by its measure, Shown with room for its width', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: true, order: [...DEFAULT_ORDER], aboveOff: ['chart'] } }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    const padOf = (text: string) => em(text) - em(unpadded(text))
    const shown = padOf(await label(ui, 'above-show-touch'))
    const hidden = padOf(await label(ui, 'above-show-chart'))
    for (const real of [3.01, 3.25]) expect([real, shown + real <= TARGET + 1e-9]).toEqual([real, true])
    // measured whole on 14.webp (134 px with 4.25 characters of padding): 3.24, padded to the column by its measure
    expect(shown + 3.24).toBeGreaterThan(TARGET - 0.25)
    expect(hidden + 3.37).toBeLessThanOrEqual(TARGET + 1e-9)
    expect(hidden + 3.37).toBeGreaterThan(TARGET - 0.25)
  })

  test('wide, 編輯 預設 新增卡片 stand in the last three columns of the four', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(await columns(ui, 'tools-row')).toEqual([['15 -', '15 sort', '15 default-order', '15 add-card']])
    expect(String(((await ui.find({ type: 'Box', key: 'cards' })) as El | undefined)?.children?.[0] && (((await ui.find({ type: 'Box', key: 'cards' })) as El).children as El[])[0]?.props['key'])).toBe('tools-row')
  })

  // s39 (the owner's 10.png 「下面層級的這些按鈕也可以這樣處理嗎」 after 乙 for the first row): narrow, Status Line's and each menu's 編輯 預設 新增卡片
  // stand on one row at their own widths (no padding), spread edge to edge; whole in the three languages, 編輯 lit (bold) too
  for (const [language, labels] of [['en', ['Edit', 'Default', 'Add card']], ['zh-TW', ['編輯', '預設', '新增卡片']], ['ja', ['編集', 'デフォルト', 'カード追加']]] as const) {
    test(`narrow, 編輯 預設 新增卡片 on one row at their own widths, spread edge to edge, in Status Line and in a menu (${language})`, async ($, on) => {
      const w = world()
      w.store = { ...MENU, language, settings: { ...MENU.settings, narrow: true } }
      engine(on, w)
      await start($)

      const ui = await panelOn($)
      for (const [row, prefix] of [['tools-row', ''], ['touch-tools-row', 'touch-']] as const) {
        const box = (await ui.find({ type: 'Box', key: row })) as El | undefined
        expect([row, box?.props['width'], box?.props['flexDirection'], box?.props['justifyContent']]).toEqual([row, 32, 'row', 'space-between'])
        expect(((box?.children ?? []) as El[]).map(b => [b.type, String(b.props['key']), b.props['label']])).toEqual([
          ['Button', `${prefix}sort`, labels[0]], ['Button', `${prefix}default-order`, labels[1]], ['Button', `${prefix}add-card`, labels[2]],
        ])
      }
      // 編輯 lit while on keeps its words (the desktop draws it bold, 5% wider): the three and two cells between inside 32 cells of 9.53 px
      await ui.press({ key: 'sort' })
      expect(((await ui.find({ type: 'Button', key: 'sort' })) as El | undefined)?.props['label']).toBe(labels[0])
      const room = labels.reduce((sum, l, i) => sum + ((MEASURED_EM[l] ?? estimateEm(l)) + ESTIMATE_SPARE) * 15.5 * (i === 0 ? 1.05 : 1) + 20.5, 0) + 2 * 9.53
      expect(room).toBeLessThanOrEqual(32 * 9.53)
    })
  }

  test('a menu\'s 編輯 預設 新增卡片 stand in the same columns, out of the menu\'s indent; 編輯 lit keeps its width', async ($, on) => {
    const w = world()
    w.store = MENU
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(await columns(ui, 'touch-tools-row')).toEqual([['15 -', '15 touch-sort', '15 touch-default-order', '15 touch-add-card']])
    const inCards = walk(((await ui.find({ type: 'Box', key: 'touch-cards' })) as El | undefined)?.children).map(el => String(el.props?.['key']))
    expect(inCards).not.toContain('touch-sort')
    for (const key of ['touch-sort', 'touch-default-order', 'touch-add-card']) {
      const width = drawnEm(await label(ui, key))
      const target = key === 'touch-sort' ? TARGET - ESTIMATE_SPARE : TARGET
      expect([key, width <= target + 1e-9 && width > target - 0.25]).toEqual([key, true])
    }
    await ui.press({ key: 'sort' })
    expect((await ui.find({ type: 'Button', key: 'sort' }))?.props['variant']).toBe('primary')
    expect(drawnEm(await label(ui, 'sort'))).toBe(drawnEm(await label(ui, 'touch-sort')))
  })

  test('the phone, VS Code and the terminal keep their labels as before: 編輯 laid out in 5.5 characters, Edit as it is', async ($, on) => {
    const w = world()
    engine(on, w)
    for (const [language, sort] of [['zh-TW', 5.5], ['en', 4]] as const) {
      w.store = { language }
      await start($)

      for (const surface of ['mobile', 'vscode', 'terminal'] as const) {
        const ui = await panelOn($, surface)
        expect([surface, language, em(await label(ui, 'sort'))]).toEqual([surface, language, sort])
      }
    }
  })
})

// Claude Design's pane design, step 3 (HANDOFF 「選單卡片改回四欄（不縮排），AbovePrompt 開關改成「系統名 Text + Shown/Hidden 按鈕」」; the owner
// 2026-10-14 s37 「OK，照設計的順序開始第 3 步」 on the switches in the band's order, replacing s34's three rows): on the desktop a menu's cards
// stand in the panel's columns (its header row keeps its 2 cells); each of AbovePrompt's seven switches is its system name and a button one
// column wide, 顯示 lit while its block shows, 隱藏 grey while it is folded; two pairs a row, narrow one, in the band's order.
describe('AbovePrompt\'s switches and the menus\' cards on the desktop (Claude Design step 3)', () => {
  const STACKED = ['chart-full', 'chart-half', 'chart', 'info-full', 'info-half', 'info', 'touch']
  const NAME: Record<string, string> = { chart: 'showchart', 'chart-half': 'showchart-half', 'chart-full': 'showchart-full', info: 'showinfo',
    'info-half': 'showinfo-half', 'info-full': 'showinfo-full', touch: 'touchbar' }
  const TARGET = (15 * 9.53 - 20.5) / 15.5
  const panelOn = ($: Engine, surface: (typeof FOUR)[number] = 'desktop') =>
    $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
  type Panel = Awaited<ReturnType<typeof panelOn>>
  // the switches as drawn: rows of columns, each column 'width name' for a Text, 'width key' for a Button
  const switches = async (ui: Panel) =>
    (((await ui.find({ type: 'Box', key: 'above-tools-row' })) as El | undefined)?.children as El[] | undefined ?? []).map(r =>
      ((r.children ?? []) as El[]).map(c => {
        const inside = ((c.children ?? []) as El[])[0]
        return `${String(c.props['width'])} ${inside?.type === 'Text' ? String(inside.children?.[0]) : String(inside?.props['key'])}`
      }),
    )
  const pair = (block: string) => [`15 ${NAME[block]}`, `15 above-show-${block}`]
  const CARDS = { off: [], note: '', icons: true, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2', 'c3', 'c4', 'c5'], cards: [
    { id: 'c1', kind: 'button', name: 'A', text: '--h', prefix: '', section: 'above' },
    { id: 'c2', kind: 'button', name: 'B', text: '--S', prefix: '', section: 'above' },
    { id: 'c3', kind: 'button', name: 'C', text: '--L', prefix: '', section: 'above' },
    { id: 'c4', kind: 'button', name: 'D', text: '--P', prefix: '', section: 'above' },
    { id: 'c5', kind: 'button', name: 'E', text: '--H', prefix: '', section: 'above' },
  ] }

  test('wide, the seven switches are a name and a button each, two pairs a row in the band\'s order; 顯示 lit, padded to its column', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(await switches(ui)).toEqual([
      [...pair('chart-full'), ...pair('chart-half')],
      [...pair('chart'), ...pair('info-full')],
      [...pair('info-half'), ...pair('info')],
      [...pair('touch')],
    ])
    // a name (one row) level with its button (two): the rows centre what they hold
    const rows = (((await ui.find({ type: 'Box', key: 'above-tools-row' })) as El | undefined)?.children ?? []) as El[]
    expect(rows.map(r => r.props['alignItems'])).toEqual(['center', 'center', 'center', 'center'])
    for (const block of STACKED) {
      const button = await ui.find({ type: 'Button', key: `above-show-${block}` })
      expect([block, bare(button?.text), button?.props['variant'], button?.props['dimColor']]).toEqual([block, '顯示', 'primary', false])
      expect(em(String(button?.props['label']))).toBeLessThanOrEqual(TARGET)
      expect(em(String(button?.props['label']))).toBeGreaterThan(TARGET - 0.25)
    }
  })

  test('a press folds its block away: the button reads 隱藏, grey; kept; pressed again 顯示', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    await ui.press({ key: 'above-show-info-half' })
    const off = await ui.find({ type: 'Button', key: 'above-show-info-half' })
    expect([bare(off?.text), off?.props['variant'], off?.props['dimColor']]).toEqual(['隱藏', 'secondary', true])
    expect((w.store['settings'] as { aboveOff: string[] }).aboveOff).toEqual(['info-half'])
    await ui.press({ key: 'above-show-info-half' })
    expect(bare((await ui.find({ type: 'Button', key: 'above-show-info-half' }))?.text)).toBe('顯示')
    expect((w.store['settings'] as { aboveOff: string[] }).aboveOff).toEqual([])
  })

  test('in English Shown / Hidden, in 日本語 表示 / 非表示; the system names are never translated', async ($, on) => {
    const w = world()
    engine(on, w)
    for (const [language, shown, hidden] of [['en', 'Shown', 'Hidden'], ['ja', '表示', '非表示']] as const) {
      w.store = { language, settings: { off: [], note: '', icons: true, order: [...DEFAULT_ORDER], aboveOff: ['touch'] } }
      await start($)

      const ui = await panelOn($)
      expect([language, bare((await ui.find({ type: 'Button', key: 'above-show-chart' }))?.text)]).toEqual([language, shown])
      expect([language, bare((await ui.find({ type: 'Button', key: 'above-show-touch' }))?.text)]).toEqual([language, hidden])
      expect((await switches(ui))[3]).toEqual(pair('touch'))
    }
  })

  test('narrow, one pair a row', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: true, order: [...DEFAULT_ORDER], narrow: true } }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(await switches(ui)).toEqual(STACKED.map(pair))
  })

  test('a menu\'s cards stand in the panel\'s columns, four to a row, not indented; its header row keeps its 2 cells', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: CARDS }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    const cards = (await ui.find({ type: 'Box', key: 'touch-cards' })) as El | undefined
    expect(cards?.props['marginLeft'] ?? 0).toBe(0)
    expect(((((await ui.find({ type: 'Box', key: 'touch-row-0' })) as El | undefined)?.children) ?? []).length).toBe(4)
    expect((await ui.find({ type: 'Box', key: 'touch-row-0' }))?.props['gap']).toBe(1)
    expect((await ui.find({ type: 'Box', key: 'touch-header' }))?.props['paddingLeft']).toBe(2)
  })

  test('the phone, VS Code and the terminal keep s34\'s switches (the names on the buttons, three rows) and the menus\' indent', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: CARDS }
    engine(on, w)
    await start($)

    for (const surface of ['mobile', 'vscode', 'terminal'] as const) {
      const ui = await panelOn($, surface)
      expect([surface, bare((await ui.find({ type: 'Button', key: 'above-show-chart' }))?.text)]).toEqual([surface, 'showchart'])
      expect([surface, await ui.find({ type: 'Box', key: 'above-switch-row-2' }) !== undefined]).toEqual([surface, true])
      expect([surface, (await ui.find({ type: 'Box', key: 'touch-cards' }))?.props['marginLeft']]).toEqual([surface, 2])
    }
  })
})

// Claude Design's pane design, step 4 (HANDOFF 「band 縮圖寬版 600px、窄版 295px；窄版 H1 列畫 01–12 方框（有按鈕白框，空位灰虛線框）」; the owner
// 2026-10-14 s37 「OK，用 608／300 開始第 4 步」: 608 / 300 px for the 64 / 32 cells, the picture on a row of its own under AbovePrompt's
// header, replacing s33's place beside the name): on the desktop the picture draws the blocks shown that hold cards, in the band's order, the
// touchbar row last (wide each button's superscript and name, an empty place its grey number; narrow 01-12 boxes, white where a button is,
// grey dashed where none); with no card, a line says so. Narrow, each menu's picture stands under its header. VS Code keeps s33's.
describe('AbovePrompt\'s picture on the desktop (Claude Design step 4)', () => {
  const panelOn = ($: Engine, surface: (typeof FOUR)[number] = 'desktop') =>
    $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
  type Panel = Awaited<ReturnType<typeof panelOn>>
  const svgIn = async (ui: Panel, key: string) => walk((await ui.find({ type: 'Box', key }))?.children).find(el => el.type === 'Svg')
  // the rows the picture draws, top to bottom, by the class each row's group carries
  const rowsOf = (source: string) => [...source.matchAll(/<g class="row-([A-Za-z0-9-]+)"/g)].map(m => m[1])
  const rowSource = (source: string, row: string) => source.split(`<g class="row-${row}"`)[1]?.split('</g>')[0] ?? ''
  const SETTINGS = (extra: Record<string, unknown> = {}) => ({ off: ['c6'], note: '', icons: true, order: [...DEFAULT_ORDER],
    aboveOrder: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], aboveOff: ['info-half'], cards: [
      { id: 'c1', kind: 'text', name: '圖一', text: 'a', prefix: '', section: 'above', size: 'H3' },
      { id: 'c2', kind: 'text', name: '收起', text: 'a', prefix: '', section: 'above', size: 'H2-half' },
      { id: 'c3', kind: 'text', name: '字一', text: 'a', prefix: '', section: 'above', size: 'H2' },
      { id: 'c4', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
      { id: 'c5', kind: 'button', name: '暫存', text: '--S', prefix: '', section: 'above' },
      { id: 'c6', kind: 'button', name: '關的', text: '--x', prefix: '', section: 'above' },
    ], ...extra })

  test('wide, the picture is a row of its own under the header, 608 px: the shown blocks with cards, then the buttons named, empty places numbered', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: SETTINGS() }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    const top = ((await ui.drawn()).children as El[]).map(el => String(el.props?.['key']))
    expect(top.indexOf('above-preview')).toBe(top.indexOf('above-header') + 1)
    expect(await svgIn(ui, 'above-header')).toBeUndefined()
    const picture = await svgIn(ui, 'above-preview')
    expect(picture?.props['width']).toBe(608)
    const source = drawingOf(String(picture?.props['source']))
    expect(source).toContain('width="608"')
    expect(source).toContain(`height="${picture?.props['height']}"`)
    // showchart and showinfo hold cards; showinfo-half is folded; the rest hold none
    expect(rowsOf(source)).toEqual(['H3', 'H2', 'H1'])
    expect(source).toContain('>圖一</text>')
    expect(source).toContain('>字一</text>')
    expect(source).not.toContain('收起')
    const h1 = rowSource(source, 'H1')
    expect(h1).toContain('>¹說明</text>')
    expect(h1).toContain('>²暫存</text>')
    expect(h1).not.toContain('關的')
    // the ten empty places, their numbers grey, no frames
    expect((h1.match(/fill="#8a8a8a"[^>]*>[⁰¹²³⁴⁵⁶⁷⁸⁹]+<\/text>/g) ?? []).length).toBe(10)
    expect(h1).not.toContain('<rect')
    expect(picture?.props['alt']).toBe('AbovePrompt：圖一｜字一｜¹說明 ²暫存')
  })

  test('narrow, 300 px; the touchbar row is twelve boxes 01-12, a white frame where a button is, a grey dashed one where none', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: SETTINGS({ narrow: true }) }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    const picture = await svgIn(ui, 'above-preview')
    expect(picture?.props['width']).toBe(300)
    const h1 = rowSource(drawingOf(String(picture?.props['source'])), 'H1')
    const frames = [...h1.matchAll(/<rect [^>]*>/g)].map(m => m[0])
    expect(frames).toHaveLength(12)
    expect(frames.filter(r => r.includes('stroke="#f2f2f2"') && !r.includes('dasharray'))).toHaveLength(2)
    expect(frames.filter(r => r.includes('stroke-dasharray'))).toHaveLength(10)
    const numbers = [...h1.matchAll(/>(\d\d)<\/text>/g)].map(m => m[1])
    expect(numbers).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'])
  })

  test('with no card in AbovePrompt the picture is a line: 還沒有卡片：按新增卡片加入', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(await svgIn(ui, 'above-preview')).toBeUndefined()
    const line = walk((await ui.find({ type: 'Box', key: 'above-preview' }))?.children).find(el => el.type === 'Text')
    expect(String(line?.children?.[0])).toBe('還沒有卡片：按新增卡片加入')
  })

  test('the touchbar row folded by its switch is not drawn; the picture keeps the rest', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: SETTINGS({ aboveOff: ['touch'] }) }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(rowsOf(drawingOf(String((await svgIn(ui, 'above-preview'))?.props['source'])))).toEqual(['H3', 'H2-half', 'H2'])
  })

  test('narrow, a menu\'s picture stands under its header, from the left; wide, at the header\'s right end as before', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: SETTINGS({ narrow: true }) }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    expect(await svgIn(ui, 'h3-header')).toBeUndefined()
    expect((await svgIn(ui, 'h3-band'))?.props['width']).toBe(300)
    const top = walk(((await ui.find({ type: 'Box', key: 'h3' })) as El | undefined)?.children).map(el => String(el.props?.['key']))
    expect(top.indexOf('h3-band')).toBeGreaterThan(top.indexOf('h3-header'))
    await ui.press({ key: 'panel-layout' })
    expect(await svgIn(ui, 'h3-header')).toBeDefined()
  })

  test('a name too long for its place is squeezed into it, never past it; a short one is drawn as it is', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: SETTINGS({ cards: [
      { id: 'c4', kind: 'button', name: 'ホスト状態確認', text: '--h', prefix: '', section: 'above' },
      { id: 'c5', kind: 'button', name: '存', text: '--S', prefix: '', section: 'above' },
    ], aboveOrder: ['c4', 'c5'] }) }
    engine(on, w)
    await start($)

    const ui = await panelOn($)
    const h1 = rowSource(drawingOf(String((await svgIn(ui, 'above-preview'))?.props['source'])), 'H1')
    // twelve places across 608 px, 6 px apart: 45 px each, 41 for the text
    const long = h1.match(/<text [^>]*>¹ホスト状態確認<\/text>/)?.[0] ?? ''
    expect(Number(long.match(/textLength="([\d.]+)"/)?.[1])).toBeLessThanOrEqual((608 - 2 - 11 * 6) / 12 - 4 + 1e-9)
    expect(h1.match(/<text [^>]*>²存<\/text>/)?.[0]).not.toContain('textLength')
  })

  test('VS Code keeps s33\'s picture beside AbovePrompt\'s name, 300 px', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: SETTINGS() }
    engine(on, w)
    await start($)

    const ui = await panelOn($, 'vscode')
    expect((await svgIn(ui, 'above-header'))?.props['width']).toBe(300)
  })
})

// The Jev card (the owner 2026-10-14 s37 「幫我做個我ss的卡片是Jev的使用量計費」, 「OK」 on step 0): a module card reading scripts/jev.py's ledger
// from the user's home; superstatus fills in the home folder (asked of the shell once) for a module's ~/ path.
// Claude Design step 5 (docs/design/pane-mocks-1013, screen 2; the owner 2026-10-14 s38 「1–4 照建議」): on the desktop AbovePrompt's 新增卡片 pane
// has the seven block tabs and seven fold rows, one block open; each block holds the design's places (H1 12, H2 5, H2-half 2, H2-full 1, H3 3,
// H3-half 2, H3-full 1) and only a lit card takes one; Place lists every place to the lit cards and one more, an earlier one inserting; H1 offers
// the cards that are pressed (button, switch, a button module), the others the displays; under the form the block's places and their cards.
// Status Line's 新增卡片 keeps its pane.
describe('the add-card pane by block (Claude Design step 5)', () => {
  const STEP5 = (more: Record<string, unknown> = {}) => ({ language: 'en', settings: { off: ['c4', 'c6', 'c12'], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'], cards: [
      { id: 'c1', kind: 'button', name: 'Go', text: 'go', prefix: '', section: 'above' },
      { id: 'c2', kind: 'button', name: 'Save', text: '--S', prefix: '', section: 'above' },
      { id: 'c3', kind: 'button', name: 'Help', text: '--h', prefix: '', section: 'above' },
      { id: 'c4', kind: 'button', name: 'Boot', text: '!uptime', prefix: '', section: 'above' },
      { id: 'c5', kind: 'text', name: 'Alpha', text: 'a', prefix: '', section: 'above', size: 'H2' },
      { id: 'c6', kind: 'text', name: 'Beta', text: 'b', prefix: '', section: 'above', size: 'H2' },
      { id: 'c7', kind: 'text', name: 'Gamma', text: 'c', prefix: '', section: 'above', size: 'H2' },
      { id: 'c8', kind: 'text', name: 'Note', text: 'n', prefix: '', section: 'above', size: 'H2-full' },
      { id: 'c9', kind: 'text', name: 'One', text: '1', prefix: '', section: 'above', size: 'H3' },
      { id: 'c10', kind: 'text', name: 'Two', text: '2', prefix: '', section: 'above', size: 'H3' },
      { id: 'c11', kind: 'text', name: 'Three', text: '3', prefix: '', section: 'above', size: 'H3' },
      { id: 'c12', kind: 'text', name: 'Four', text: '4', prefix: '', section: 'above', size: 'H3' },
    ], ...more } })
  const BLOCK_IDS = ['H1', 'H2', 'H2-half', 'H2-full', 'H3', 'H3-half', 'H3-full']
  const stored = (w: World) => w.store['settings'] as { cards: { id: string; kind: string; size?: string }[]; aboveOrder: string[] }
  // the panel's menu Add card (h2-add-card: showinfo, H2; status: Status Line's), then the pane, on the surface asked
  const openFrom = async ($: Engine, menu: string, surface: 'desktop' | 'vscode' = 'desktop') => {
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: menu === 'status' ? 'add-card' : `${menu}-add-card` })
    await ui.unmount()
    return $.ui.mount({ plugin: 'superstatus', surface, component: 'Pane', props: ADD_PANE, requestId: 'sl-add' })
  }
  type Pane = Awaited<ReturnType<typeof openFrom>>
  const keysOf = async (pane: Pane, type: string, prefix: string) =>
    ((await pane.findAll({ type })) as { key?: string; props: Record<string, unknown> }[]).map(b => String(b.key ?? b.props['key'])).filter(k => k.startsWith(prefix))
  const texts = (node: unknown) => walk(node).filter(el => el.type === 'Text').map(el => ((el.children ?? []) as unknown[]).join(''))
  // the block's list under the form: each row its place and its card
  const listed = async (pane: Pane) =>
    ((((await pane.find({ type: 'Box', key: 'add-occ' })) as El | undefined)?.children ?? []) as El[]).map(row => texts(row.children).join(' | '))

  // s39 (the owner's 20.png, 21.png 「這裡的間隔沒有改到」「這個字可以刪掉了」): no note among the tabs; their rows half a row apart, as the switches'
  test('opened from showinfo\'s Add card: seven block tabs, H2\'s lit, no note, the rows half a row apart; seven fold rows named with their menus, H2 open', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'h2')
    // s39 (「StatusLine 照這四點放進新增卡片 pane」): StatusLine's tab first, then the seven blocks'
    expect(await keysOf(pane, 'Button', 'add-tab-')).toEqual(['add-tab-StatusLine', ...BLOCK_IDS.map(id => `add-tab-${id}`)])
    for (const id of ['StatusLine', ...BLOCK_IDS]) {
      const tab = await pane.find({ type: 'Button', key: `add-tab-${id}` })
      expect(unpadded(tab?.text ?? '')).toBe(id)
      expect(tab?.props['variant']).toBe(id === 'H2' ? 'primary' : 'secondary')
      expect(tab?.props['dimColor']).toBe(id !== 'H2')
    }
    expect(await pane.find({ type: 'Text', text: /One block open/ })).toBeUndefined()
    // wide: StatusLine H1 H2 H2-half, then H2-full H3 H3-half H3-full
    const rowKeys = async (i: number) => walk(((await pane.find({ type: 'Box', key: `add-tabs-${i}` })) as El | undefined)?.children).filter(el => el.type === 'Button').map(el => String(el.props['key']))
    expect([await rowKeys(0), await rowKeys(1)]).toEqual([
      ['add-tab-StatusLine', 'add-tab-H1', 'add-tab-H2', 'add-tab-H2-half'], ['add-tab-H2-full', 'add-tab-H3', 'add-tab-H3-half', 'add-tab-H3-full'],
    ])
    expect(((await pane.find({ type: 'Box', key: 'add-tabs' })) as El | undefined)?.props['gap']).toBe(0.5)
    expect(await keysOf(pane, 'Button', 'add-fold-')).toEqual(BLOCK_IDS.map(id => `add-fold-${id}`))
    for (const id of BLOCK_IDS) expect((await pane.find({ type: 'Button', key: `add-fold-${id}` }))?.text).toBe(id === 'H2' ? '▼' : '▶')
    for (const name of ['touchbar', 'showinfo', 'showinfo-half', 'showinfo-full', 'showchart', 'showchart-half', 'showchart-full']) {
      expect(await pane.find({ type: 'Text', text: name })).toBeDefined()
    }
    // a tab press opens its block; a fold press too; the open block's fold closes it
    await pane.press({ key: 'add-tab-H3' })
    expect((await pane.find({ type: 'Button', key: 'add-tab-H3' }))?.props['variant']).toBe('primary')
    expect((await pane.find({ type: 'Button', key: 'add-fold-H3' }))?.text).toBe('▼')
    expect((await pane.find({ type: 'Button', key: 'add-fold-H2' }))?.text).toBe('▶')
    await pane.press({ key: 'add-fold-H2-half' })
    expect((await pane.find({ type: 'Button', key: 'add-tab-H2-half' }))?.props['variant']).toBe('primary')
    await pane.press({ key: 'add-fold-H2-half' })
    expect(await keysOf(pane, 'Button', 'add-fold-')).toHaveLength(7)
    expect((await pane.find({ type: 'Button', key: 'add-fold-H2-half' }))?.text).toBe('▶')
    expect(await pane.find({ type: 'Select', key: 'add-place' })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: 'add-ok' })).toBeUndefined()
  })

  test('Place lists each place to the lit cards and one more, named by the block, the last chosen: a card turned off takes none', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'h2')
    const place = await pane.find({ type: 'Select', key: 'add-place' })
    // Alpha and Gamma lit, Beta off: two places taken, the third the next
    expect(place?.props['options']).toEqual([{ value: '1', label: 'H2-1' }, { value: '2', label: 'H2-2' }, { value: '3', label: 'H2-3' }])
    expect(place?.props['value']).toBe('3')
    await pane.press({ key: 'add-tab-H2-half' })
    expect((await pane.find({ type: 'Select', key: 'add-place' }))?.props['options']).toEqual([{ value: '1', label: 'H2-half-1' }])
  })

  test('an earlier place puts the new card there, before the card that held it; the last adds it at the block\'s end', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    let pane = await openFrom($, 'h2')
    await pane.select({ key: 'add-place', value: '2' })
    await pane.input({ key: 'add-name', text: 'New', kind: 'change' })
    await pane.input({ key: 'add-text', text: 'x', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    // place 2 was Gamma's (Beta, off, holds none): the card goes just before Gamma
    expect(stored(w).aboveOrder).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c13', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'])
    expect(stored(w).cards[12]).toMatchObject({ id: 'c13', kind: 'text', size: 'H2', section: 'above' })
    await pane.unmount()

    pane = await openFrom($, 'h2')
    expect((await pane.find({ type: 'Select', key: 'add-place' }))?.props['value']).toBe('4')
    await pane.input({ key: 'add-name', text: 'Last', kind: 'change' })
    await pane.input({ key: 'add-text', text: 'y', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    expect(stored(w).aboveOrder[stored(w).aboveOrder.length - 1]).toBe('c14')
  })

  test('a full block: Place says none free, a standing line names the block, its places and its menu, Add is dim and adds nothing', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    // H3: One, Two, Three lit (Four off): three of three
    const pane = await openFrom($, 'h3')
    expect((await pane.find({ type: 'Select', key: 'add-place' }))?.props['options']).toEqual([{ value: '', label: 'none free' }])
    expect(await pane.find({ type: 'Text', text: 'H3 is full: 3 of 3 taken. Turn a card off or delete one in showchart first.' })).toBeDefined()
    expect((await pane.find({ type: 'Button', key: 'add-ok' }))?.props['dimColor']).toBe(true)
    await pane.input({ key: 'add-name', text: 'Five', kind: 'change' })
    await pane.input({ key: 'add-text', text: '5', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    expect(stored(w).cards).toHaveLength(12)
    expect(w.closed).toEqual([])
    // a block with room: Add is not dim, no line
    await pane.press({ key: 'add-tab-H2' })
    expect((await pane.find({ type: 'Button', key: 'add-ok' }))?.props['dimColor']).not.toBe(true)
    expect(await pane.find({ type: 'Text', text: /is full/ })).toBeUndefined()
  })

  test('H1 offers the cards that are pressed (button, switch, module), the other blocks the displays; a tab starts its block\'s first kind', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'h2')
    const kinds = async () => ((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['options'] as { value: string }[]).map(o => o.value)
    expect(await kinds()).toEqual(['text', 'countdown', 'file', 'command', 'module'])
    await pane.press({ key: 'add-tab-H1' })
    expect(await kinds()).toEqual(['button', 'switch', 'module'])
    expect((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['value']).toBe('button')
    await pane.select({ key: 'add-kind', value: 'module' })
    expect(((await pane.find({ type: 'Select', key: 'add-module' }))?.props['options'] as { value: string }[]).map(o => o.value)).toEqual(['host.snapshot', 'session.snapshot', 'action.reload', 'action.panel'])
    await pane.press({ key: 'add-tab-H3-half' })
    expect((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['value']).toBe('text')
    // a kind another block offers is never taken: a button card is not added to a display block
    expect(await kinds()).not.toContain('button')
  })

  test('under the form the block\'s places: each with its card or (empty); past six, one line for the rest; an empty block says so', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'h2')
    expect(await pane.find({ type: 'Text', text: 'In this block' })).toBeDefined()
    expect(await listed(pane)).toEqual(['H2-1 | Alpha', 'H2-2 | Gamma', 'H2-3 | (empty)', 'H2-4 | (empty)', 'H2-5 | (empty)'])
    await pane.press({ key: 'add-tab-H1' })
    expect(await listed(pane)).toEqual(['H1-1 | Go', 'H1-2 | Save', 'H1-3 | Help', 'H1-4 | (empty)', 'H1-5 | (empty)', 'H1-6 | (empty)', 'H1-7…12 | (empty)'])
    await pane.press({ key: 'add-tab-H3-half' })
    expect(await pane.find({ type: 'Box', key: 'add-occ' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: 'Nothing here yet. 2 places free.' })).toBeDefined()
    // a block of one place says it in the singular
    await pane.press({ key: 'add-tab-H3-full' })
    expect(await pane.find({ type: 'Text', text: 'Nothing here yet. 1 place free.' })).toBeDefined()
  })

  test('past six lit buttons the last line counts the rest', async ($, on) => {
    const w = world()
    const st = STEP5()
    for (let i = 13; i <= 20; i++) {
      st.settings.cards.push({ id: `c${i}`, kind: 'button', name: `B${i}`, text: 'x', prefix: '', section: 'above' })
      st.settings.aboveOrder.push(`c${i}`)
    }
    w.store = st
    engine(on, w)
    await start($)

    // Go Save Help and B13-B20: eleven lit
    const pane = await openFrom($, 'touch')
    expect((await listed(pane)).slice(5)).toEqual(['H1-6 | B15', 'H1-7…12 | 5 more'])
  })

  test('each fold row draws its block\'s places: lit cards by name, a free place by its name, the chosen one outlined; H1 as 01-12 boxes', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'h2')
    const svgIn = async (id: string) => {
      const props = walk((await pane.find({ type: 'Box', key: `add-pic-${id}` }))?.children).find(el => el.type === 'Svg')?.props as { source: string; alt: string } | undefined
      return props === undefined ? undefined : { ...props, source: drawingOf(props.source) }
    }
    expect((await svgIn('H2'))?.alt).toBe('H2 Alpha Gamma H2-3 H2-4 H2-5')
    expect((await svgIn('H2'))?.source.match(/stroke="#b1b9f9"/g)).toHaveLength(1)
    expect((await svgIn('H3'))?.alt).toBe('H3 One Two Three')
    expect((await svgIn('H3'))?.source).not.toContain('#b1b9f9')
    expect((await svgIn('H3-full'))?.alt).toBe('H3-full H3-full-1')
    const h1 = await svgIn('H1')
    expect(h1?.alt).toBe('H1 Go Save Help')
    expect(h1?.source).toContain('>01<')
    expect(h1?.source).toContain('>12<')
    expect(h1?.source.match(/stroke="#f2f2f2"/g)).toHaveLength(3)
    // the place picked moves the outline
    await pane.select({ key: 'add-place', value: '1' })
    expect((await svgIn('H2'))?.source.match(/<rect[^>]*stroke="#b1b9f9"/)?.[0]).toContain('x="1"')
  })

  test('laid out in the panel\'s columns: tabs a column each; Place and Kind a label column then the list; Name a label column, then a 31-cell field with no label of its own', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'h2')
    const widthsIn = async (key: string) =>
      ((((await pane.find({ type: 'Box', key })) as El | undefined)?.children ?? []) as El[]).map(c => c.props['width'])
    expect(await widthsIn('add-tabs-0')).toEqual([15, 15, 15, 15])
    // H2-full H3 H3-half H3-full (s39: the note gone, StatusLine's tab first in the row above)
    expect(await widthsIn('add-tabs-1')).toEqual([15, 15, 15, 15])
    expect(await widthsIn('add-row-place')).toEqual([15, 15])
    expect(await widthsIn('add-row-kind')).toEqual([15, 15])
    expect(await widthsIn('add-row-name')).toEqual([15, 31])
    expect((await pane.find({ type: 'Input', key: 'add-name' }))?.props['label']).toBeUndefined()
    expect(texts((await pane.find({ type: 'Box', key: 'add-row-name' }))?.children)).toEqual(['Name'])
    expect(texts((await pane.find({ type: 'Box', key: 'add-row-text' }))?.children)).toEqual(['Text'])
    expect(await widthsIn('add-buttons')).toEqual([15, 15])
    expect(unpadded((await pane.find({ type: 'Button', key: 'add-ok' }))?.text ?? '')).toBe('Add')
  })

  test('narrow, the tabs stand two to a row, a field\'s label on the line above it, a block\'s picture under its fold row', async ($, on) => {
    const w = world()
    w.store = STEP5({ narrow: true })
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'h2')
    // narrow, two to a row (s39: no note; StatusLine's tab first, eight in four rows), the rows half a row apart
    const lengths = []
    for (let i = 0; i < 4; i++) lengths.push((((await pane.find({ type: 'Box', key: `add-tabs-${i}` })) as El | undefined)?.children ?? []).length)
    expect(lengths).toEqual([2, 2, 2, 2])
    expect(await pane.find({ type: 'Text', text: /One block open/ })).toBeUndefined()
    expect(((await pane.find({ type: 'Box', key: 'add-tabs' })) as El | undefined)?.props['gap']).toBe(0.5)
    expect((await pane.find({ type: 'Box', key: 'add-row-name' }))?.props['flexDirection']).toBe('column')
    expect((await pane.find({ type: 'Box', key: 'add-fold-row-H2' }))?.props['flexDirection']).toBe('column')
  })

  // s39 (the owner 「StatusLine的新增卡片應該也要到這個Pane裡面吧」, then 「可以，StatusLine 照這四點放進新增卡片 pane，先寫測試」; it was s38's ruling
  // (1), Status Line's own pane): on the desktop Status Line's Add card opens this pane on its StatusLine tab: every kind, no place, no
  // block's list, the seven fold rows closed under its form; a card added goes to Status Line. Off the desktop, its form as before.
  test('Status Line\'s Add card opens the pane on its StatusLine tab: every kind, no place or block list, the fold rows closed; Add puts it in Status Line', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'status')
    const status = await pane.find({ type: 'Button', key: 'add-tab-StatusLine' })
    expect([status?.props['variant'], status?.props['dimColor']]).toEqual(['primary', false])
    for (const id of BLOCK_IDS) expect([id, (await pane.find({ type: 'Button', key: `add-tab-${id}` }))?.props['variant']]).toEqual([id, 'secondary'])
    expect(((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['options'] as { value: string }[]).map(o => o.value))
      .toEqual(['text', 'countdown', 'file', 'command', 'switch', 'button', 'module'])
    expect(await pane.find({ type: 'Select', key: 'add-place' })).toBeUndefined()
    expect(await pane.find({ type: 'Box', key: 'add-occ-part' })).toBeUndefined()
    for (const id of BLOCK_IDS) expect([id, (await pane.find({ type: 'Button', key: `add-fold-${id}` }))?.text]).toEqual([id, '▶'])
    // its form under the tabs, before the fold rows
    const top = (((await pane.drawn()) as El).children as El[]).map(el => String(el.props['key']))
    expect(top.slice(0, 3)).toEqual(['add-tabs', 'add-row-kind', 'add-row-name'])
    expect(top.indexOf('add-fold-row-H1')).toBeGreaterThan(top.indexOf('add-buttons'))

    await pane.input({ key: 'add-name', text: 'Memo', kind: 'change' })
    await pane.input({ key: 'add-text', text: 'hello', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    const settings = w.store['settings'] as { cards: { id: string; name: string; section?: string }[]; order: string[]; aboveOrder: string[] }
    const memo = settings.cards.find(c => c.name === 'Memo')
    expect([memo?.section, settings.order.includes(memo?.id ?? '?'), settings.aboveOrder.includes(memo?.id ?? '?')]).toEqual([undefined, true, false])
  })

  test('from StatusLine\'s tab a block\'s tab opens that block (its kinds, its place), and StatusLine\'s tab brings Status Line\'s form back', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'status')
    await pane.press({ key: 'add-tab-H3' })
    expect([(await pane.find({ type: 'Button', key: 'add-tab-H3' }))?.props['variant'], (await pane.find({ type: 'Button', key: 'add-tab-StatusLine' }))?.props['variant']]).toEqual(['primary', 'secondary'])
    expect(((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['options'] as { value: string }[]).map(o => o.value)).toEqual(['text', 'countdown', 'file', 'command', 'module'])
    expect(await pane.find({ type: 'Select', key: 'add-place' })).toBeDefined()
    await pane.press({ key: 'add-tab-StatusLine' })
    expect((await pane.find({ type: 'Button', key: 'add-tab-StatusLine' }))?.props['variant']).toBe('primary')
    expect((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['options']).toHaveLength(7)
    expect(await pane.find({ type: 'Select', key: 'add-place' })).toBeUndefined()
  })

  test('on VS Code Status Line\'s Add card keeps its form: no tabs, every kind', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'status', 'vscode')
    expect(await keysOf(pane, 'Button', 'add-tab-')).toEqual([])
    expect((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['options']).toHaveLength(7)
  })

  test('on VS Code the pane keeps its form, with the block\'s kinds, and a full block still refuses', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const pane = await openFrom($, 'h3', 'vscode')
    expect(await keysOf(pane, 'Button', 'add-tab-')).toEqual([])
    expect(((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['options'] as { value: string }[]).map(o => o.value)).toEqual(['text', 'countdown', 'file', 'command', 'module'])
    await pane.input({ key: 'add-name', text: 'Five', kind: 'change' })
    await pane.input({ key: 'add-text', text: '5', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    expect(stored(w).cards).toHaveLength(12)
    expect(await pane.find({ type: 'Text', text: /H3 is full/ })).toBeDefined()
  })

  // Claude Design step 5b (s38, ruling 2: only a lit card takes a place, so a card turned on needs room; the owner 「接受現在的寬度直接做後半」):
  // the panel refuses to light a card in a full block, a size press moves no lit card into one, and /ss examples fills a block to its places
  const FULL_LINE = 'H3 is full: 3 of 3 taken. Turn a card off or delete one in showchart first.'

  test('turning a card on in a full block is refused, with a toast naming the block; with one turned off it lights', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const off = () => (w.store['settings'] as { off: string[] }).off
    // H3: One, Two, Three lit; Four (c12) off
    await ui.press({ key: 'toggle-c12' })
    expect(off()).toContain('c12')
    expect(w.toasts).toEqual([FULL_LINE])
    // turning one off is never refused; then Four lights
    await ui.press({ key: 'toggle-c9' })
    expect(off()).toContain('c9')
    await ui.press({ key: 'toggle-c12' })
    expect(off()).not.toContain('c12')
    expect(w.toasts).toHaveLength(1)
    // a block with room: Beta (H2, two of five lit) lights at once
    await ui.press({ key: 'toggle-c6' })
    expect(off()).not.toContain('c6')
  })

  test('a size press moves no lit card into a full block (a toast says why); an off card moves, and a lit one into room', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const sizeIn = (id: string) => (w.store['settings'] as { cards: { id: string; size?: string }[] }).cards.find(c => c.id === id)?.size
    // Alpha and Gamma (H2, lit) to H2-half, which then holds two of two
    await ui.press({ key: 'size-c5' })
    await ui.press({ key: 'size-c7' })
    expect([sizeIn('c5'), sizeIn('c7')]).toEqual(['H2-half', 'H2-half'])
    // Beta, off, takes no place: it moves into the full H2-half
    await ui.press({ key: 'size-c6' })
    expect(sizeIn('c6')).toBe('H2-half')
    expect(w.toasts).toEqual([])
    // Note (H2-full, lit) would go to H3, full: it stays
    await ui.press({ key: 'size-c8' })
    expect(sizeIn('c8')).toBe('H2-full')
    expect(w.toasts).toEqual([FULL_LINE])
  })

  test('/ss examples fills each block only to its places: a full block gets none', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    // H2 holds two of five lit, H2-full and H3 are full; H2-half, H3-half and H3-full are empty
    expect((await sl($, 'examples')).text).toBe('8 example cards added; the six display blocks are on')
    const added = (w.store['settings'] as { cards: { id: string; kind: string; size?: string; text: string }[] }).cards.filter(c => c.kind === 'module')
    expect(added.map(c => `${c.size} ${c.text}`)).toEqual([
      'H2 session.ctx', 'H2 session.5h', 'H2 session.7d',
      'H2-half host.overview', 'H2-half host.load',
      'H3-half session.commits', 'H3-half host.diskchart', 'H3-full session.timeline',
    ])
  })

  // Ruling 4 and 「丙」 (s38): a 開關卡 in AbovePrompt is H1's: it stands in touchbar and on the band as a button, ● and its name while on,
  // ○ and its name, grey, while off; drawn either way, it always takes a place; a press sends its off or on command, as its name in the panel does
  const SWITCHED = (off: string[] = []) => ({ language: 'zh-TW', settings: { off, note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2', 'c3'], cards: [
    { id: 'c1', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
    { id: 'c2', kind: 'switch', name: '探針', text: 'probe', prefix: '', onArgs: '', offArgs: 'off', section: 'above' },
    { id: 'c3', kind: 'button', name: '存檔', text: '--S', prefix: '', section: 'above' },
  ] } })
  const BAND_AT = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never

  test('a 開關卡 added in H1 stands in touchbar and takes a place there, on or off', async ($, on) => {
    const w = world()
    w.store = STEP5()
    engine(on, w)
    await start($)

    let pane = await openFrom($, 'touch')
    await pane.select({ key: 'add-kind', value: 'switch' })
    await pane.input({ key: 'add-name', text: 'Probe', kind: 'change' })
    await pane.input({ key: 'add-text', text: 'probe', kind: 'change' })
    await pane.input({ key: 'add-off', text: 'off', kind: 'change' })
    await pane.press({ key: 'add-ok' })
    await pane.unmount()
    expect(stored(w).cards[12]).toMatchObject({ id: 'c13', kind: 'switch', section: 'above' })
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    expect(walk((await ui.find({ type: 'Box', key: 'touch-cards' }))?.children).map(el => String(el.props?.['key']))).toContain('card-c13')
    // off, it still takes its place (Go, Save, Help, then Probe)
    await ui.press({ key: 'toggle-c13' })
    expect(w.commands).toEqual(['probe off'])
    pane = await openFrom($, 'touch')
    expect((await listed(pane))[3]).toBe('H1-4 | Probe')
  })

  test('on the band: ● and its name while on, ○ and grey while off; a press sends the off then the on command and turns it', async ($, on) => {
    const w = world()
    w.store = SWITCHED()
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: BAND_AT })
    const key = async () => ((await band.findAll({ type: 'Button' })) as { key?: string; props: Record<string, unknown> }[]).map(b => String(b.key ?? b.props['key']))
    expect(await key()).toEqual(['band-c1', 'band-c2', 'band-c3'])
    const probe = async () => band.find({ type: 'Button', key: 'band-c2' })
    expect(bare((await probe())?.text)).toBe('²●探針')
    expect((await probe())?.props['dimColor']).not.toBe(true)
    await band.press({ key: 'band-c2' })
    expect(w.commands).toEqual(['probe off'])
    expect(bare((await probe())?.text)).toBe('²○探針')
    expect((await probe())?.props['dimColor']).toBe(true)
    // the buttons after it keep their places
    expect(bare((await band.find({ type: 'Button', key: 'band-c3' }))?.text)).toBe('³存檔')
    await band.press({ key: 'band-c2' })
    expect(w.commands).toEqual(['probe off', 'probe'])
    expect(bare((await probe())?.text)).toBe('²●探針')
  })

  test('a 開關卡 kept off from before is drawn grey, not left out; touchbar\'s picture shows it with its mark', async ($, on) => {
    const w = world()
    w.store = SWITCHED(['c2'])
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: BAND_AT })
    expect(bare((await band.find({ type: 'Button', key: 'band-c2' }))?.text)).toBe('²○探針')
    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'vscode', component: 'CommandOutput', props: PANEL })
    const picture = walk((await ui.find({ type: 'Box', key: 'touch-band' }))?.children).find(el => el.type === 'Svg')
    expect(picture?.props['alt']).toBe('touchbar ¹說明 ²○探針 ³存檔')
  })
})

// Claude Design step 8 (s38; the design's screen 5 and its decided list 「全空時：…AbovePrompt 用一行文字取代縮圖；收合的空選單右邊留空…日文先用草稿」):
// on the desktop, what an empty place says: Status Line with 版本號 alone, a menu with no card (and no picture beside its name), the 編輯 grid
// with nothing to move, the Profile pane with no profile; an English 刪除 asks 「Yes, delete」 (the decided short words)
describe('empty states (Claude Design step 8)', () => {
  const ONLY_VERSION = (more: Record<string, unknown> = {}) => ({ language: 'en', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER],
    removed: [...DEFAULT_ORDER.filter(k => k !== 'ver'), 'icons'], cards: [], ...more } })
  const panel = ($: Engine) => $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const keysIn = (node: unknown) => walk(node).map(el => String(el.props?.['key']))

  test('版本號 alone in Status Line: a line beside its card says Default brings the built-in cards back; narrow, under it', async ($, on) => {
    const w = world()
    w.store = ONLY_VERSION()
    engine(on, w)
    await start($)

    let ui = await panel($)
    expect(await ui.find({ type: 'Text', text: 'Only Version is left. Default brings the built-in cards back.' })).toBeDefined()
    expect(keysIn((await ui.find({ type: 'Box', key: 'row-0' }))?.children)).toContain('sl-empty')
    await ui.unmount()
    w.store = ONLY_VERSION({ narrow: true })
    await sl($, 'reload')
    ui = await panel($)
    expect(keysIn((await ui.find({ type: 'Box', key: 'row-0' }))?.children)).not.toContain('sl-empty')
    expect(await ui.find({ type: 'Box', key: 'sl-empty' })).toBeDefined()
    // with 符號 still there, 版本號 is not alone: no line
    await ui.unmount()
    w.store = ONLY_VERSION({ removed: DEFAULT_ORDER.filter(k => k !== 'ver') })
    await sl($, 'reload')
    ui = await panel($)
    expect(await ui.find({ type: 'Box', key: 'sl-empty' })).toBeUndefined()
  })

  test('a menu with no card says so and how many it holds, and draws no picture beside its name', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [
      { id: 'c1', kind: 'text', name: 'One', text: '1', prefix: '', section: 'above', size: 'H3' },
    ] } }
    engine(on, w)
    await start($)

    const ui = await panel($)
    expect(await ui.find({ type: 'Text', text: 'No cards in showinfo yet. It holds up to 5.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'No cards in touchbar yet. It holds up to 12.' })).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'h2-band' })).toBeUndefined()
    // a menu with a card keeps its picture and says nothing of the kind
    expect(await ui.find({ type: 'Box', key: 'h3-band' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /No cards in showchart yet/ })).toBeUndefined()
  })

  test('the 編輯 grid with nothing to move says so: Version stays first', async ($, on) => {
    const w = world()
    w.store = ONLY_VERSION()
    engine(on, w)
    await start($)

    const ui = await panel($)
    await ui.press({ key: 'sort' })
    expect(await ui.find({ type: 'Text', text: 'Nothing to move. Version stays first.' })).toBeDefined()
  })

  test('the Profile pane with no profile says how to make one; an English 刪除 asks Yes, delete', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], cards: [] } }
    w.git[['sh', '-c', 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"'].join(' ')] = { exitCode: 0, stdout: '/home/k/.claude' }
    engine(on, w)
    await start($)

    const ui = await panel($)
    await ui.press({ key: 'profile' })
    const pane = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', props: { title: 'Profile', isFocused: false, bodyColumns: 60, placement: 'dock' } as never, requestId: 'ss-profile' })
    expect(await pane.find({ type: 'Text', text: 'No profiles yet. Save one above, or put a .json file in the folder and press Refresh.' })).toBeDefined()
    await ui.press({ key: 'sort' })
    await ui.press({ key: 'grid-delete-who', in: 'grid-status' })
    expect(unpadded((await ui.find({ type: 'Button', key: 'grid-delete-who', in: 'grid-status' }))?.text ?? '')).toBe('Yes, delete')
  })

  for (const [language, alone, menu] of [
    ['zh-TW', '只剩版本號。按預設可以找回內建卡片。', 'showinfo 還沒有卡片，最多可放 5 張。'],
    ['ja', 'バージョンだけが残っています。デフォルトで組み込みカードを戻せます。', 'showinfo にはまだカードがありません。最大 5 枚です。'],
  ] as const) {
    test(`in ${language} the same lines`, async ($, on) => {
      const w = world()
      w.store = { ...ONLY_VERSION(), language }
      engine(on, w)
      await start($)

      const ui = await panel($)
      expect(await ui.find({ type: 'Text', text: alone })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: menu })).toBeDefined()
    })
  }
})

// s39 (the owner's day mode: 「我如果改成daymode 還是黑卡耶」, 「這邊也都看不清楚字」; the theme probe 14.webp-16.webp: an SVG image follows the app's
// day and night through prefers-color-scheme, a rule on [fill="…"] overriding the attribute; 「可以」 on the swatches): every picture the mod
// draws carries, right after its opening tag, a rule turning each dark colour it uses into its day counterpart (GitHub's light palette);
// the track's grey stays. And the AbovePrompt switches' rows stand half a row apart (gap-lab 14.webp: B, 5-6 px), wide and narrow.
describe('day mode and the switch rows (s39)', () => {
  const ABOVE = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const ADD = { title: 'Add card', isFocused: false, bodyColumns: 40, placement: 'dock' } as never
  // the swatches as the owner approved them, and the add-card pane's chosen place (#b1b9f9, a light blue) to the day blue
  const DAY_TABLE: Record<string, string> = {
    '#262626': '#f6f8fa', '#f2f2f2': '#1f2328', '#c9d1d9': '#424a53', '#8a8a8a': '#656d76', '#3fb950': '#1a7f37',
    '#d29922': '#9a6700', '#f85149': '#cf222e', '#58a6ff': '#0969da', '#bc8cff': '#8250df', '#b1b9f9': '#0969da',
  }
  const STAYS = ['#808080', 'none']
  const svgsIn = (node: unknown) => walk([node]).filter(el => el.type === 'Svg').map(el => String(el.props['source']))
  // what is wrong with one picture: no day rule after its opening tag, a colour with no day counterpart, a colour used with no rule
  const wrongIn = (source: string) => {
    const open = /^<svg[^>]*>/.exec(source)?.[0] ?? ''
    const rest = source.slice(open.length)
    const style = /^<style>@media \(prefers-color-scheme: light\)\{([^<]*)\}<\/style>/.exec(rest)
    if (style === null) return [`no day rule: ${source.slice(0, 80)}`]
    const body = rest.slice(style[0].length)
    const used = [...body.matchAll(/(fill|stroke)="([^"]+)"/g)].map(m => [m[1] as string, (m[2] as string).toLowerCase()] as const)
    return used.flatMap(([attr, colour]) =>
      STAYS.includes(colour) ? [] : DAY_TABLE[colour] === undefined ? [`${attr} ${colour} has no day colour`]
        : (style[1] ?? '').includes(`[${attr}="${colour}"]{${attr}:${DAY_TABLE[colour]}}`) ? [] : [`${attr} ${colour}: no rule`])
  }

  test('every picture in the panel (wide and narrow), the band and the add-card pane carries its day colours', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], cards: [
      { id: 'c1', kind: 'button', name: 'Help', text: '--h', prefix: '', section: 'above' },
    ] } }
    engine(on, w)
    await start($)
    await sl($, 'examples')

    const panel = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const wide = svgsIn(await panel.drawn())
    await panel.press({ key: 'panel-layout' })
    const narrow = svgsIn(await panel.drawn())
    await panel.press({ key: 'panel-layout' })
    await panel.press({ key: 'h2-add-card' })
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    const onBand = svgsIn(await band.drawn())
    const pane = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', props: ADD, requestId: 'sl-add' })
    const inPane = svgsIn(await pane.drawn())
    // the panel's dials and pictures, the band's charts and tiles, the pane's places: each kind there
    expect([wide.length > 10, narrow.length > 10, onBand.length >= 10, inPane.length >= 1]).toEqual([true, true, true, true])
    expect([...wide, ...narrow, ...onBand, ...inPane].flatMap(wrongIn).slice(0, 5)).toEqual([])
  })

  test('the switches\' rows stand half a row apart, wide and narrow; the first row and 編輯 預設 新增卡片 as before', async ($, on) => {
    const w = world()
    w.store = { language: 'en' }
    engine(on, w)
    await start($)

    const panel = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    const gapOf = async (key: string) => ((await panel.find({ type: 'Box', key })) as El | undefined)?.props['gap']
    expect([await gapOf('above-tools-row'), await gapOf('panel-tools'), await gapOf('tools-row')]).toEqual([0.5, undefined, undefined])
    await panel.press({ key: 'panel-layout' })
    expect(await gapOf('above-tools-row')).toBe(0.5)
  })
})


// the owner 2026-10-15 s40 「現在就做 C–E，用 semibold，先寫測試」: Claude Code 2.1.299 deprecates Text's bold (read as weight semibold); every
// bold the mod drew becomes weight 'semibold', so the look stays (s40 2.webp, 3.webp: bold / plain ink 1.37 under 2.1.299, 1.31-1.35
// under 2.1.295). On the desktop, VS Code and the phone 2.1.299 fills the pair: a Text given bold or weight semibold reaches them with both
// (s40 phase 1, the kit's find and drawn alike), so there the two are one drawing and a bold put back draws the same; the terminal and a
// Client region keep the prop given, so there each check also asks that no Text carries bold.
describe('Text weight for Claude Code 2.1.299 (s40)', () => {
  const RICH = () => ({ language: 'en', settings: { off: ['c3'], note: '', icons: true, order: [...DEFAULT_ORDER, 'c1', 'c3'], aboveOrder: ['c2', 'c4'], cards: [
    { id: 'c1', kind: 'text', name: 'Next', text: 'wait', prefix: '' },
    { id: 'c3', kind: 'text', name: 'Later', text: 'soon', prefix: '' },
    { id: 'c2', kind: 'text', name: 'Alpha', text: 'a', prefix: '', section: 'above', size: 'H2' },
    { id: 'c4', kind: 'button', name: 'Go', text: 'go', prefix: '', section: 'above' },
  ] } })
  type Found = { text?: string; props: Record<string, unknown> }
  // the texts drawn semibold, and every Text that still carries bold or another weight (both lists empty when right)
  const weighed = (found: Found[]) => ({
    semibold: found.filter(t => t.props['weight'] === 'semibold').map(t => t.text),
    bold: found.filter(t => t.props['bold'] !== undefined).map(t => t.text),
    other: found.filter(t => t.props['weight'] !== undefined && t.props['weight'] !== 'semibold').map(t => t.text),
  })
  const HEADERS = ['StatusLine', 'AbovePrompt', 'showchart-full', 'showchart-half', 'showchart', 'showinfo-full', 'showinfo-half', 'showinfo', 'touchbar']

  test('the panel on every surface: the section and menu names and a card\'s name semibold; no Text bold on the terminal', async ($, on) => {
    const w = world()
    w.store = RICH()
    engine(on, w)
    await start($)

    for (const surface of ['desktop', 'terminal', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'superstatus', surface, component: 'CommandOutput', props: PANEL })
      const got = weighed((await ui.findAll({ type: 'Text' })) as Found[])
      // bold off the terminal is the engine's own half of the pair
      expect({ surface, bold: surface === 'terminal' ? got.bold : [], other: got.other }).toEqual({ surface, bold: [], other: [] })
      // Alpha: the display card's name heading its card
      expect(HEADERS.concat('Alpha').filter(t => !got.semibold.includes(t))).toEqual([])
      await ui.unmount()
    }
  })

  test('the terminal\'s cards: the value of a card on semibold, of a card off plain; 符號 semibold while on, its words plain while off', async ($, on) => {
    const w = world()
    w.store = RICH()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'CommandOutput', props: PANEL })
    // the one Text reading exactly so (a find by text also matches the status line's preview, which holds the values)
    const weightOf = async (text: string) => {
      const found = ((await ui.findAll({ type: 'Text' })) as Found[]).filter(t => t.text === text)
      expect(found.length).toBe(1)
      return { weight: found[0]?.props['weight'], bold: found[0]?.props['bold'] }
    }
    expect(await weightOf('wait')).toEqual({ weight: 'semibold', bold: undefined })
    expect(await weightOf('soon')).toEqual({ weight: undefined, bold: undefined })
    expect(await weightOf('◉ ★ ⎇ ✓')).toEqual({ weight: 'semibold', bold: undefined })
    await ui.press({ key: 'toggle-icons' })
    expect(await weightOf('words')).toEqual({ weight: undefined, bold: undefined })
  })

  test('the Profile pane: its list heading and each profile\'s name semibold, on the desktop and off it; no Text bold on the terminal', async ($, on) => {
    const DIR = '/home/k/.claude/superstatus/profiles'
    const w = world()
    w.store = RICH()
    w.git[['sh', '-c', 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"'].join(' ')] = { exitCode: 0, stdout: '/home/k/.claude' }
    w.files[`${DIR}/work.json`] = `${JSON.stringify({ kind: 'superstatus-profile', format: 1, name: 'work', savedAt: '2026-10-11T01:00:00.000Z', version: '0.3', language: 'en', settings: RICH().settings }, null, 2)}\n`
    w.dirs = { ...(w.dirs ?? {}), [DIR]: [file('work.json', 1)] }
    engine(on, w)
    await start($)

    const panel = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await panel.press({ key: 'profile' })
    await panel.unmount()
    const props = { title: 'Profile', isFocused: false, bodyColumns: 60, placement: 'dock' } as never
    for (const [surface, heavy] of [['desktop', ['Profiles', 'work']], ['terminal', ['work']]] as const) {
      const pane = await $.ui.mount({ plugin: 'superstatus', surface, component: 'Pane', props, requestId: 'ss-profile' })
      const got = weighed((await pane.findAll({ type: 'Text' })) as Found[])
      expect({ surface, ...got, bold: surface === 'terminal' ? got.bold : [] }).toEqual({ surface, semibold: heavy, bold: [], other: [] })
      await pane.unmount()
    }
  })

  // drawn on the desktop only, where bold and weight semibold are one drawing: this guards the weight, not the spelling
  test('the add-card pane: each block\'s name in its fold row and the block\'s list heading semibold, nothing else weighted', async ($, on) => {
    const w = world()
    w.store = RICH()
    engine(on, w)
    await start($)

    const panel = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await panel.press({ key: 'h2-add-card' })
    await panel.unmount()
    const pane = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', props: ADD_PANE, requestId: 'sl-add' })
    const got = weighed((await pane.findAll({ type: 'Text' })) as Found[])
    expect({ semibold: got.semibold, other: got.other }).toEqual({ semibold: ['H1', 'H2', 'In this block', 'H2-half', 'H2-full', 'H3', 'H3-half', 'H3-full'], other: [] })
  })

  test('編輯\'s grid: the card held in a drag semibold, the others plain; no Text bold', async ($, on) => {
    const w = world()
    w.store = RICH()
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'sort' })
    const at = (place: number) => ({ x: ((place - 1) % 4) * 16 + 2, y: Math.floor((place - 1) / 4) * 6 + 1 })
    const inGrid = async () => weighed((await ui.findAll({ type: 'Text', in: 'grid-status' })) as Found[])
    expect(await inGrid()).toEqual({ semibold: [], bold: [], other: [] })
    await ui.pointer({ type: 'down', ...at(3), button: 'left', in: 'grid-status' })
    await ui.pointer({ type: 'move', ...at(2), button: 'left', in: 'grid-status' })
    expect(await inGrid()).toEqual({ semibold: ['2 Block'], bold: [], other: [] })
    await ui.pointer({ type: 'up', ...at(2), button: 'left', in: 'grid-status' })
  })
})

// the owner 2026-10-15 s40 「標籤頁設定SS 改 Settings」 (his screenshot of the pane's tab, 設定SS): the /ss panel's tab reads Settings however it
// opens (a band button sending /ss, the panel action module, a typed /ss), in every language, as Profile's does; the band button keeps
// the name he gave it.
describe('the /ss panel\'s tab reads Settings (s40)', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never
  const OPENERS = (language: string) => ({ language, settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: ['c1', 'c2'], cards: [
      { id: 'c1', kind: 'button', name: '設定SS', text: '/ss', prefix: '', section: 'above' },
      { id: 'c2', kind: 'module', name: '設定', text: 'action.panel', prefix: '', section: 'above' },
    ] } })

  for (const language of ['zh-TW', 'en', 'ja']) {
    test(`${language}: from the 設定SS button, the panel module and a typed /ss, the tab reads Settings; the button keeps its name`, async ($, on) => {
      const w = world()
      w.store = OPENERS(language)
      engine(on, w)
      await start($)

      const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
      const titles: string[] = []
      for (const key of ['band-c1', 'band-c2']) {
        delete w.titles['ss-panel']
        await band.press({ key })
        titles.push(w.titles['ss-panel'] ?? '(not opened)')
      }
      delete w.titles['ss-panel']
      await sl($, '')
      titles.push(w.titles['ss-panel'] ?? '(not opened)')
      expect(titles).toEqual(['Settings', 'Settings', 'Settings'])
      expect(bare((await band.find({ type: 'Button', key: 'band-c1' }))?.text)).toContain('設定SS')
    })
  }
})

// ---------------------------------------------------------------------------------------------------------------------------------
// The card tools (s41, the owner's 「A」 then 「好」): the model lists, adds and changes cards through superstatus itself, by the panel's own
// rules, so no Claude edits the store file by hand (the office Mac did, 10-16). A card that runs things (a 指令卡, a ! button, a button
// that sends words, a 開關卡) is added off and only the owner turns it on, in /ss; an off 指令卡 runs nothing.
const CARD_TOOL = (name: string) => `mcp__superstatus__${name}`
type ToolAnswer = { result?: unknown; deny?: string }
const callTool = ($: Engine, name: string, input: Record<string, unknown>) => $.tool.call({ tool: CARD_TOOL(name), ...input } as never) as Promise<ToolAnswer>
type StoredCard = { id: string; kind: string; name: string; text: string; section?: string; size?: string }
const kept = (w: World) => w.store['settings'] as { cards: StoredCard[]; off: string[]; order: string[]; aboveOrder: string[] }
const above = (id: string, kind: string, name: string, text: string, extra: Record<string, unknown> = {}) => ({ id, kind, name, text, prefix: '', section: 'above', ...extra })
const turnEnds = ($: Engine) => $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
const ranBash = (w: World, command: string) => w.ran.some(a => a[0] === 'bash' && a[1] === '-c' && a[2] === command)

describe('the card tools (s41): the model reads and changes the cards through superstatus, by the panel\'s rules', () => {
  test('four tools at session start, cards, add_card, change_card and add_module (s43); their descriptions carry the rules; behind ToolSearch (the prompt kept small)', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    expect((w.tools ?? []).map(t => t.name)).toEqual(['cards', 'add_card', 'change_card', 'add_module'])
    const add = w.tools?.find(t => t.name === 'add_card')
    for (const part of ['StatusLine', 'H1', 'H2-half', 'H3-full', 'command', 'end of every turn', '3 s', 'read-only', 'added off', '/ss', 'cards first'])
      expect(add?.description).toContain(part)
    expect(Object.keys((add?.inputSchema?.['properties'] ?? {}) as object)).toEqual(['kind', 'block', 'name', 'text', 'prefix', 'onArgs', 'offArgs', 'place', 'every'])
    expect(add?.inputSchema?.['required']).toEqual(['kind', 'block'])
    expect(w.tools?.find(t => t.name === 'change_card')?.description).toContain('only the user turns')
    expect((w.tools ?? []).every(t => t.isDeferred === undefined)).toBe(true)
  })

  test('cards: the Status Line items in their order, built-in and added, on or off; each AbovePrompt block with its places, how many are lit, its kinds and its cards', async ($, on) => {
    const w = world()
    w.store = {
      language: 'zh-TW',
      settings: {
        off: ['c2', 'tools'], note: '', icons: true, aboveOff: ['chart-full'],
        cards: [above('c1', 'text', '甲', 'a', { size: 'H2' }), above('c2', 'command', 'GPU', 'echo hi', { size: 'H2-half' }), above('c3', 'button', '存檔', '--S'), { id: 'c4', kind: 'text', name: '下一步', text: '等回覆', prefix: '' }],
      },
    }
    engine(on, w)
    await start($)

    const answer = await callTool($, 'cards', {})
    expect(answer.deny).toBeUndefined()
    const j = JSON.parse(String(answer.result)) as {
      language: string; nameMax: number
      statusLine: { id: string; builtIn?: boolean; on: boolean; kind?: string; name?: string; text?: string }[]
      abovePrompt: Record<string, { places: number; lit: number; full: boolean; shown: boolean; kinds: string[]; cards: { id: string; kind: string; name: string; on: boolean; place?: number; text: string }[] }>
    }
    expect([j.language, j.nameMax]).toEqual(['zh-TW', 4])
    expect(j.statusLine.find(i => i.id === 'tools')).toEqual({ id: 'tools', builtIn: true, on: false })
    expect(j.statusLine.find(i => i.id === 'c4')).toEqual({ id: 'c4', kind: 'text', name: '下一步', on: true, text: '等回覆' })
    expect(j.statusLine.map(i => i.id).slice(0, 2)).toEqual(['ver', 'who'])
    expect(Object.keys(j.abovePrompt)).toEqual(['H1', 'H2', 'H2-half', 'H2-full', 'H3', 'H3-half', 'H3-full'])
    expect(j.abovePrompt['H2']).toEqual({ places: 5, lit: 1, full: false, shown: true, kinds: ['text', 'countdown', 'file', 'command', 'module'], cards: [{ id: 'c1', kind: 'text', name: '甲', on: true, place: 1, text: 'a' }] })
    expect(j.abovePrompt['H2-half']?.cards).toEqual([{ id: 'c2', kind: 'command', name: 'GPU', on: false, text: 'echo hi' }])
    expect(j.abovePrompt['H1']).toMatchObject({ places: 12, lit: 1, kinds: ['button', 'switch', 'module'] })
    // a block its switch hides: a card added there is not seen until the owner shows it
    expect(j.abovePrompt['H3-full']?.shown).toBe(false)
    expect(j.abovePrompt['H1']?.cards).toEqual([{ id: 'c3', kind: 'button', name: '存檔', on: true, place: 1, text: '--S' }])
  })

  test('add_card: a text card into H2 lit at the next free place, kept in the store; a countdown into the Status Line at its end', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: true, cards: [above('c1', 'text', '甲', 'a', { size: 'H2' })] } }
    engine(on, w)
    await start($)

    const added = await callTool($, 'add_card', { kind: 'text', block: 'H2', name: '下一步', text: '等回覆' })
    expect(added.deny).toBeUndefined()
    const card = kept(w).cards.find(c => c.name === '下一步')
    expect(card).toMatchObject({ kind: 'text', text: '等回覆', section: 'above', size: 'H2' })
    expect(kept(w).off).not.toContain(card?.id)
    expect(kept(w).aboveOrder.filter(k => k === 'c1' || k === card?.id)).toEqual(['c1', card?.id])
    expect(String(added.result)).toContain(`${card?.id}`)
    expect(String(added.result)).toContain('H2-2')

    const dated = await callTool($, 'add_card', { kind: 'countdown', block: 'StatusLine', name: '交期', text: '2027-01-01' })
    expect(dated.deny).toBeUndefined()
    const d = kept(w).cards.find(c => c.name === '交期')
    expect(d?.section).toBeUndefined()
    expect(kept(w).order[kept(w).order.length - 1]).toBe(d?.id)
  })

  test('add_card refuses what the panel refuses, saying why, and changes nothing: a kind the block does not take, a name too long, a date that is none, a full block', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: true, cards: [above('c1', 'text', '甲', 'a', { size: 'H2-full' })] } }
    engine(on, w)
    await start($)
    const before = JSON.stringify(w.store['settings'])

    const wrongKind = await callTool($, 'add_card', { kind: 'button', block: 'H2', name: '存檔', text: '--S' })
    expect(wrongKind.deny).toContain('H2')
    expect(wrongKind.deny).toContain('text, countdown, file, command, module')
    const long = await callTool($, 'add_card', { kind: 'text', block: 'H2', name: '一二三四五', text: 'x' })
    expect(long.deny).toBe('名稱最多四個字，現在是 5 個字')
    const notADay = await callTool($, 'add_card', { kind: 'countdown', block: 'H2', name: '交期', text: '2027-02-30' })
    expect(notADay.deny).toBeDefined()
    const full = await callTool($, 'add_card', { kind: 'text', block: 'H2-full', name: '乙', text: 'b' })
    expect(full.deny).toContain('showinfo-full')
    const noBlock = await callTool($, 'add_card', { kind: 'text', block: 'H4', name: '乙', text: 'b' })
    expect(noBlock.deny).toContain('StatusLine')
    expect(JSON.stringify(w.store['settings'])).toBe(before)
  })

  test('add_card: a card that runs things (a 指令卡, a ! button, a button sending words, a 開關卡) is added off and its command not run; the answer gives the command and says Alex turns it on in /ss', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: true, cards: [] } }
    engine(on, w)
    await start($)

    const gpu = await callTool($, 'add_card', { kind: 'command', block: 'H2-half', name: 'GPU', text: 'echo hi' })
    expect(gpu.deny).toBeUndefined()
    const id = kept(w).cards.find(c => c.name === 'GPU')?.id ?? '?'
    expect(kept(w).off).toContain(id)
    expect(String(gpu.result)).toContain('echo hi')
    expect(String(gpu.result)).toContain('/ss')
    await turnEnds($)
    expect(ranBash(w, 'echo hi')).toBe(false)

    for (const [kind, name, text] of [['button', '開機', '!uptime'], ['button', '存檔', '--S'], ['switch', '探針', 'probe']]) {
      const r = await callTool($, 'add_card', { kind, block: 'H1', name, text })
      expect(r.deny).toBeUndefined()
      expect(kept(w).off).toContain(kept(w).cards.find(c => c.name === name)?.id)
    }
    expect(w.commands).toEqual([])
    expect(w.prompts).toEqual([])
  })

  test('add_card with a place: the new lit card stands before the one holding it, as the pane puts it', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: true, cards: [above('c1', 'text', '甲', 'a', { size: 'H2' }), above('c2', 'text', '乙', 'b', { size: 'H2' })] } }
    engine(on, w)
    await start($)

    const r = await callTool($, 'add_card', { kind: 'text', block: 'H2', name: '丙', text: 'c', place: 1 })
    expect(r.deny).toBeUndefined()
    const id = kept(w).cards.find(c => c.name === '丙')?.id
    expect(kept(w).aboveOrder.filter(k => ['c1', 'c2', id].includes(k))).toEqual([id, 'c1', 'c2'])
  })

  test('change_card: a rename and a new text by the panel\'s rules; a new command turns its card off; on for a card that runs things is refused; on into a full block is refused; off always works', async ($, on) => {
    const w = world()
    w.store = {
      language: 'zh-TW',
      settings: {
        off: ['c3'], note: '', icons: true,
        cards: [above('c1', 'text', '甲', 'a', { size: 'H2' }), above('c2', 'command', 'GPU', 'echo hi', { size: 'H2' }), above('c3', 'text', '丙', 'c', { size: 'H2-full' }), above('c4', 'text', '丁', 'd', { size: 'H2-full' }), above('c5', 'switch', '探針', 'probe', { onArgs: 'on', offArgs: 'off' })],
      },
    }
    engine(on, w)
    await start($)
    const cardOf = (id: string) => kept(w).cards.find(c => c.id === id)

    expect((await callTool($, 'change_card', { id: 'c1', name: '新名', text: 'z' })).deny).toBeUndefined()
    expect(cardOf('c1')).toMatchObject({ name: '新名', text: 'z' })
    expect((await callTool($, 'change_card', { id: 'c1', name: '一二三四五' })).deny).toBe('名稱最多四個字，現在是 5 個字')
    expect(cardOf('c1')?.name).toBe('新名')

    const newCommand = await callTool($, 'change_card', { id: 'c2', text: 'echo bye' })
    expect(newCommand.deny).toBeUndefined()
    expect(kept(w).off).toContain('c2')
    expect(String(newCommand.result)).toContain('/ss')
    const onAgain = await callTool($, 'change_card', { id: 'c2', on: true })
    expect(onAgain.deny).toContain('/ss')
    expect(kept(w).off).toContain('c2')
    expect((await callTool($, 'change_card', { id: 'c5', on: false })).deny).toContain('/ss')

    expect((await callTool($, 'change_card', { id: 'c3', on: true })).deny).toContain('showinfo-full')
    expect((await callTool($, 'change_card', { id: 'c4', on: false })).deny).toBeUndefined()
    expect((await callTool($, 'change_card', { id: 'c3', on: true })).deny).toBeUndefined()
    expect(kept(w).off).toEqual(expect.arrayContaining(['c4', 'c2']))
    expect(kept(w).off).not.toContain('c3')

    expect((await callTool($, 'change_card', { id: 'c99', on: false })).deny).toContain('c99')
    expect((await callTool($, 'change_card', { id: 'tools', on: false })).deny).toContain('/ss')
  })
})

describe('an off 指令卡 runs nothing (s41: as an off 模組卡 reads nothing; the card tools add one off)', () => {
  test('off: its command is not run at the start or at a turn\'s end', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: ['c1'], note: '', icons: true, cards: [{ id: 'c1', kind: 'command', name: 'GPU', text: 'echo hi', prefix: '' }] } }
    engine(on, w)
    await start($)
    await turnEnds($)
    expect(ranBash(w, 'echo hi')).toBe(false)
  })

  test('lit: it is', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: true, cards: [{ id: 'c1', kind: 'command', name: 'GPU', text: 'echo hi', prefix: '' }] } }
    engine(on, w)
    await start($)
    expect(ranBash(w, 'echo hi')).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// The touchbar pages (s41, the owner 「A感覺比較好 可以在pane做個打勾按鈕 讓我選 A或B這樣嗎？」, 「go，照這 7 個預設做」; docs/rulings.md): when the
// lit buttons do not all fit, A (the default) puts ‹ and › at the two ends, B a counter n/N at the right end; A stops at its ends, B goes
// round; a page's buttons keep their numbers; a press on a button keeps the page; a narrower band keeps the page's first button in view;
// all twelve fitting, nothing changes. Picked in the /ss panel, under AbovePrompt's switches: 「touchbar 翻頁」 ✓ A 箭頭 / B 頁碼.
const SUP_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
const sup = (n: number) => [...String(n)].map(d => SUP_DIGITS[Number(d)]).join('')
describe('the touchbar pages (s41)', () => {
  const twelve = (paging?: string) => ({
    language: 'zh-TW',
    settings: {
      off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER],
      aboveOrder: Array.from({ length: 12 }, (_, i) => `c${i + 1}`),
      cards: Array.from({ length: 12 }, (_, i) => ({ id: `c${i + 1}`, kind: 'button', name: `鈕${i + 1}`, text: '--h', prefix: '', section: 'above' })),
      ...(paging === undefined ? {} : { paging }),
    },
  })
  const bandAt = ($: Engine, columns: number, surface: 'desktop' | 'terminal' = 'desktop') =>
    $.ui.mount({ plugin: 'superstatus', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columns } as never })
  type Band = Awaited<ReturnType<typeof bandAt>>
  const keysOf = async (band: Band) => (await band.findAll({ type: 'Button' })).map(b => String((b as { key?: string }).key ?? b.props['key']))
  const onPage = async (band: Band) => (await keysOf(band)).filter(k => /^band-c\d+$/.test(k))
  const control = (band: Band, key: string) => band.find({ type: 'Button', key })

  test('all twelve fitting (119 cells): no arrow, the row as before', async ($, on) => {
    const w = world()
    w.store = twelve()
    engine(on, w)
    await start($)
    const band = await bandAt($, 119)
    expect((await keysOf(band)).filter(k => k.startsWith('band-page'))).toEqual([])
    expect(await onPage(band)).toEqual(Array.from({ length: 12 }, (_, i) => `band-c${i + 1}`))
  })

  test('B at 119 cells: no counter either', async ($, on) => {
    const w = world()
    w.store = twelve('counter')
    engine(on, w)
    await start($)
    const band = await bandAt($, 119)
    expect(await control(band, 'band-page-count')).toBeUndefined()
    expect((await onPage(band)).length).toBe(12)
  })

  test('A by default: ‹ first and › last; page 1 from ¹ with ‹ dim; › turns to the next page, numbers kept; › dims on the last and does nothing there; ‹ goes back', async ($, on) => {
    const w = world()
    w.store = twelve()
    engine(on, w)
    await start($)
    let band = await bandAt($, 63)
    const keys = await keysOf(band)
    expect([keys[0], keys[keys.length - 1]]).toEqual(['band-page-prev', 'band-page-next'])
    expect((await control(band, 'band-page-prev'))?.props['dimColor']).toBe(true)
    expect((await control(band, 'band-page-next'))?.props['dimColor']).toBe(false)
    expect((await control(band, 'band-page-prev'))?.props['label']).toBe('‹')
    expect((await control(band, 'band-page-next'))?.props['label']).toBe('›')
    const first = await onPage(band)
    const n = first.length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(12)
    expect(first).toEqual(Array.from({ length: n }, (_, i) => `band-c${i + 1}`))
    expect((await control(band, 'band-c1'))?.text).toMatch(/^¹/)

    const seen: string[] = [...first]
    let pages = 1
    while ((await control(band, 'band-page-next'))?.props['dimColor'] === false) {
      await band.press({ key: 'band-page-next' })
      band = await bandAt($, 63)
      const page = await onPage(band)
      // the page's first button keeps its number in the row of twelve
      expect((await control(band, page[0] as string))?.text?.startsWith(sup(seen.length + 1))).toBe(true)
      seen.push(...page)
      pages++
      expect(pages).toBeLessThan(13)
    }
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => `band-c${i + 1}`))
    expect((await control(band, 'band-page-prev'))?.props['dimColor']).toBe(false)
    // the dim › at the last page does nothing
    const last = await onPage(band)
    await band.press({ key: 'band-page-next' })
    band = await bandAt($, 63)
    expect(await onPage(band)).toEqual(last)
    await band.press({ key: 'band-page-prev' })
    band = await bandAt($, 63)
    expect((await onPage(band))[0]).not.toBe(last[0])
  })

  test('B: the counter at the right end, 1/N; each press the next page; after the last, page 1 again; no arrows', async ($, on) => {
    const w = world()
    w.store = twelve('counter')
    engine(on, w)
    await start($)
    let band = await bandAt($, 63)
    const keys = await keysOf(band)
    expect(keys.filter(k => k === 'band-page-prev' || k === 'band-page-next')).toEqual([])
    expect(keys[keys.length - 1]).toBe('band-page-count')
    const n = (await onPage(band)).length
    const total = Math.ceil(12 / n)
    expect(total).toBeGreaterThan(1)
    expect((await control(band, 'band-page-count'))?.props['label']).toBe(`1/${total}`)
    for (let p = 2; p <= total; p++) {
      await band.press({ key: 'band-page-count' })
      band = await bandAt($, 63)
      expect((await control(band, 'band-page-count'))?.props['label']).toBe(`${p}/${total}`)
      expect((await onPage(band))[0]).toBe(`band-c${(p - 1) * n + 1}`)
    }
    await band.press({ key: 'band-page-count' })
    band = await bandAt($, 63)
    expect((await control(band, 'band-page-count'))?.props['label']).toBe(`1/${total}`)
    expect((await onPage(band))[0]).toBe('band-c1')
  })

  test('a press on a button keeps its page; a narrower band keeps the page\'s first button in view', async ($, on) => {
    const w = world()
    w.store = twelve()
    engine(on, w)
    await start($)
    let band = await bandAt($, 63)
    const n = (await onPage(band)).length
    await band.press({ key: 'band-page-next' })
    band = await bandAt($, 63)
    const second = await onPage(band)
    await band.press({ key: second[0] as string })
    expect(w.prompts.map(p => p.text)).toEqual(['--h'])
    band = await bandAt($, 63)
    expect(await onPage(band)).toEqual(second)
    await band.unmount()
    const narrower = await bandAt($, 40)
    expect(await onPage(narrower)).toContain(`band-c${n + 1}`)
  })

  test('the terminal draws a Button as [ label ]: the arrows take more room there, so a page there holds fewer than the desktop\'s', async ($, on) => {
    const w = world()
    w.store = twelve()
    engine(on, w)
    await start($)
    const desktop = (await onPage(await bandAt($, 37))).length
    const terminal = (await onPage(await bandAt($, 37, 'terminal'))).length
    expect(terminal).toBeGreaterThan(0)
    expect(terminal).toBeLessThan(desktop)
  })

  test('the setting: B kept as paging "counter"; anything else is A, and dropped', async ($, on) => {
    const w = world()
    w.store = twelve('sideways')
    engine(on, w)
    await start($)
    const band = await bandAt($, 63)
    expect(await control(band, 'band-page-prev')).toBeDefined()
    expect(await control(band, 'band-page-count')).toBeUndefined()
  })

  test('the /ss panel: 「touchbar 翻頁」 under AbovePrompt\'s switches, ✓ A 箭頭 lit; B 頁碼 pressed keeps paging "counter", A drops it', async ($, on) => {
    const w = world()
    w.store = twelve()
    engine(on, w)
    await start($)
    const sites = [
      ['desktop', await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', requestId: 'ss-panel', props: { title: 'Settings', isFocused: false, bodyColumns: 80, placement: 'dock' } as never })],
      ['terminal', await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'CommandOutput', props: PANEL })],
    ] as const
    for (const [, ui] of sites) {
      expect(await ui.find({ type: 'Text', text: /touchbar 翻頁/ })).toBeDefined()
      const a = await ui.find({ type: 'Button', key: 'paging-arrows' })
      const b = await ui.find({ type: 'Button', key: 'paging-counter' })
      expect(bare(a?.text)).toContain('✓')
      expect(bare(a?.text)).toContain('箭')
      expect(a?.props['variant']).toBe('primary')
      expect(bare(b?.text)).not.toContain('✓')
      expect(bare(b?.text)).toContain('頁')
      expect(b?.props['variant']).toBe('secondary')
    }
    const [, pane] = sites[0]
    await pane.press({ key: 'paging-counter' })
    expect((w.store['settings'] as { paging?: string }).paging).toBe('counter')
    await pane.unmount()
    const after = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'Pane', requestId: 'ss-panel', props: { title: 'Settings', isFocused: false, bodyColumns: 80, placement: 'dock' } as never })
    expect(bare((await after.find({ type: 'Button', key: 'paging-counter' }))?.text)).toContain('✓')
    await after.press({ key: 'paging-arrows' })
    expect('paging' in (w.store['settings'] as object)).toBe(false)
  })

  for (const [code, name, a, b] of [['en', 'touchbar paging', 'A arrows', 'B counter'], ['ja', 'touchbar ページ送り', 'A 矢印', 'B ページ番号']] as const) {
    test(`the row's words in ${code}: ${name}, ${a}, ${b}`, async ($, on) => {
      const w = world()
      w.store = { ...twelve(), language: code }
      engine(on, w)
      await start($)
      const pane = await $.ui.mount({ plugin: 'superstatus', surface: 'terminal', component: 'CommandOutput', props: PANEL })
      expect(await pane.find({ type: 'Text', text: new RegExp(name) })).toBeDefined()
      expect(bare((await pane.find({ type: 'Button', key: 'paging-arrows' }))?.text)?.replace(/\s+/g, ' ')).toContain(a)
      expect(bare((await pane.find({ type: 'Button', key: 'paging-counter' }))?.text)?.replace(/\s+/g, ' ')).toContain(b)
    })
  }
})

// s43 (the owner 「步驟固定、內容彈性」, his B): a user's own modules, read from .claude/superstatus/modules the way the language
// folder has been read since s34. The file's own check is tests/usermods.test.ts; here is the folder: what is offered, what is
// refused and said out loud, and that a card made of one really runs its command and draws its line.
describe("a user's modules folder", () => {
  const MOD_DIR = `${CWD}/.claude/superstatus/modules`
  const entry = (name: string): Entry => ({ name, kind: 'file', size: 10, mtimeMs: 1, isLink: false })
  const panelOf = ($: Engine) => $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const GPU = ['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits']
  const file = (over: object = {}) =>
    JSON.stringify({ format: 1, id: 'user.gpu', name: 'GPU', about: 'the GPU', role: 'tile', runs: [GPU], values: { use: { from: 'run:0', line: 1, col: 1 } }, lines: ['GPU {use}%'], ...over })
  const moduleOptions = async (pane: { find: (q: object) => Promise<{ props: Record<string, unknown> } | undefined>; select: (a: object) => Promise<unknown> }) => {
    await pane.select({ key: 'add-kind', value: 'module' })
    return ((await pane.find({ type: 'Select', key: 'add-module' }))?.props['options'] as { value: string; label: string }[]) ?? []
  }

  test('a good .json in the folder is offered in 新增卡片, under its own group, beside the built-ins', async ($, on) => {
    const w = world()
    w.dirs = { [MOD_DIR]: [entry('gpu.json')] }
    w.files[`${MOD_DIR}/gpu.json`] = file()
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    await ui.press({ key: 'h3-add-card' })
    const options = await moduleOptions(await addPane($))
    expect(options.map(o => o.value)).toContain('user.gpu')
    expect(options.map(o => o.value)).toContain('host.disk')
    expect(options.find(o => o.value === 'user.gpu')?.label).toContain('GPU')
  })

  test('a file the check refuses is not offered, and the panel names the file and why', async ($, on) => {
    const w = world()
    w.dirs = { [MOD_DIR]: [entry('gpu.json'), entry('bad.json')] }
    w.files[`${MOD_DIR}/gpu.json`] = file()
    w.files[`${MOD_DIR}/bad.json`] = file({ id: 'host.gpu67' })
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    expect(await ui.find({ type: 'Text', text: /bad\.json/ })).toBeDefined()
    await ui.press({ key: 'h3-add-card' })
    const options = await moduleOptions(await addPane($))
    expect(options.map(o => o.value)).toContain('user.gpu')
    expect(options.map(o => o.value)).not.toContain('host.gpu67')
  })

  test('no folder at all: the built-ins are offered as before and nothing is said', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    expect(await ui.find({ type: 'Text', text: /\.json/ })).toBeUndefined()
    await ui.press({ key: 'h3-add-card' })
    const options = await moduleOptions(await addPane($))
    expect(options.map(o => o.value)).toContain('host.disk')
    expect(options.filter(o => o.value.startsWith('user.'))).toEqual([])
  })

  test('a file that is not .json is left alone, not read and not refused', async ($, on) => {
    const w = world()
    w.dirs = { [MOD_DIR]: [entry('notes.txt'), entry('gpu.json')] }
    w.files[`${MOD_DIR}/notes.txt`] = 'not a module'
    w.files[`${MOD_DIR}/gpu.json`] = file()
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    expect(await ui.find({ type: 'Text', text: /notes\.txt/ })).toBeUndefined()
    expect(w.read).not.toContain(`${MOD_DIR}/notes.txt`)
  })

  test('two files claiming the same id: the first by name is kept, the second named as a repeat', async ($, on) => {
    const w = world()
    w.dirs = { [MOD_DIR]: [entry('a-gpu.json'), entry('z-gpu.json')] }
    w.files[`${MOD_DIR}/a-gpu.json`] = file({ name: 'First' })
    w.files[`${MOD_DIR}/z-gpu.json`] = file({ name: 'Second' })
    engine(on, w)
    await start($)

    const ui = await panelOf($)
    expect(await ui.find({ type: 'Text', text: /z-gpu\.json not applied: user\.gpu is already a-gpu\.json's/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /a-gpu\.json not applied/ })).toBeUndefined()
    await ui.press({ key: 'h3-add-card' })
    const options = await moduleOptions(await addPane($))
    expect(options.filter(o => o.value === 'user.gpu').length).toBe(1)
    expect(options.find(o => o.value === 'user.gpu')?.label).toContain('First')
    expect(options.find(o => o.value === 'user.gpu')?.label).not.toContain('Second')
  })

  test("a card made of a user's module runs its command and draws its line", async ($, on) => {
    const w = world()
    w.dirs = { [MOD_DIR]: [entry('gpu.json')] }
    w.files[`${MOD_DIR}/gpu.json`] = file()
    w.git[GPU.join(' ')] = { exitCode: 0, stdout: '37, 2048, 16384\n' }
    w.store = { settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'],
      cards: [{ id: 'c1', kind: 'module', name: 'GPU', text: 'user.gpu', prefix: '', section: 'above', size: 'H3' }] } }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
    const lines = walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))
    expect(w.ran.map(a => a.join(' '))).toContain(GPU.join(' '))
    expect(lines).toContain('GPU 37%')
  })

  test('the folder is read again on a reload, so a file put there now is offered without a new session', async ($, on) => {
    const w = world()
    w.dirs = { [MOD_DIR]: [] }
    engine(on, w)
    await start($)

    w.dirs = { [MOD_DIR]: [entry('gpu.json')] }
    w.files[`${MOD_DIR}/gpu.json`] = file()
    const ui = await panelOf($)
    await ui.press({ key: 'panel-reload' })
    await ui.press({ key: 'h3-add-card' })
    const options = await moduleOptions(await addPane($))
    expect(options.map(o => o.value)).toContain('user.gpu')
  })
})

// s43 (the owner 「先把「加模組的工具」做掉」, after 「我想用我的自然語言新增不行嗎」): the model writes a module file through
// superstatus, which checks it, writes it and reads the folder again on the spot — so nothing waits for a Reload.
describe('add_module (s43): a module from a sentence, live without a reload', () => {
  const MODS = `${CWD}/.claude/superstatus/modules`
  const FILE = JSON.stringify({
    format: 1, id: 'user.gpu', name: { en: 'GPU' }, about: { en: 'the GPU' }, role: 'tile',
    runs: [['nvidia-smi', '--q']], values: { use: { from: 'run:0', line: 1, col: 1 } }, lines: ['GPU {use}%'],
    chart: { shape: 'rings', head: 'GPU', items: [{ label: 'G0', percent: '{use}', value: '{use}%' }] },
  })
  const entry = (name: string): Entry => ({ name, kind: 'file', size: 10, mtimeMs: 1, isLink: false })
  const panelOf = ($: Engine) => $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })

  test('it is the fourth tool, and its description carries the rules a module file must keep', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    expect((w.tools ?? []).map(t => t.name)).toEqual(['cards', 'add_card', 'change_card', 'add_module'])
    const add = w.tools?.find(t => t.name === 'add_module')
    for (const part of ['user.', 'format', 'rings', 'bars', 'argv', '3 s', 'line', 'col', '?'])
      expect(add?.description).toContain(part)
    expect(Object.keys((add?.inputSchema?.['properties'] ?? {}) as object)).toEqual(['file', 'name'])
    expect(add?.inputSchema?.['required']).toEqual(['file'])
  })

  test('a good file is written to the modules folder and the module is on offer at once, with no reload', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const answer = await callTool($, 'add_module', { file: FILE })
    expect(answer.deny).toBeUndefined()
    expect(String(answer.result)).toContain('user.gpu')
    expect(w.written).toContain(`${MODS}/user.gpu.json`)
    // on offer without anything being reloaded
    const ui = await panelOf($)
    await ui.press({ key: 'h3-add-card' })
    const pane = await addPane($)
    await pane.select({ key: 'add-kind', value: 'module' })
    const options = ((await pane.find({ type: 'Select', key: 'add-module' }))?.props['options'] as { value: string }[]) ?? []
    expect(options.map(o => o.value)).toContain('user.gpu')
  })

  test('the name given is used for the file; without one the id is', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    await callTool($, 'add_module', { file: FILE, name: 'gpu67' })
    expect(w.written).toContain(`${MODS}/gpu67.json`)
  })

  test('a file the check refuses is denied with the reason, and nothing is written', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const answer = await callTool($, 'add_module', { file: JSON.stringify({ format: 1, id: 'host.gpu', role: 'tile', lines: ['x'] }) })
    expect(answer.deny).toContain('user.')
    expect(w.written ?? []).toEqual([])
  })

  test('text that is not JSON at all is denied, and nothing is written', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const answer = await callTool($, 'add_module', { file: '{ nope' })
    expect(answer.deny).toBeDefined()
    expect(w.written ?? []).toEqual([])
  })

  test('an id another file in the folder already has is denied, and that file is not overwritten', async ($, on) => {
    const w = world()
    w.dirs = { [MODS]: [entry('taken.json')] }
    w.files[`${MODS}/taken.json`] = FILE
    engine(on, w)
    await start($)

    const answer = await callTool($, 'add_module', { file: FILE, name: 'mine' })
    expect(answer.deny).toContain('taken.json')
    expect(w.written ?? []).toEqual([])
  })

  test('a file that appeared since this session started is seen too: the id it holds is denied, not overwritten (s43 mutant R7)', async ($, on) => {
    const w = world()
    w.dirs = { [MODS]: [] }
    engine(on, w)
    await start($)

    // someone else (or the owner) drops a module file in while this session is running
    w.dirs = { [MODS]: [entry('his.json')] }
    w.files[`${MODS}/his.json`] = FILE
    const answer = await callTool($, 'add_module', { file: FILE, name: 'mine' })
    expect(answer.deny).toContain('his.json')
    expect(w.written ?? []).toEqual([])
  })

  test('written, then placed by add_card in one go: the card is in the store and names the module', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    await callTool($, 'add_module', { file: FILE })
    const placed = await callTool($, 'add_card', { kind: 'module', block: 'H3', name: 'GPU', text: 'user.gpu' })
    expect(placed.deny).toBeUndefined()
    const cards = kept(w).cards
    expect(cards[cards.length - 1]).toMatchObject({ kind: 'module', text: 'user.gpu' })
  })
})

// s43 (待你裁決 5, held over since s34; the owner 「小卡更新秒數的設定可以加上去嗎？」): each card may carry its own interval.
// Until now one timer re-read every tile module every 60 s. A card's seconds decide how often ITS module is read; where two
// lit cards share a module the shorter wins; below the floor the number is ignored and 60 stands.
describe('a refresh interval per card (s43)', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const store = (list: object[], off: string[] = []) => ({ settings: { off, note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: list.map(c => (c as { id: string }).id), cards: list } })
  const mod = (id: string, every?: number) => ({ id, kind: 'module', name: '主機', text: 'host.overview', prefix: '', section: 'above', ...(every === undefined ? {} : { every }) })
  const lineOf = async (band: { find: (q: object) => Promise<{ children?: unknown } | undefined> }, key: string) =>
    walk((await band.find({ type: 'Box', key: `band-frame-${key}` }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))[0]
  const mounted = ($: Engine) => $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })

  test('a card that says 10 seconds has its module read again at 10, not at 60', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([mod('c1', 10)])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    const band = await mounted($)
    expect(await lineOf(band, 'c1')).toBe('主機 box')
    w.files['/proc/sys/kernel/hostname'] = 'pve2\n'
    await clock.advance(9999)
    expect(await lineOf(band, 'c1')).toBe('主機 box')
    await clock.advance(1)
    expect(await lineOf(band, 'c1')).toBe('主機 pve2')
  })

  test('a card that says nothing keeps the minute it has always had', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([mod('c1')])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    const band = await mounted($)
    w.files['/proc/sys/kernel/hostname'] = 'pve2\n'
    await clock.advance(59999)
    expect(await lineOf(band, 'c1')).toBe('主機 box')
    await clock.advance(1)
    expect(await lineOf(band, 'c1')).toBe('主機 pve2')
  })

  test('two lit cards of one module: the shorter of the two decides how often it is read', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([mod('c1', 60), mod('c2', 10)])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    const band = await mounted($)
    w.files['/proc/sys/kernel/hostname'] = 'pve2\n'
    await clock.advance(10000)
    expect(await lineOf(band, 'c1')).toBe('主機 pve2')
    expect(await lineOf(band, 'c2')).toBe('主機 pve2')
  })

  test('the shorter wins whichever order the two cards are in (s43 mutant S3)', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    // the short one FIRST this time: taking the last card's seconds would give a minute and this would not move
    w.store = store([mod('c1', 10), mod('c2', 60)])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    const band = await mounted($)
    w.files['/proc/sys/kernel/hostname'] = 'pve2\n'
    await clock.advance(10000)
    expect(await lineOf(band, 'c1')).toBe('主機 pve2')
  })

  test('a tick reads only what is due: the 10-second card is read again, the minute card is left alone (s43 mutant S5)', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([mod('c1', 10), { id: 'c2', kind: 'module', name: '磁碟', text: 'host.disk', prefix: '', section: 'above', size: 'H3', every: 60 }])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    await mounted($)
    const hosts = () => w.read.filter(p => p === '/proc/sys/kernel/hostname').length
    const dfs = () => w.ran.filter(a => a[0] === 'df').length
    const h0 = hosts()
    const d0 = dfs()
    await clock.advance(10000)
    expect(hosts()).toBeGreaterThan(h0)
    expect(dfs()).toBe(d0)
    // at the minute the disk's turn comes round too
    await clock.advance(50000)
    expect(dfs()).toBeGreaterThan(d0)
  })

  test('a number under the floor is ignored and the minute stands: nobody reads the host every second', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([mod('c1', 1)])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    const band = await mounted($)
    w.files['/proc/sys/kernel/hostname'] = 'pve2\n'
    await clock.advance(30000)
    expect(await lineOf(band, 'c1')).toBe('主機 box')
    await clock.advance(30000)
    expect(await lineOf(band, 'c1')).toBe('主機 pve2')
  })

  test("an off card's seconds pull nothing: its module is not read at all", async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([mod('c1', 10)], ['c1'])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    // nothing is drawn with every card off, so the band is not mounted: the reads are what this test is about
    const reads = () => w.read.filter(p => p === '/proc/sys/kernel/hostname').length
    const before = reads()
    await clock.advance(60000)
    expect(reads()).toBe(before)
  })
})

// s43 (the owner 「要合理呀…你是用工程師思維在設計產品」, then 「你說的OK」): a card is not a number to type. Every module carries
// its own rhythm so nothing has to be set; a card may pick another from the menu; 0 is 只在回合結束 and never on the timer.
// A 指令卡 takes none at all and keeps running at a turn's end (「指令卡不需要，謝謝」).
describe('a rhythm every card already has (s43)', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const store = (list: object[], off: string[] = []) => ({ settings: { off, note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: list.map(c => (c as { id: string }).id), cards: list } })
  const card = (id: string, text: string, every?: number) => ({ id, kind: 'module', name: '主機', text, prefix: '', section: 'above', size: 'H3', ...(every === undefined ? {} : { every }) })
  const mounted = ($: Engine) => $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })

  test('a module that reads something slow says so itself: the disk is not run again on the minute, but is at five', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([card('c1', 'host.disk')])
    w.mockClock = true
    engine(on, w)
    await start($)

    await mounted($)
    const dfs = () => w.ran.filter(a => a[0] === 'df').length
    const before = dfs()
    await clock.advance(60000)
    expect(dfs()).toBe(before)
    await clock.advance(240000)
    expect(dfs()).toBeGreaterThan(before)
  })

  test("a card's own rhythm beats the module's: the slow disk on 快 is run again at ten seconds", async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([card('c1', 'host.disk', 10)])
    w.mockClock = true
    engine(on, w)
    await start($)

    await mounted($)
    const dfs = () => w.ran.filter(a => a[0] === 'df').length
    const before = dfs()
    await clock.advance(10000)
    expect(dfs()).toBeGreaterThan(before)
  })

  test('只在回合結束 (0): never on the timer, however long it runs', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([card('c1', 'host.overview', 0)])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    await mounted($)
    const hosts = () => w.read.filter(p => p === '/proc/sys/kernel/hostname').length
    const before = hosts()
    await clock.advance(600000)
    expect(hosts()).toBe(before)
  })

  test('a module that says nothing keeps the minute: today\'s behaviour is the default, nothing got busier', async ($, on) => {
    const clock = mock.clock(on, { now: NOON_1009 })
    const w = world()
    w.store = store([card('c1', 'host.overview')])
    w.mockClock = true
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    const band = await mounted($)
    w.files['/proc/sys/kernel/hostname'] = 'pve2\n'
    await clock.advance(59999)
    expect(walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))[0]).toBe('主機 box')
    await clock.advance(1)
    expect(walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))[0]).toBe('主機 pve2')
  })

  test('no built-in module that runs or reads anything asks to be read faster than the minute: a default never makes the host busier', () => {
    // s43 is his rule and it is about the HOST: a module's rhythm is how often its commands and files are read. s44 added
    // session.pomo, which runs nothing and reads nothing — it counts down a value already in the settings — so its 10 s costs
    // the host nothing. The rule is read as what it is for; if the owner wants the flat number instead, the pomodoro takes 60.
    for (const m of MODULES) {
      const touchesHost = (m.runs?.length ?? 0) > 0 || (m.reads?.length ?? 0) > 0
      const ok = m.every === undefined || m.every >= 60 || !touchesHost
      expect(`${m.id} ${ok}`).toBe(`${m.id} true`)
    }
    // and the one that is faster is the pomodoro, nothing else
    expect(MODULES.filter(m => (m.every ?? 60) < 60).map(m => m.id)).toEqual(['session.pomo'])
  })
})

// s43: the rhythm is picked, never typed — four words, the same four wherever it is set (the owner 「你說的OK」). A 指令卡 has none.
describe('picking a rhythm (s43)', () => {
  const RHYTHMS = ['fast', 'normal', 'slow', 'turn']
  const kept2 = (w: World) => w.store['settings'] as { cards: { id: string; every?: number }[] }

  test('the four words, and the seconds behind them, are one list the tools and the pane share', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const add = w.tools?.find(t => t.name === 'add_card')
    const every = (add?.inputSchema?.['properties'] as Record<string, { enum?: string[] }> | undefined)?.['every']
    expect(every?.enum).toEqual(RHYTHMS)
    const change = w.tools?.find(t => t.name === 'change_card')
    expect((change?.inputSchema?.['properties'] as Record<string, { enum?: string[] }> | undefined)?.['every']?.enum).toEqual(RHYTHMS)
    for (const part of ['fast', 'normal', 'slow', 'turn', '指令卡'])
      expect(add?.description).toContain(part)
  })

  test('add_card takes a rhythm and keeps the seconds behind the word', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    await callTool($, 'add_card', { kind: 'module', block: 'H3', name: '主機', text: 'host.overview', every: 'fast' })
    const cards = kept2(w).cards
    expect(cards[cards.length - 1]?.every).toBe(10)
  })

  test('change_card moves a card to another rhythm, and 只在回合結束 is kept as 0', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    await callTool($, 'add_card', { kind: 'module', block: 'H3', name: '主機', text: 'host.overview', every: 'fast' })
    const id = kept2(w).cards[kept2(w).cards.length - 1]?.id as string
    await callTool($, 'change_card', { id, every: 'slow' })
    expect(kept2(w).cards.find(c => c.id === id)?.every).toBe(300)
    await callTool($, 'change_card', { id, every: 'turn' })
    expect(kept2(w).cards.find(c => c.id === id)?.every).toBe(0)
  })

  test('a 指令卡 is refused a rhythm: it runs at a turn\'s end and nowhere else', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const answer = await callTool($, 'add_card', { kind: 'command', block: 'H3', name: '備份', text: 'echo hi', every: 'fast' })
    expect(answer.deny).toContain('指令卡')
    // nothing was written at all, so the store has no settings yet
    expect(kept2(w)?.cards ?? []).toEqual([])
  })

  test('a card added with no rhythm carries none: the module\'s own stands', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    await callTool($, 'add_card', { kind: 'module', block: 'H3', name: '主機', text: 'host.overview' })
    expect(kept2(w).cards[0]?.every).toBeUndefined()
  })
})

// s43 version D (the owner 「D 可以」): the card can show its own rhythm as a dim line. Off until he turns it on, because the band's
// height is capped and a line added to a full row is an old trap (s28); nothing he sees changes until he asks for it.
describe('showing a card its own rhythm (s43, version D)', () => {
  const ABOVE_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const store = (list: object[], extra: object = {}) => ({ settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER],
    aboveOrder: list.map(c => (c as { id: string }).id), cards: list, ...extra } })
  const card = (id: string, every?: number) => ({ id, kind: 'module', name: '主機', text: 'host.overview', prefix: '', section: 'above', size: 'H3', ...(every === undefined ? {} : { every }) })
  const mounted = ($: Engine) => $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE_PROPS })
  const lines = async (band: { find: (q: object) => Promise<{ children?: unknown } | undefined> }) =>
    walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))

  test('off by default: no card says how often it is read', async ($, on) => {
    const w = world()
    w.store = store([card('c1', 10)])
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    expect((await lines(await mounted($))).some(l => l.includes('每'))).toBe(false)
  })

  test('on: the card carries a line with its own rhythm, in the panel\'s language', async ($, on) => {
    const w = world()
    w.store = { ...store([card('c1', 10)], { showEvery: true }), language: 'zh-TW' }
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)

    expect(await lines(await mounted($))).toContain('10秒')
  })

  test('the word follows the rhythm, and a card that set none shows the module\'s own', async ($, on) => {
    const w = world()
    w.store = { ...store([card('c1', 300)], { showEvery: true }), language: 'zh-TW' }
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)
    expect(await lines(await mounted($))).toContain('5分')
  })

  test('只在回合結束 says so, not a number of seconds', async ($, on) => {
    const w = world()
    w.store = { ...store([card('c1', 0)], { showEvery: true }), language: 'zh-TW' }
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    engine(on, w)
    await start($)
    expect(await lines(await mounted($))).toContain('回合')
  })

  test('a 指令卡 never carries the line, switch on or not: it has no rhythm to show (s43 mutant V2)', async ($, on) => {
    const w = world()
    w.store = { ...store([card('c1', 10), { id: 'c2', kind: 'command', name: '備份', text: 'echo hi', prefix: '', section: 'above', size: 'H3' }], { showEvery: true }), language: 'zh-TW' }
    w.files['/proc/sys/kernel/hostname'] = 'box\n'
    w.git['bash -c echo hi'] = { exitCode: 0, stdout: 'hi\n' }
    engine(on, w)
    await start($)

    const band = await mounted($)
    const onCommand = walk((await band.find({ type: 'Box', key: 'band-frame-c2' }))?.children).filter(el => el.type === 'Text').map(el => String(el.children?.[0]))
    expect(onCommand.some(l => ['10秒', '1分', '5分', '回合'].includes(l))).toBe(false)
    // the module card beside it still has its line, so this is the kind and not the switch
    expect(await lines(band)).toContain('10秒')
  })

  test('/ss has the switch, under AbovePrompt\'s others, and it is kept', async ($, on) => {
    const w = world()
    w.store = store([card('c1', 10)])
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'above-every' })
    expect((w.store['settings'] as { showEvery?: boolean }).showEvery).toBe(true)
    await ui.press({ key: 'above-every' })
    expect((w.store['settings'] as { showEvery?: boolean }).showEvery).toBeUndefined()
  })
})

// s44 (the owner 「節奏做成乙（打勾按鈕）」, after three mock pictures of the pane): the rhythm, which v0.7.5 can only be given by talking to
// Claude or in a module file, is picked in the 新增卡片 pane — one row of five buttons, the picked one lit with ✓, as the touchbar's
// A / B row is. 預設 is the first and the one a card starts on, so nothing need be picked (his product-logic ruling, s43).
describe('picking a rhythm in the 新增卡片 pane (s44)', () => {
  const kept3 = (w: World) => w.store['settings'] as { cards: { id: string; every?: number }[] }
  const EVERY_KEYS = ['add-every-default', 'add-every-fast', 'add-every-normal', 'add-every-slow', 'add-every-turn']

  test('a 文字卡 gets a 節奏 row of five buttons, 預設 first and lit with ✓', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    expect(await pane.find({ type: 'Text', text: /^節奏$/ })).toBeDefined()
    const words = []
    for (const key of EVERY_KEYS) words.push(bare((await pane.find({ type: 'Button', key }))?.text))
    // the spaces inside are the language file's own (每 10 秒), not the panel's padding, which bare() takes away
    expect(words).toEqual(['✓ 預設', '每 10 秒', '每 1 分', '每 5 分', '每回合'])
    expect((await pane.find({ type: 'Button', key: 'add-every-default' }))?.props['variant']).toBe('primary')
    expect((await pane.find({ type: 'Button', key: 'add-every-fast' }))?.props['variant']).toBe('secondary')
  })

  test('a 指令卡, a 按鈕卡 and a 開關卡 get no 節奏 row at all', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    for (const kind of ['command', 'button', 'switch']) {
      await pane.select({ key: 'add-kind', value: kind })
      expect((await pane.find({ type: 'Select', key: 'add-kind' }))?.props['value']).toBe(kind)
      expect(await pane.find({ type: 'Text', text: /^節奏$/ })).toBeUndefined()
      expect(await pane.find({ type: 'Button', key: 'add-every-fast' })).toBeUndefined()
    }
  })

  test('a press moves the ✓ to that word and leaves 預設 dim', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.press({ key: 'add-every-slow' })
    expect(bare((await pane.find({ type: 'Button', key: 'add-every-slow' }))?.text)).toBe('✓ 每 5 分')
    expect((await pane.find({ type: 'Button', key: 'add-every-slow' }))?.props['variant']).toBe('primary')
    expect(bare((await pane.find({ type: 'Button', key: 'add-every-default' }))?.text)).toBe('預設')
    expect((await pane.find({ type: 'Button', key: 'add-every-default' }))?.props['variant']).toBe('secondary')
  })

  test('加入 keeps the seconds behind the picked word, and 每回合 is kept as 0', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.input({ key: 'add-name', text: '下一步', kind: 'change' })
    await pane.input({ key: 'add-text', text: '等 Anna 回覆' })
    await pane.press({ key: 'add-every-fast' })
    await pane.press({ key: 'add-ok' })
    expect(kept3(w).cards[0]?.every).toBe(10)

    await pane.unmount()
    const again = await addPane($)
    await again.input({ key: 'add-name', text: '備份', kind: 'change' })
    await again.input({ key: 'add-text', text: '每回合看一次' })
    await again.press({ key: 'add-every-turn' })
    await again.press({ key: 'add-ok' })
    expect(kept3(w).cards[1]?.every).toBe(0)
  })

  test('預設 left alone, the card carries no rhythm of its own', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.input({ key: 'add-name', text: '下一步', kind: 'change' })
    await pane.input({ key: 'add-text', text: '等 Anna 回覆' })
    await pane.press({ key: 'add-ok' })
    expect(kept3(w).cards[0]).toEqual({ id: 'c1', kind: 'text', name: '下一步', text: '等 Anna 回覆', prefix: '' })
    expect('every' in (kept3(w).cards[0] as object)).toBe(false)
  })

  test('the next card starts on 預設 again, whatever the last one picked', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.input({ key: 'add-name', text: '下一步', kind: 'change' })
    await pane.input({ key: 'add-text', text: '等 Anna 回覆' })
    await pane.press({ key: 'add-every-slow' })
    await pane.press({ key: 'add-ok' })

    await pane.unmount()
    const again = await addPane($)
    expect((await again.find({ type: 'Button', key: 'add-every-default' }))?.props['variant']).toBe('primary')
    expect((await again.find({ type: 'Button', key: 'add-every-slow' }))?.props['variant']).toBe('secondary')
  })

  test('a rhythm picked for a 文字卡 is dropped when the kind becomes a 指令卡', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.press({ key: 'add-every-fast' })
    await pane.select({ key: 'add-kind', value: 'command' })
    await pane.input({ key: 'add-name', text: '備份', kind: 'change' })
    await pane.input({ key: 'add-text', text: 'df -h' })
    await pane.press({ key: 'add-ok' })
    expect(kept3(w).cards[0]?.every).toBeUndefined()
  })

  // s44 mutant M3: dropping the reset in pickKind changed nothing, because withCard's own guard still kept the rhythm off the card.
  // What it does change is what he SEES: the old pick stayed lit when the kind came back.
  test('a kind that takes no rhythm and back again leaves 預設 lit, not the old pick', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.press({ key: 'add-every-fast' })
    await pane.select({ key: 'add-kind', value: 'command' })
    await pane.select({ key: 'add-kind', value: 'text' })
    expect((await pane.find({ type: 'Button', key: 'add-every-default' }))?.props['variant']).toBe('primary')
    expect((await pane.find({ type: 'Button', key: 'add-every-fast' }))?.props['variant']).toBe('secondary')
  })

  // s44 mutant M1: withCard's own guard, the one pickKind's reset hides. A block's tab sets the kind by itself (kindsOf's first),
  // never through pickKind, so a rhythm picked on the StatusLine tab reaches H1, whose 按鈕卡 takes none.
  test('a rhythm picked, then a block tab whose kind takes none: the card carries no rhythm', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    await pane.press({ key: 'add-every-fast' })
    await pane.press({ key: 'add-tab-H1' })
    await pane.input({ key: 'add-name', text: '備份', kind: 'change' })
    await pane.input({ key: 'add-text', text: '--h' })
    await pane.press({ key: 'add-ok' })
    const cards = (w.store['settings'] as { cards: { kind: string; every?: number }[] }).cards
    expect(cards[0]?.kind).toBe('button')
    expect(cards[0]?.every).toBeUndefined()
  })

  // s44 mutant M7: the row has six things in it, so it wraps — four to a line wide, two narrow, as the tabs do. One engine() a test
  // (s41 pitfall): the hooks beneath the plugins are registered once, so wide and narrow are two tests, never one loop.
  const everyRows = async (pane: { find: (q: { type: string; key: string }) => Promise<unknown> }) => {
    const lengths: number[] = []
    for (let i = 0; i < 4; i++) {
      const row = (await pane.find({ type: 'Box', key: `add-row-every-${i}` })) as El | undefined
      if (row === undefined) break
      lengths.push(((row.children ?? []) as El[]).length)
    }
    return lengths
  }

  test('wide, the row stands four to a line and the rest falls to the next', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW' }
    engine(on, w)
    await start($)

    expect(await everyRows(await addPane($))).toEqual([4, 2])
  })

  test('narrow, the row stands two to a line, as the tabs do', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], narrow: true } }
    engine(on, w)
    await start($)

    expect(await everyRows(await addPane($))).toEqual([2, 2, 2])
  })

  test('the five words are the language file\'s, not the pane\'s own', async ($, on) => {
    const w = world()
    w.store = { language: 'en' }
    engine(on, w)
    await start($)

    const pane = await addPane($)
    const words = []
    for (const key of EVERY_KEYS) words.push(unpadded(String((await pane.find({ type: 'Button', key }))?.props['label'])))
    expect(words).toEqual(['✓ Default', 'every 10s', 'every 1m', 'every 5m', 'each turn'])
    expect(await pane.find({ type: 'Text', text: /^Rhythm$/ })).toBeDefined()
  })
})

// s44 (the owner 「更新頻率的字也太大了吧還會遮擋」, his screenshot with the switch on): the rhythm line was drawn at the body size, the
// same as the value above it, so a three-row tile held two full-size lines and they crowded. A caption is the smallest the engine
// draws (Text size, Claude Code 2.1.299) and is what a note under a value is for.
describe('the rhythm line is a caption, not a second value (s44)', () => {
  const ABOVE = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const storeWith = (size: string) => ({
    language: 'zh-TW',
    settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], showEvery: true,
      cards: [{ id: 'c1', kind: 'text', name: '長值', text: '等 Anna 回覆報價單與合約細節', prefix: '', section: 'above', size }] },
  })
  const band = ($: Engine) => $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
  const textsOf = async (ui: { find: (q: object) => Promise<{ children?: unknown } | undefined> }) =>
    walk((await ui.find({ type: 'Box', key: 'band-frame-c1' }))?.children).filter(el => el.type === 'Text')

  test('the rhythm line is drawn at caption size and the value is not', async ($, on) => {
    const w = world()
    w.store = storeWith('H2-full')
    engine(on, w)
    await start($)

    const texts = await textsOf(await band($))
    const value = texts.find(t => String(t.children?.[0]).includes('Anna'))
    const rhythm = texts.find(t => t.props['size'] === 'caption')
    expect(value?.props['size']).toBeUndefined()
    expect(rhythm?.props['size']).toBe('caption')
    expect(rhythm?.props['dimColor']).toBe(true)
  })

  test('the same in a narrow H2 tile, where the room is smallest', async ($, on) => {
    const w = world()
    w.store = storeWith('H2')
    engine(on, w)
    await start($)

    const rhythm = (await textsOf(await band($))).find(t => t.props['size'] === 'caption')
    expect(rhythm?.props['size']).toBe('caption')
  })
})

// s44 (the owner 「甲，字縮短」, picked off three drawn versions): the line under a card says 「1分」, not 「每 1 分」 — the same word the
// /ss 節奏 row offers, shortened, because on the card it is a note in the corner and the menu is where it is read in full.
describe('the card\'s rhythm line is the short word (s44)', () => {
  const ABOVE = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const storeOf = (language: string) => ({
    language,
    settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], showEvery: true,
      cards: [{ id: 'c1', kind: 'text', name: '長值', text: '等 Anna 回覆報價單與合約細節', prefix: '', section: 'above', size: 'H2-full', every: 60 }] },
  })
  const bandLine = async ($: Engine) => {
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    return walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children)
      .filter(el => el.type === 'Text' && el.props['size'] === 'caption')
      .map(el => String(el.children?.[0]))[0]
  }

  test('繁中: the card says 1分, the menu still says 每 1 分', async ($, on) => {
    const w = world()
    w.store = storeOf('zh-TW')
    engine(on, w)
    await start($)

    expect(await bandLine($)).toBe('1分')
    const pane = await addPane($)
    expect(bare((await pane.find({ type: 'Button', key: 'add-every-normal' }))?.text)).toBe('每 1 分')
  })

  test('English and 日本語 have their own short words', async ($, on) => {
    const w = world()
    w.store = storeOf('en')
    engine(on, w)
    await start($)

    expect(await bandLine($)).toBe('1m')
  })

  test('日本語', async ($, on) => {
    const w = world()
    w.store = storeOf('ja')
    engine(on, w)
    await start($)

    expect(await bandLine($)).toBe('1分')
  })

  test('every rhythm has a short word, and none of them is the long one', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER],
      aboveOrder: ['c1', 'c2', 'c3', 'c4'], showEvery: true,
      cards: [10, 60, 300, 0].map((every, i) => ({ id: `c${i + 1}`, kind: 'text', name: `卡${i + 1}`, text: 'x', prefix: '', section: 'above', size: 'H2', every })) } }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    const words = []
    for (const id of ['c1', 'c2', 'c3', 'c4'])
      words.push(walk((await band.find({ type: 'Box', key: `band-frame-${id}` }))?.children)
        .filter(el => el.type === 'Text' && el.props['size'] === 'caption').map(el => String(el.children?.[0]))[0])
    expect(words).toEqual(['10秒', '1分', '5分', '回合'])
  })

  // s44 mutant N4: a number of seconds that is none of the four (a store written by hand, or an older file) falls back to a word.
  // It must be the minute's, which is what the card is actually read on, never 回合, which would say it is read at a turn's end.
  test('seconds that match no rhythm say the minute, not 回合', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER],
      aboveOrder: ['c1'], showEvery: true,
      cards: [{ id: 'c1', kind: 'text', name: '奇數', text: 'x', prefix: '', section: 'above', size: 'H2', every: 45 }] } }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never })
    const line = walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children)
      .filter(el => el.type === 'Text' && el.props['size'] === 'caption').map(el => String(el.children?.[0]))[0]
    expect(line).toBe('1分')
  })
})

// s44 (measured on the owner's own screenshots, docs/measures.md 2026-10-20): the card tools' guide promised 「about 10 Chinese
// characters」 for an H2 tile; a normal H2 tile is 100 px and holds 5-6 of them INCLUDING the name. He ruled the cut itself is not
// a bug (「反正使用者自己會用claude去調整」) — which makes this line the thing that has to be right, since it is what a Claude
// elsewhere reads before it places a card.
describe('the card tools say how much room a tile really has (s44)', () => {
  test('the guide names the measured room, and says the name counts toward it', async ($, on) => {
    const w = world()
    engine(on, w)
    await start($)

    const add = w.tools?.find(t => t.name === 'add_card')
    expect(add?.description).toContain('5-6 Chinese characters')
    expect(add?.description).toContain('the name counts')
    expect(add?.description).not.toContain('about 10 Chinese characters')
    // the wider tiles are named too, so a long value has somewhere to go
    expect(add?.description).toContain('H2-half')
    expect(add?.description).toContain('H2-full')
  })
})

// s44 (the owner 「甲」, the open bug of a skipped press: the engine's own words were 「superstatus ui.press hook skipped: ran past its
// 10s budget」). The window hands a press to the mod and waits for its answer, with a 10 s limit; the mod used to read every lit
// module's commands — one after another, 3 s each — BEFORE answering, which on his desktop came to 11.5 s. change() no longer
// awaits that read: it is handed to later(), which runs it after the answer and swallows its failure.
// WHAT THESE TESTS CAN AND CANNOT SHOW: the test kit answers every command at once, so the deferred work finishes inside the same
// turn and no test here can time the press. What is tested is what the kit CAN see: the press finishes and its settings are stored
// even when the reading after it fails, and the failure never reaches the window. The timing itself is the owner's desktop to show.
describe('a press answers first and reads after (s44)', () => {
  test('a read that fails after the press neither breaks it nor reaches the window', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: ['c1'], note: '', icons: false, order: [...DEFAULT_ORDER],
      aboveOrder: ['c1'], cards: [{ id: 'c1', kind: 'module', name: '磁碟', text: 'host.diskchart', prefix: '', section: 'above', size: 'H3' }] } }
    // a command the world does not answer is refused ('cannot start'), so the reading after the press fails outright
    engine(on, w)
    await start($)

    const ui = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'CommandOutput', props: PANEL })
    await ui.press({ key: 'toggle-c1' })

    // the press did its own work: the card is on and the settings are in the store
    expect(((w.store['settings'] as { off: string[] }).off ?? []).includes('c1')).toBe(false)
    expect((await ui.find({ type: 'Button', key: 'toggle-c1' }))?.props['variant']).toBe('primary')
  })
})

// s44 (the owner 「蕃茄鐘現在做」): the pomodoro wired in — a built-in module that draws it, and /ss pomo to work it. The state lives
// in the settings, so it survives a turn, a reload and a new session; hooks/pomo.ts holds the value and the drawing.
describe('the pomodoro card and its command (s44)', () => {
  const ABOVE = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never
  const AT = 1792500000000
  const storeWith = (pomo?: object) => ({
    language: 'zh-TW',
    settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], ...(pomo === undefined ? {} : { pomo }),
      cards: [{ id: 'c1', kind: 'module', name: '蕃茄', text: 'session.pomo', prefix: '', section: 'above', size: 'H3-half' }] },
  })
  const tile = async ($: Engine) => {
    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    const svg = await band.find({ type: 'Svg' })
    return String(svg?.props['source'] ?? '') + ' | ' + String(svg?.props['alt'] ?? '')
  }

  test('the module is offered under the session group and draws a clock of segments', async ($, on) => {
    const w = world()
    w.store = storeWith({ state: 'run', endsAt: AT + 23 * 60000 + 59000, done: 2 })
    w.now = AT
    engine(on, w)
    await start($)

    const drawn = await tile($)
    // the digits are rectangles, never letters, and the alt says the time in words
    expect(drawn.includes('<rect')).toBe(true)
    expect(drawn).toContain('23:59')
  })

  test('/ss pomo start sets it running and stores it; pause keeps what is left; reset puts it back', async ($, on) => {
    const w = world()
    w.store = storeWith()
    w.now = AT
    engine(on, w)
    await start($)

    await $.command.run({ command: 'ss', args: 'pomo start' })
    const kept = () => (w.store['settings'] as { pomo?: { state: string; endsAt?: number; leftMs?: number; done: number } }).pomo
    expect(kept()?.state).toBe('run')
    expect(kept()?.endsAt).toBe(AT + 25 * 60000)

    w.now = AT + 5 * 60000
    await $.command.run({ command: 'ss', args: 'pomo pause' })
    expect(kept()?.state).toBe('pause')
    expect(kept()?.leftMs).toBe(20 * 60000)

    await $.command.run({ command: 'ss', args: 'pomo reset' })
    expect(kept()).toEqual({ state: 'idle', done: 0 })
  })

  // s45 (the owner's 2.png, 專注 pressed and nothing moved): the engine runs a mod's $.command.run through every hook but the
  // caller's, so a button of this mod's sending /ss pomo start never reached the hook above; the press works the pomodoro itself
  test('a 按鈕卡 sending /ss pomo start starts the pomodoro, and pause holds it', async ($, on) => {
    const w = world()
    w.now = AT
    const cards = [
      { id: 'c1', kind: 'button', name: '專注', text: '/ss pomo start', prefix: '', section: 'above' },
      { id: 'c2', kind: 'button', name: '暫停', text: '/ss  pomo   pause', prefix: '', section: 'above' },
    ]
    w.store = { settings: { off: [] as string[], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1', 'c2'], cards } }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    await band.press({ key: 'band-c1' })
    const kept = () => (w.store['settings'] as { pomo?: { state: string; endsAt?: number; leftMs?: number } }).pomo
    expect(kept()?.state).toBe('run')
    expect(kept()?.endsAt).toBe(AT + 25 * 60000)

    w.now = AT + 60000
    await band.press({ key: 'band-c2' })
    expect(kept()?.state).toBe('pause')
    expect(kept()?.leftMs).toBe(24 * 60000)
  })

  test('/ss pomo with no word, or a word it does not know, says what it takes', async ($, on) => {
    const w = world()
    w.store = storeWith()
    engine(on, w)
    await start($)

    const answer = await $.command.run({ command: 'ss', args: 'pomo wobble' })
    expect(String(answer.text)).toContain('start')
    expect(String(answer.text)).toContain('pause')
  })

  test('a pomodoro that ran out is counted once, and the card goes quiet', async ($, on) => {
    const w = world()
    w.store = storeWith({ state: 'run', endsAt: AT + 1000, done: 1 })
    w.now = AT + 2000
    engine(on, w)
    await start($)

    await tile($)
    const kept = (w.store['settings'] as { pomo?: { state: string; done: number } }).pomo
    expect([kept?.state, kept?.done]).toEqual(['idle', 2])
  })

  // s45 (the owner 「他就沒有秒數倒數」, then 「每次都是在我使用完傳訊息才renew」): the clock on the band moves every second by
  // itself, with no turn and no command between. The tests above mount a new band each time, so a band that never redraws
  // passed them all: here one band is mounted once, the kit's clock moved, and the same band read again.
  test('a running pomodoro redraws the band every second, with no turn in between', async ($, on) => {
    const clock = mock.clock(on, { now: AT })
    const w = world()
    w.store = storeWith({ state: 'run', endsAt: AT + 25 * 60000, done: 0 })
    w.mockClock = true
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
    const alt = async () => String((await band.find({ type: 'Svg' }))?.props['alt'] ?? '')
    expect(await alt()).toContain('25:00')
    await clock.advance(1000)
    expect(await alt()).toContain('24:59')
    await clock.advance(2000)
    expect(await alt()).toContain('24:57')
  })
})

// s44 (the owner 「倒數就要每秒可以正常倒數對吧」): a countdown ticks every second. The rule it is read against is about the host —
// a rhythm is how often a module's commands and files are read — and the pomodoro has neither: it counts a number already in
// the settings. So its rhythm is one second, and nothing of the host is touched any oftener than before.
describe('the pomodoro ticks every second (s44)', () => {
  // s44 (the owner 「刷新可以改0.5秒嗎」「蕃茄鐘的部分」): a redraw every second lands at no fixed point of the second, so now and then
  // one second is never shown (24:06 straight to 24:04); every half second shows each one
  // s44: half a second was tried on his 「刷新可以改0.5秒嗎」 and taken back on his 「改回1秒吧好像失效了」 — with it /ss pomo start
  // still went unanswered, so it is not the half second that fixes that, and one second is half the work
  test('its own rhythm is one second, and it is the only module under a minute', () => {
    expect(MODULES.find(m => m.id === 'session.pomo')?.every).toBe(1)
    expect(MODULES.filter(m => (m.every ?? 60) < 60).map(m => m.id)).toEqual(['session.pomo'])
  })

  test('it runs nothing and reads nothing: a second costs the host no work', () => {
    const m = MODULES.find(x => x.id === 'session.pomo')
    expect([m?.runs ?? [], m?.reads ?? []]).toEqual([[], []])
  })

  // (what the engine is armed with is s43's rhythm tests' ground: this test kit answers no clock.after, so the interval
  // itself cannot be observed here)
})

// s44 (the owner 「你蕃茄鐘更新頻率是1分鐘是要怎麼用」): the pomodoro ticks every second, but the card's rhythm line said 1分 — the
// line can only name the four rhythms, and one second is none of them, so it fell back to the minute (s44 mutant N4's rule,
// written for a hand-edited store). A rhythm under ten seconds is a clock's, and the line says so.
describe('a clock\'s rhythm is named as one (s44)', () => {
  test('the pomodoro card says it ticks every half second, not every minute', async ($, on) => {
    const w = world()
    w.store = { language: 'zh-TW', settings: { off: [], note: '', icons: false, order: [...DEFAULT_ORDER], aboveOrder: ['c1'], showEvery: true,
      cards: [{ id: 'c1', kind: 'module', name: '蕃茄', text: 'session.pomo', prefix: '', section: 'above', size: 'H2' }] } }
    engine(on, w)
    await start($)

    const band = await $.ui.mount({ plugin: 'superstatus', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 119 } as never })
    const line = walk((await band.find({ type: 'Box', key: 'band-frame-c1' }))?.children)
      .filter(el => el.type === 'Text' && el.props['size'] === 'caption').map(el => String(el.children?.[0]))[0]
    expect(line).toBe('1秒')
  })
})

// s45 (the owner 「你設計的好像有點太局限在我這台的路徑，你應該要引導使用者建立，把這幾張小卡變成方向跟使用者自己討論，依照使用者語言去
// 設計」, then 「都給你改」): every user's Claude reads these descriptions, so they name no one, and they tell that Claude to ask
// before it picks cards for someone, in that person's language, for that person's machine.
describe('the card tools speak to whoever installed the mod (s45)', () => {
  const described = async ($: Engine, on: On) => {
    const w = world()
    w.store = { language: 'en' }
    engine(on, w)
    await start($)
    return w.tools ?? []
  }

  test('no tool description and no field of one names Alex', async ($, on) => {
    const tools = await described($, on)
    expect(tools.length).toBe(4)
    for (const t of tools) expect(JSON.stringify({ d: t.description, s: t.inputSchema })).not.toContain('Kevin')
  })

  test("the countdown is described in the user's own time zone, not Taiwan's", async ($, on) => {
    const tools = await described($, on)
    const add = tools.find(t => t.name === 'add_card')?.description ?? ''
    expect(add).not.toContain('Taiwan')
    expect(add).toContain("days left, in this machine's own time zone")
  })

  test('add_card and add_module tell the model to ask first, in the user\'s language, and to build for this user\'s machine', async ($, on) => {
    const tools = await described($, on)
    for (const name of ['add_card', 'add_module']) {
      const d = tools.find(t => t.name === name)?.description ?? ''
      for (const part of ['Ask first', 'in the language the user writes in', 'what they work on', 'two or three', 'only the ones they agree to', 'never one copied from another machine'])
        expect(d).toContain(part)
    }
  })

  test('what the tools answer names no one either: a button that sends words sends them as the user\'s', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: true, cards: [] } }
    engine(on, w)
    await start($)

    const added = await callTool($, 'add_card', { kind: 'button', block: 'H1', name: 'Save', text: 'save my work' })
    const listed = await callTool($, 'cards', {})
    const refused = await callTool($, 'change_card', { id: 'c1', on: true })
    const changed = await callTool($, 'change_card', { id: 'c1', text: 'save it all' })
    const said = JSON.stringify([added, listed, refused, changed])
    expect(refused.deny).toBeDefined()
    expect(said).not.toContain('Kevin')
    expect(said).toContain("as the user's words")
  })

  test('the other answers name no one: a hidden block, a built-in item, a switch pressed by the model', async ($, on) => {
    const w = world()
    w.store = { language: 'en', settings: { off: [], note: '', icons: true, aboveOff: ['info'], cards: [] } }
    engine(on, w)
    await start($)

    const hidden = await callTool($, 'add_card', { kind: 'text', block: 'H2', name: 'Note', text: 'x' })
    const builtIn = await callTool($, 'change_card', { id: 'who', on: false })
    await callTool($, 'add_card', { kind: 'switch', block: 'H1', name: 'Probe', text: 'probe', onArgs: 'on', offArgs: 'off' })
    const listed = JSON.parse(String((await callTool($, 'cards', {})).result)) as { abovePrompt: { H1: { cards: { id: string }[] } } }
    const switchId = listed.abovePrompt.H1.cards[0]?.id ?? ''
    const pressed = await callTool($, 'change_card', { id: switchId, on: true })
    expect(String(hidden.result)).toContain('hidden')
    expect(builtIn.deny).toBeDefined()
    expect(pressed.deny).toBeDefined()
    expect(JSON.stringify([hidden, builtIn, pressed])).not.toContain('Kevin')
  })
})
