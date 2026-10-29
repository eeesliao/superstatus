// The host modules (the owner 2026-10-10 s33 「框123 顯示主機資訊」): the machine Claude Code runs on, read from Linux's /proc and /sys, and df
// for the disks. Read-only; no address and no IP (screenshots get shared). Where there is no /proc (a Mac) the values are ?.
import { barRows, barTile, COLOUR, MARK, pct, svg, text, usedTone, wordsBefore } from './chart'
import type { ModuleInput, SsModule } from './types'
import { runKey } from './types'

const HOSTNAME = '/proc/sys/kernel/hostname'
const KERNEL = '/proc/sys/kernel/osrelease'
const UPTIME = '/proc/uptime'
const CPUINFO = '/proc/cpuinfo'
const TEMP = '/sys/class/thermal/thermal_zone0/temp'
const LOADAVG = '/proc/loadavg'
const MEMINFO = '/proc/meminfo'
// local file systems only (-l: a hung network mount cannot stall it), POSIX columns in KiB, without the memory-backed ones
export const DF = ['df', '-P', '-k', '-l', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'overlay', '-x', 'squashfs', '-x', 'efivarfs'] as const
// s35 (the owner's table, 「磁碟卡 打包前改成 Mac 也能跑」): a Mac's df has no -x, so GNU's run fails there; this plain POSIX one is read when
// it did, without what is not a disk of the user's (notADisk)
export const DF_POSIX = ['df', '-P', '-k', '-l'] as const
const DFS = [DF, DF_POSIX]

const GIB = 1024 * 1024
const gib = (kib: number) => (kib / GIB).toFixed(1)

export function hostname(input: ModuleInput): string | undefined {
  return input.files[HOSTNAME]?.trim() || undefined
}

export function kernel(input: ModuleInput): string | undefined {
  return input.files[KERNEL]?.trim() || undefined
}

// 開機 7 天 1 小時; under a day 3 小時 12 分
export function uptime(input: ModuleInput): string | undefined {
  const seconds = Number(input.files[UPTIME]?.trim().split(/\s+/)[0])
  if (!Number.isFinite(seconds) || seconds < 0 || input.files[UPTIME] === undefined) return undefined
  const minutes = Math.floor(seconds / 60)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  return days > 0 ? input.t('host.upDays', { d: days, h: hours }) : input.t('host.upHours', { h: hours, m: minutes % 60 })
}

export function cores(input: ModuleInput): number | undefined {
  const text = input.files[CPUINFO]
  if (text === undefined) return undefined
  const n = (text.match(/^processor\s*:/gm) ?? []).length

  return n > 0 ? n : undefined
}

export function temperature(input: ModuleInput): string | undefined {
  const milli = Number(input.files[TEMP]?.trim())
  if (input.files[TEMP] === undefined || !Number.isFinite(milli)) return undefined

  return `${(milli / 1000).toFixed(1)}°C`
}

export function load(input: ModuleInput): [string, string, string] | undefined {
  const parts = input.files[LOADAVG]?.trim().split(/\s+/)
  if (parts === undefined || parts.length < 3 || parts.slice(0, 3).some(p => !Number.isFinite(Number(p)))) return undefined

  return [parts[0] as string, parts[1] as string, parts[2] as string]
}

// /proc/meminfo in KiB: used = total - available
export function memory(input: ModuleInput): { total: number; used: number; available: number; swapTotal: number; swapUsed: number } | undefined {
  const text = input.files[MEMINFO]
  if (text === undefined) return undefined
  const field = (name: string) => {
    const m = new RegExp(`^${name}:\\s*(\\d+)`, 'm').exec(text)
    return m ? Number(m[1]) : undefined
  }
  const total = field('MemTotal')
  const available = field('MemAvailable')
  if (total === undefined || available === undefined || total <= 0) return undefined
  const swapTotal = field('SwapTotal') ?? 0

  return { total, used: total - available, available, swapTotal, swapUsed: swapTotal - (field('SwapFree') ?? swapTotal) }
}

const percentOf = (part: number, whole: number) => Math.round((part / whole) * 100)

// What a Mac's df -l lists that is not a disk of the user's: devfs, the automounter's maps, and the system's own volumes under
// /System/Volumes except Data, which holds the user's files.
const notADisk = (source: string, mount: string) =>
  mount === '/dev' || source.startsWith('map ') || (mount.startsWith('/System/Volumes/') && mount !== '/System/Volumes/Data')

// df -P rows (GNU's, else the POSIX one's: a Mac): mount, percent used, used and size in KiB; / first, then the fullest. A row is read
// from both ends, so a source or a mount with a space in it (map auto_home, /Volumes/USB Stick) stays whole.
const DF_ROW = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/
export function disks(input: ModuleInput): { mount: string; percent: number; used: number; size: number }[] | undefined {
  const text = input.runs[runKey(DF)] ?? input.runs[runKey(DF_POSIX)]
  if (text === undefined) return undefined
  const rows = text
    .split('\n')
    .slice(1)
    .map(line => DF_ROW.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null && !notADisk(m[1] as string, m[6] as string))
    .map(m => ({ mount: m[6] as string, percent: Number(m[5]), used: Number(m[3]), size: Number(m[2]) }))

  return rows.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : b.percent - a.percent))
}

const shown = (value: string | number | undefined) => (value === undefined ? '?' : String(value))

// s35: the host's four figures as bars (主機資源): the one-minute load over the cores, memory used, swap used, / used; each with its line.
function resources(input: ModuleInput): { label: string; percent: number | undefined; line: string }[] {
  const avg = load(input)
  const n = cores(input)
  const mem = memory(input)
  const root = disks(input)?.find(r => r.mount === '/')
  const cpu = avg === undefined || n === undefined ? undefined : (Number(avg[0]) / n) * 100
  const memUsed = mem === undefined ? undefined : percentOf(mem.used, mem.total)
  const swap = mem === undefined || mem.swapTotal === 0 ? undefined : percentOf(mem.swapUsed, mem.swapTotal)
  const p = (v: number | undefined) => (v === undefined ? '?' : `${Math.round(v)}%`)
  return [
    { label: 'CPU', percent: cpu, line: input.t('chart.cpuLine', { p: p(cpu) }) },
    { label: input.t('chart.memory'), percent: memUsed, line: input.t('host.mem', { v: p(memUsed) }) },
    { label: input.t('chart.swap'), percent: swap, line: input.t('host.swap', { v: mem !== undefined && mem.swapTotal === 0 ? input.t('host.none') : p(swap) }) },
    { label: input.t('chart.disk', { mount: '/' }), percent: root?.percent, line: input.t('host.disk', { mount: '/', p: root?.percent ?? '?' }) },
  ]
}

export const HOST_MODULES: readonly SsModule[] = [
  {
    id: 'host.overview',
    name: 'Host',
    group: 'host',
    about: 'host name, kernel, uptime, CPU cores, temperature',
    role: 'tile',
    reads: [HOSTNAME, KERNEL, UPTIME, CPUINFO, TEMP],
    lines: input => [
      input.t('host.host', { v: shown(hostname(input)) }),
      input.t('host.kernel', { v: shown(kernel(input)) }),
      input.t('host.up', { v: shown(uptime(input)) }),
      input.t('host.cpu', { n: shown(cores(input)) }),
      input.t('host.temp', { v: shown(temperature(input)) }),
    ],
  },
  {
    id: 'host.usage',
    name: 'Usage',
    group: 'host',
    about: 'load (1, 5, 15 minutes), load per core, memory, swap',
    role: 'tile',
    reads: [LOADAVG, CPUINFO, MEMINFO],
    lines: input => {
      const avg = load(input)
      const n = cores(input)
      const mem = memory(input)
      return [
        input.t('host.load', { v: avg === undefined ? '?' : avg.join(' ') }),
        input.t('host.perCore', { n: shown(n), p: avg === undefined || n === undefined ? '?' : `${Math.round((Number(avg[0]) / n) * 100)}%` }),
        input.t('host.mem', { v: mem === undefined ? '?' : `${percentOf(mem.used, mem.total)}%` }),
        input.t('host.used', { v: mem === undefined ? '?' : `${gib(mem.used)} / ${gib(mem.total)} GiB` }),
        input.t('host.swap', {
          v: mem === undefined
            ? '?'
            : mem.swapTotal === 0
              ? input.t('host.none')
              : input.t('host.swapDetail', { p: percentOf(mem.swapUsed, mem.swapTotal), used: gib(mem.swapUsed), total: gib(mem.swapTotal) }),
        }),
      ]
    },
  },
  {
    id: 'host.memory',
    name: 'Memory',
    group: 'host',
    about: 'memory used, used, available, swap',
    role: 'tile',
    reads: [MEMINFO],
    lines: input => {
      const mem = memory(input)
      if (mem === undefined) return [input.t('host.mem', { v: '?' })]
      return [
        input.t('host.mem', { v: `${percentOf(mem.used, mem.total)}%` }),
        input.t('host.used', { v: `${gib(mem.used)} / ${gib(mem.total)} GiB` }),
        input.t('host.free', { v: gib(mem.available) }),
        input.t('host.swap', { v: mem.swapTotal === 0 ? input.t('host.none') : `${percentOf(mem.swapUsed, mem.swapTotal)}%` }),
      ]
    },
  },
  {
    id: 'host.load',
    name: 'Load',
    group: 'host',
    about: 'one-minute load, the 1, 5 and 15 minute figures, the cores',
    role: 'tile',
    reads: [LOADAVG, CPUINFO],
    lines: input => {
      const avg = load(input)
      if (avg === undefined) return [input.t('host.load', { v: '?' })]
      return [input.t('host.load', { v: avg[0] }), avg.join(' '), input.t('host.cpu', { n: shown(cores(input)) })]
    },
    // s39 (B): the one-minute figure and a bar of it per core
    tile: (input, box) => {
      const avg = load(input)
      const n = cores(input)
      const p = avg !== undefined && n ? (Number(avg[0]) / n) * 100 : undefined
      return barTile(box, wordsBefore(input.t('host.load', { v: MARK }), 'load'), avg?.[0] ?? '?', p, usedTone(p))
    },
  },
  {
    id: 'host.disk', every: 300,
    name: 'Disks',
    group: 'host',
    about: 'local disks used: / first, then the fullest (df)',
    role: 'tile',
    runs: DFS,
    lines: input => {
      const rows = disks(input)
      if (rows === undefined || rows.length === 0) return [input.t('host.diskUnknown')]
      const first = rows[0] as (typeof rows)[number]
      return [
        input.t('host.disk', { mount: first.mount, p: first.percent }),
        ...rows.slice(0, 4).map(r => `${r.mount} ${r.percent}% ${gib(r.used)}/${gib(r.size)}G`),
      ]
    },
  },
  // s35 (the owner 「H3 以上的可以畫一些圖表」): the host in pictures
  {
    id: 'host.resources',
    name: 'Resources',
    group: 'host',
    about: 'bars: CPU load per core, memory, swap, disk / (a chart in H3)',
    role: 'tile',
    reads: [LOADAVG, CPUINFO, MEMINFO],
    runs: DFS,
    lines: input => resources(input).map(r => r.line),
    chart: (input, box) =>
      svg(box, barRows(box, resources(input).map(r => ({ label: r.label, percent: r.percent, value: pct(r.percent), colour: usedTone(r.percent) })))),
  },
  {
    id: 'host.diskchart', every: 300,
    name: 'Disk chart',
    group: 'host',
    about: 'a bar for each local disk, / first, then the fullest (df; a chart in H3)',
    role: 'tile',
    runs: DFS,
    lines: input => {
      const rows = disks(input)
      if (rows === undefined || rows.length === 0) return [input.t('host.diskUnknown')]
      return rows.slice(0, 5).map(r => input.t('host.disk', { mount: r.mount, p: r.percent }))
    },
    // s39 (B): / first (the list's first), its percent and a bar
    tile: (input, box) => {
      const first = disks(input)?.[0]
      return barTile(box, wordsBefore(input.t('host.disk', { mount: first?.mount ?? '', p: MARK }), 'disk'), first ? `${first.percent}%` : '?', first?.percent, usedTone(first?.percent))
    },
    chart: (input, box) => {
      const rows = disks(input) ?? []
      // a row is at least 22 px: as many as the box holds, five at most; the size beside the percent where the box is wide
      const fit = Math.max(1, Math.min(5, Math.floor((box.height - 16) / 22)))
      const wide = box.width >= 360
      const shownRows =
        rows.length === 0
          ? [{ label: input.t('host.diskUnknown'), percent: undefined, value: '?', colour: COLOUR.dim }]
          : rows.slice(0, fit).map(r => ({ label: r.mount, percent: r.percent, value: `${r.percent}%`, colour: usedTone(r.percent), size: `${gib(r.used)} / ${gib(r.size)} GiB` }))
      const sizes = wide ? shownRows.map(r => ('size' in r ? r.size : '')) : []
      const room = wide ? Math.max(...sizes.map(t => t.length)) * 6.6 + 12 : 0
      const inner = { width: box.width - room, height: box.height }
      const pad = Math.min(14, box.height * 0.12)
      const pitch = (box.height - 2 * pad) / shownRows.length
      const size = Math.max(9, Math.min(12, pitch * 0.46))
      return svg(
        box,
        barRows(inner, shownRows) +
          sizes.map((t, k) => (t === '' ? '' : text(box.width - pad, pad + pitch * (k + 0.5) + size * 0.35, t, { size, colour: COLOUR.dim, anchor: 'end' }))).join(''),
      )
    },
  },
  {
    id: 'host.snapshot',
    name: 'Host now',
    group: 'host',
    about: 'a press: a line in the corner with the host name, load, memory, / used',
    role: 'button',
    reads: [HOSTNAME, LOADAVG, MEMINFO],
    runs: DFS,
    press: input => {
      const avg = load(input)
      const mem = memory(input)
      const root = disks(input)?.find(r => r.mount === '/')
      return {
        kind: 'toast',
        text: [
          shown(hostname(input)),
          input.t('host.load', { v: avg === undefined ? '?' : avg[0] }),
          input.t('host.mem', { v: mem === undefined ? '?' : `${percentOf(mem.used, mem.total)}%` }),
          `/ ${root === undefined ? '?' : `${root.percent}%`}`,
        ].join(' · '),
      }
    },
  },
]
