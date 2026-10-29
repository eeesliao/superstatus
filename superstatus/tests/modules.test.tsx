import { describe, expect, test } from 'claude-code/testing'

import { H3_LINES, MODULES, moduleOf, runKey } from '../hooks/modules'
import type { ModuleInput, SessionFacts } from '../hooks/modules'
import { DF, DF_POSIX } from '../hooks/modules/host'
const JEV_NOW = ['date', '+%s'] as const
import { BUILT_IN, EN, JA, translator, ZH_TW } from '../hooks/lang'
import { COLOUR, DAY, withDay } from '../hooks/modules/chart'
import { estimateEm } from '../hooks/labels'

// The modules on their own (the owner 2026-10-10 s33 「框1~8是各種模組，按鈕1~12是各種模組」): plain functions of what superstatus read for them.
// The expected numbers were worked out apart from the code (python on the same figures), from the the dev host host's own /proc and df of
// 2026-10-10 03:2x.

const CPUINFO = Array.from({ length: 16 }, (_, i) => `processor\t: ${i}\nmodel name\t: x\n`).join('\n')
const MEMINFO = 'MemTotal:       65779300 kB\nMemFree:        1000 kB\nMemAvailable:   28055500 kB\nSwapTotal:       8388604 kB\nSwapFree:        8388604 kB\n'
const DF_OUT = [
  'Filesystem                      1024-blocks     Used Available Capacity Mounted on',
  '/dev/mapper/vg0-root               98497780 35934464  57513768      39% /',
  '/dev/nvme0n1p2                      1046512     9240   1037272       1% /boot/efi',
  '/dev/mapper/vg0-data--assets     102626232     2640  97364328       1% /srv/assets',
  'backup                            419242624      128 419242496       1% /mnt/backup',
  'backup/vm                         471454080 52211584 419242496      12% /mnt/backup/vm',
  '',
].join('\n')
const FILES = {
  '/proc/sys/kernel/hostname': 'box\n',
  '/proc/sys/kernel/osrelease': '7.0.14-14-gen\n',
  '/proc/uptime': '609056.37 9392486.16\n',
  '/proc/cpuinfo': CPUINFO,
  '/sys/class/thermal/thermal_zone0/temp': '27800\n',
  '/proc/loadavg': '1.43 1.79 1.31 2/785 2346009\n',
  '/proc/meminfo': MEMINFO,
}
const SESSION: SessionFacts = {
  who: 'Alex', block: 'B5', score: 'D', total: '-6', pending: 3, branch: 'claude/l-8b5c70', dirty: 2, ff: 'can',
  left: 50, h5: 23.2, d7: 8, tools: 42, version: 'v.0.3', journal: ['18 LAUNCH — a', '19 LAUNCH — b', '20 DECIDE — c'],
}
// the lines below are the owner's 繁中 (s34: a module speaks the panel's language through t)
const ZH = translator(ZH_TW)
const FULL: ModuleInput = { files: FILES, runs: { [runKey(DF)]: DF_OUT }, session: SESSION, t: ZH }
const EMPTY: ModuleInput = { files: {}, runs: {}, session: { tools: -1, version: 'v.0.3', journal: [] }, t: ZH }
const linesOf = (id: string, input: ModuleInput) => moduleOf(id)?.lines?.(input)
const pressOf = (id: string, input: ModuleInput) => moduleOf(id)?.press?.(input)

describe('the module list', () => {
  // s34: a module's own name and line are English; 繁中 has its name in four characters at most (the language's rule), English in nine
  test('every module has a group.name id of its own, a name in each language within its rule, a group, a line saying what it does', () => {
    const ids = MODULES.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of MODULES) {
      expect(m.id).toMatch(/^[a-z0-9]+\.[a-z0-9]+$/)
      expect([...m.name].length).toBeGreaterThan(0)
      expect([...m.name].length).toBeLessThanOrEqual(EN.rules.nameMax)
      // every built-in language names it within its own rule (a card added with no name takes the module's, cut to the rule)
      for (const lang of BUILT_IN.filter(l => l.code !== 'en')) {
        const name = lang.strings[`mod.${m.id}.name`] ?? ''
        expect([...name].length).toBeGreaterThan(0)
        expect([...name].length).toBeLessThanOrEqual(lang.rules.nameMax)
        expect(lang.strings[`mod.${m.id}.about`]).toBeDefined()
      }
      expect(['host', 'session', 'action']).toContain(m.group)
      expect(m.about).not.toBe('')
    }
  })

  // s35 (the owner 「好，先做日文」): 日本語 built in beside English and 繁中 (s34 「做繁體中文(zh-TW) English 日文 還有 新增語言」)
  test('the built-in languages are English, 繁體中文 and 日本語', () => {
    expect(BUILT_IN.map(l => [l.code, l.name])).toEqual([['en', 'English'], ['zh-TW', '繁體中文'], ['ja', '日本語']])
  })

  test('a tile draws lines and has no press; a button has a press and no lines', () => {
    for (const m of MODULES) {
      expect(m.role === 'tile' ? typeof m.lines : typeof m.press).toBe('function')
      expect(m.role === 'tile' ? m.press : m.lines).toBeUndefined()
    }
    expect(MODULES.filter(m => m.role === 'tile').length).toBeGreaterThanOrEqual(8)
    expect(MODULES.filter(m => m.role === 'button').length).toBeGreaterThanOrEqual(3)
  })

  test('with nothing read, every tile still has a first line, at most five, and never NaN or undefined', () => {
    for (const m of MODULES.filter(x => x.role === 'tile')) {
      const lines = m.lines?.(EMPTY) ?? []
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.length).toBeLessThanOrEqual(H3_LINES)
      for (const line of lines) {
        expect(line).not.toBe('')
        expect(line).not.toMatch(/NaN|undefined|null/)
      }
    }
  })

  test('with everything read, every tile holds at most five lines, none empty, never NaN or undefined', () => {
    for (const m of MODULES.filter(x => x.role === 'tile')) {
      const lines = m.lines?.(FULL) ?? []
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.length).toBeLessThanOrEqual(H3_LINES)
      for (const line of lines) expect(line).not.toMatch(/^$|NaN|undefined|null/)
    }
  })

  // s37: a path may start at the user's home (~/), which superstatus fills in (the Jev ledger is the machine user's, on the dev host and on a Mac)
  test('a module reads only absolute paths or paths from the home folder, and runs only commands without a shell', () => {
    for (const m of MODULES) {
      for (const path of m.reads ?? []) expect(path.startsWith('/') || path.startsWith('~/')).toBe(true)
      for (const argv of m.runs ?? []) expect(['bash', 'sh', 'zsh']).not.toContain(argv[0])
    }
  })
})

describe('the host modules', () => {
  test('主機: name, kernel, time since boot, cores, temperature', () => {
    expect(linesOf('host.overview', FULL)).toEqual(['主機 box', '核心 7.0.14-14-gen', '開機 7 天 1 小時', 'CPU 16 核', '溫度 27.8°C'])
  })

  // s35: the same figures in 日本語 (the translator falls back to English for nothing: every key is in the file)
  test('ホスト and 使用状況 speak 日本語', () => {
    const ja = BUILT_IN.find(l => l.code === 'ja')
    expect(ja).toBeDefined()
    const JA: ModuleInput = { ...FULL, t: translator(ja ?? EN) }
    expect(linesOf('host.overview', JA)).toEqual(['ホスト box', 'カーネル 7.0.14-14-gen', '稼働 7 日 1 時間', 'CPU 16 コア', '温度 27.8°C'])
    expect(linesOf('host.usage', JA)).toEqual(['負荷 1.43 1.79 1.31', 'CPU 16 コア · コアあたり 9%', 'メモリ 57%', '使用 36.0 / 62.7 GiB', 'スワップ 0%（0.0 / 8.0 GiB）'])
  })

  test('under a day the time since boot is hours and minutes', () => {
    expect(linesOf('host.overview', { ...FULL, files: { ...FILES, '/proc/uptime': '11532.9 1.0\n' } })?.[2]).toBe('開機 3 小時 12 分')
  })

  test('the time since boot at its edges: a minute short of three days, two hours exactly', () => {
    const at = (seconds: number) => linesOf('host.overview', { ...FULL, files: { ...FILES, '/proc/uptime': `${seconds} 1\n` } })?.[2]
    expect(at(4319 * 60)).toBe('開機 2 天 23 小時')
    expect(at(7200)).toBe('開機 2 小時 0 分')
  })

  test('磁碟 puts / first even when another is fuller', () => {
    const df = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/b 1048576 838861 209715 80% /boot\n/dev/a 1048576 408945 639631 39% /\n'
    expect(linesOf('host.disk', { ...FULL, runs: { [runKey(DF)]: df } })?.slice(0, 3)).toEqual(['磁碟 / 39%', '/ 39% 0.4/1.0G', '/boot 80% 0.8/1.0G'])
  })

  test('主機用量: load, per core, memory used, swap', () => {
    expect(linesOf('host.usage', FULL)).toEqual(['負載 1.43 1.79 1.31', 'CPU 16 核 · 每核 9%', '記憶體 57%', '已用 36.0 / 62.7 GiB', 'swap 0%（0.0 / 8.0 GiB）'])
  })

  test('記憶體 and 負載 on their own', () => {
    expect(linesOf('host.memory', FULL)).toEqual(['記憶體 57%', '已用 36.0 / 62.7 GiB', '可用 26.8 GiB', 'swap 0%'])
    expect(linesOf('host.load', FULL)).toEqual(['負載 1.43', '1.43 1.79 1.31', 'CPU 16 核'])
  })

  test('no swap reads 沒有', () => {
    const files = { ...FILES, '/proc/meminfo': 'MemTotal: 1048576 kB\nMemAvailable: 524288 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n' }
    expect(linesOf('host.memory', { ...FULL, files })).toEqual(['記憶體 50%', '已用 0.5 / 1.0 GiB', '可用 0.5 GiB', 'swap 沒有'])
  })

  test('磁碟: / first, then the fullest; four file systems at most', () => {
    expect(linesOf('host.disk', FULL)).toEqual([
      '磁碟 / 39%',
      '/ 39% 34.3/93.9G',
      '/mnt/backup/vm 12% 49.8/449.6G',
      '/boot/efi 1% 0.0/1.0G',
      '/srv/assets 1% 0.0/97.9G',
    ])
  })

  test('df runs on local file systems only, in KiB, without the memory-backed ones', () => {
    expect(DF).toEqual(['df', '-P', '-k', '-l', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'overlay', '-x', 'squashfs', '-x', 'efivarfs'])
  })

  // s35 (the owner's table, 「磁碟卡 打包前改成 Mac 也能跑」): a Mac's df has no -x, so GNU's run fails there; every disk module also runs the
  // plain POSIX one and reads it when GNU's gave nothing, leaving out what is not a disk of the user's: devfs, the automounter's maps, and
  // the system's own volumes under /System/Volumes except Data (where the user's files are). The Mac rows below are the shape of macOS's
  // df -P -k -l as Claude remembers it, not yet seen from the owner's Mac.
  const MAC_DF = [
    'Filesystem     1024-blocks      Used Available Capacity  Mounted on',
    '/dev/disk3s1s1   482797652  10727788 245044916     5%    /',
    'devfs                  204       204         0   100%    /dev',
    '/dev/disk3s6     482797652   1048596 245044916     1%    /System/Volumes/VM',
    '/dev/disk3s2     482797652   6262344 245044916     3%    /System/Volumes/Preboot',
    '/dev/disk3s4     482797652      3576 245044916     1%    /System/Volumes/Update',
    '/dev/disk1s2        512000      6100    490004     2%    /System/Volumes/xarts',
    '/dev/disk1s1        512000      5600    490004     2%    /System/Volumes/iSCPreboot',
    '/dev/disk1s3        512000      3480    490004     1%    /System/Volumes/Hardware',
    '/dev/disk3s5     482797652 217638916 245044916    48%    /System/Volumes/Data',
    'map auto_home            0         0         0   100%    /System/Volumes/Data/home',
    'map -hosts               0         0         0   100%    /net',
    '/dev/disk5s1      61202432  30601216  30601216    50%    /Volumes/USB Stick',
    '',
  ].join('\n')
  const ON_MAC: ModuleInput = { ...EMPTY, runs: { [runKey(DF_POSIX)]: MAC_DF } }

  test('every disk module runs GNU df and the plain POSIX one; on Linux the GNU one is read', () => {
    expect(DF_POSIX).toEqual(['df', '-P', '-k', '-l'])
    for (const id of ['host.disk', 'host.diskchart', 'host.resources', 'host.snapshot']) expect(`${id} ${JSON.stringify(moduleOf(id)?.runs?.slice(-2))}`).toBe(`${id} ${JSON.stringify([DF, DF_POSIX])}`)
    // both answered (a Linux): the GNU rows, not the POSIX ones
    const both: ModuleInput = { ...FULL, runs: { [runKey(DF)]: DF_OUT, [runKey(DF_POSIX)]: MAC_DF } }
    expect(linesOf('host.disk', both)?.[0]).toBe('磁碟 / 39%')
  })

  test('on a Mac (GNU df failed) the disks are read from the POSIX df: /, then the fullest; no devfs, maps or system volumes but Data', () => {
    expect(linesOf('host.disk', ON_MAC)).toEqual(['磁碟 / 5%', '/ 5% 10.2/460.4G', '/Volumes/USB Stick 50% 29.2/58.4G', '/System/Volumes/Data 48% 207.6/460.4G'])
    expect(linesOf('host.diskchart', ON_MAC)).toEqual(['磁碟 / 5%', '磁碟 /Volumes/USB Stick 50%', '磁碟 /System/Volumes/Data 48%'])
    expect(linesOf('host.resources', ON_MAC)?.[3]).toBe('磁碟 / 5%')
  })

  test('where there is no /proc (a Mac), every value is ?', () => {
    expect(linesOf('host.overview', EMPTY)).toEqual(['主機 ?', '核心 ?', '開機 ?', 'CPU ? 核', '溫度 ?'])
    expect(linesOf('host.usage', EMPTY)).toEqual(['負載 ?', 'CPU ? 核 · 每核 ?', '記憶體 ?', '已用 ?', 'swap ?'])
    expect(linesOf('host.memory', EMPTY)).toEqual(['記憶體 ?'])
    expect(linesOf('host.load', EMPTY)).toEqual(['負載 ?'])
    expect(linesOf('host.disk', EMPTY)).toEqual(['磁碟 ?'])
  })

  test('主機快照 is a button: a toast of the name, the load, memory and /', () => {
    expect(pressOf('host.snapshot', FULL)).toEqual({ kind: 'toast', text: 'box · 負載 1.43 · 記憶體 57% · / 39%' })
    expect(pressOf('host.snapshot', EMPTY)).toEqual({ kind: 'toast', text: '? · 負載 ? · 記憶體 ? · / ?' })
  })
})

describe('the session modules', () => {
  test('目前剩下, 五小時, 每週: the percent, a bar, what it is', () => {
    expect(linesOf('session.ctx', FULL)).toEqual(['目前剩下 50%', '█████░░░░░', '到自動壓縮前'])
    expect(linesOf('session.5h', FULL)).toEqual(['五小時 23%', '██░░░░░░░░', '用掉的額度'])
    expect(linesOf('session.7d', FULL)).toEqual(['每週 8%', '█░░░░░░░░░', '用掉的額度'])
    expect(linesOf('session.ctx', EMPTY)).toEqual(['目前剩下 ?'])
  })

  test('分支: the branch\'s last part, files to save, fast-forward', () => {
    expect(linesOf('session.git', FULL)).toEqual(['分支 l-8b5c70', '待存檔 2', '↑ 可快轉'])
    expect(linesOf('session.git', EMPTY)).toEqual(['分支 ?（不是 git）'])
  })

  test('分數: total and band, pending pitfalls', () => {
    expect(linesOf('session.score', FULL)).toEqual(['分數 -6 · D', '待決議 3'])
    expect(linesOf('session.score', EMPTY)).toEqual(['分數 ? · ?'])
  })

  test('工具, 日誌 (the newest first), 專案', () => {
    expect(linesOf('session.tools', FULL)).toEqual(['工具 42 次', '這個 session 主迴圈'])
    expect(linesOf('session.tools', EMPTY)?.[0]).toBe('工具 ? 次')
    expect(linesOf('session.journal', FULL)).toEqual(['20 DECIDE — c', '19 LAUNCH — b', '18 LAUNCH — a'])
    expect(linesOf('session.journal', EMPTY)).toEqual(['日誌 ?'])
    expect(linesOf('session.project', FULL)).toEqual(['操作者 Alex', '進度 B5', 'superstatus v.0.3'])
  })

  test('狀態快照 is a button: a toast of the room left, the quota and the score', () => {
    expect(pressOf('session.snapshot', FULL)).toEqual({ kind: 'toast', text: '剩下 50% · 五小時 23% · 每週 8% · 分數 -6 D' })
  })
})

describe('the action modules', () => {
  test('重新載入 asks for a reload, 設定 for the panel', () => {
    expect(pressOf('action.reload', EMPTY)).toEqual({ kind: 'reload' })
    expect(pressOf('action.panel', EMPTY)).toEqual({ kind: 'panel' })
    expect(moduleOf('action.reload')?.name).toBe('Reload')
    expect(ZH_TW.strings['mod.action.reload.name']).toBe('重新載入')
  })
})

// s35 (the owner 「我剛剛把H2~H3-Full 的卡片都刪掉了，你建立符合那些格子會使用的範例卡片給我，H3 以上的可以畫一些圖表或是做成漂亮一點的介面給我看嗎」):
// a tile module may draw a chart, an SVG document in the box superstatus gives it (CSS px); its lines stay what an H2 tile, the terminal
// and the picture's alt read. The expected figures are FULL's, worked out by hand: load 1.43 over 16 cores 9%, memory 37723800 of
// 65779300 KiB 57%, swap 0%, / 39% (34.3 of 93.9 GiB).
describe('the chart modules', () => {
  const BOX = { width: 280, height: 118 }
  // s37: the Jev tile draws its chart too (the owner 「OK，照右邊那張改」)
  const CHARTS = ['session.gauges', 'host.resources', 'session.scorecard', 'session.commits', 'host.diskchart', 'session.timeline']
  const GIT_LOG = 'git log --since=15.days.ago --format=%cs'
  const TODAY = 'date +%F'
  // the 14 days to 2026-10-12 start 09-29: 09-28 and 09-20 fall before
  const LOG = ['2026-10-12', '2026-10-12', '2026-10-11', '2026-10-01', '2026-09-28', '2026-09-20'].join('\n') + '\n'
  const EVENTS = ['WHO', 'LAUNCH', 'PASS', 'FAIL', 'FIX', 'PASS', 'DECIDE'].map((word, id) => ({ id, word }))
  const RICH: ModuleInput = { ...FULL, runs: { ...FULL.runs, [GIT_LOG]: LOG, [TODAY]: '2026-10-12\n' }, session: { ...SESSION, events: EVENTS } }
  const chartOf = (id: string, input: ModuleInput, box = BOX) => moduleOf(id)?.chart?.(input, box) ?? ''

  test('six chart modules, each a tile with lines too', () => {
    for (const id of CHARTS) {
      const m = moduleOf(id)
      expect(`${id} ${m?.role} ${typeof m?.chart} ${typeof m?.lines}`).toBe(`${id} tile function function`)
    }
  })

  test('a chart is one SVG document the size of its box, never NaN or undefined, with everything read and with nothing', () => {
    for (const id of CHARTS) {
      for (const input of [RICH, EMPTY]) {
        for (const box of [BOX, { width: 900, height: 118 }, { width: 150, height: 40 }]) {
          const svg = chartOf(id, input, box)
          expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}"`)).toBe(true)
          expect(svg.endsWith('</svg>')).toBe(true)
          expect(`${id} ${svg.match(/NaN|undefined|null|Infinity/)?.[0]}`).toBe(`${id} undefined`)
          expect(svg.length).toBeLessThan(131072)
        }
      }
    }
  })

  test('a journal line or a branch name is escaped before it goes into the markup', () => {
    const svg = chartOf('session.scorecard', { ...RICH, session: { ...SESSION, score: '<b>' } })
    expect(svg).toContain('&lt;b&gt;')
    expect(svg).not.toContain('<b>')
  })

  test('額度儀表: three rings, what is left and what is used, coloured as the status line', () => {
    const svg = chartOf('session.gauges', RICH)
    for (const text of ['>50%<', '>23%<', '>8%<', '>目前剩下<', '>五小時<', '>每週<']) expect(svg).toContain(text)
    // a track and an arc each
    expect((svg.match(/<circle /g) ?? []).length).toBe(6)
    expect(svg).not.toMatch(/#d29922|#f85149/)
    const hot = chartOf('session.gauges', { ...RICH, session: { ...SESSION, left: 20, h5: 70, d7: 90 } })
    expect(hot).toContain('#d29922')
    expect(hot).toContain('#f85149')
    expect(chartOf('session.gauges', EMPTY)).toContain('>?<')
    expect(linesOf('session.gauges', RICH)).toEqual(['目前剩下 50%', '五小時 23%', '每週 8%'])
  })

  // the status line's tones (s27): what is left yellow under 30% and red under 10%, what is used yellow from 60% and red from 85%; 0% no arc
  test('額度儀表: each ring its own tone; a ring at 0% has no arc', () => {
    const arcs = (s: Partial<SessionFacts>) =>
      [...chartOf('session.gauges', { ...RICH, session: { ...SESSION, ...s } }).matchAll(/stroke="(#[0-9a-f]{6})" fill="none"/g)].map(m => m[1])
    expect(arcs({ left: 20, h5: 10, d7: 10 })).toEqual(['#d29922', '#3fb950', '#3fb950'])
    expect(arcs({ left: 5, h5: 65, d7: 90 })).toEqual(['#f85149', '#d29922', '#f85149'])
    expect(arcs({ left: 30, h5: 59, d7: 84 })).toEqual(['#3fb950', '#3fb950', '#d29922'])
    expect(arcs({ left: 0, h5: 0, d7: 100 })).toEqual(['#f85149'])
  })

  test('主機資源: bars of CPU per core, memory, swap and /, each with its percent', () => {
    const svg = chartOf('host.resources', RICH)
    for (const text of ['>CPU<', '>9%<', '>記憶體<', '>57%<', '>swap<', '>0%<', '>磁碟 /<', '>39%<']) expect(svg).toContain(text)
    expect(linesOf('host.resources', RICH)).toEqual(['CPU 9%', '記憶體 57%', 'swap 0%', '磁碟 / 39%'])
  })

  test('分數卡: the band in large, the total, the pending pitfalls; D red, A green', () => {
    const svg = chartOf('session.scorecard', RICH)
    for (const text of ['>D<', '>-6<', '>待決議 3<']) expect(svg).toContain(text)
    expect(svg).toContain('#f85149')
    expect(chartOf('session.scorecard', { ...RICH, session: { ...SESSION, score: 'A' } })).toContain('#3fb950')
    expect(chartOf('session.scorecard', EMPTY)).toContain('>?<')
  })

  test('提交活動: commits a day over the 14 days to today, today in blue', () => {
    const svg = chartOf('session.commits', RICH, { width: 450, height: 118 })
    expect(moduleOf('session.commits')?.runs).toEqual([['git', 'log', '--since=15.days.ago', '--format=%cs'], ['date', '+%F']])
    expect((svg.match(/data-day="/g) ?? []).length).toBe(14)
    expect(svg).toContain('data-day="2026-10-12" data-n="2"')
    expect(svg).toContain('data-day="2026-10-01" data-n="1"')
    expect(svg).toContain('data-day="2026-09-29" data-n="0"')
    expect(svg).not.toContain('data-day="2026-09-28"')
    expect(svg).toMatch(/data-day="2026-10-12"[^>]*fill="#58a6ff"/)
    expect(svg).toMatch(/data-day="2026-10-11"[^>]*fill="#3fb950"/)
    expect(svg).toMatch(/data-day="2026-09-29"[^>]*fill="#808080"/)
    expect(linesOf('session.commits', RICH)).toEqual(['14 天提交 4 次', '今天 2'])
    expect(linesOf('session.commits', EMPTY)).toEqual(['14 天提交 ? 次'])
  })

  test('磁碟圖: a bar for each local disk, / first, then the fullest, with its percent and size', () => {
    const svg = chartOf('host.diskchart', RICH, { width: 450, height: 118 })
    for (const text of ['>/<', '>39%<', '>34.3 / 93.9 GiB<', '>/mnt/backup/vm<', '>12%<']) expect(svg).toContain(text)
    expect(svg.indexOf('>/<')).toBeLessThan(svg.indexOf('>/mnt/backup/vm<'))
    expect(linesOf('host.diskchart', RICH)?.slice(0, 2)).toEqual(['磁碟 / 39%', '磁碟 /mnt/backup/vm 12%'])
  })

  test('時間軸: the newest journal\'s events in order, coloured by kind, counted; past the width the newest that fit', () => {
    const svg = chartOf('session.timeline', RICH, { width: 900, height: 118 })
    expect((svg.match(/data-event="/g) ?? []).length).toBe(7)
    expect(svg).toMatch(/data-event="2 PASS"[^>]*fill="#3fb950"/)
    expect(svg).toMatch(/data-event="3 FAIL"[^>]*fill="#f85149"/)
    expect(svg).toMatch(/data-event="4 FIX"[^>]*fill="#d29922"/)
    expect(svg.indexOf('data-event="0 WHO"')).toBeLessThan(svg.indexOf('data-event="6 DECIDE"'))
    expect(svg).toContain('>PASS 2<')
    expect(linesOf('session.timeline', RICH)?.[0]).toBe('7 個事件')
    const many = Array.from({ length: 200 }, (_, id) => ({ id, word: 'PASS' }))
    const narrow = chartOf('session.timeline', { ...RICH, session: { ...SESSION, events: many } })
    expect(narrow).toContain('data-event="199 PASS"')
    expect(narrow).not.toContain('data-event="0 PASS"')
  })
})

// Jev's use on this machine (the owner 2026-10-14 s37 「幫我做個我ss的卡片是Jev的使用量計費就我這個API就是給我這台使用的」, then 「OK」 on step 0):
// scripts/jev.py writes a line for every call to ~/.config/jev/usage.jsonl; the tile counts the calls that went through (status 200) this
// month and today in Taiwan time, and in all, with their cost at US$0.042 a million input tokens, output free (third-party sources, 2026-09;
// TypeSafe's own price page not found). The numbers below were worked out apart from the code (python on the same lines).
// s37 (the owner's 17.webp, English): the Jev chart's head drew 「Jev this month 2 · <$0.01」 over 「Today 2」. Phase 1: an H3 band tile is 206 px
// wide at 90 columns (279 at 119); the two need about 200 of its 178. A chart's head now squeezes its left words into the room its right
// ones leave (the letter-by-letter estimate, bold 5% wider), so they never overlap; with room enough, nothing is squeezed.
describe('a chart\'s head never overlaps', () => {
  const EN_T = translator(EN)
  const NOW_EN: ModuleInput = { files: { '~/.config/jev/usage.jsonl': JSON.stringify({ at: '2026-10-14T08:04:18Z', status: 200, input_tokens: 284 }) + '\n' },
    runs: { [runKey(JEV_NOW)]: '1791972000\n', 'git log --since=15.days.ago --format=%cs': '2026-10-12\n2026-10-12\n', 'date +%F': '2026-10-12\n' }, session: SESSION, t: EN_T }
  // the head's two texts: where the left one ends (its textLength, else its estimate) and where the right one starts
  const head = (svg: string) => {
    const texts = [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].slice(0, 2)
    const attr = (a: string, name: string) => Number(a.match(new RegExp(`${name}="([\\d.]+)"`))?.[1])
    const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    const [left, right] = texts
    const size = attr(left?.[1] ?? '', 'font-size')
    const length = attr(left?.[1] ?? '', 'textLength')
    const leftEnd = attr(left?.[1] ?? '', 'x') + (Number.isFinite(length) ? length : estimateEm(unescape(left?.[2] ?? '')) * size * 1.05)
    const rightStart = attr(right?.[1] ?? '', 'x') - estimateEm(unescape(right?.[2] ?? '')) * size
    return { leftEnd, rightStart, squeezed: Number.isFinite(length) }
  }

  for (const id of ['session.commits']) {
    test(`${id}: at 206 px (and 150, a narrow band) its left words end before its right ones start; at 400 px nothing is squeezed`, () => {
      // every width from a narrow band's 150 px to 400, a pixel apart (the bold margin matters in a few pixels only)
      const overlapping = Array.from({ length: 251 }, (_, i) => 150 + i).filter(width => {
        const h = head(moduleOf(id)?.chart?.(NOW_EN, { width, height: 118 }) ?? '')
        return !(h.leftEnd + 4 <= h.rightStart)
      })
      expect([id, overlapping]).toEqual([id, []])
      const wide = head(moduleOf(id)?.chart?.(NOW_EN, { width: 400, height: 118 }) ?? '')
      expect([id, wide.squeezed, wide.leftEnd + 4 <= wide.rightStart]).toEqual([id, false, true])
    })
  }
})

// the owner 2026-10-15 s39 「幫我把我showinfo 系列的小卡都做好，文字都好醜做成小圖表圓形或成小方條」, then 「OK，showinfo 小卡用 B 方條」 on the mock:
// an H2 tile (showinfo, -half, -full) on the desktop is a small picture: the tile's words and its value on one line, a bar of the value under
// them in the status line's tones; the branch its name and its unsaved files with a mark of the fast-forward; the score its total and band
// with a strip of A B C D, the band lit. The room is chartBox's for 3 rows: 30 px high (his 1.webp: an H2 frame 67 px, 2.5 rows of 26.8).
describe('the showinfo tiles: words, a value and a bar (s39, B)', () => {
  const H2 = { width: 69, height: 30 }
  const TILES = ['session.ctx', 'session.5h', 'session.7d', 'session.git', 'session.score', 'host.load', 'host.diskchart']
  const tileOf = (id: string, input: ModuleInput, box = H2) => moduleOf(id)?.tile?.(input, box) ?? ''
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const attrsOf = (a: string) => Object.fromEntries([...a.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]])) as Record<string, string>
  const textsOf = (svg: string) => [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map(m => ({ ...attrsOf(m[1] ?? ''), content: unescape(m[2] ?? '') }))
  const wordsOf = (svg: string) => textsOf(svg).map(t => t.content)
  // the rects after the panel (the first, the box's size)
  const rectsOf = (svg: string) => [...svg.matchAll(/<rect ([^>]*)\/>/g)].map(m => attrsOf(m[1] ?? '')).slice(1)
  const track = (svg: string) => rectsOf(svg).find(r => r['fill'] === COLOUR.track && r['data-band'] === undefined)
  const filled = (svg: string) => rectsOf(svg).filter(r => r['fill'] !== COLOUR.track && r['data-band'] === undefined)
  const EN_IN: ModuleInput = { ...FULL, t: translator(EN) }
  const JA_IN: ModuleInput = { ...FULL, t: translator(JA) }
  const at = (session: Partial<SessionFacts>): ModuleInput => ({ ...FULL, session: { ...SESSION, ...session } })

  test('seven modules draw an H2 tile; one with no value to draw (the journal, a chart of its own) keeps its lines', () => {
    for (const id of TILES) expect(`${id} ${typeof moduleOf(id)?.tile}`).toBe(`${id} function`)
    for (const id of ['session.journal', 'session.gauges', 'session.tools', 'host.usage']) expect(`${id} ${typeof moduleOf(id)?.tile}`).toBe(`${id} undefined`)
  })

  test('a tile is one SVG document the size of its box, never NaN or undefined, with everything read and with nothing', () => {
    for (const id of TILES) {
      for (const input of [FULL, EMPTY]) {
        for (const box of [H2, { width: 60, height: 30 }, { width: 160, height: 30 }, { width: 449, height: 30 }]) {
          const svg = tileOf(id, input, box)
          expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}"`)).toBe(true)
          expect(svg.endsWith('</svg>')).toBe(true)
          expect(`${id} ${svg.match(/NaN|undefined|null|Infinity/)?.[0]}`).toBe(`${id} undefined`)
        }
      }
    }
  })

  test('context, 5 hours and weekly: the words before the value, the value, and a bar of it, in the status line\'s tones', () => {
    const cases: [string, ModuleInput, string[], number, string][] = [
      ['session.ctx', FULL, ['目前剩下', '50%'], 50, COLOUR.success],
      ['session.5h', FULL, ['五小時', '23%'], 23.2, COLOUR.success],
      ['session.7d', FULL, ['每週', '8%'], 8, COLOUR.success],
      ['session.ctx', at({ left: 25 }), ['目前剩下', '25%'], 25, COLOUR.warning],
      ['session.ctx', at({ left: 5 }), ['目前剩下', '5%'], 5, COLOUR.error],
      ['session.5h', at({ h5: 90 }), ['五小時', '90%'], 90, COLOUR.error],
      ['session.7d', at({ d7: 61 }), ['每週', '61%'], 61, COLOUR.warning],
    ]
    for (const [id, input, words, percent, colour] of cases) {
      const svg = tileOf(id, input)
      expect([id, wordsOf(svg)]).toEqual([id, words])
      const all = Number(track(svg)?.['width'])
      const fill = filled(svg)
      expect([id, fill.length, fill[0]?.['fill']]).toEqual([id, 1, colour])
      // the part filled is the percent of the track (a sliver is never shorter than the bar is high)
      const want = Math.max((all * percent) / 100, Number(track(svg)?.['height']))
      expect([id, Math.abs(Number(fill[0]?.['width']) - want) < 0.15]).toEqual([id, true])
    }
  })

  test('the bar stands under the words and inside the box; the words inside it', () => {
    for (const id of TILES.filter(id => id !== 'session.git')) {
      for (const box of [H2, { width: 160, height: 30 }]) {
        const svg = tileOf(id, FULL, box)
        const bars = rectsOf(svg).filter(r => r['fill-opacity'] !== undefined || r['data-band'] !== undefined)
        const baseline = Number(textsOf(svg)[0]?.['y'])
        expect([id, bars.length > 0]).toEqual([id, true])
        for (const r of bars) {
          expect([id, Number(r['y']) >= baseline + 2, Number(r['y']) + Number(r['height']) <= box.height - 2]).toEqual([id, true, true])
          expect([id, Number(r['x']) >= 2, Number(r['x']) + Number(r['width']) <= box.width - 2]).toEqual([id, true, true])
        }
        // s39 asked for 9 px here; since s44 the line shrinks instead of being squashed, and at 69 px 「目前剩下 50%」 needs 8.85 px
        // to stay whole. Keeping the words whole was taken over keeping 9 px: 0.15 px is invisible, a cut character is not.
        expect([id, Number(textsOf(svg)[0]?.['font-size']) >= 8]).toEqual([id, true])
      }
    }
  })

  test('nothing read: the value is ?, the bar empty', () => {
    for (const [id, words] of [['session.ctx', ['目前剩下', '?']], ['session.5h', ['五小時', '?']], ['session.7d', ['每週', '?']], ['host.load', ['負載', '?']], ['host.diskchart', ['磁碟', '?']]] as const) {
      const svg = tileOf(id, EMPTY)
      expect([id, wordsOf(svg)]).toEqual([id, words])
      expect([id, track(svg) !== undefined, filled(svg).length]).toEqual([id, true, 0])
    }
  })

  test('the branch: its last part after ⎇, then the unsaved files and a mark of the fast-forward, each in its colour', () => {
    const colourOf = (svg: string, word: string) => textsOf(svg).find(t => t.content === word)?.['fill']
    const can = tileOf('session.git', FULL)
    expect(wordsOf(can)).toEqual(['⎇ l-8b5c70', '待存檔 2', '↑'])
    expect([colourOf(can, '待存檔 2'), colourOf(can, '↑')]).toEqual([COLOUR.warning, COLOUR.blue])
    const done = tileOf('session.git', at({ dirty: 0, ff: 'done' }))
    expect(wordsOf(done)).toEqual(['⎇ l-8b5c70', '待存檔 0', '✓'])
    expect([colourOf(done, '待存檔 0'), colourOf(done, '✓')]).toEqual([COLOUR.dim, COLOUR.success])
    const cannot = tileOf('session.git', at({ ff: 'cannot' }))
    expect(colourOf(cannot, '✕')).toBe(COLOUR.error)
    const unknown = tileOf('session.git', at({ ff: undefined, dirty: undefined }))
    expect(wordsOf(unknown)).toEqual(['⎇ l-8b5c70', '待存檔 ?', '?'])
    expect(colourOf(unknown, '?')).toBe(COLOUR.dim)
    // the second line stands under the first
    expect(Number(textsOf(can)[1]?.['y'])).toBeGreaterThan(Number(textsOf(can)[0]?.['y']) + 6)
    // s44: 「分支 ?（不是 git）」 is ten characters in a 69 px test box; at the 7 px floor its last bracket is cut rather than the
    // glyphs pressed thin. A real H2 tile is 100 px (docs/measures.md 2026-10-20) and it fits there whole.
    expect(wordsOf(tileOf('session.git', EMPTY))).toEqual([`${ZH('ses.notGit').slice(0, -1)}…`])
    expect(wordsOf(tileOf('session.git', EMPTY, { width: 100, height: 30 }))).toEqual([ZH('ses.notGit')])
    // a branch name from git goes in escaped
    expect(tileOf('session.git', at({ branch: 'x/<b>' }))).toContain('⎇ &lt;b&gt;')
  })

  test('the score: its total and band in the band\'s colour, a strip of A B C D with the band lit', () => {
    const lit = (svg: string) => rectsOf(svg).filter(r => r['data-band'] !== undefined).map(r => `${r['data-band']} ${r['fill'] === COLOUR.track ? '-' : r['fill']}`)
    const d = tileOf('session.score', FULL)
    expect(wordsOf(d)).toEqual(['分數', '-6 · D'])
    expect(textsOf(d)[1]?.['fill']).toBe(COLOUR.error)
    expect(lit(d)).toEqual(['A -', 'B -', 'C -', `D ${COLOUR.error}`])
    const b = tileOf('session.score', at({ score: 'B', total: '12' }))
    expect(wordsOf(b)).toEqual(['分數', '12 · B'])
    expect(lit(b)).toEqual(['A -', `B ${COLOUR.success}`, 'C -', 'D -'])
    expect(lit(tileOf('session.score', at({ score: 'C' })))).toEqual(['A -', 'B -', `C ${COLOUR.warning}`, 'D -'])
    const none = tileOf('session.score', EMPTY)
    expect(wordsOf(none)).toEqual(['分數', '? · ?'])
    expect(lit(none)).toEqual(['A -', 'B -', 'C -', 'D -'])
  })

  test('load: the one-minute figure and a bar of it per core; the disk chart: / first, its percent and a bar', () => {
    const load = tileOf('host.load', FULL)
    expect(wordsOf(load)).toEqual(['負載', '1.43'])
    // 1.43 on 16 cores is 8.9375% (worked out apart from the code)
    const all = Number(track(load)?.['width'])
    expect(Math.abs(Number(filled(load)[0]?.['width']) - Math.max((all * 8.9375) / 100, Number(track(load)?.['height'])))).toBeLessThan(0.15)
    const noCores = tileOf('host.load', { ...FULL, files: { ...FILES, '/proc/cpuinfo': undefined } })
    expect([wordsOf(noCores), filled(noCores).length]).toEqual([['負載', '1.43'], 0])
    const disk = tileOf('host.diskchart', FULL)
    expect(wordsOf(disk)).toEqual(['磁碟 /', '39%'])
    expect(Math.abs(Number(filled(disk)[0]?.['width']) - (Number(track(disk)?.['width']) * 39) / 100)).toBeLessThan(0.15)
    expect(filled(disk)[0]?.['fill']).toBe(COLOUR.success)
  })

  test('in English and Japanese each tile says its own words', () => {
    const words = (input: ModuleInput) => TILES.map(id => wordsOf(tileOf(id, input)))
    expect(words(EN_IN)).toEqual([['context', '50%'], ['5 hours', '23%'], ['weekly', '8%'], ['⎇ l-8b5c70', 'unsaved 2', '↑'], ['score', '-6 · D'], ['load', '1.43'], ['disk /', '39%']])
    expect(words(JA_IN)).toEqual([['残り', '50%'], ['5時間', '23%'], ['週間', '8%'], ['⎇ l-8b5c70', '未保存 2', '↑'], ['スコア', '-6 · D'], ['負荷', '1.43'], ['ディスク /', '39%']])
  })

  test('the words never run past the box or into the value: the line shrinks, then cuts, then gives way (s44), at every width from 60 to 200 px', () => {
    const LONG: ModuleInput[] = [FULL, EN_IN, JA_IN].flatMap(input => [input, { ...input, session: { ...SESSION, branch: 'claude/a-very-long-branch-name-for-a-test', total: '-1234' } }])
    const end = (t: Record<string, string>) => Number(t['x']) + (t['textLength'] !== undefined ? Number(t['textLength']) : estimateEm(t['content'] ?? '') * Number(t['font-size']) * 1.05)
    // a text drawn at its end (anchor end) reaches back its textLength where it is squeezed, else its estimate
    const start = (t: Record<string, string>) => Number(t['x']) - (t['textLength'] !== undefined ? Number(t['textLength']) : estimateEm(t['content'] ?? '') * Number(t['font-size']))
    const wrong: string[] = []
    for (const id of TILES) {
      for (const input of LONG) {
        for (let width = 60; width <= 200; width++) {
          const texts = textsOf(tileOf(id, input, { width, height: 30 }))
          for (const t of texts) {
            if (t['text-anchor'] === 'start' && end(t) > width - 2) wrong.push(`${id} ${width} ${t['content']} past the box`)
            if (t['text-anchor'] === 'end' && start(t) < 2) wrong.push(`${id} ${width} ${t['content']} before the box`)
          }
          // two texts on one line: the left one ends 4 px before the right one starts
          for (const l of texts) for (const r of texts) {
            if (l !== r && l['y'] === r['y'] && l['text-anchor'] === 'start' && r['text-anchor'] === 'end' && end(l) + 4 > start(r)) wrong.push(`${id} ${width} ${l['content']} into ${r['content']}`)
          }
        }
      }
    }
    expect(wrong.slice(0, 5)).toEqual([])
  })
})

// s39 (the owner 「可以」 on the swatches): each dark colour of the palette and its day counterpart, GitHub's light palette; the track's grey
// stays; the add-card pane's chosen place (#b1b9f9) takes the day blue. withDay puts the rules right after a document's opening tag.
describe('the day colours (s39)', () => {
  test('the table is the swatches Alex approved, every colour of the palette but the track in it', () => {
    expect(DAY).toEqual({
      '#262626': '#f6f8fa', '#f2f2f2': '#1f2328', '#c9d1d9': '#424a53', '#8a8a8a': '#656d76', '#3fb950': '#1a7f37',
      '#d29922': '#9a6700', '#f85149': '#cf222e', '#58a6ff': '#0969da', '#bc8cff': '#8250df', '#b1b9f9': '#0969da',
    })
    for (const [name, colour] of Object.entries(COLOUR)) expect([name, name === 'track' || DAY[colour] !== undefined]).toEqual([name, true])
  })

  test('withDay puts one style of rules right after the opening tag, a fill and a stroke rule for each colour; the rest unchanged', () => {
    const doc = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect fill="#262626"/></svg>'
    const out = withDay(doc)
    const open = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">'
    expect(out.startsWith(`${open}<style>@media (prefers-color-scheme: light){`)).toBe(true)
    expect(out.endsWith('}</style><rect fill="#262626"/></svg>')).toBe(true)
    for (const [dark, day] of Object.entries(DAY)) {
      expect(out).toContain(`[fill="${dark}"]{fill:${day}}`)
      expect(out).toContain(`[stroke="${dark}"]{stroke:${day}}`)
    }
    expect(out.match(/<style>/g)?.length).toBe(1)
  })
})

// s44 (the owner 「乙，整行字變小」, picked off three drawn versions of his own narrow band): a chart's head never squashes its glyphs.
// s37 gave the left words an SVG textLength with lengthAdjust="spacingAndGlyphs", which pressed the letters thin — that is what he
// reported as 「被擠」. Now the WHOLE line (both texts) is drawn a size smaller until it fits, down to a floor; at the floor, where
// nothing else can give, the left words are cut with an ellipsis, never squashed.
describe('a chart\'s head shrinks instead of squashing (s44)', () => {
  const EN_T = translator(EN)
  const NOW_EN: ModuleInput = { files: { '~/.config/jev/usage.jsonl': JSON.stringify({ at: '2026-10-14T08:04:18Z', status: 200, input_tokens: 284 }) + '\n' },
    runs: { [runKey(JEV_NOW)]: '1791972000\n', 'git log --since=15.days.ago --format=%cs': '2026-10-12\n2026-10-12\n', 'date +%F': '2026-10-12\n' }, session: SESSION, t: EN_T }
  const twoTexts = (svg: string) => {
    const texts = [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].slice(0, 2)
    const attr = (a: string, name: string) => Number(a.match(new RegExp(`${name}="([\\d.]+)"`))?.[1])
    return texts.map(m => ({ size: attr(m[1] ?? '', 'font-size'), squeezed: /lengthAdjust/.test(m[1] ?? ''), words: m[2] ?? '' }))
  }
  const headOf = (id: string, width: number) => twoTexts(moduleOf(id)?.chart?.(NOW_EN, { width, height: 118 }) ?? '')

  for (const id of ['session.commits']) {
    test(`${id}: nothing is squashed at any width from 60 to 400 px`, () => {
      const squashed = Array.from({ length: 341 }, (_, i) => 60 + i).filter(width => headOf(id, width).some(t => t.squeezed))
      expect([id, squashed]).toEqual([id, []])
    })

    test(`${id}: a narrow band draws the whole line smaller, both texts the same size`, () => {
      const narrow = headOf(id, 150)
      const wide = headOf(id, 400)
      expect([id, narrow[0]?.size === narrow[1]?.size]).toEqual([id, true])
      expect([id, (narrow[0]?.size ?? 0) < (wide[0]?.size ?? 0)]).toEqual([id, true])
    })

    test(`${id}: with room enough the line keeps its own size`, () => {
      const wide = headOf(id, 400)
      const wider = headOf(id, 600)
      expect([id, wide[0]?.size]).toEqual([id, wider[0]?.size])
    })
  }

  test('in a box too small for the line, the left words are cut or give way — never pressed thin, never over the value', () => {
    const tiny = headOf('host.jev', 60)
    expect(tiny.some(t => t.squeezed)).toBe(false)
    // at the floor it is cut with an ellipsis; where not even one character and an ellipsis fit, the left words go and the
    // right ones (what the tile is for) stay
    // whatever it does to fit — shrink, cut, or give way — the left words never reach the right ones
    const [l, r] = tiny
    const ends = 7 + estimateEm(l?.words ?? '') * (l?.size ?? 0) * 1.05
    const starts = 60 - 7 - estimateEm(r?.words ?? '') * (r?.size ?? 0)
    expect(ends <= starts).toBe(true)
  })
})

// s44 (the owner's 「OK」 on the drawn pair): the H2 tiles' own line follows the chart head — the whole line a size smaller, never a
// glyph pressed thin. Their words and their value stay what s39 settled; only the way they are made to fit changes.
describe('an H2 tile\'s line is never squashed either (s44)', () => {
  const EN_T = translator(EN)
  const IN: ModuleInput = { files: {}, runs: {}, session: { ...SESSION, ctx: { used: 50, left: 50 } } as never, t: EN_T }
  const squashedIn = (svg: string) => /lengthAdjust/.test(svg)

  for (const id of ['session.ctx', 'session.5h', 'session.score']) {
    test(`${id}: nothing is pressed thin at any width from 60 to 300 px`, () => {
      const bad = Array.from({ length: 241 }, (_, i) => 60 + i)
        .filter(width => squashedIn(moduleOf(id)?.tile?.(IN, { width, height: 30 }) ?? ''))
      expect([id, bad]).toEqual([id, []])
    })
  }
})

// s44 mutants P4 and P6, each a guard nothing reached: the give-way in a box too small for one character and an ellipsis, and the
// cut stopping one character short of fitting.
describe('what a line does when the box is impossibly narrow (s44)', () => {
  const EN_T = translator(EN)
  const IN: ModuleInput = { files: {}, runs: {}, session: { ...SESSION, total: '-123456789', band: 'D' } as never, t: EN_T }
  const textsIn = (svg: string) => [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map(m => {
    const a = Object.fromEntries([...(m[1] ?? '').matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]])) as Record<string, string>
    return { ...a, content: (m[2] ?? '').replace(/&lt;/g, '<').replace(/&amp;/g, '&') }
  })

  test('too narrow for one character and an ellipsis: the left words go, the value stays', () => {
    const texts = textsIn(moduleOf('session.score')?.tile?.(IN, { width: 34, height: 30 }) ?? '')
    const left = texts.filter(t => t['text-anchor'] !== 'end')
    const right = texts.filter(t => t['text-anchor'] === 'end')
    expect(left.map(t => t.content)).toEqual([])
    expect(right.length > 0).toBe(true)
  })

  // s44 mutant P6: a cut that stops one character early was hidden by the give-way above — the words vanished instead of
  // overflowing. A cut keeps as much as fits: one more character must not fit.
  test('a cut keeps as much as fits: one more character would not', () => {
    const full = 'score'
    const wrong: string[] = []
    for (let width = 30; width <= 200; width++) {
      const texts = textsIn(moduleOf('session.score')?.tile?.(IN, { width, height: 30 }) ?? '')
      const left = texts.find(t => t['text-anchor'] !== 'end')
      const right = texts.find(t => t['text-anchor'] === 'end')
      if (left === undefined || !left.content.endsWith('…')) continue
      const size = Number(left['font-size'])
      // the 8 px the drawing keeps between the two texts is room the left words never had (chart.ts HEAD_GAP)
      const room = (right === undefined ? width - Number(left['x']) : Number(right['x']) - estimateEm(right.content) * size - Number(left['x']) - 8)
      const kept = left.content.slice(0, -1)
      const oneMore = `${kept}${full.slice(kept.length, kept.length + 1)}…`
      if (estimateEm(oneMore) * size * 1.05 <= room) wrong.push(`${width}: ${left.content} could have kept one more`)
    }
    expect(wrong).toEqual([])
  })

  test('whatever is drawn on the left really fits the room it was given', () => {
    const wrong: string[] = []
    for (let width = 30; width <= 200; width++) {
      const texts = textsIn(moduleOf('session.score')?.tile?.(IN, { width, height: 30 }) ?? '')
      const left = texts.find(t => t['text-anchor'] !== 'end')
      const right = texts.find(t => t['text-anchor'] === 'end')
      if (left === undefined) continue
      const ends = Number(left['x']) + estimateEm(left.content) * Number(left['font-size']) * 1.05
      const starts = right === undefined ? width : Number(right['x']) - estimateEm(right.content) * Number(right['font-size'])
      if (ends > starts) wrong.push(`${width}: ${left.content} runs into ${right?.content ?? 'the edge'}`)
    }
    expect(wrong).toEqual([])
  })
})

