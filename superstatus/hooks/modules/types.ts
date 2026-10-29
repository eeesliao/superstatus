// A superstatus module (the owner 2026-10-10 s33 「每個框都是一個模組，每個按鈕可以是模組也可以是hook也可以是轉發執行命令」「框1~8是各種模組，按鈕1~12是
// 各種模組」): what one tile of the band shows (a tile module) or what one button of the band does (a button module).
//
// A module is plain data and plain functions: it never touches the engine. It names the files it wants read and the read-only commands
// it wants run; superstatus reads and runs them (when the facts are read: a session's start, each turn's end, /ss reload, and for a button
// module its press) and hands the module what came back. The engine refuses a module that passes $ to a function declared in another
// file (s29 pitfall), and a module that cannot reach the engine cannot change anything: anyone can add one (docs/modules.md).

// What superstatus has read about the session and the project, the same facts its status line shows; any of them may be missing.
import type { Translate } from '../lang/types'

export type SessionFacts = {
  who?: string
  block?: string
  // the score band and the total (Score.md score_band, score_total)
  score?: string
  total?: string
  pending?: number
  branch?: string
  dirty?: number
  ff?: 'done' | 'can' | 'cannot'
  // percent left before auto-compaction, and the 5-hour and weekly quota used
  left?: number
  h5?: number
  d7?: number
  // the pomodoro as the card needs it (s44): what is left in ms, what it is doing, how many are done
  pomo?: { left: number; state: 'idle' | 'run' | 'pause' | 'break'; done: number }
  // this session's main-loop tool calls so far (-1 before they were counted)
  tools: number
  version: string
  // the last lines of the newest journal, the newest last
  journal: readonly string[]
  // every event of the newest journal, oldest first (s35: the timeline); missing before the journal is read
  events?: readonly JournalEvent[]
}

// A journal line's id and its event word (DESIGN §1: WHO ADD DECIDE LAUNCH PASS FAIL FIX CLOSE).
export type JournalEvent = { id: number; word: string }

// The room a chart is drawn in, in CSS px: superstatus works it out from the tile's cells and rows.
export type ChartBox = { width: number; height: number }

// What a module is given: each file it named (its text; undefined when it is not there or could not be read), each command it named (by
// its argv joined with spaces: what it printed; undefined when it failed or ran past its time), and the session's facts.
// t: the panel's language (s34): a key's words in it, English where it has none, else the fallback given.
export type ModuleInput = {
  files: Readonly<Record<string, string | undefined>>
  runs: Readonly<Record<string, string | undefined>>
  session: SessionFacts
  t: Translate
}

// What a button module asks superstatus to do when it is pressed.
export type ModuleEffect =
  // read the store and the project's files again (/ss reload)
  | { kind: 'reload' }
  // open the /ss panel in its pane
  | { kind: 'panel' }
  // a short line at the corner of the window
  | { kind: 'toast'; text: string }
  // words sent as if typed (a turn of their own)
  | { kind: 'submit'; text: string }

export type SsModule = {
  // group.name, lowercase: what a 模組卡 keeps
  id: string
  // the card's name when none is typed: at most four characters (a name button is four wide); in English, the language file has the
  // others (mod.<id>.name)
  name: string
  // the heading it is listed under in the 新增卡片 pane: host, session, action, or a module's own (mod.group.<group> names it)
  group: string
  // one line saying what it shows or does, in English (mod.<id>.about in a language file)
  about: string
  // a tile (H2 or H3, a display) or a button (H1, the button row)
  role: 'tile' | 'button'
  // absolute paths superstatus reads for it
  reads?: readonly string[]
  // read-only commands superstatus runs for it (argv, no shell), each for at most 3 seconds
  runs?: readonly (readonly string[])[]
  // a tile's lines: an H2 tile shows the first, an H3 tile up to five; never empty
  lines?: (input: ModuleInput) => string[]
  // a tile's picture (s35, the owner 「H3 以上的可以畫一些圖表」): an SVG document, <svg ...>...</svg>, as wide and as tall as the box, drawn in
  // an H3, H3-half or H3-full tile on a surface that draws pictures; its lines stay what an H2 tile and the terminal show, and the picture's
  // alt. Words from files go in escaped (chart.ts esc).
  chart?: (input: ModuleInput, box: ChartBox) => string
  // an H2 tile's picture (s39, the owner 「showinfo 系列的小卡…做成小圖表…小方條」, B on the mock): an SVG document as chart's, drawn in an H2,
  // H2-half or H2-full tile on the desktop: the tile's words and its value on one line, a bar (or a mark) under them; its lines stay the alt
  tile?: (input: ModuleInput, box: ChartBox) => string
  // how often this module is worth reading again, in seconds (s43): its own rhythm, so a card of it needs nothing set.
  // Left out, the minute superstatus has always used. A card may pick another; a card's 只在回合結束 beats both.
  every?: number
  // a button's press
  press?: (input: ModuleInput) => ModuleEffect
}

// The rhythms a card or a module may ask for, picked by name and never typed as a number (s43, the owner 「要合理呀…你是用工程師思維
// 在設計產品」 then 「你說的OK」). One list, so the tools, the module files and the panel cannot drift apart; turn is 只在回合結束,
// never on the timer. A 指令卡 takes none at all (「指令卡不需要，謝謝」).
export const RHYTHMS = ['fast', 'normal', 'slow', 'turn'] as const
export type Rhythm = (typeof RHYTHMS)[number]
export const RHYTHM_SECONDS: Record<Rhythm, number> = { fast: 10, normal: 60, slow: 300, turn: 0 }
export const isRhythm = (v: unknown): v is Rhythm => typeof v === 'string' && (RHYTHMS as readonly string[]).includes(v)

// How many lines an H3 tile holds (8 rows less half a row and its two border rows: 5.5).
export const H3_LINES = 5

export const runKey = (argv: readonly string[]) => argv.join(' ')

// A ten-block bar of a percent, as the terminal's (█ filled, ░ empty).
export const bar = (percent: number) => {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)))
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}
