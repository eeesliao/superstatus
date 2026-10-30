import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { AboveBlock, SlCard, SlCardKind, SlDraft, SlKey, SlSettings, SlSize, SsProfiles } from '../types'

import { BAND_EM, bandLabel, columnLabel, fixed, leastEm, MAX_CHARACTERS, OFF_MARK, ON_MARK, padded, textEm, uiLabel } from './labels'
import { BUILT_IN, checkLang, EN, translator } from './lang'
import type { LangFile, Translate } from './lang'
import { clockText, NO_POMO, pomoAfter, pomoLeft, pomoNext } from './pomo'
import { localDay, zoneOffsetMs } from './zone'
import type { Props as GridProps } from './sortgrid'
// the four states a stored pomodoro may carry; anything else is settings from before it, or nonsense, and is dropped
const POMO_STATES: readonly string[] = ['idle', 'run', 'pause', 'break']
import type { Pomo, PomoVerb } from './pomo'
import { allModules, H3_LINES, isRhythm, MODULES, moduleOf, RHYTHM_SECONDS, RHYTHMS, runKey, setUserModules } from './modules'
import type { Rhythm } from './modules'
import { withDay } from './modules/chart'
import type { ChartBox, JournalEvent, ModuleEffect, SessionFacts, SsModule } from './modules'
import { checkProfile, fileOf, makeProfile, nameProblem, PROFILE_NAME_MAX, runsThings, savedLabel } from './profiles'
import { checkUserModule, toUserModule } from './usermods'

// superstatus (session-status until 2026-10-09 s28, renamed by the owner so the status line at the bottom reads superstatus in front):
// one status line for a another project session (the owner, 2026-10-09 s27: 「資訊類型的放A」).
// Display only: no tool.call hook. Reads the newest journal, MEMORY.md and Score.md; runs three read-only
// git commands; counts this session's main-loop tool calls from the rows the session stores.

type Key = SlKey
// ver: 版本號, the version (the owner 2026-10-09 s29 「版本號只要在 status line」), first; the one card that cannot be deleted
const KEYS: readonly Key[] = ['ver', 'who', 'block', 'tools', 'ctx', '5h', '7d', 'score', 'pending', 'branch', 'dirty', 'ff']
const GROUPS: Record<string, readonly Key[]> = { git: ['branch', 'dirty', 'ff'] }

type Settings = SlSettings
// the owner 2026-10-09 (「資訊好多看不懂」): by default only 操作者, 工作塊, context and 額度, in words.
const DEFAULTS: Settings = { off: ['tools', 'score', 'pending', 'branch', 'dirty'], note: '', icons: false, order: [...KEYS], cards: [], collapsed: false, aboveOrder: [], aboveCollapsed: false, touchCollapsed: false, h3Collapsed: false, h2Collapsed: false, h3HalfCollapsed: false, h3FullCollapsed: false, h2HalfCollapsed: false, h2FullCollapsed: false, removed: [], aboveOff: [] }
const isKey = (id: string): id is Key => (KEYS as readonly string[]).includes(id)
// The default order: the built-in items, then the added cards in the order they were added.
const defaultOrder = (cards: readonly SlCard[]) => [...KEYS, ...cards.filter(c => c.section !== 'above').map(c => c.id)]
// The AbovePrompt section's default order: its cards in the order they were added (the owner 2026-10-09 s28).
const aboveDefault = (cards: readonly SlCard[]) => cards.filter(c => c.section === 'above').map(c => c.id)
const isAbove = (st: Settings, key: string) => st.cards.some(c => c.id === key && c.section === 'above')
// TouchBar, the first layer of AbovePrompt (the owner 2026-10-09 s29): its 按鈕卡. They keep their places in aboveOrder; TouchBar sorts them
// among themselves and AbovePrompt sorts its other cards among themselves.
const isTouch = (st: Settings, key: string) => st.cards.some(c => c.id === key && c.section === 'above' && isPress(c))
// Which menu under AbovePrompt a card stands in (s30; renumbered 2026-10-10): its size's (H1 is TouchBar, the 按鈕卡 and since s38 the 開關卡);
// undefined for a card not in AbovePrompt.
const groupOf = (st: Settings, key: string): SlSize | undefined => {
  const card = st.cards.find(c => c.id === key && c.section === 'above')
  return card === undefined ? undefined : sizeOf(card)
}

type Facts = {
  who?: string
  block?: string
  score?: string
  pending?: number
  branch?: string
  dirty?: number
  // fast-forward of master: done = HEAD is already in it, can = master is behind HEAD, cannot = diverged
  ff?: 'done' | 'can' | 'cannot'
  left?: number
  h5?: number
  d7?: number
  // Score.md score_total, and the newest journal's last lines (the newest last) for the modules (s33)
  total?: string
  journal?: string[]
  // every event line of the newest journal, oldest first (s35: the timeline chart)
  events?: JournalEvent[]
  // the pomodoro as a card needs it (s44), worked out in readModules from the settings and the clock
  pomo?: { left: number; state: 'idle' | 'run' | 'pause' | 'break'; done: number }
}

const GIT_BRANCH = ['git', 'rev-parse', '--abbrev-ref', 'HEAD']
const GIT_DIRTY = ['git', 'status', '--porcelain']
const GIT_FF = ['git', 'merge-base', '--is-ancestor', 'HEAD', 'master']
const GIT_FF_MAIN = ['git', 'merge-base', '--is-ancestor', 'HEAD', 'main']
const GIT_CAN = ['git', 'merge-base', '--is-ancestor', 'master', 'HEAD']
const GIT_CAN_MAIN = ['git', 'merge-base', '--is-ancestor', 'main', 'HEAD']
const JOURNAL = /^journal_\d{4}-\d{2}-\d{2}_.+\.md$/
const PENDING = /^\s*(?:-\s*)?\[PENDING\] \[\d{4}-\d{2}-\d{2}\]/gm

// The engine puts the mod's name in front of the status line and of the command reply; it cannot be hidden or empty.
const NAME = 'superstatus'
// The version (the owner 2026-10-09 s29 「v0.1 開始」; 2026-10-10 s30 「叫 v 0.2」; 2026-10-12 s35 v0.3, the first build installed on another
// machine, 「好全小寫 superstatus@ccssm」 on the table; 2026-10-15 s40 0.6, 「目前SS版本號應該要往前到0.6了，從現在開始變動的版本號給你
// 自動判定處理」; 2026-10-19 s42 0.7 by that rule, the touchbar pages seen on his desktop and his 「好，繼續」), plugin.json's 0.7.0;
// 2026-10-30 s45 0.85, the store's fixes on 0.8 (his 「版本修正成 v0.85」); 0.8 was the first public release (his 「v0.8 Beta」, s44), plugin.json's 0.85.0: change the two together (the Mac installer's build refuses them apart). Shown as 「v.0.7」 by the 版本號 card (ver), first on the status line; it was by eE v0.1 in front of the line, then a button
// in TouchBar, then 「版本號只要在 status line」.
const VERSION = '0.85'
const VERSION_NAME = `v.${VERSION}`
const toolCount = atom({ plugin: 'superstatus', key: 'toolCount' } as const, -1)
// How many times the cards' and modules' values changed (s33): read by every drawing that shows them, so a new value redraws it.
const readCountState = atom({ plugin: 'superstatus', key: 'readCount' } as const, 0)
// The settings live in $.state: a button pressed in one /ss panel redraws every panel, and a reload keeps them.
const settingsState = atom({ plugin: 'superstatus', key: 'settings' } as const, DEFAULTS)
// Whether the sort arrows show under the cards (the owner 2026-10-09, C): in state so every open panel redraws; not stored.
const sortState = atom({ plugin: 'superstatus', key: 'sorting' } as const, false)
// AbovePrompt's switches (the owner 2026-10-09 s30 「這三顆都是代表未來這三個區塊一次開關的功能」): each folds one block of the band away at once.
// s34 (the owner 「開關按鈕現在會有 showchart showchart-half showchart-full / showinfo showinfo-half showinfo-full / touchbar(改成全小寫)」): seven, in
// his three rows; 「按鈕大小要固定不要跑掉」: each label padded to the widest's width, each button in a plain room of one width.
const BLOCK_LABEL: Record<AboveBlock, string> = {
  chart: 'showchart', 'chart-half': 'showchart-half', 'chart-full': 'showchart-full',
  info: 'showinfo', 'info-half': 'showinfo-half', 'info-full': 'showinfo-full',
  touch: 'touchbar',
}
const SWITCH_ROWS: readonly (readonly AboveBlock[])[] = [['chart', 'chart-half', 'chart-full'], ['info', 'info-half', 'info-full'], ['touch']]
const ABOVE_BLOCKS: readonly AboveBlock[] = SWITCH_ROWS.flat()
// Each label's own width in characters, measured on the owner's 7.webp (s34: padded by s29's 0.575 a Latin letter the pills came out 121-141 px;
// lower-case letters are narrower). Each is padded to SWITCH_EM in quarters of a character, the odd quarter on the right: the seven within
// about 2 px. A new label is measured before it is padded.
const SWITCH_LABEL_EM: Record<AboveBlock, number> = {
  chart: 4.98, 'chart-half': 7.19, 'chart-full': 6.92, info: 4.28, 'info-half': 6.49, 'info-full': 6.16, touch: 4.28,
}
const SWITCH_EM = Math.max(...ABOVE_BLOCKS.map(b => SWITCH_LABEL_EM[b]))
// A button in the pane (s34 lab 2.webp: the 5.5-character button 103.5 px, its characters 15.1 px apart, 9.35 px a cell): 1.62 cells a
// character and 2.19 of its own; a cell to spare.
const PANE_EM_CELLS = 1.62
const PANE_BUTTON_CELLS = 2.19
const SWITCH_CELLS = Math.ceil(SWITCH_EM * PANE_EM_CELLS + PANE_BUTTON_CELLS) + 1
// TouchBar's own 排序 (the owner 2026-10-09 s29).
const touchSortState = atom({ plugin: 'superstatus', key: 'touchSorting' } as const, false)
// The showchart (H3) and showinfo (H2) menus' own 排序 (s30), and their -half and -full menus' (s34).
const h3SortState = atom({ plugin: 'superstatus', key: 'h3Sorting' } as const, false)
const h2SortState = atom({ plugin: 'superstatus', key: 'h2Sorting' } as const, false)
const h3HalfSortState = atom({ plugin: 'superstatus', key: 'h3HalfSorting' } as const, false)
const h3FullSortState = atom({ plugin: 'superstatus', key: 'h3FullSorting' } as const, false)
const h2HalfSortState = atom({ plugin: 'superstatus', key: 'h2HalfSorting' } as const, false)
const h2FullSortState = atom({ plugin: 'superstatus', key: 'h2FullSorting' } as const, false)
// The panel's language (the owner 2026-10-11 s34 「做繁體中文(zh-TW) English 日文 還有 新增語言」「英文 是預設」): its code in the store (key
// 'language'), here for the drawings to redraw on a pick; what the last 新增語言 found, shown under the panel's first row. Every word of the
// interface goes through tr (hooks/lang); a user's own card names and sends, and the system names, never do.
const languageState = atom({ plugin: 'superstatus', key: 'language' } as const, 'en')
const langNoteState = atom({ plugin: 'superstatus', key: 'langNote' } as const, '')
// What the user's modules folder had to say (s43): kept here and not in $.state, because the scan can run inside a
// first draw (the panel reloads lazily) and a write while a drawing is dispatched is refused (s33, 'drawing is pure').
let modNote = ''
// which file each user module came from, so add_module can name the one that already has an id
let userModuleFiles: Record<string, string> = {}
// a user's language files, beside the project (the folder of the to-do list's own modules, docs/modules.md)
const LANG_DIR = '.claude/superstatus/lang'
// a user's own modules, beside their language files (s43, the owner 「步驟固定、內容彈性」): one .json a module, hooks/usermods
const MODULE_DIR = '.claude/superstatus/modules'
let languages: LangFile[] = [...BUILT_IN]
let lang: LangFile = EN
let tr: Translate = translator(EN)
// The 新增卡片 pane (the owner 2026-10-09 s28, option 3): its id and what is typed in it so far.
const ADD_PANE = 'sl-add'
const EMPTY_DRAFT: SlDraft = { kind: 'text', name: '', text: '', prefix: '', offArgs: '', error: '', section: 'status' }
// The /ss panel in a pane, for a 按鈕卡 that sends this mod's own bare /ss (the owner 2026-10-09 s28 「按鈕3 改成 /ss 的功能 顯示設定SS」):
// $.command.run skips the calling mod's own hooks, so such a press opens the panel here instead of running /ss. Its tab reads Settings
// however it opens (the owner 2026-10-15 s40 「標籤頁設定SS 改 Settings」; it read the button's name, or superstatus from a typed /ss).
const PANEL_PANE = 'ss-panel'
// The Profile pane (the owner 2026-10-12 s36 「我要做個Profile 存檔跟載入的機制 要直接在Pane 可以匯入匯出」, the design left to Claude, then
// 「go」): the profiles are .json files in <CLAUDE_CONFIG_DIR or ~/.claude>/superstatus/profiles of the machine the session runs on (the
// store's machine, not the project's), found once by asking the shell, since the kit names no home folder.
const PROFILE_PANE = 'ss-profile'
const PROFILES_SUBDIR = 'superstatus/profiles'
const CONFIG_DIR_ARGV = ['sh', '-c', 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"']
const NO_PROFILES: SsProfiles = { dir: '', error: '', rows: [], refused: [], asking: '', note: '', name: '' }
const profilesState = atom({ plugin: 'superstatus', key: 'profiles' } as const, NO_PROFILES)
// the built-in Status Line cards a profile counts: the twelve items and 符號 (icons), less those it deleted
const BUILT_IN_CARDS = 13
// Why the last press of a 開關卡 sent nothing, shown under the cards until a press works.
const switchErrorState = atom({ plugin: 'superstatus', key: 'switchError' } as const, '')
// the first touchbar button of the page shown while the touchbar pages (s41); the session's, page 1 at its start
const bandFirstState = atom({ plugin: 'superstatus', key: 'bandFirst' } as const, 0)
// the owner 2026-10-09 s28 「5秒」: the yellow line goes after this long, or at once when its card is deleted.
const SWITCH_ERROR_MS = 5000
// Which card the yellow line is about, so deleting that card (and no other) takes it away.
let switchErrorCard = ''
// Counts the failures, so a timer takes away only the line of its own failure, even when the text is the same.
let switchErrorSeq = 0
// The added card whose 刪除 was pressed once and now reads 確定刪除 (the owner 2026-10-09 s28); '' for none.
const deletingState = atom({ plugin: 'superstatus', key: 'deleting' } as const, '')
const draftState = atom({ plugin: 'superstatus', key: 'draft' } as const, EMPTY_DRAFT)

// What each item is called in the /ss panel (/sl until the owner 2026-10-09 s28 「sl 指令也要改成 ss」).
const nameOf = (key: Key) => tr(`card.${key}`)

let cwd = ''
let facts: Facts = {}
// Whether the facts were read at least once since this module was loaded: a hot reload gives a fresh module, and session.start
// does not always reach it, so the first thing that needs the facts reads them (the owner saw 這個專案沒有 everywhere after a reload).
let isRead = false
// What failed in the last read (the owner 2026-10-09: after a reload every read failed on his desktop and the mod only said 這個專案沒有).
// A file that is simply not there is no failure; a read that is refused or cannot start is.
let problems: string[] = []
const reason = (error: unknown) => String((error as { message?: string } | undefined)?.message ?? error).replace(/\s+/g, ' ').slice(0, 90)
const note = (what: string, error: unknown) => {
  if (problems.length < 4) problems.push(`${what} ${reason(error)}`)
}
// What the 倒數卡, 檔案卡 and 指令卡 show now, read when the facts are (the owner 2026-10-09 s28 「全加」): the line's value and the
// dial's text, by card id.
let cardValues: Record<string, { value: string; dial: string }> = {}
// the owner 2026-10-09 s28 「這些按鈕左上角可以有編號嗎 用 ¹²³⁴⁵⁶⁷⁸⁹⁰」 (A): the button's place in its row in superscript digits, first on its
// label, in place of the first space of the left padding, an en or a quarter space (so the width holds; a superscript digit sits high, at the top left).
const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
const numbered = (place: number, label: string) =>
  [...String(place)].map(d => SUPERSCRIPT[Number(d)]).join('') + (/^[\u2002\u2005]/.test(label) ? label.slice(1) : label)

const BAND_GAP = 1
// the owner 2026-10-09 s29 (dragging the window made 12 buttons jump, screenshots 3-8; 「大小才是重點 內容被擠掉一點沒關係」; 「全開的時候用原本的算法
// 開始縮的時候用第二種 剩下五顆的時候切回第一種」, 「你試試看」): the band has three stages, at most 12 buttons.
//   1. The buttons fit at their own size: that size, spread edge to edge (no more packing left, which jumped at 124 cells).
//   2. They do not: slots of a whole percentage (the engine refuses a fraction) share the row, each label padded to its slot, so the buttons
//      are one size and shrink with the window, never past the stage-1 size; a slot holds the least label of each of its cards (the number
//      and two characters, 「字最少…要留前兩個字」), or there are fewer slots.
//   3. That leaves BAND_FEW or fewer: back to the own size, as many as fit (5 at the switch).
// Every stage pads with bandLabel, so a four-character name is no wider than a two-character one; the own size is BAND_EM (4.5, s28
// 「把寬度縮小到可以放12個」) or the widest label of the row when that is wider (¹²存檔交接).
const BAND_SLOTS = 12
const BAND_FEW = 5
// A Button cannot be stretched (/lab 9.webp): its width is its label's. Calibrated on the owner's 11-12.webp (s29): 設定SS (3.49 characters)
// 106 px and 確定分數 (4.34) 127 px give 24.7 px a character and a 19.8 px frame; the slot pitch gives 17.3 px a cell: so a Chinese
// character is 1.43 cells and a button's frame 1.14 (s28's 8.6 cells for 4.5 characters was one screenshot's guess). Each slot keeps a
// 1-cell gap on its right and the row the same on its left, so a label cut by its slot is as wide as a padded one.
// s34, the owner's 8.webp (Claude Code 2.1.295): ten buttons 75-81 px at about 88 cells, the tenth cut off by the band's edge, and in 1.webp the
// desktop cut names to one character: the buttons were wider than the numbers above said. A band character is 14.1 px (確定分數's glyphs
// 14 px apart) and a 4.59-character label 80 px at 9.35 px a cell: 1.51 cells a character and 1.64 of the button's own, plus an eighth of
// a character for the quarter spaces bandLabel rounds to (1.64 + 0.125 x 1.51 = 1.83).
const BAND_EM_CELLS = 1.51
const BAND_FRAME_CELLS = 1.83
const KIND_VALUES: readonly SlCardKind[] = ['text', 'countdown', 'file', 'command', 'switch', 'button', 'module']
const kinds = () => KIND_VALUES.map(value => ({ value, label: tr(`kind.${value}`) }))
// A value from a file or a command is cut to this many characters on the line; the dial shows the first four.
const VALUE_MAX = 40
const COMMAND_TIMEOUT_MS = 3000
// The ruling of 2026-10-10 s29 (「我的規則H1是按鈕 H23 是像是dashboard那樣展示資訊的部分」): a 按鈕卡 is always H1, the button row; any other
// AbovePrompt card (text, countdown, file, command: a display) is H2 or H3, H2 unless kept as H3.
// the owner 2026-10-10 s33 「每個按鈕可以是模組」: a button module stands in the button row as a 按鈕卡 does; a tile module is a display.
const isPress = (card: SlCard) => card.kind === 'button' || (card.kind === 'module' && moduleOf(card.text)?.role === 'button')
// s34 (the owner): the band from the top, showchart-full, -half, showchart, showinfo-full, -half, showinfo, then the buttons (H1); the menus in the
// same order. A display card is one of the six, H2 unless kept as another.
type DisplaySize = Exclude<SlSize, 'H1'>
const DISPLAY_SIZES: readonly DisplaySize[] = ['H3-full', 'H3-half', 'H3', 'H2-full', 'H2-half', 'H2']
const STACK: readonly SlSize[] = [...DISPLAY_SIZES, 'H1']
const isDisplaySize = (size: unknown): size is DisplaySize => DISPLAY_SIZES.includes(size as DisplaySize)
// a 開關卡 is H1's too (Claude Design step 5b, s38 ruling 4): a band button that turns
const sizeOf = (card: SlCard): SlSize => (isPress(card) || card.kind === 'switch' ? 'H1' : isDisplaySize(card.size) ? card.size : 'H2')
const isDisplay = (card: SlCard) => card.section === 'above' && !isPress(card) && card.kind !== 'switch'
// A 按鈕卡 that starts with ! runs the rest on the host for at most this long (a press hook has 10 s).
const HOST_COMMAND_MS = 5000
// The display tiles above the button row (ruling 2026-10-10 s29, picture docs/sketches/2026-10-10_s29_h123-bounds.png): H3 three to a row, H2
// five, each row spanning the button row's span; rows high (H3 the rest: 12 less H2's 3 and the button row; H2 3).
// s34 (the owner 「half 就是寬度抓按鈕1最左側到按鈕6最右側…第二個就抓按鈕7最左側到按鈕12最右側」「full 就是寬度抓按鈕1最左側到按鈕12最右側」,
// heights 「跟原本固定」): half two to a row, full one, as tall as their series.
const TILES: Record<DisplaySize, { rows: number; perRow: number }> = {
  'H3-full': { rows: 8, perRow: 1 },
  'H3-half': { rows: 8, perRow: 2 },
  H3: { rows: 8, perRow: 3 },
  'H2-full': { rows: 3, perRow: 1 },
  'H2-half': { rows: 3, perRow: 2 },
  H2: { rows: 3, perRow: 5 },
}
// the owner 2026-10-10 s30 「框123456 下方都縮一點就可以了」「縮的範圍就是 H1 按鈕1 2的空間」「框123 不要貼著框456」: each frame is half a row shorter
// than its slot (about 11 px; the band buttons stand 12-13 px apart), so it stands off the row below (a blank Svg between did not show).
const FRAME_SHORT_ROWS = 0.5
// A chart's room in CSS px (s35, the owner 「H3 以上的可以畫一些圖表」), estimated from docs/measures.md until a screenshot of the charts is
// measured: a band cell 9.34 screenshot px (s34 8.webp) and a row 22 px (s30 5.webp: 8 rows 176 px), at 1.15 screenshot px a CSS px
// (s29 1.webp: the 66-unit ring 76 px), so a cell about 8.1 CSS px and a row 19; less the dashed frame's border and the desktop's padding
// of a bordered Box (s34: about 14.5 screenshot px a side) and a margin above and below. The Svg is given no size of its own: the desktop
// draws the markup's width up to the tile and its height in proportion, so a width guessed too large comes out smaller, never wider.
// s39 (the owner's 6.png 「方匡內跟底色塊為什麼有間距?」, then 「有內容之後 色塊要填滿細線方框的size」): measured, a picture's markup of 206 CSS px
// is drawn 354 screenshot px (1.72 a CSS px), an H3 frame 396 px over 29 cells (7.94 CSS px a cell), a row 18.84 (H2's 2.5 rows, 81 px) to
// 19.07 CSS px (H3's 7.5, 246 px); the gap was the margins taken off above (the desktop drew the picture at its own size, centred). A picture
// now takes its frame's whole size, which draws no dashed line: its width a little wide (8 a cell: drawn down to the frame) and its height a
// little short (18.8 a row), so it is never larger than the frame and fills 97% of its height at least.
const CHART_CELL_PX = 8
const CHART_ROW_PX = 18.8
const chartBox = (cells: number, rows: number): ChartBox => ({
  width: Math.max(60, Math.ceil(cells * CHART_CELL_PX)),
  height: Math.max(30, Math.floor((rows - FRAME_SHORT_ROWS) * CHART_ROW_PX)),
})
// which switch folds each size's block away
const BLOCK_OF: Record<SlSize, AboveBlock> = {
  H1: 'touch', H2: 'info', 'H2-half': 'info-half', 'H2-full': 'info-full', H3: 'chart', 'H3-half': 'chart-half', 'H3-full': 'chart-full',
}
// Claude Design step 5 (s38, the owner 「1–4 照建議」): AbovePrompt's blocks in the add-card pane's order; the places each holds (the design's: a
// row of the band, H1 its 12 buttons); its menu's system name; the kinds each offers: H1 the cards that are pressed (a button, a switch, a
// button module), the others the displays; Status Line's pane every kind.
const BLOCKS: readonly SlSize[] = ['H1', 'H2', 'H2-half', 'H2-full', 'H3', 'H3-half', 'H3-full']
const placesOf = (size: SlSize) => (size === 'H1' ? BAND_SLOTS : TILES[size].perRow)
const MENU_NAME: Record<SlSize, string> = {
  H1: 'touchbar', H2: 'showinfo', 'H2-half': 'showinfo-half', 'H2-full': 'showinfo-full', H3: 'showchart', 'H3-half': 'showchart-half', 'H3-full': 'showchart-full',
}
const PRESSED_KINDS: readonly SlCardKind[] = ['button', 'switch', 'module']
const DISPLAY_KINDS: readonly SlCardKind[] = ['text', 'countdown', 'file', 'command', 'module']
const kindsOf = (section: 'status' | 'above', size: SlSize | undefined): readonly SlCardKind[] =>
  section === 'status' ? KIND_VALUES : (size ?? 'H1') === 'H1' ? PRESSED_KINDS : DISPLAY_KINDS
// a place's system name (H2-3, H3-full-1)
const placeName = (size: SlSize, place: number) => `${size}-${place}`
// whether a card takes a place in its block: a lit one (a card turned off waits in its menu, ruling 2), and a 開關卡 always (on the band on
// or off, ruling 4: its off is its state, not hidden)
const takesPlace = (st: Settings, key: string) => !st.off.includes(key) || st.cards.some(c => c.id === key && c.kind === 'switch')
// a block's cards that take a place, in the band's order
const litIn = (st: Settings, size: SlSize) => st.aboveOrder.filter(k => takesPlace(st, k) && groupOf(st, k) === size)
// the name a card has on the band and in its pictures: a 開關卡's after ● while on, ○ while off (s38, the owner 「丙」)
const bandName = (st: Settings, card: SlCard) => (card.kind === 'switch' ? `${st.off.includes(card.id) ? OFF_MARK : ON_MARK}${card.name}` : card.name)
// whether a block's lit cards fill its places, so no card lights in it, is added to it or moves into it lit (Claude Design step 5b, s38)
const isFullIn = (st: Settings, size: SlSize) => litIn(st, size).length >= placesOf(size)
// what the pane's line and the panel's toast say of a full block
const fullLine = (size: SlSize) => tr('add.full', { block: size, n: placesOf(size), menu: MENU_NAME[size] })
// a display card's size button goes up the band, one block at a time, and from the top back to H2 (s34, the table)
const SIZE_CYCLE: readonly DisplaySize[] = ['H2', 'H2-half', 'H2-full', 'H3', 'H3-half', 'H3-full']
// s35 (the owner 「我剛剛把H2~H3-Full 的卡片都刪掉了，你建立符合那些格子會使用的範例卡片給我」): what /ss examples puts in each display block,
// one module a tile: one-line modules in the H2 blocks (an H2 tile shows the first line), charts in the H3 blocks.
const EXAMPLES: readonly { size: DisplaySize; modules: readonly string[] }[] = [
  { size: 'H2', modules: ['session.ctx', 'session.5h', 'session.7d', 'session.git', 'session.score'] },
  { size: 'H2-half', modules: ['host.overview', 'host.load'] },
  { size: 'H2-full', modules: ['session.journal'] },
  { size: 'H3', modules: ['session.gauges', 'host.resources', 'session.scorecard'] },
  { size: 'H3-half', modules: ['session.commits', 'host.diskchart'] },
  { size: 'H3-full', modules: ['session.timeline'] },
]
const nextSize = (size: SlSize): SlSize => SIZE_CYCLE[(SIZE_CYCLE.indexOf(size as DisplaySize) + 1) % SIZE_CYCLE.length] ?? 'H2'
const DAY_MS = 86400000
const cut = (text: string, n: number) => [...text].slice(0, n).join('')

// The day of a YYYY-MM-DD date as a day count, or undefined when it is not one or not a real day (2027-02-30).
function dayOf(date: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return undefined
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const back = new Date(t)
  if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return undefined

  return t / DAY_MS
}

// A path inside the project: relative, no .. anywhere.
const isInside = (path: string) => path !== '' && !path.startsWith('/') && !path.split('/').includes('..')

// The modules a 模組卡 can be made of in a section and block (s33): H1's (TouchBar's) the button modules, every other the tiles.
const modulesFor = (d: { section: 'status' | 'above'; size?: SlSize }) =>
  allModules().filter(m => m.role === (d.section === 'above' && (d.size ?? 'H1') === 'H1' ? 'button' : 'tile'))

// What is wrong with a card about to be added or changed, in the panel's words, or '' when it can be: the 新增卡片 pane's rules, which the
// card tools hold to as well (s41).
function draftProblem(d: SlDraft): string {
  if (d.kind === 'module' && !modulesFor(d).some(m => m.id === d.text)) return tr('add.err.pickModule')
  if (d.name.trim() === '' && d.kind !== 'module') return tr('add.err.name')
  // a name button holds the language's most (s34: 繁中 four characters, English nine letters, the language file's rules.nameMax)
  if ([...d.name.trim()].length > lang.rules.nameMax) return tr('add.err.nameLong', { n: [...d.name.trim()].length, max: lang.rules.nameMax })
  if (d.kind === 'countdown' && dayOf(d.text.trim()) === undefined) return tr('add.err.date')
  if (d.kind === 'file' && !isInside(d.text.trim())) return tr('add.err.path')
  if (d.kind === 'file' && d.prefix.trim() === '') return tr('add.err.prefix')
  if (d.kind === 'command' && d.text.trim() === '') return tr('add.err.command')
  if (d.kind === 'button' && d.text.trim() === '') return tr('add.err.send')
  if (d.kind === 'switch' && !/^\/?[^\s/]+$/.test(d.text.trim())) return tr('add.err.switch')
  return ''
}

// The settings with a card added from a draft (the 新增卡片 pane, and add_card since s41): its id the next free, a 模組卡 with no name typed
// its module's (s33); in AbovePrompt's block into at the place picked, before the lit card that holds it (ruling 3), past the last at the
// end of the order; with no block, at the end of the Status Line.
function withCard(s: Settings, now: SlDraft, into: SlSize | undefined): { settings: Settings; card: SlCard } {
  const id = nextCardId(s.cards)
  const name = now.name.trim() || (now.kind === 'module' ? cut(moduleName(moduleOf(now.text)), lang.rules.nameMax) : '')
  const card: SlCard =
    now.kind === 'switch'
      ? { id, kind: 'switch', name, text: now.text.trim().replace(/^\//, ''), prefix: '', onArgs: now.prefix.trim(), offArgs: now.offArgs.trim() }
      : { id, kind: now.kind, name, text: now.text.trim(), prefix: now.kind === 'file' ? now.prefix.trim() : '' }
  // the 節奏 row's pick (s44): 預設 leaves the card without one, so the module's own rhythm stands; a kind that takes none never carries one
  if (now.every !== undefined && TAKES_RHYTHM.includes(now.kind)) card.every = RHYTHM_SECONDS[now.every]
  if (into === undefined) return { settings: { ...s, cards: [...s.cards, card], order: [...s.order, id] }, card }
  card.section = 'above'
  if (!isPress(card) && card.kind !== 'switch' && isDisplaySize(into)) card.size = into
  const taken = litIn(s, into)
  const before = taken[(Number(now.place) || taken.length + 1) - 1]
  const aboveOrder = before === undefined ? [...s.aboveOrder, id] : s.aboveOrder.flatMap(k => (k === before ? [id, k] : [k]))
  return { settings: { ...s, cards: [...s.cards, card], aboveOrder }, card }
}

// The card tools (s41, the owner 「A」 and 「好」 after 「我的mod裡面不能包給claude讀的設計檔嗎？」): the model lists, adds and changes the cards
// through superstatus itself, by the panel's rules, so no Claude edits the store file by hand (the office Mac did, 2026-10-16). Each tool's
// description is the guide. A card that runs things (a 指令卡, any 按鈕卡, a 開關卡: profiles.ts runsThings) is added off and only the owner turns
// it on, in /ss; an off 指令卡 runs nothing (readCards). Left behind ToolSearch, so the prompt stays small until one is wanted.
// the kinds a rhythm is offered for: what a 指令卡 runs is the owner's own bash, and it stays on the turn's end
const TAKES_RHYTHM: readonly SlCardKind[] = ['module', 'file', 'text', 'countdown']
// version D (s43, the owner 「D 可以」): what a card's own line says — the rhythm's word, never a raw number of seconds
// s44 (the owner 「甲，字縮短」): on the card it is the SHORT word (1分), a note in the corner; the /ss 節奏 row keeps the long one
// (每 1 分), because the menu is where a rhythm is read and picked.
const rhythmWord = (ms: number): string => {
  // s44: a clock (the pomodoro, half a second) is faster than any rhythm a card can pick; it says its own seconds — 0.5, not
  // a rounded 1 — and never the minute
  if (ms > 0 && ms < 10000) return tr('rhythm.short.seconds', { n: Math.round(ms / 100) / 10 })
  const secs = ms === Number.POSITIVE_INFINITY ? 0 : Math.round(ms / 1000)
  const name = (RHYTHMS as readonly string[]).find(r => RHYTHM_SECONDS[r as Rhythm] === secs)
  return tr(`rhythm.short.${name === undefined ? 'normal' : name}`)
}
const CARD_TOOLS = { cards: `mcp__${NAME}__cards`, add: `mcp__${NAME}__add_card`, change: `mcp__${NAME}__change_card`, addModule: `mcp__${NAME}__add_module` } as const
const CARDS_GUIDE = [
  'superstatus draws the user\'s status line under the prompt and, above the prompt, the band (AbovePrompt). Cards live in two sections.',
  'StatusLine: one line of items; any kind of card; no limit.',
  'AbovePrompt, from the top of the band: H3-full (1 tile a row, 8 rows tall), H3-half (2 a row), H3 (3), H2-full (1, 3 rows tall),',
  'H2-half (2), H2 (5), then H1, the row of 12 buttons. A block holds as many lit cards as it has places; an off card waits in its menu',
  'and takes none (a switch always takes one). A block can be hidden by its switch in /ss.',
  'Kinds and what text holds: text (the words); countdown (a date YYYY-MM-DD; days left, in this machine\'s own time zone); file (a path inside the project;',
  'prefix: the start of the line to show); command (a bash command, run on this machine at the end of every turn with a 3 s limit; the',
  'first line of its output is shown, cut to 40 characters); module (a module id from the /ss Add card list); button (H1 only: a /command',
  'or words sent as the user\'s, or ! and a command run on this machine when pressed); switch (H1 only: a slash command\'s name; onArgs and',
  'offArgs: what it sends to turn on and off). H1 takes button, switch, module; the H2 and H3 blocks take text, countdown, file, command,',
  'module.',
  // measured on the owner's desktop 2026-10-20 (docs/measures.md): the band's content is 624 px, so a normal H2 tile is 100 px —
  // 5-6 Chinese characters, the name among them. The old line promised 10 and a Claude elsewhere believed it.
  'An H2 tile shows one line and is narrow: about 5-6 Chinese characters or 11-12 Latin ones, and the name counts toward that, so a long value is cut with an ellipsis. H2-half holds about three times as much and H2-full the whole band width; an H3 tile up to 5 lines. A chart comes only from a module.',
  'So: keep a card name short, put a long value in H2-half or H2-full, and where a value cannot be shortened say so to the user rather than letting the tile cut it.',
  'A name has at most nameMax characters, by the panel\'s language (cards says it: 繁中 4, English 10, 日本語 5).',
  'every: how often a card is read again, picked by name — fast 10 s, normal 1 min, slow 5 min, turn only at a turn\'s end.',
  'Left out, the module\'s own rhythm stands, so most cards need nothing. A 指令卡 takes none: it runs at a turn\'s end and',
  'nowhere else, and asking for one is refused.',
].join(' ')
// What a module file holds, for the model that writes one (s43): the add_module description carries it, so a Claude on a
// machine that has never seen this project can write one correctly from the tool alone.
const MODULE_GUIDE = [
  'A module file is DATA, never code: superstatus cannot run code from a file. It says which commands to run, which files to read,',
  'how to pull numbers out of what came back, and what to draw. Fields:',
  'format 1. id must be user. and then lowercase letters or digits (a user module can never take a built-in name).',
  'name and about: one string (English) or a language code for each ({ "en": "GPU", "zh-TW": "顯卡" }).',
  'role tile (a button module is not read yet).',
  'runs: argv lists, no shell and no pipe, each run for at most 3 s. reads: absolute paths.',
  'values: { <name>: { from: "run:0" | "read:0", line: 1, col: 1, scale: 1024 } } — line and col count from 1, blank lines are',
  'skipped, columns split on commas and spaces, scale divides. A value that cannot be read shows ? and never an older number.',
  'lines: one or more, each with {name} for a value; a name not declared is refused and the file is not written.',
  'chart (optional): { shape: "rings" | "bars", head, foot, items: [{ label, percent, value, colour }] } — percent and value are',
  'templates like "{use}". colour is used (green to red by the number), blue or dim.',
  `every (optional): the module's own rhythm, one of ${RHYTHMS.join(', ')} — fast 10 s, normal 1 min, slow 5 min, turn only`,
  'at a turn\'s end. Left out, the minute. Give a slow thing (a disk, a log) the slow one, so a card of it needs nothing set.',
  'tile (optional): { words, value, percent, colour } for an H2 block. Leave it out and the H2 blocks get a bar for free, from the',
  'chart\'s head and its first item (H3 draws the chart it names, H2 always a bar).',
  'Call cards first to see what is there. After this, add_card with kind module and text <id> puts it in a block.',
].join(' ')
// How a Claude elsewhere builds cards WITH the person (s45, the owner 「你應該要引導使用者建立，把這幾張小卡變成方向跟使用者自己
// 討論，依照使用者語言去設計」): the mod ships no ready-made set for someone else's machine; it ships the way to make one.
const ADD_FLOW = [
  'When the user asks for cards without saying exactly which (something useful, a first setup, an empty band), do not pick',
  'from what this machine happens to have. Ask first, in the language the user writes in: what they work on, what they want to',
  'see at a glance without asking, and which machine it runs on. Then offer two or three cards that answer that, each with its',
  'block and why, named in that language within nameMax, and add only the ones they agree to. A card whose data no built-in',
  'module reads becomes a module file (add_module) for this user\'s own paths and commands, never one copied from another machine.',
].join(' ')

const CARD_TOOL_SPECS = [
  {
    name: 'cards',
    description: `List the user's superstatus cards as JSON: the Status Line items in their order (built-in ones and added cards, on or off), and each AbovePrompt block with its places, how many are lit, whether it is full or shown, the kinds it takes and its cards (id, kind, name, on, place while lit, text). Call it before add_card or change_card. ${CARDS_GUIDE}`,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_card',
    description: `Add a card to the user's superstatus by the same rules as the /ss panel's Add card pane; a card it refuses comes back with the reason, nothing changed. Call cards first to see what is there and which places are free. ${CARDS_GUIDE} A card that runs things (a command card, any button, a switch) is added off and runs nothing: only the user turns it on, in /ss, after reading what it runs; tell them the command and where to turn it on. Put only read-only commands in a command card: it runs on this machine at the end of every turn. ${ADD_FLOW}`,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...KIND_VALUES] },
        block: { type: 'string', enum: ['StatusLine', ...BLOCKS], description: 'StatusLine, or the AbovePrompt block' },
        name: { type: 'string', description: 'the name on the card, at most nameMax characters (a module card may leave it out: the module\'s)' },
        text: { type: 'string', description: 'what the kind holds: the words, the date, the path, the command, the module id, what a button sends, the switch\'s command' },
        prefix: { type: 'string', description: 'file cards: the start of the line to show' },
        onArgs: { type: 'string', description: 'switch cards: what is sent to turn it on' },
        offArgs: { type: 'string', description: 'switch cards: what is sent to turn it off' },
        place: { type: 'integer', minimum: 1, description: 'a lit card in an AbovePrompt block: the place it takes (1 first); the card holding it moves one on; left out, the next free one' },
        every: { type: 'string', enum: [...RHYTHMS], description: 'how often this card is read again: fast 10 s, normal 1 min, slow 5 min, turn only at a turn\'s end. Left out, the module\'s own rhythm stands and nothing need be set. Not for a 指令卡' },
      },
      required: ['kind', 'block'],
    },
  },
  {
    name: 'change_card',
    description: `Change one of the user's superstatus cards by its id (cards lists them): its name, its text (prefix, onArgs, offArgs), or on: false to turn it off, on: true to turn it on; the panel's rules hold, and a card turned on needs a free place in its block. A card that runs things (a command card, any button, a switch) is never turned on here: only the user turns it on, in /ss; a new command or new words turn it off. A switch's on and off are the user's presses. Built-in Status Line items are turned on and off in /ss. ${CARDS_GUIDE}`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'the card\'s id, as cards gives it (c1, c2, ...)' },
        name: { type: 'string' },
        text: { type: 'string' },
        prefix: { type: 'string' },
        onArgs: { type: 'string' },
        offArgs: { type: 'string' },
        on: { type: 'boolean' },
        every: { type: 'string', enum: [...RHYTHMS], description: "the card's rhythm: fast 10 s, normal 1 min, slow 5 min, turn only at a turn's end. Not for a 指令卡" },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_module',
    description: `Write one of the user's own superstatus modules as a file in their project's .claude/superstatus/modules, check it, and read the folder again at once so it can be used in this session without a reload. A file that does not hold together is refused with the reason and nothing is written. ${MODULE_GUIDE} ${ADD_FLOW}`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'the module file itself, as JSON text' },
        name: { type: 'string', description: "the file's name without .json; left out, the id is used" },
      },
      required: ['file'],
    },
  },
]

async function registerCardTools($: EngineInterface) {
  for (const spec of CARD_TOOL_SPECS) {
    try {
      await $.tool.register(spec)
    } catch (error) {
      note(`tool ${spec.name}:`, error)
    }
  }
}

// What a card that runs things does, in words for the model; undefined for one that runs nothing.
const RUNS_WHAT: Record<string, (text: string) => string> = {
  command: t => `runs \`${t}\` with bash on this machine at the end of every turn`,
  host: t => `runs \`${t}\` on this machine when pressed`,
  send: t => `sends \`${t}\` as the user's words when pressed`,
  switch: t => `sends ${t} when pressed`,
}
const runsWhat = (card: SlCard): string | undefined => {
  const runs = runsThings({ cards: [card] })[0]
  return runs === undefined ? undefined : RUNS_WHAT[runs.how]?.(runs.text)
}

function cardEntry(st: Settings, card: SlCard, place?: number) {
  return {
    id: card.id,
    kind: card.kind,
    name: card.name,
    on: !st.off.includes(card.id),
    ...(place === undefined ? {} : { place }),
    text: card.text,
    ...(card.kind === 'file' ? { prefix: card.prefix } : {}),
    ...(card.kind === 'switch' ? { onArgs: card.onArgs ?? '', offArgs: card.offArgs ?? '' } : {}),
  }
}

// What the cards tool answers: the Status Line in its order, then each AbovePrompt block, as JSON.
function cardsReport(st: Settings): string {
  const statusLine = st.order
    .filter(k => !st.removed.includes(k))
    .flatMap(k => {
      if (isKey(k)) return [{ id: k, builtIn: true, on: !st.off.includes(k) }]
      const card = st.cards.find(c => c.id === k)
      return card === undefined ? [] : [cardEntry(st, card)]
    })
  const abovePrompt = Object.fromEntries(
    BLOCKS.map(size => {
      const lit = litIn(st, size)
      const cards = st.aboveOrder
        .filter(k => groupOf(st, k) === size)
        .flatMap(k => {
          const card = st.cards.find(c => c.id === k)
          const at = lit.indexOf(k)
          return card === undefined ? [] : [cardEntry(st, card, at >= 0 ? at + 1 : undefined)]
        })
      const block = { places: placesOf(size), lit: lit.length, full: isFullIn(st, size), shown: !st.aboveOff.includes(BLOCK_OF[size]), kinds: [...kindsOf('above', size)], cards }
      return [size, block]
    }),
  )
  return JSON.stringify({ language: lang.code, nameMax: lang.rules.nameMax, statusLine, abovePrompt }, null, 1)
}

async function readCard($: EngineInterface, card: SlCard, now: number | undefined): Promise<{ value: string; dial: string }> {
  const plain = (value: string) => ({ value: cut(value, VALUE_MAX), dial: cut(value, 4) })
  switch (card.kind) {
    case 'text':
      return plain(card.text)
    case 'countdown': {
      const day = dayOf(card.text)
      if (day === undefined || now === undefined) return { value: '?', dial: '?' }
      // the day turns at midnight where the session runs (s45; Taiwan's until then)
      const left = day - localDay(now, zoneOffsetMs(now))
      if (left === 0) return { value: tr('val.today'), dial: tr('val.today') }
      return left > 0
        ? { value: tr('val.daysLeft', { n: left }), dial: tr('val.daysLeftDial', { n: left }) }
        : { value: tr('val.daysAgo', { n: -left }), dial: tr('val.daysAgoDial', { n: -left }) }
    }
    case 'file': {
      if (!isInside(card.text)) return plain(tr('val.notInProject'))
      try {
        const text = await textOf($, `${cwd}/${card.text}`)
        if (text === undefined) return plain(tr('val.noFile'))
        const line = text.split('\n').map(l => l.trimStart()).find(l => l.startsWith(card.prefix))
        return plain(line === undefined ? tr('val.notFound') : line.slice(card.prefix.length).trim())
      } catch (error) {
        note(`${card.text}:`, error)
        return plain(tr('val.unreadable'))
      }
    }
    case 'switch':
    case 'button':
    // a module's value is drawn from what was gathered for it (moduleLines)
    case 'module':
      return { value: '', dial: '' }
    case 'command':
      try {
        const ran = await $.process.run(['bash', '-c', card.text], { cwd, timeoutMs: COMMAND_TIMEOUT_MS })
        if (ran.exitCode !== 0) return plain(tr('val.failed'))
        const first = ran.stdout.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).find(l => l !== '')
        return plain(first ?? tr('val.noOutput'))
      } catch {
        // still running after 3 s (bash itself always starts)
        return plain(tr('val.timeout'))
      }
  }
}

// redraw: false while a drawing is being made (ensure), where $.state cannot be written; that drawing reads the new values itself.
async function readCards($: EngineInterface, redraw = true) {
  const { cards } = await read($, settingsState)
  let now: number | undefined
  if (cards.some(c => c.kind === 'countdown')) {
    try {
      now = await $.clock.now()
    } catch (error) {
      note('clock:', error)
    }
  }
  const { off } = await read($, settingsState)
  const next: typeof cardValues = {}
  // an off 指令卡 runs nothing, as an off 模組卡 reads nothing (s41: the card tools add one off, for the owner to turn on)
  for (const card of cards) if (!(card.kind === 'command' && off.includes(card.id))) next[card.id] = await readCard($, card, now)
  cardValues = next
  await readModules($, redraw)
}

// The tile modules' files and commands, each module once whatever number of cards show it, an off card's not at all; then a redraw if
// anything changed.
// dueOnly: a tick reads only the modules whose own seconds have gone by; a session's start, a turn's end and a reload read them all.
// Work a press must not wait for (s44): it runs after the hook has answered, and what it draws lands when it lands. A failure
// is noted as any read's is, never thrown at the window.
function later($: EngineInterface, work: Promise<unknown>): void {
  void work.catch(error => note('after a press:', error))
}

async function readModules($: EngineInterface, redraw = true, dueOnly = false) {
  const { cards, off } = await read($, settingsState)
  // the pomodoro is read here, not in refresh: refresh can run before the store has reached the state, and this is the one
  // place that moves its own clock on (a finished one is counted and put back to idle)
  facts = { ...facts, pomo: await pomoFacts($) }
  // each lit tile module's interval: the shortest of the cards that show it
  const wanted: Record<string, number> = {}
  for (const card of cards) {
    const module = card.kind === 'module' && !off.includes(card.id) ? moduleOf(card.text) : undefined
    if (module?.role === 'tile') wanted[module.id] = Math.min(wanted[module.id] ?? NEVER, everyMs(card, module))
  }
  const soonest = Object.values(wanted).filter(ms => ms !== NEVER)
  nextTickMs = soonest.length === 0 ? LIVE_MS : Math.min(...soonest)
  let now = 0
  try {
    now = await $.clock.now()
  } catch {
    now = 0
  }
  const gathered: typeof moduleInputs = {}
  for (const [id, interval] of Object.entries(wanted)) {
    const module = moduleOf(id)
    if (module === undefined) continue
    const last = readAt[id]
    const kept = moduleInputs[id]
    // 只在回合結束 needs no case of its own: its interval is NEVER, so `now - last < interval` is always true and what was
    // read last stands (s43: the case written out was an equivalent mutant, T3, and the dead branch was dropped)
    if (dueOnly && kept !== undefined && last !== undefined && now - last < interval) {
      gathered[id] = kept
      continue
    }
    gathered[id] = await gather($, module)
    readAt[id] = now
  }
  moduleInputs = gathered
  // what was read lives in this module's variables, which the engine does not watch: a count in $.state that moves when it changed
  // redraws the band and the panel (s33: the tiles kept the old values after a turn's end). The pomodoro reads nothing, so what it
  // shows is compared as shown (s45, the owner 「每次都是在我使用完傳訊息才renew」: it moved only at a turn's end); the text, not the
  // milliseconds, so a half-second tick that changes no digit draws nothing.
  const pomo = facts.pomo
  const seen = JSON.stringify([cardValues, moduleInputs, pomo === undefined ? '' : [pomo.state, pomo.done, clockText(pomo.left)]])
  if (redraw && seen !== lastRead) {
    lastRead = seen
    await update($, readCountState, n => n + 1)
  }
}
let lastRead = ''

// The tiles are a dashboard (s33): while the session is open the tile modules are read again every LIVE_MS, not only at a turn's end; the
// other cards (a 指令卡 runs once a turn, its pane says so) and the facts are not. A reload (session.start again) arms a new timer and the
// old one does nothing (its number is no longer the last); with no tile module on, the minute reads nothing.
const LIVE_MS = 60000
// A card may carry its own seconds (s43, 待你裁決 5 from s34, the owner 「小卡更新秒數的設定可以加上去嗎？」). Below this floor the
// number is ignored and the minute stands: nobody is to read the host every second by filling in 1. The floor is Claude's, said to
// him when it was proposed; he can set another.
const EVERY_MIN = 10
// 只在回合結束: never on the timer (the menu's last choice, and the only one a 指令卡 has — the owner 「指令卡不需要，謝謝」)
const NEVER = Number.POSITIVE_INFINITY
// What a card is read on: its own rhythm where it picked one, else the module's own, else the minute. A card is never asked to
// carry a number the person typed: the menu writes one of these (s43, the owner 「要合理呀…你是用工程師思維在設計產品」).
function everyMs(card: SlCard, module: SsModule | undefined): number {
  if (card.every === 0) return NEVER
  if (Number.isInteger(card.every) && (card.every as number) >= EVERY_MIN) return (card.every as number) * 1000
  return Number.isFinite(module?.every) && (module?.every as number) > 0 ? Math.round((module?.every as number) * 1000) : LIVE_MS
}
// when each module was last read, and how soon the next tick has to come: both worked out in readModules
let readAt: Record<string, number> = {}
let nextTickMs = LIVE_MS
let liveSeq = 0

function arm($: EngineInterface) {
  const seq = ++liveSeq
  try {
    $.clock.after(nextTickMs, () => {
      if (seq === liveSeq) void tick($)
    })
  } catch (error) {
    // no clock on this surface: the tiles follow the turns
    note('clock:', error)
  }
}

async function tick($: EngineInterface) {
  await readModules($, true, true)
  arm($)
}

// What was read and run for each tile module, by module id (the owner 2026-10-10 s33 「每個框都是一個模組」): read with the facts, so a tile
// follows the files at a session's start, each turn's end and /ss reload; its lines are drawn from this and the facts as they are now.
let moduleInputs: Record<string, { files: Record<string, string | undefined>; runs: Record<string, string | undefined> }> = {}

// Reads the files and runs the commands a module names: a file that is not there or a command that fails is undefined (a refused read
// is noted); each command for at most COMMAND_TIMEOUT_MS, in the project.
async function gather($: EngineInterface, module: SsModule) {
  const files: Record<string, string | undefined> = {}
  for (const path of module.reads ?? []) {
    // s37: a path from the home folder (~/), filled in from the shell's $HOME; none known, it is not read
    const home = path.startsWith('~/') ? await homeDir($) : ''
    if (home === undefined) {
      files[path] = undefined
      continue
    }
    try {
      files[path] = await textOf($, home === '' ? path : `${home}/${path.slice(2)}`)
    } catch (error) {
      note(`${path}:`, error)
      files[path] = undefined
    }
  }
  const runs: Record<string, string | undefined> = {}
  for (const argv of module.runs ?? []) {
    try {
      const ran = await $.process.run(argv, { cwd, timeoutMs: COMMAND_TIMEOUT_MS })
      runs[runKey(argv)] = ran.exitCode === 0 ? ran.stdout : undefined
    } catch {
      runs[runKey(argv)] = undefined
    }
  }

  return { files, runs }
}

// The user's home folder as the shell names it (s37: the Jev ledger under ~/.config/jev), asked once a module load; undefined when the shell
// names none.
let home: string | undefined | null = null
async function homeDir($: EngineInterface): Promise<string | undefined> {
  if (home !== null) return home
  try {
    const ran = await $.process.run(['sh', '-c', 'printf %s "$HOME"'], { timeoutMs: COMMAND_TIMEOUT_MS })
    home = ran.exitCode === 0 && ran.stdout.startsWith('/') ? ran.stdout.replace(/\/+$/, '') : undefined
  } catch {
    home = undefined
  }
  return home
}

// The facts as a module is given them.
function sessionFacts(tools: number): SessionFacts {
  return {
    who: facts.who,
    block: facts.block,
    score: facts.score,
    total: facts.total,
    pending: facts.pending,
    branch: facts.branch,
    dirty: facts.dirty,
    ff: facts.ff,
    left: facts.left,
    h5: facts.h5,
    d7: facts.d7,
    tools,
    // s44: the pomodoro, read in readModules and kept with the rest of the facts
    pomo: facts.pomo,
    version: VERSION_NAME,
    journal: facts.journal ?? [],
    events: facts.events ?? [],
  }
}

// A 模組卡's lines (at most H3_LINES, none empty): its module's, or a line saying the module is not there or failed. A module someone
// else wrote that throws breaks its own tile only.
function moduleLines(card: SlCard, tools: number): string[] {
  const module = moduleOf(card.text)
  if (module?.lines === undefined) return [tr('mod.missing', { id: card.text })]
  try {
    const lines = module.lines({ ...(moduleInputs[module.id] ?? { files: {}, runs: {} }), session: sessionFacts(tools), t: tr })
      .filter(line => line !== '')
      .slice(0, H3_LINES)
    return lines.length > 0 ? lines : ['?']
  } catch (error) {
    return [tr('mod.error', { name: moduleName(module), reason: reason(error) })]
  }
}

// A 模組卡's picture in an H3 tile (s35): its module's chart in the box, or undefined (no chart, or it failed: its lines then).
function moduleChart(card: SlCard, tools: number, box: ChartBox): string | undefined {
  const module = moduleOf(card.text)
  if (module?.chart === undefined) return undefined
  try {
    const source = module.chart({ ...(moduleInputs[module.id] ?? { files: {}, runs: {} }), session: sessionFacts(tools), t: tr }, box)
    return source.startsWith('<svg') ? source : undefined
  } catch (error) {
    note(`${module.id}:`, error)
    return undefined
  }
}

// A 模組卡's picture in an H2 tile (s39, B): its module's tile in the box, or undefined (none, or it failed: its first line then).
function moduleTile(card: SlCard, tools: number, box: ChartBox): string | undefined {
  const module = moduleOf(card.text)
  if (module?.tile === undefined) return undefined
  try {
    const source = module.tile({ ...(moduleInputs[module.id] ?? { files: {}, runs: {} }), session: sessionFacts(tools), t: tr }, box)
    return source.startsWith('<svg') ? source : undefined
  } catch (error) {
    note(`${module.id}:`, error)
    return undefined
  }
}

// Where auto-compaction starts, from /context's rows: the window measured against, less the compaction buffer.
let room: { max: number; buffer: number; source: string; window: number } | undefined

// The text of a file, or undefined when it is not there (not a failure). A read that is refused throws.
async function textOf($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path))) return undefined

  return String(await $.fs.read(path))
}

async function readFiles($: EngineInterface): Promise<Facts> {
  const out: Facts = {}
  try {
    if (await $.fs.exists(`${cwd}/.claude`)) {
      const entries = await $.fs.list(`${cwd}/.claude`)
      const newest = entries
        .filter(f => f.kind === 'file' && JOURNAL.test(f.name))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
      if (newest) {
        const text = String(await $.fs.read(`${cwd}/.claude/${newest.name}`))
        out.who = /^0 WHO — (\S+)/.exec(text)?.[1]
        out.journal = text.split('\n').map(line => line.trim()).filter(line => line !== '').slice(-H3_LINES)
        out.events = [...text.matchAll(/^(\d+) ([A-Z]+) —/gm)].map(m => ({ id: Number(m[1]), word: m[2] as string }))
      }
    }
  } catch (error) {
    note('journal:', error)
  }
  try {
    const memory = await textOf($, `${cwd}/MEMORY.md`)
    if (memory !== undefined) {
      out.block = /^current_block:\s*(\S+)/m.exec(memory)?.[1]
      out.pending = (memory.match(PENDING) ?? []).length
    }
  } catch (error) {
    note('MEMORY.md:', error)
  }
  try {
    const score = await textOf($, `${cwd}/Score.md`)
    if (score !== undefined) {
      out.score = /^score_band:\s*(\S+)/m.exec(score)?.[1]
      out.total = /^score_total:\s*(\S+)/m.exec(score)?.[1]
    }
  } catch (error) {
    note('Score.md:', error)
  }

  return out
}

async function git($: EngineInterface, argv: readonly string[]) {
  try {
    return await $.process.run(argv, { cwd, timeoutMs: 5000 })
  } catch (error) {
    note(`git ${argv.slice(1, 3).join(' ')}:`, error)

    return undefined
  }
}

async function readGit($: EngineInterface): Promise<Facts> {
  const out: Facts = {}
  const branch = await git($, GIT_BRANCH)
  if (branch?.exitCode === 0) out.branch = branch.stdout.trim().replace(/^claude\//, '')
  const dirty = await git($, GIT_DIRTY)
  if (dirty?.exitCode === 0) out.dirty = dirty.stdout.split('\n').filter(line => line.trim() !== '').length
  // master, else main: a repo with neither leaves ff unknown. the owner 2026-10-09: also say whether the base can be
  // fast-forwarded to HEAD (the base is an ancestor of HEAD) or has gone its own way (cannot).
  for (const [inBase, baseIn] of [[GIT_FF, GIT_CAN], [GIT_FF_MAIN, GIT_CAN_MAIN]]) {
    const done = await git($, inBase)
    if (done?.exitCode === 0) {
      out.ff = 'done'
      break
    }
    if (done?.exitCode === 1) {
      const can = await git($, baseIn)
      if (can?.exitCode === 0) out.ff = 'can'
      else if (can?.exitCode === 1) out.ff = 'cannot'
      if (out.ff) break
    }
  }

  return out
}

// the owner 2026-10-09: context shows what is left before auto-compaction, not what is used.
// The threshold comes from /context's rows (a local estimate, no requests) when `withRows`; the tokens in use
// come from the last response on every call.
async function readUsage($: EngineInterface, withRows: boolean): Promise<Facts> {
  const out: Facts = {}
  try {
    const usage = withRows ? await $.session.usage({ breakdown: 'summary' }) : await $.session.usage()
    const rows = usage.context.breakdown
    if (rows) {
      const buffer = rows.categories.filter(c => c.kind === 'buffer').reduce((sum, c) => sum + c.tokens, 0)
      room = { max: rows.rawMaxTokens, buffer, source: rows.autocompactSource, window: usage.context.window }
    }
    const tokens = usage.context.tokens
    const usable = room ? room.max - room.buffer : 0
    out.left = tokens !== undefined && usable > 0 ? (Math.max(0, usable - tokens) / usable) * 100 : undefined
    out.h5 = usage.rateLimits.find(r => r.kind === 'five_hour')?.percentUsed
    out.d7 = usage.rateLimits.find(r => r.kind === 'seven_day')?.percentUsed
  } catch (error) {
    note('usage:', error)
  }

  return out
}

// Seeds the count once from the stored conversation; a reload keeps the count it already has.
async function seed($: EngineInterface) {
  if ((await read($, toolCount)) >= 0) return
  let n = 0
  try {
    for (const message of await $.session.messages({ as: 'api' })) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        n += message.content.filter(block => block.type === 'tool_use').length
      }
    }
  } catch {
    // counted from here on
  }
  await update($, toolCount, () => n)
}

// The settings as this mod last read them from the store or wrote them there, as JSON: a store that reads otherwise was written by someone
// else (by hand, or another window running this mod) and is taken before the next change (s33).
let lastStored = ''

// s35 (the owner 「1 不空格」): the half gaps between characters are 繁中's (s28 「字距固定」). A panel in any other language keeps its interface
// words and the built-in cards' names whole (日本語 ツール, 操作者); a user's name is laid out by fixed, which keeps a name with kana whole.
const isChinesePanel = () => lang.code.toLowerCase().startsWith('zh')
const ui = (label: string) => uiLabel(label, isChinesePanel())
const nameLabel = (label: string, isBuiltIn: boolean) => (isBuiltIn && !isChinesePanel() ? label : fixed(label))

// A module's name in the panel's language: the language file's mod.<id>.name, else the module's own (English) name.
const moduleName = (module: SsModule | undefined) => (module === undefined ? '' : tr(`mod.${module.id}.name`, undefined, module.name))

// The language a session starts in (s34): the one kept in the store; with none kept, 繁中 where settings were kept before languages existed
// (the owner's), English where nothing was ever kept (「英文 是預設」). The user's language files are read first, so a kept one of theirs is there.
// write: false from a drawing (ensure), where $.state cannot be written; the drawing then speaks it at once.
let isLangRead = false
// whether the store holds a language: until it does, the first settings written carry the one spoken (s35: a fresh install's first
// change wrote settings alone, and the next session took them for settings from before languages and spoke 繁中)
let isLangKept = false
async function loadLanguage($: EngineInterface, write = true) {
  isLangRead = true
  await scanLanguages($, false)
  await scanUserModules($)
  let code: string | undefined
  try {
    const kept = await $.store.get('language')
    isLangKept = typeof kept === 'string'
    if (typeof kept === 'string') code = kept
    else code = lastStored !== '' ? 'zh-TW' : 'en'
  } catch (error) {
    note('store:', error)
  }
  await useLanguage($, code ?? 'en', write)
}

// The language to speak: a code not offered is English.
async function useLanguage($: EngineInterface, code: string, write = true) {
  lang = languages.find(l => l.code === code) ?? EN
  tr = translator(lang)
  if (write) await update($, languageState, () => lang.code)
}

// /ss, with its help in the panel's language (registered again on a pick).
async function registerSs($: EngineInterface) {
  await $.command.register({ name: 'ss', description: tr('cmd.description'), argumentHint: tr('cmd.hint') })
}

// A pick in the panel's language list: kept in the store, then the values, the status line and /ss's help in its words.
async function pickLanguage($: EngineInterface, code: string) {
  await useLanguage($, code)
  try {
    await registerSs($)
  } catch (error) {
    note('command:', error)
  }
  try {
    await $.store.set('language', lang.code)
    isLangKept = true
  } catch (error) {
    note('store:', error)
  }
  await readCards($)
  await render($)
}

// 新增語言 (s34; the kit has no upload, so a file put in LANG_DIR is read when this is pressed, and at a session's start): each .json there
// checked (版本防呆, hooks/lang checkLang); a good one offered (a user's file of a built-in's code takes its place); report: what was loaded,
// how many strings English stands in for, which file was refused and why, under the panel's first row.
async function scanLanguages($: EngineInterface, report: boolean) {
  const dir = `${cwd}/${LANG_DIR}`
  const lines: string[] = []
  const loaded: string[] = []
  let names: string[] = []
  try {
    if (await $.fs.exists(dir)) names = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name).sort()
  } catch (error) {
    note(`${LANG_DIR}:`, error)
  }
  const found: LangFile[] = []
  for (const name of names) {
    let text: string
    try {
      text = await $.fs.read(`${dir}/${name}`)
    } catch (error) {
      lines.push(tr('lang.refused', { file: name, why: reason(error) }))
      continue
    }
    const checked = checkLang(text)
    if (!checked.ok) {
      lines.push(tr('lang.refused', { file: name, why: tr(checked.why, checked.vars) }))
      continue
    }
    found.push(checked.lang)
    loaded.push(`${checked.lang.code}（${checked.lang.name}）`)
    if (checked.missing > 0) lines.push(tr('lang.missing', { code: checked.lang.code, n: checked.missing }))
  }
  languages = [...BUILT_IN.filter(b => !found.some(f => f.code === b.code)), ...found]
  if (!report) return
  const note2 = names.length === 0 ? [tr('lang.none', { dir: LANG_DIR })] : [...(loaded.length > 0 ? [tr('lang.loaded', { list: loaded.join('、') })] : []), ...lines]
  await update($, langNoteState, () => note2.join('；'))
}

// A user's own modules (s43): .claude/superstatus/modules read as the language folder is — every .json checked by hooks/usermods,
// a good one offered beside the built-ins, a refused one named with the reason. Two files claiming one id: the first by name keeps it.
// A folder that is not there is not a fault, and nothing is said about it.
async function scanUserModules($: EngineInterface) {
  const dir = `${cwd}/${MODULE_DIR}`
  const lines: string[] = []
  let names: string[] = []
  try {
    if (await $.fs.exists(dir)) names = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name).sort()
  } catch (error) {
    note(`${MODULE_DIR}:`, error)
  }
  const found: SsModule[] = []
  const takenBy: Record<string, string> = {}
  userModuleFiles = takenBy
  for (const name of names) {
    let text: string
    try {
      text = await $.fs.read(`${dir}/${name}`)
    } catch (error) {
      lines.push(tr('usermod.refused', { file: name, why: reason(error) }))
      continue
    }
    const checked = checkUserModule(text)
    if (!checked.ok) {
      lines.push(tr('usermod.refused', { file: name, why: tr(checked.why, checked.vars) }))
      continue
    }
    const first = takenBy[checked.def.id]
    if (first !== undefined) {
      lines.push(tr('usermod.repeat', { file: name, id: checked.def.id, first }))
      continue
    }
    takenBy[checked.def.id] = name
    found.push(toUserModule(checked.def))
  }
  setUserModules(found)
  modNote = lines.join('；')
}

// 新增語言… picked in the desktop's language list (Claude Design step 1, s37): the folder read as by the button, then the drawings drawn
// again, so the list shows the language in use, not the option picked (the person's pick stands until the hook draws another)
async function addLanguage($: EngineInterface) {
  await scanLanguages($, true)
  await update($, readCountState, n => n + 1)
}

async function loadSettings($: EngineInterface) {
  try {
    const stored = (await $.store.get('settings')) as Partial<Settings> | undefined
    lastStored = JSON.stringify(stored) ?? ''
    if (stored && typeof stored === 'object') {
      const next = normalizeSettings(stored)
      await update($, settingsState, () => next)
    }
  } catch {
    // keeps what the state holds (the defaults on a first load)
  }
}

// Settings as kept somewhere (the store, a profile file, s36), each field checked: what is unknown or of the wrong kind is dropped.
function normalizeSettings(stored: Partial<Settings>): Settings {
  const cards = normalizeCards(stored.cards)
  const known = (k: unknown) => typeof k === 'string' && (isKey(k) || cards.some(c => c.id === k))
  const next: Settings = {
    off: Array.isArray(stored.off) ? stored.off.filter((k): k is string => known(k)) : [],
    note: typeof stored.note === 'string' ? stored.note : '',
    icons: stored.icons !== false,
    order: normalizeOrder(stored.order, cards),
    cards,
    collapsed: stored.collapsed === true,
    aboveOrder: normalizeList(stored.aboveOrder, aboveDefault(cards)),
    aboveCollapsed: stored.aboveCollapsed === true,
    touchCollapsed: stored.touchCollapsed === true,
    h3Collapsed: stored.h3Collapsed === true,
    h2Collapsed: stored.h2Collapsed === true,
    h3HalfCollapsed: stored.h3HalfCollapsed === true,
    h3FullCollapsed: stored.h3FullCollapsed === true,
    h2HalfCollapsed: stored.h2HalfCollapsed === true,
    h2FullCollapsed: stored.h2FullCollapsed === true,
    // built-in cards deleted with 刪除 (s29); 版本號 cannot be
    removed: Array.isArray(stored.removed) ? stored.removed.filter((k): k is string => typeof k === 'string' && k !== 'ver' && (isKey(k) || k === 'icons')) : [],
    aboveOff: Array.isArray(stored.aboveOff) ? ABOVE_BLOCKS.filter(b => stored.aboveOff?.includes(b)) : [],
    // the desktop panel's width (Claude Design step 1, s37): kept only when narrow, so settings from before widths read as they were
    ...(stored.narrow === true ? { narrow: true } : {}),
    // how the touchbar pages (s41): 'counter' is B; anything else is A, kept as nothing
    ...(stored.paging === 'counter' ? { paging: 'counter' as const } : {}),
    ...(stored.showEvery === true ? { showEvery: true } : {}),
    // the pomodoro (s44): a state it knows and a whole count, else nothing — a settings file from before it reads as before
    ...(POMO_STATES.includes(stored.pomo?.state as string)
      ? { pomo: {
          state: stored.pomo?.state as 'idle' | 'run' | 'pause' | 'break',
          done: Number.isInteger(stored.pomo?.done) ? (stored.pomo?.done as number) : 0,
          ...(Number.isFinite(stored.pomo?.endsAt) ? { endsAt: stored.pomo?.endsAt as number } : {}),
          ...(Number.isFinite(stored.pomo?.leftMs) ? { leftMs: stored.pomo?.leftMs as number } : {}),
        } }
      : {}),
  }

  return next
}

// One change of the settings, from a command or from a button: state, store, status line.
async function change($: EngineInterface, fn: (st: Settings) => Settings) {
  // s31 nodes 17 and 19, s33 03:38:52: a press wrote this mod's old settings over a store written by hand under it; take the newer one first
  await adopt($)
  await update($, settingsState, fn)
  const next = await read($, settingsState)
  // a store that never held settings nor a language (a fresh install): its first settings carry the language spoken, so the next session
  // does not take them for settings from before languages; a store already written (by another session, or the owner's) is left as it is
  const isFresh = !isLangKept && (await $.store.get('settings')) === undefined && typeof (await $.store.get('language')) !== 'string'
  await $.store.set('settings', next)
  lastStored = JSON.stringify(next)
  if (isFresh) await $.store.set('language', lang.code)
  isLangKept = true
  // a tile module just turned on has nothing read yet (an off card is not read): read it now, not at the next minute (s33).
  // NOT awaited since s44 (the owner 「甲」): the window waits for a press hook's answer and gives it 10 s, and reading his ten-odd lit
  // modules one after another, 3 s a command, came to 11.5 s and the press was skipped (s30 node 53, the engine's own line).
  // The reading happens after the answer and redraws the band when it lands; nobody waits for it.
  if (next.cards.some(c => c.kind === 'module' && !next.off.includes(c.id) && moduleOf(c.text)?.role === 'tile' && !(c.text in moduleInputs))) {
    later($, readModules($))
  }
  await render($)
}

// Takes the store when it moved since this mod last read or wrote it.
async function adopt($: EngineInterface) {
  try {
    const stored = await $.store.get('settings')
    if (stored !== undefined && (JSON.stringify(stored) ?? '') !== lastStored) await loadSettings($)
  } catch {
    // the store cannot be read: the change goes on from what the state holds
  }
}

// the owner 2026-10-10 s33 「把9按鈕設定為重新載入讓我開發階段可以快速進展一點」: /ss reload reads the store and the project's files again, so
// a store written by hand shows in the running session; without it the mod's state, still the old settings, is drawn, and the next
// change writes it over the file (s31 nodes 17 and 19).
async function reload($: EngineInterface) {
  await loadSettings($)
  await scanUserModules($)
  await refresh($)
  await render($)
}

// The profiles folder (s36), asked once of the shell: CLAUDE_CONFIG_DIR, else ~/.claude, then superstatus/profiles; undefined, with the
// reason in the pane, when it cannot be found.
let profileDir: string | undefined
async function profilesDir($: EngineInterface): Promise<string | undefined> {
  if (profileDir !== undefined) return profileDir
  try {
    const ran = await $.process.run(CONFIG_DIR_ARGV, { timeoutMs: HOST_COMMAND_MS })
    const base = ran.stdout.trim()
    if (ran.exitCode !== 0 || !base.startsWith('/')) throw new Error(ran.stderr.trim() || `exit ${ran.exitCode}`)
    profileDir = `${base.replace(/\/+$/, '')}/${PROFILES_SUBDIR}`
    await update($, profilesState, p => ({ ...p, dir: profileDir ?? '', error: '' }))
    return profileDir
  } catch (error) {
    await update($, profilesState, p => ({ ...p, dir: '', error: tr('profile.err.folder', { why: reason(error) }) }))
    return undefined
  }
}

// Reads the folder again: each .json there checked (a profile of another kind or format is refused, saying why), the good ones listed by
// file name with their name, the cards they show, when they were saved and the cards in them that run things. Run before the pane opens
// and after each save, load and delete; 重新整理 runs it for a file put there by hand (the import).
async function scanProfiles($: EngineInterface) {
  const dir = await profilesDir($)
  if (dir === undefined) {
    await update($, profilesState, p => ({ ...p, rows: [], refused: [] }))
    return
  }
  let names: string[] = []
  try {
    if (await $.fs.exists(dir)) names = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name).sort()
  } catch (error) {
    await update($, profilesState, p => ({ ...p, rows: [], refused: [], error: tr('profile.err.list', { why: reason(error) }) }))
    return
  }
  const rows: SsProfiles['rows'] = []
  const refused: string[] = []
  for (const file of names) {
    let text: string
    try {
      text = await $.fs.read(`${dir}/${file}`)
    } catch (error) {
      refused.push(tr('profile.refused', { file, why: reason(error) }))
      continue
    }
    const checked = checkProfile(text)
    if (!checked.ok) {
      refused.push(tr('profile.refused', { file, why: tr(checked.why, checked.vars) }))
      continue
    }
    const st = normalizeSettings(checked.profile.settings as Partial<Settings>)
    rows.push({ file, name: checked.profile.name, cards: BUILT_IN_CARDS - st.removed.length + st.cards.length, saved: savedLabel(checked.profile.savedAt), runs: runsThings(checked.profile.settings) })
  }
  await update($, profilesState, p => ({ ...p, rows, refused }))
}

async function openProfiles($: EngineInterface) {
  await update($, profilesState, p => ({ ...p, asking: '', note: '' }))
  await scanProfiles($)
  await $.ui.open({ id: PROFILE_PANE, title: tr('pane.profileTitle'), focus: true, closeOnEscape: true })
}

// The look now (the settings and the language) as a profile file under the name.
async function writeProfile($: EngineInterface, dir: string, name: string) {
  const text = makeProfile({ name, savedAt: await $.clock.now(), version: VERSION, language: lang.code, settings: await read($, settingsState) })
  await $.fs.write(`${dir}/${fileOf(name)}`, text)
}

// 存檔: the name typed, checked; an existing file of that name asks again (the button reads 確定覆蓋); then the file is written.
async function saveProfile($: EngineInterface) {
  const now = await read($, profilesState)
  const problem = nameProblem(now.name)
  if (problem !== undefined) {
    await update($, profilesState, p => ({ ...p, asking: '', note: tr(problem.why, problem.vars) }))
    return
  }
  const dir = await profilesDir($)
  if (dir === undefined) return
  const file = fileOf(now.name)
  const path = `${dir}/${file}`
  if (now.asking !== `save:${file}` && (now.rows.some(r => r.file === file) || (await $.fs.exists(path)))) {
    await update($, profilesState, p => ({ ...p, asking: `save:${file}`, note: tr('profile.askOverwrite', { name: now.name.trim() }) }))
    return
  }
  try {
    await writeProfile($, dir, now.name.trim())
  } catch (error) {
    await update($, profilesState, p => ({ ...p, asking: '', note: tr('profile.err.write', { why: reason(error) }) }))
    return
  }
  await update($, profilesState, p => ({ ...p, asking: '', note: tr('profile.saved', { file: path }) }))
  await scanProfiles($)
}

// 載入: the first press shows the cards in it that run things and asks again (the button reads 確定載入); the second reads the file again,
// saves the look now as 載入前 (no load when that fails), then takes the profile's settings (checked as the store's are) and its language
// when this machine offers it.
async function loadProfile($: EngineInterface, index: number) {
  const now = await read($, profilesState)
  const row = now.rows[index]
  if (row === undefined) return
  if (now.asking !== `load:${row.file}`) {
    await update($, profilesState, p => ({ ...p, asking: `load:${row.file}`, note: '' }))
    return
  }
  const dir = await profilesDir($)
  if (dir === undefined) return
  const fail = (why: string) => update($, profilesState, p => ({ ...p, asking: '', note: tr('profile.err.read', { why }) }))
  let text: string
  try {
    text = await $.fs.read(`${dir}/${row.file}`)
  } catch (error) {
    await fail(reason(error))
    return
  }
  const checked = checkProfile(text)
  if (!checked.ok) {
    await fail(tr(checked.why, checked.vars))
    return
  }
  const before = tr('profile.beforeLoad')
  try {
    await writeProfile($, dir, before)
  } catch (error) {
    await update($, profilesState, p => ({ ...p, asking: '', note: tr('profile.err.write', { why: reason(error) }) }))
    return
  }
  const next = normalizeSettings(checked.profile.settings as Partial<Settings>)
  await change($, () => next)
  const code = checked.profile.language
  if (code !== undefined && code !== lang.code && languages.some(l => l.code === code)) await pickLanguage($, code)
  await readCards($)
  await render($)
  await update($, profilesState, p => ({ ...p, asking: '', note: tr('profile.loaded', { name: checked.profile.name, before }) }))
  await scanProfiles($)
}

// 刪除: asks again (確定刪除), then removes the file (the kit's $.fs has no delete: rm -f on this machine).
async function deleteProfile($: EngineInterface, index: number) {
  const now = await read($, profilesState)
  const row = now.rows[index]
  if (row === undefined) return
  if (now.asking !== `delete:${row.file}`) {
    await update($, profilesState, p => ({ ...p, asking: `delete:${row.file}`, note: '' }))
    return
  }
  const dir = await profilesDir($)
  if (dir === undefined) return
  try {
    const ran = await $.process.run(['rm', '-f', '--', `${dir}/${row.file}`], { timeoutMs: HOST_COMMAND_MS })
    if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `exit ${ran.exitCode}`)
  } catch (error) {
    await update($, profilesState, p => ({ ...p, asking: '', note: tr('profile.err.delete', { why: reason(error) }) }))
    return
  }
  await update($, profilesState, p => ({ ...p, asking: '', note: tr('profile.deleted', { name: row.name }) }))
  await scanProfiles($)
}

// A card deleted (刪除's second press, or the 編輯 grid's, s36): a built-in card is put in removed (預設 brings it back), an added one goes
// for good, its value, place and on/off with it.
async function deleteCard($: EngineInterface, key: string) {
  if (isKey(key) || key === 'icons') {
    await change($, s => ({ ...s, removed: [...s.removed, key] }))
    return
  }
  if (switchErrorCard === key) await update($, switchErrorState, () => '')
  delete cardValues[key]
  await change($, s => ({
    ...s,
    cards: s.cards.filter(c => c.id !== key),
    order: s.order.filter(k => k !== key),
    aboveOrder: s.aboveOrder.filter(k => k !== key),
    off: s.off.filter(k => k !== key),
  }))
}

// 編輯 on the desktop (the owner 2026-10-12 s36 「拖卡片換順序」「可以用編輯按鈕鎖定拖曳的動作嗎」「← → 箭頭 保留」「我想像之前一樣維持刪除按鈕」,
// then 「你先做我們再細修」): each section's grid is a Client keyed grid-status or grid-<size>; what it posts is checked against that
// section here before anything is kept, since a post is plain data from code.
type GridSection = 'status' | SlSize
type GridPost = { move?: { key?: unknown; to?: unknown }; remove?: unknown; rename?: { key?: unknown; name?: unknown } }
function gridSection(element: string): GridSection | undefined {
  if (element === 'grid-status') return 'status'
  const size = element.startsWith('grid-') ? element.slice(5) : ''
  return (STACK as readonly string[]).includes(size) ? (size as SlSize) : undefined
}
// a section's cards in their order: Status Line's (less the deleted built-ins), or a menu's
function gridList(st: Settings, section: GridSection): string[] {
  return section === 'status' ? st.order.filter(k => !st.removed.includes(k)) : st.aboveOrder.filter(k => groupOf(st, k) === section)
}
const placed = (list: readonly string[], key: string, to: number) => {
  const next = list.filter(k => k !== key)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, key)
  return next
}
async function gridPost($: EngineInterface, section: GridSection, data: GridPost) {
  const st = await read($, settingsState)
  const list = gridList(st, section)
  if (data.move !== undefined) {
    const { key, to } = data.move
    // 版本號 is fixed first (Claude Design step 7, s38): it never moves, and a place counts among the cards after it
    if (typeof key !== 'string' || typeof to !== 'number' || !Number.isInteger(to) || !list.includes(key) || key === 'ver') return
    const wanted = [...list.filter(k => k === 'ver'), ...placed(list.filter(k => k !== 'ver'), key, to)]
    if (wanted.join() === list.join()) return
    await change($, s =>
      section === 'status'
        ? { ...s, order: withGroupOrder(s.order, k => !s.removed.includes(k), wanted) }
        : { ...s, aboveOrder: withGroupOrder(s.aboveOrder, k => groupOf(s, k) === section, wanted) },
    )
    return
  }
  if (data.remove !== undefined) {
    const key = data.remove
    const isIcons = section === 'status' && key === 'icons' && !st.removed.includes('icons')
    if (typeof key !== 'string' || key === 'ver' || !(list.includes(key) || isIcons)) return
    await deleteCard($, key)
    return
  }
  if (data.rename !== undefined) {
    const { key, name } = data.rename
    const card = st.cards.find(c => c.id === key)
    const trimmed = typeof name === 'string' ? name.trim() : ''
    const n = [...trimmed].length
    if (card === undefined || !list.includes(card.id) || n === 0 || n > lang.rules.nameMax || trimmed === card.name) return
    await change($, s => ({ ...s, cards: s.cards.map(c => (c.id === card.id ? { ...c, name: trimmed } : c)) }))
  }
}

// The panel's and the band's 重新載入 (the owner 2026-10-10 s33 「你可以做個重新加載的按鈕在pane嗎不用每次都讓我開新對話」): the store and the files
// again, then Claude Code's own /reload-plugins, which loads the mods' code as it is now. A mod loaded from .claude/skills is not reloaded
// while the session runs (s33 node 28); the engine's own words: "edits there take effect after /reload-plugins". $.command.run runs a
// built-in as if typed; $.prompt.submit would send the words to the model instead.
async function reloadAll($: EngineInterface) {
  await reload($)
  try {
    await $.command.run({ command: 'reload-plugins', args: '' })
  } catch (error) {
    $.ui.toast(tr('toast.reloadPartial', { reason: reason(error) }))
  }
}

function pie(value: number) {
  const r = Math.round(value)
  return r <= 12 ? '○' : r <= 37 ? '◔' : r <= 62 ? '◑' : r <= 87 ? '◕' : '●'
}

// 通用 (the owner 2026-10-09): an item a project has no source for returns null and does not appear: the operator
// and block need the another project journal and MEMORY.md, the score Score.md, the git items a repository.
function segment(key: string, tools: number, st: Settings): string | null {
  if (!isKey(key)) {
    const added = st.cards.find(c => c.id === key)
    if (added === undefined) return null
    // a 開關卡 or a 按鈕卡 is a button, not a fact: never on a line of text
    if (added.kind === 'switch' || isPress(added)) return null
    if (added.kind === 'module') return moduleLines(added, tools)[0] ?? '?'
    const value = added.kind === 'text' ? added.text : cardValues[key]?.value ?? '?'
    return value === '' ? added.name : `${added.name} ${value}`
  }
  const icons = st.icons
  const percent = (label: string, value: number | undefined) =>
    value === undefined ? `${label} ?` : `${icons ? `${pie(value)} ` : ''}${label} ${Math.round(value)}%`
  const shown = (value: unknown) => (value === undefined ? '?' : String(value))

  switch (key) {
    case 'ver':
      return VERSION_NAME
    case 'who':
      return facts.who === undefined ? null : icons ? `◉ ${facts.who}` : facts.who
    case 'block':
      if (facts.block === undefined) return null
      return icons ? `▣ B${facts.block}` : tr('line.block', { v: facts.block })
    case 'tools':
      return `${icons ? '⌗' : tr('line.tools')} ${tools >= 0 ? tools : '?'}`
    case 'ctx':
      return percent(tr(icons ? 'line.ctxIcon' : 'line.ctx'), facts.left)
    case '5h':
      return percent(icons ? '5h' : tr('line.5h'), facts.h5)
    case '7d':
      return percent(icons ? '7d' : tr('line.7d'), facts.d7)
    case 'score':
      return facts.score === undefined ? null : `${icons ? '★' : tr('line.score')} ${facts.score}`
    case 'pending':
      return facts.pending === undefined ? null : `${icons ? '△' : tr('line.pending')} ${facts.pending}`
    case 'branch':
      return facts.branch === undefined ? null : `${icons ? '⎇' : tr('line.branch')} ${facts.branch}`
    case 'dirty':
      return facts.branch === undefined ? null : `${icons ? '±' : tr('line.dirty')} ${shown(facts.dirty)}`
    case 'ff':
      if (facts.branch === undefined) return null
      // a symbol and a word in both modes (the owner 2026-10-09)
      if (facts.ff === undefined) return tr('line.ffUnknown')
      return tr(facts.ff === 'done' ? 'line.ffDone' : facts.ff === 'can' ? 'line.ffCan' : 'line.ffCannot')
  }
}

// The status line as it reads now: the items that are on, then the note.
function lineText(tools: number, st: Settings): string | undefined {
  const parts = st.order.filter(key => !st.off.includes(key) && !st.removed.includes(key))
    .map(key => segment(key, tools, st))
    .filter((part): part is string => part !== null)
  if (st.note) parts.push(`${st.icons ? '✎' : tr('line.note')} ${st.note}`)

  return parts.length > 0 ? parts.join('  ') : undefined
}

// The band above the prompt as it reads now: the AbovePrompt section's cards that are on, in its order.
function aboveText(tools: number, st: Settings): string | undefined {
  const parts = st.aboveOrder.filter(key => !st.off.includes(key))
    .map(key => segment(key, tools, st))
    .filter((part): part is string => part !== null)

  return parts.length > 0 ? parts.join('  ') : undefined
}

// Reads the folder and the facts if nothing has yet.
async function ensure($: EngineInterface) {
  // a module reloaded without session.start: its language from the store first (s34), then the facts
  if (!isLangRead) await loadLanguage($, false)
  if (!isRead) await refresh($, false)
}

async function render($: EngineInterface) {
  const line = lineText(await read($, toolCount), await read($, settingsState))
  $.ui.status(line)
}

// s44: the pomodoro as the card needs it, and the one place its own clock moves — a running one that reached zero is counted
// and put back to idle, in the settings, so the count survives a reload and a new session.
async function pomoFacts($: EngineInterface): Promise<{ left: number; state: 'idle' | 'run' | 'pause' | 'break'; done: number }> {
  const st = await read($, settingsState)
  const kept: Pomo = st.pomo ?? NO_POMO
  let now = 0
  try {
    now = await $.clock.now()
  } catch {
    now = 0
  }
  const after = now === 0 ? kept : pomoAfter(kept, now)
  if (JSON.stringify(after) !== JSON.stringify(kept)) await change($, cur => ({ ...cur, pomo: after }))
  return { left: pomoLeft(after, now), state: after.state, done: after.done }
}

async function refresh($: EngineInterface, redraw = true) {
  isRead = true
  problems = []
  if (cwd === '') cwd = await $.session.cwd()
  if (cwd === '') note('folder:', 'the session reports no folder')
  facts = { ...(await readFiles($)), ...(await readGit($)), ...(await readUsage($, true)) }
  await readCards($, redraw)
}

// The /ss panel (the owner 2026-10-09 「照示意圖做」): three groups, a label and a value per row, a ten-block bar for the
// three percentages, coloured by theme keys: green when fine, yellow when getting full, red when nearly out.
type Tone = 'success' | 'warning' | 'error'
// value: the text of the card on the terminal; dial: the text inside the disc; arc: how much of the 270 degrees is coloured (0 to 100).
type Row = { label: string; value: string; dial: string; bar?: string; arc?: number; tone?: Tone }

// The added cards as stored: each needs an id and a name; anything else is dropped.
function normalizeCards(raw: unknown): SlCard[] {
  if (!Array.isArray(raw)) return []
  const out: SlCard[] = []
  for (const c of raw as Partial<SlCard>[]) {
    if (c && typeof c.id === 'string' && /^c\d+$/.test(c.id) && typeof c.name === 'string' && c.name !== '' && !out.some(o => o.id === c.id)) {
      const kind = KIND_VALUES.includes(c.kind as SlCardKind) ? (c.kind as SlCardKind) : 'text'
      const card: SlCard = { id: c.id, kind, name: c.name, text: typeof c.text === 'string' ? c.text : '', prefix: typeof c.prefix === 'string' ? c.prefix : '' }
      if (c.section === 'above') card.section = 'above'
      if (kind !== 'button' && kind !== 'switch' && isDisplaySize(c.size)) card.size = c.size
      // the card's own seconds (s43): a whole number above zero is kept as it stands; everyMs holds it to the floor when it reads
      if (Number.isInteger(c.every) && (c.every as number) >= 0) card.every = c.every as number
      if (kind === 'switch') {
        card.onArgs = typeof c.onArgs === 'string' ? c.onArgs : ''
        card.offArgs = typeof c.offArgs === 'string' ? c.offArgs : ''
      }
      out.push(card)
    }
  }

  return out
}

// The order of the items: the stored one, unknown names dropped, a name given twice kept once, missing ones at the end.
function normalizeOrder(raw: unknown, cards: readonly SlCard[] = []): string[] {
  const list = normalizeList(raw, defaultOrder(cards))
  // an order kept before s29 has no 版本號: it goes first, where the default has it, not at the end with other newcomers
  return Array.isArray(raw) && !raw.includes('ver') ? ['ver', ...list.filter(k => k !== 'ver')] : list
}

function normalizeList(raw: unknown, all: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (all.includes(k) && !seen.has(k)) {
        seen.add(k)
        out.push(k)
      }
    }
  }
  for (const k of all) if (!seen.has(k)) out.push(k)

  return out
}

// The next free id for an added card: c1, c2, …
const nextCardId = (cards: readonly SlCard[]) =>
  `c${cards.reduce((most, c) => Math.max(most, Number(c.id.slice(1))), 0) + 1}`

// Moves an item one place, swapping it with its neighbour; at the ends nothing moves.
// The picture of TouchBar beside AbovePrompt's name (the owner 2026-10-09 s29 sketch, then 2.png): a rounded frame, and in it a rounded shape
// per button that is on, its place in superscript and its name, as the band numbers them; what does not fit ends in +N. 300 units: the
// 456 it had on its own line (four cards in his pane) less the ~133 that ▶ AbovePrompt takes beside it (2.png, 2.39 px per unit).
const BAND_PICTURE_WIDTH = 300
const BAND_PICTURE_HEIGHT = 34
function bandPictureSvg(labels: string[]): string {
  const widthOf = (label: string) =>
    Math.max(36, [...label].reduce((sum, c) => sum + (/[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(c) ? 6 : /[\u2e80-\uffff]/.test(c) ? 12 : 7), 0) + 14)
  const room = BAND_PICTURE_WIDTH - 16
  const total = labels.reduce((sum, l) => sum + widthOf(l) + 6, -6)
  const limit = total <= room ? room : room - 30
  const shapes: string[] = []
  let x = 8
  let shown = 0
  for (const label of labels) {
    const w = widthOf(label)
    if (x + w > 8 + limit) break
    shapes.push(
      `<rect x="${x}" y="7" width="${w}" height="20" rx="6" fill="#808080" fill-opacity="0.28"/>` +
        `<text x="${x + w / 2}" y="21" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="11" fill="#f2f2f2">${escapeXml(label)}</text>`,
    )
    x += w + 6
    shown++
  }
  const rest = labels.length - shown
  const more = rest > 0 ? `<text x="${x + 2}" y="21" font-family="-apple-system,system-ui,sans-serif" font-size="11" fill="#8a8a8a">+${rest}</text>` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAND_PICTURE_WIDTH}" height="${BAND_PICTURE_HEIGHT}" viewBox="0 0 ${BAND_PICTURE_WIDTH} ${BAND_PICTURE_HEIGHT}">` +
    `<rect x="1" y="1" width="${BAND_PICTURE_WIDTH - 2}" height="${BAND_PICTURE_HEIGHT - 2}" rx="16" fill="none" stroke="#808080" stroke-opacity="0.6"/>` +
    shapes.join('') +
    more +
    '</svg>'
  )
}

// The pictures beside AbovePrompt and its menus in the panel (the owner 2026-10-10 s33): each 300 units, the TouchBar picture's width, at the right
// end of a four-card row. AbovePrompt's is the band made small; showchart's and showinfo's are three and five boxes spread edge to edge, named
// for the cards in them. A block its switch folds away is dimmed.
const TILES_PICTURE_HEIGHT = 34
const DIM = ' opacity="0.35"'
const SVG_FONT = 'font-family="-apple-system,system-ui,sans-serif"'

// n boxes of one size from x0 to x1, a gap between
function spread(n: number, x0: number, x1: number, gap: number): { x: number; w: number }[] {
  const w = (x1 - x0 - gap * (n - 1)) / n
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + gap), w }))
}

// one row of dashed boxes, each named for its card (the last says +N for the cards past it); a box with no card is drawn empty
function boxesSvg(names: readonly string[], slots: number, y: number, rowH: number, fontSize: number, width = BAND_PICTURE_WIDTH): string {
  return spread(slots, 1, width - 1, 6)
    .map((b, i) => {
      const name = names[i]
      const more = i === slots - 1 && names.length > slots ? ` +${names.length - slots}` : ''
      return (
        `<rect x="${b.x}" y="${y}" width="${b.w}" height="${rowH}" rx="5" fill="none" stroke="#808080" stroke-opacity="0.8" stroke-dasharray="4 3"/>` +
        (name === undefined
          ? ''
          : `<text x="${b.x + b.w / 2}" y="${y + rowH / 2 + fontSize / 2 - 1}" text-anchor="middle" ${SVG_FONT} font-size="${fontSize}" fill="#f2f2f2">${escapeXml(name + more)}</text>`)
      )
    })
    .join('')
}

function tilesSvg(names: readonly string[], slots: number, isFolded: boolean): string {
  const picH = TILES_PICTURE_HEIGHT
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAND_PICTURE_WIDTH}" height="${picH}" viewBox="0 0 ${BAND_PICTURE_WIDTH} ${picH}">` +
    `<g${isFolded ? DIM : ''}>${boxesSvg(names, slots, 2, picH - 4, 11)}</g></svg>`
  )
}

// the band made small: its tile blocks from the top (an H3 series block 40 units, an H2 series one 18, 4 between), then the buttons (H1);
// showchart and showinfo always, a -half or -full block only while it holds a card (s34), so the picture grows with the band
type PreviewBlock = { size: DisplaySize; names: readonly string[] }
function bandPreview(blocks: readonly PreviewBlock[], buttons: readonly string[], off: readonly AboveBlock[]): { source: string; height: number } {
  const dim = (block: AboveBlock) => (off.includes(block) ? DIM : '')
  let y = 2
  const rows = blocks.map(({ size, names }) => {
    const rowH = size.startsWith('H3') ? 40 : 18
    const row = `<g${dim(BLOCK_OF[size])}>${boxesSvg(names, TILES[size].perRow, y, rowH, rowH === 40 ? 10 : 9)}</g>`
    y += rowH + 4
    return row
  })
  const pills = buttons.length === 0 ? [] : spread(Math.min(buttons.length, BAND_SLOTS), 1, BAND_PICTURE_WIDTH - 1, 4)
  const height = y + 12
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAND_PICTURE_WIDTH}" height="${height}" viewBox="0 0 ${BAND_PICTURE_WIDTH} ${height}">` +
    rows.join('') +
    `<g${dim('touch')}>${pills.map(p => `<rect class="pill" x="${p.x}" y="${y}" width="${p.w}" height="10" rx="3" fill="#808080" fill-opacity="0.45"/>`).join('')}</g>` +
    '</svg>'
  return { source, height }
}

// Claude Design step 4 (s37, the owner 「OK，用 608／300 開始第 4 步」): AbovePrompt's picture on the desktop, a row of its own as wide as the
// panel's cards (608 px for its 64 cells, 300 for 32: the measured card, where the design said 600 and 295), drawing only the blocks shown
// that hold cards, in the band's order, each as its slots, and the touchbar row last (buttons: the names of the buttons that are on, or
// undefined when the row is folded or empty): wide each button's superscript and name over its place, an empty place its grey number; narrow
// 01-12 boxes, a white frame where a button is, a grey dashed one where none. Each row's group is named for its block. Nothing to draw:
// undefined.
const PREVIEW_PX = 608
const PREVIEW_NARROW_PX = 300
function laidPreview(blocks: readonly PreviewBlock[], buttons: readonly string[] | undefined, width: number, isNarrow: boolean): { source: string; height: number } | undefined {
  if (blocks.length === 0 && buttons === undefined) return undefined
  let y = 2
  const rows = blocks.map(({ size, names }) => {
    const rowH = size.startsWith('H3') ? 40 : 18
    const row = `<g class="row-${size}">${boxesSvg(names, TILES[size].perRow, y, rowH, rowH === 40 ? 10 : 9, width)}</g>`
    y += rowH + 4
    return row
  })
  if (buttons !== undefined) {
    const rowH = isNarrow ? 16 : 18
    const places = spread(BAND_SLOTS, 1, width - 1, isNarrow ? 3 : 6).map((p, i) => {
      const name = buttons[i]
      const colour = name !== undefined ? '#f2f2f2' : '#8a8a8a'
      const text = (label: string, size: number) => {
        const fit = textEm(label) * size > p.w - 4 ? ` textLength="${p.w - 4}" lengthAdjust="spacingAndGlyphs"` : ''
        return `<text x="${p.x + p.w / 2}" y="${y + rowH / 2 + size * 0.36}" text-anchor="middle" ${SVG_FONT} font-size="${size}" fill="${colour}"${fit}>${escapeXml(label)}</text>`
      }
      if (!isNarrow) return text(numbered(i + 1, name ?? ''), 9.5)
      const frame = name !== undefined ? 'stroke="#f2f2f2"' : 'stroke="#808080" stroke-opacity="0.8" stroke-dasharray="3 2"'
      return `<rect x="${p.x}" y="${y}" width="${p.w}" height="${rowH}" rx="3" fill="none" ${frame}/>` + text(String(i + 1).padStart(2, '0'), 8)
    })
    rows.push(`<g class="row-H1">${places.join('')}</g>`)
    y += rowH + 4
  }
  const height = y - 2
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rows.join('')}</svg>`, height }
}

// Claude Design step 5 (s38): a block's places beside its fold row in the add-card pane, 300 px: H1 its twelve as 01-12 boxes (a white frame
// where a lit button is, a grey dashed one where none), any other block its places spread edge to edge, a lit card's name in its place and a
// free place's own name in grey; the place picked outlined in the accent. alt: the block, its lit cards, then (H1 aside) its free places.
const BLOCK_PICTURE_PX = 300
const PICKED_STROKE = '#b1b9f9'
function blockSvg(size: SlSize, names: readonly string[], picked: number | undefined): { source: string; alt: string } {
  const n = placesOf(size)
  const picH = TILES_PICTURE_HEIGHT
  const isBoxes = size === 'H1'
  const inPlace = names.slice(0, n)
  const shapes = spread(n, 1, BLOCK_PICTURE_PX - 1, isBoxes ? 3 : 6).map((p, i) => {
    const name = inPlace[i]
    const label = isBoxes ? String(i + 1).padStart(2, '0') : (name ?? placeName(size, i + 1))
    const boxH = isBoxes ? 16 : picH - 4
    const frame =
      picked === i + 1
        ? `stroke="${PICKED_STROKE}" stroke-width="1.6"`
        : isBoxes && name !== undefined
          ? 'stroke="#f2f2f2"'
          : 'stroke="#808080" stroke-opacity="0.8" stroke-dasharray="4 3"'
    const font = isBoxes ? 8 : 9.5
    const fit = textEm(label) * font > p.w - 4 ? ` textLength="${p.w - 4}" lengthAdjust="spacingAndGlyphs"` : ''
    return (
      `<rect x="${p.x}" y="${(picH - boxH) / 2}" width="${p.w}" height="${boxH}" rx="${isBoxes ? 3 : 5}" fill="none" ${frame}/>` +
      `<text x="${p.x + p.w / 2}" y="${picH / 2 + font * 0.36}" text-anchor="middle" ${SVG_FONT} font-size="${font}" fill="${name !== undefined ? '#f2f2f2' : '#8a8a8a'}"${fit}>${escapeXml(label)}</text>`
    )
  })
  const free = isBoxes ? [] : Array.from({ length: n - inPlace.length }, (_, i) => placeName(size, inPlace.length + i + 1))
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${BLOCK_PICTURE_PX}" height="${picH}" viewBox="0 0 ${BLOCK_PICTURE_PX} ${picH}">${shapes.join('')}</svg>`,
    alt: [size, ...inPlace, ...free].join(' '),
  }
}

// Swaps a card with its nearest neighbour of the same group (TouchBar or not), passing over the others in the shared order.
function moveWithin(order: string[], key: string, delta: -1 | 1, isSame: (k: string) => boolean): string[] {
  const at = order.indexOf(key)
  if (at < 0) return order
  let to = at + delta
  while (to >= 0 && to < order.length && !isSame(order[to] as string)) to += delta
  if (to < 0 || to >= order.length) return order
  const next = [...order]
  ;[next[at], next[to]] = [next[to] as string, next[at] as string]

  return next
}

// Puts one group's cards back in the wanted order, in the places that group holds; the other cards keep theirs.
function withGroupOrder(order: string[], isInGroup: (k: string) => boolean, wanted: string[]): string[] {
  const queue = wanted.filter(k => order.includes(k))
  return order.map(k => (isInGroup(k) ? (queue.shift() ?? k) : k))
}

function moveItem(order: string[], key: string, delta: -1 | 1): string[] {
  const at = order.indexOf(key)
  const to = at + delta
  if (at < 0 || to < 0 || to >= order.length) return order
  const next = [...order]
  ;[next[at], next[to]] = [next[to] as string, next[at] as string]

  return next
}

// the owner 2026-10-09 「照這個做」: every card is a 72 px dial, the same shape for all of them (like the Apple Watch rings, open at the
// bottom). The value is drawn inside a dark disc of its own (an SVG image cannot follow the theme, so the text carries its own
// background); the coloured arc says how full it is, or the state (快轉, 待決議). The colours are fixed hex values that read on a
// light and on a dark background. The terminal has no pictures: its cards stay text.
// The gap between the ← and → buttons, and the margin above them, in cells: one value for both.
const ARROW_GAP = 1
// the owner 2026-10-09 「箭頭左右邊緣可以對其按鈕左右邊緣嗎」: the pair of arrows is as wide as the name button above it. Measured in his
// screenshot: a character is 27 px, a name button 175.5 px, an arrow button 50.5 px and the gap between the two arrows (ARROW_GAP,
// one cell) 19 px, so each arrow must grow by (175.5 - 19) / 2 - 50.5 = 27.75 px, which is one character: an en space (half a
// character) on each side of the arrow.
const ARROW_PAD = '\u2002'
// the owner 2026-10-09 「一排卡片改顯示4個」: four cards to a row.
const CARDS_PER_ROW = 4
// the owner 2026-10-10 s33 「不是說好pane裡面的卡片都是一張一排要對齊嗎字變少的時候也要可以對齊」「直接幫卡片裡面的按鈕畫一個白外框，這樣是不是就會
// 強制一樣大了」: on a surface with pictures every card is CARD_CELLS wide, its name button in a frame of NAME_FRAME_CELLS (the 5.5-character
// button, 209 px in 1.png at 20 px a cell, and the frame's own lines), so a name of Latin letters (設定SS 225 px, Lab 213, against 251) no
// longer narrows its card; a picture row is a row of cards and its gaps. The terminal keeps its cards as wide as what they hold.
// s34, measured on the owner's lab (2.webp, 9.35 px a cell): every name was cut to one character (版 …, 目 …, 1.webp) for two reasons. A bordered
// Box given no padding is padded about 14.5 px a side by the desktop (the 11-cell frame left its button 72 px of 103), and a 5.5-character
// button is 103-104 px, a hair over 11 cells (a plain 11-cell room still cut it: 目 前 剩…). So the frame says paddingX 0 and holds a plain
// room of NAME_ROOM_CELLS round the button; the card's CARD_CELLS stand on a plain Box inside the card's border and padding.
const CARD_CELLS = 13
const NAME_ROOM_CELLS = 12
// a card is its 13 cells, 2 of padding and about 1 px of border a side; four of them and three gaps of a cell come to 63.8 cells
const rowCells = (perRow: number) => perRow * (CARD_CELLS + 2) + (perRow - 1) + 1
const CARD_ROW_CELLS = rowCells(CARDS_PER_ROW)
// Claude Design's pane design, step 1 (docs/design/pane-mocks-1013; the owner 2026-10-13 s37 「OK，用 64／32 開始做第 1 步」, 64 and 32 from the
// measured card, where the design said 63 and 31): on the desktop the panel is CARD_ROW_CELLS wide, or narrow two cards to a row (32 cells);
// the first row's items stand in columns as wide as a card's 15 cells, a cell apart.
const NARROW_PER_ROW = 2
const COLUMN_CELLS = CARD_CELLS + 2
// s39 (the owner 「寬版窄版這邊上下可以有點縫隙嗎貼著有點難看」, then B on gap-lab and 「可以」): AbovePrompt's switches' rows half a row apart
const SWITCH_ROW_GAP = 0.5
// the language list's last option, 新增語言… (Claude Design step 1): no language code can be this (hooks/lang CODE starts with letters)
const ADD_LANGUAGE = '+add'
// The 編輯 grid (s36, hooks/sortgrid.tsx keeps the same numbers): a card 15 cells wide (a card's 13 and its padding) and 3 rows high, its
// buttons in the 2 rows under it, a cell or a row apart, four to a row (narrow, two); one more row for the grid's line under the cards.
const gridCells = (perRow: number) => perRow * 15 + (perRow - 1)
const GRID_PITCH_ROWS = 3 + 2 + 1

const HEX: Record<Tone, string> = { success: '#3fb950', warning: '#d29922', error: '#f85149' }
const CIRCUMFERENCE = 2 * Math.PI * 29
// The ring is open at the bottom, 270 degrees of the 360 (the owner 2026-10-09 「有缺口」). Both circles are turned 135 degrees, so they
// start at the bottom left and run clockwise over the top to the bottom right; the dash is the visible part.
const SWEEP = 0.75 * CIRCUMFERENCE

// Full-width digits (１ ２ … １１) for the order number (the owner 2026-10-09 「字太貼左上角了用全形數字」): they carry their own space
// on both sides, so the number does not touch the corner of the card.
const fullWidth = (n: number) => [...String(n)].map(d => String.fromCharCode(0xff10 + Number(d))).join('')

// The number sits at the top left of a card. A Box takes whole cells only (one cell down is about 11 px, too far for the owner: 「太往下了」),
// so where there are pictures the number is a small SVG badge placed in pixels. The digit is as far from the top edge as from the left
// edge (the owner 2026-10-09 「與上方間距調成跟左方一樣」): NUMBER_MARGIN px from the edge to the ink of the digit, both ways. A text is placed
// by its box and its baseline, so the margin is turned into x and y with the metrics of a full-width digit at 14 px, measured with Noto
// Sans CJK: its ink starts 3.2 px in from its box and rises 10.4 px above the baseline. The colour is a fixed mid grey that reads on a
// light and on a dark background.
const NUMBER_MARGIN = 10
const DIGIT_BEARING = 3.2
const DIGIT_HEIGHT = 10.4
const NUMBER_X = NUMBER_MARGIN - DIGIT_BEARING
const NUMBER_Y = NUMBER_MARGIN + DIGIT_HEIGHT

function numberSvg(text: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="26" viewBox="0 0 40 26">' +
    `<text x="${NUMBER_X.toFixed(1)}" y="${NUMBER_Y.toFixed(1)}" font-family="-apple-system,system-ui,sans-serif" font-size="14" fill="#8a8a8a">${text}</text>` +
    '</svg>'
  )
}

// Values come from files (the journal, the branch), so they are escaped before they go into markup.
const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function dialSvg(text: string, arc: number | undefined, tone: Tone | undefined, isOn: boolean): string {
  const length = arc === undefined ? 0 : Math.min(SWEEP, Math.max(0, (SWEEP * arc) / 100))
  const colour = isOn ? HEX[tone ?? 'success'] : '#808080'
  const turn = 'stroke-width="8" stroke-linecap="round"'
  // a Chinese character is as wide as the font size, any other about 0.58 of it; the text must fit the 48 px disc
  const width = [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 1 : 0.58), 0)
  const size = Math.max(11, Math.min(16, Math.floor(40 / Math.max(width, 1))))

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">' +
    `<circle cx="36" cy="36" r="29" fill="none" stroke="#808080" stroke-opacity="0.28" ${turn} stroke-dasharray="${SWEEP.toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}" transform="rotate(135 36 36)"/>` +
    (length > 0
      ? `<circle cx="36" cy="36" r="29" fill="none" stroke="${colour}" ${turn} stroke-dasharray="${length.toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}" transform="rotate(135 36 36)"/>`
      : '') +
    '<circle cx="36" cy="36" r="24" fill="#262626"/>' +
    `<text x="36" y="${(36 + size * 0.36).toFixed(1)}" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="${size}" font-weight="600" fill="${isOn ? '#f2f2f2' : '#8a8a8a'}">${escapeXml(text)}</text>` +
    '</svg>'
  )
}

function blocks(percent: number): string {
  const filled = Math.min(10, Math.max(0, Math.round(percent / 10)))

  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

// 目前剩下 turns yellow under 30% left and red under 10%; 五小時 and 每週 turn yellow from 60% used and red from 85%.
const leftTone = (left: number): Tone => (left < 10 ? 'error' : left < 30 ? 'warning' : 'success')
const usedTone = (used: number): Tone => (used >= 85 ? 'error' : used >= 60 ? 'warning' : 'success')

function panelRow(key: string, tools: number, st: Settings): Row | null {
  const text = (label: string, value: string, extra: Partial<Row> = {}): Row => ({ label, value, dial: value, ...extra })
  const sw = st.cards.find(c => c.id === key && c.kind === 'switch')
  // a 開關卡 says 開 while lit, 關 while grey: what it sent last
  if (sw !== undefined) return text(sw.name, tr(st.off.includes(key) ? 'val.off' : 'val.on'))
  const pressable = st.cards.find(c => c.id === key && isPress(c))
  if (pressable !== undefined) return text(pressable.name, tr('val.button'))
  if (segment(key, tools, st) === null) return null
  if (!isKey(key)) {
    // an added card: its name on the button, the first four characters of its value in the dial (the whole value is on 預覽)
    const added = st.cards.find(c => c.id === key) as SlCard
    const first = added.kind === 'module' ? moduleLines(added, tools)[0] ?? '?' : ''
    const shown =
      added.kind === 'text'
        ? { value: added.text, dial: cut(added.text, 4) }
        : added.kind === 'module'
          ? { value: first, dial: cut(first, 4) }
          : cardValues[key] ?? { value: '?', dial: '?' }
    return text(added.name, shown.value === '' ? '—' : shown.value, { dial: shown.dial === '' ? '—' : shown.dial })
  }
  const percent = (label: string, value: number | undefined, tone: (n: number) => Tone): Row =>
    value === undefined
      ? text(label, '?')
      : text(label, `${Math.round(value)}%`, { bar: blocks(value), arc: value, tone: tone(value) })

  switch (key) {
    case 'ver':
      return text(tr('card.ver'), VERSION_NAME)
    case 'who':
      return text(tr('card.who'), facts.who ?? '?')
    case 'block':
      return text(tr('card.block'), facts.block ?? '?')
    case 'tools':
      return text(tr('card.tools'), tools >= 0 ? String(tools) : '?')
    case 'ctx':
      return percent(tr('card.ctx'), facts.left, leftTone)
    case '5h':
      return percent(tr('card.5h'), facts.h5, usedTone)
    case '7d':
      return percent(tr('card.7dShort'), facts.d7, usedTone)
    case 'score':
      return text(tr('card.score'), facts.score ?? '?')
    case 'pending':
      // above 0 the whole arc is yellow
      return text(tr('card.pending'), String(facts.pending ?? '?'), facts.pending ? { arc: 100, tone: 'warning' } : {})
    case 'branch':
      // the owner 2026-10-09: the card says 分支路徑, not the long name (every card is the same size); the name is on the 預覽 line when 分支 is on
      return text(tr('card.branch'), tr('card.branchValue'))
    case 'dirty':
      return text(tr('card.dirty'), String(facts.dirty ?? '?'))
    case 'ff': {
      const words = { done: tr('ff.done'), can: tr('ff.can'), cannot: tr('ff.cannot') }
      const tones: Record<string, Tone> = { done: 'success', can: 'warning', cannot: 'error' }
      const ff = facts.ff

      return {
        label: '',
        value: segment('ff', tools, st) ?? '',
        dial: ff === undefined ? '?' : words[ff],
        arc: ff === undefined ? undefined : 100,
        tone: ff === undefined ? undefined : tones[ff],
      }
    }
  }
}

function listing(tools: number, st: Settings) {
  const rows = st.order.filter(key => !st.removed.includes(key)).map(key => {
    const added = st.cards.find(c => c.id === key)
    const shown =
      added?.kind === 'switch'
        ? `${tr('kind.switch')} /${added.text}`
        : added?.kind === 'button'
          ? `${tr('kind.button')} ${added.text}`
          : added !== undefined && isPress(added)
            ? `${tr('kind.module')} ${added.text}`
            : segment(key, tools, st) ?? tr('list.none')
    return `${added ? `${key}（${added.name}）` : key}　${tr(st.off.includes(key) ? 'val.off' : 'val.on')}　${shown}`
  })

  return [
    tr('list.head'),
    ...rows,
    `note　${st.note || tr('list.noValue')}`,
    `icons　${tr(st.icons ? 'list.iconsOn' : 'list.iconsOff')}`,
    ...(problems.length > 0 ? [tr('pane.problems', { v: problems.join('；') })] : []),
    tr('list.commands'),
  ].join('\n')
}

// A press on a 開關卡 (the owner 2026-10-09 s28): sends the 關 command while the card is lit, the 開 one while it is grey, as another
// mod's command run by this one; the card turns only when the command went through.
async function flip($: EngineInterface, card: SlCard, isOn: boolean) {
  const args = (isOn ? card.offArgs : card.onArgs) ?? ''
  try {
    await $.command.run({ command: card.text, args })
  } catch (error) {
    const line = tr('send.notSent', { name: card.name, what: `/${card.text} ${args}`.trim(), reason: reason(error) })
    switchErrorCard = card.id
    const seq = ++switchErrorSeq
    await update($, switchErrorState, () => line)
    // only this failure's line: a newer one has its own 5 seconds
    $.clock.after(SWITCH_ERROR_MS, () => {
      if (seq === switchErrorSeq) void update($, switchErrorState, () => '')
    })
    return
  }
  await update($, switchErrorState, () => '')
  await change($, s => ({ ...s, off: isOn ? [...s.off, card.id] : s.off.filter(k => k !== card.id) }))
}

// The pomodoro worked by its word (s44, the owner 「蕃茄鐘現在做」), from a typed /ss pomo and from a 按鈕卡 sending it alike (s45, his
// 2.png: the engine runs this mod's own $.command.run past this mod's hooks, so the press calls this itself); answers its line.
async function pomoCommand($: EngineInterface, word: string): Promise<string> {
  const verbs: readonly PomoVerb[] = ['start', 'pause', 'reset', 'break']
  if (!verbs.includes(word as PomoVerb)) return tr('pomo.usage')
  let now = 0
  try {
    now = await $.clock.now()
  } catch {
    now = 0
  }
  const st = await read($, settingsState)
  const next = pomoNext(st.pomo ?? NO_POMO, word as PomoVerb, now)
  await change($, cur => ({ ...cur, pomo: next }))
  // s44 (his 7.webp: unanswered twice, answered the third time): the command answers first and the band is redrawn after,
  // as a press is — awaiting a read of every lit module here is what ran the hook past the engine's patience
  later($, readModules($))
  return `${tr(`pomo.state.${next.state}`)} ${clockText(pomoLeft(next, now))}`
}

// A press on a 按鈕卡 in the band above the prompt (the owner 2026-10-09 s28): a / command runs as that command (another mod's, like a
// 開關卡); anything else is sent as if the owner typed it, a turn of its own (--h then reads as his own --h).
async function send($: EngineInterface, card: SlCard) {
  if (card.kind === 'module') {
    await pressModule($, card)
    return
  }
  const text = card.text.trim()
  if (text.startsWith('!')) {
    await runOnHost($, card, text.slice(1).trim())
    return
  }
  if (!text.startsWith('/')) {
    await $.prompt.submit({ text, asUser: true })
    return
  }
  const [command = '', ...rest] = text.slice(1).split(/\s+/)
  if (command === 'ss' && rest.length === 0) {
    await $.ui.open({ id: PANEL_PANE, title: tr('pane.panelTitle'), focus: true, closeOnEscape: true })
    return
  }
  // this mod's own /ss reload, done here for the same reason (s33); from a button it reloads the plugins too
  if (command === 'ss' && rest.length === 1 && rest[0] === 'reload') {
    await reloadAll($)
    return
  }
  // and its /ss pomo, for the same reason (s45)
  if (command === 'ss' && rest[0] === 'pomo') {
    await pomoCommand($, rest[1] ?? '')
    return
  }
  try {
    await $.command.run({ command, args: rest.join(' ') })
  } catch (error) {
    switchErrorCard = card.id
    const seq = ++switchErrorSeq
    await update($, switchErrorState, () => tr('send.notSent', { name: card.name, what: text, reason: reason(error) }))
    $.clock.after(SWITCH_ERROR_MS, () => {
      if (seq === switchErrorSeq) void update($, switchErrorState, () => '')
    })
  }
}

// A press on a button module (the owner 2026-10-10 s33 「每個按鈕可以是模組」): what it names is read and run, then its press says what to do.
async function pressModule($: EngineInterface, card: SlCard) {
  const module = moduleOf(card.text)
  if (module?.press === undefined) {
    $.ui.toast(tr('send.noModule', { name: card.name, id: card.text }))
    return
  }
  const got = await gather($, module)
  let effect: ModuleEffect
  try {
    effect = module.press({ ...got, session: sessionFacts(await read($, toolCount)), t: tr })
  } catch (error) {
    $.ui.toast(tr('send.moduleError', { name: card.name, reason: reason(error) }))
    return
  }
  await perform($, card, effect)
}

async function perform($: EngineInterface, card: SlCard, effect: ModuleEffect) {
  switch (effect.kind) {
    case 'reload':
      await reloadAll($)
      return
    case 'panel':
      await $.ui.open({ id: PANEL_PANE, title: tr('pane.panelTitle'), focus: true, closeOnEscape: true })
      return
    case 'toast':
      $.ui.toast(effect.text)
      return
    case 'submit':
      await $.prompt.submit({ text: effect.text, asUser: true })
      return
  }
}

// A 按鈕卡 whose text starts with ! (the owner 2026-10-10 s33 「每個按鈕可以是…轉發執行命令」): the rest runs on the host, bash in the project, for
// at most HOST_COMMAND_MS; the last line it printed shows in a toast. Nothing is typed.
async function runOnHost($: EngineInterface, card: SlCard, command: string) {
  try {
    const ran = await $.process.run(['bash', '-c', command], { cwd, timeoutMs: HOST_COMMAND_MS })
    if (ran.exitCode !== 0) {
      $.ui.toast(tr('send.failed', { name: card.name, code: ran.exitCode }))
      return
    }
    const last = ran.stdout.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line !== '').pop()
    $.ui.toast(tr('send.output', { name: card.name, line: last ?? tr('val.noOutput') }))
  } catch (error) {
    $.ui.toast(tr('send.notRun', { name: card.name, reason: reason(error) }))
  }
}

// The 編輯 grid's Client element (s36), drawn on the desktop alone: the one surface with a Client that was measured. Its own
// function so that the plugin directory reads the element down to its fixed module (s45 review, MOD_IMPORT_DYNAMIC_COMPUTED:
// a Client taken through a cast, a conditional, or even `const { Client } = $.ui.resolve(e)` was refused): h('Client', …) is its own form.
function gridClient(e: ResolveInput, section: string, props: GridProps) {
  if (e.surface !== 'desktop') return undefined
  // the string tag is the form the directory names (a Client bound from the table, with or without a cast, it refused twice)
  return h('Client', {
    key: `grid-${section}`,
    module: './sortgrid.tsx',
    props,
    width: gridCells(props.perRow),
    height: Math.max(1, Math.ceil(props.cards.length / props.perRow)) * GRID_PITCH_ROWS + 1,
  })
}

// The panel of on/off buttons (the owner 2026-10-09), drawn with Box, Text and Button only, which every surface has, so phone
// and desktop share one drawing.
async function drawPanel($: EngineInterface, e: ResolveInput) {
  // The terminal cannot draw a picture (its Svg is only a stand-in), so the bars fall back to text blocks there.
  const { Box, Text, Button, Svg } = $.ui.resolve(e)
  const isTerminal = e.surface === 'terminal'
  // the language list where the surface has a Select (the phone has none)
  const { Select } = $.ui.resolve(e) as { Select?: never }
  // the 編輯 grid (s36) where the surface draws a Client region and it was measured: the desktop; elsewhere the arrows as before
  // the grid itself is gridClient()'s, where the Client element is written plainly for the plugin directory (s45 review)
  const isGrid = e.surface === 'desktop'
  await read($, readCountState)
  await read($, languageState)
  const langNote = await read($, langNoteState)
  const st = await read($, settingsState)
  // Claude Design step 1 (s37): the desktop's panel is a set width with its first row in columns, four cards to a row or, narrow, two; the
  // phone, VS Code and the terminal draw as before
  const isLaidOut = e.surface === 'desktop' && Select !== undefined
  const perRow = isLaidOut && st.narrow === true ? NARROW_PER_ROW : CARDS_PER_ROW
  const isNarrow = perRow === NARROW_PER_ROW
  // the panel's width in cells: four cards and their gaps (CARD_ROW_CELLS), narrow two
  const panelCells = isNarrow ? rowCells(NARROW_PER_ROW) : CARD_ROW_CELLS
  const tools = await read($, toolCount)
  const toggle = (key: string) => (s: Settings): Settings => ({
    ...s,
    off: s.off.includes(key) ? s.off.filter(k => k !== key) : [...s.off, key],
  })

  // the owner 2026-10-09 「高亮跟反灰」: no 開／關 words. An item that is on is lit (a primary button, a bright card
  // border), one that is off is greyed out (a secondary, dim button, a grey border). The button carries the item's name
  // and is the thing to press: a Button holds only a label, and a Box cannot be pressed, so the card itself cannot be.
  const button = (key: string, label: string, isOn: boolean, onPress: () => Promise<void>, isBuiltIn = false) => (
    <Button key={key} label={nameLabel(label, isBuiltIn)} variant={isOn ? 'primary' : 'secondary'} dimColor={!isOn} onPress={onPress} />
  )
  // the same for an interface word (排序 / Sort): an English word is kept whole
  // a button outside the cards (Claude Design step 2, s37): on the desktop one column wide, elsewhere as before
  const word = (label: string) => (isLaidOut ? columnLabel(label, isChinesePanel()) : ui(label))
  // lit while on: its label padded short enough for the bold a lit button draws (s38 6.webp)
  // s39 (the owner's 乙: 「窄版三顆按鈕用乙（照字寬、左右撐開）」, then 「下面層級的這些按鈕也可以這樣處理嗎」): narrow, a row of three buttons (the
  // first row's, 編輯 預設 新增卡片) stands at their own widths, spread edge to edge: their words unpadded (spread)
  const uiButton = (key: string, label: string, isOn: boolean, onPress: () => Promise<void>, spread = false) => (
    <Button
      key={key}
      label={isLaidOut ? (spread && isNarrow ? label : columnLabel(label, isChinesePanel(), true)) : ui(label)}
      variant={isOn ? 'primary' : 'secondary'}
      dimColor={!isOn}
      onPress={onPress}
    />
  )
  const spreadWord = (label: string) => (isLaidOut && isNarrow ? label : word(label))
  const spreadRow = (key: string, items: [string, unknown][]) => (
    <Box key={key} flexDirection="row" alignItems="center" width={panelCells} justifyContent="space-between">
      {items.map(([, item]) => item)}
    </Box>
  )
  // One rounded card per item (the owner 2026-10-09 「塊狀卡片式」), no frame around them all.
  const sorting = await read($, sortState)
  const touchSorting = await read($, touchSortState)
  // each size's menu (s30): its cards, in the order, and its 排序
  const sizeSorting: Record<SlSize, boolean> = {
    H1: touchSorting,
    H2: await read($, h2SortState),
    'H2-half': await read($, h2HalfSortState),
    'H2-full': await read($, h2FullSortState),
    H3: await read($, h3SortState),
    'H3-half': await read($, h3HalfSortState),
    'H3-full': await read($, h3FullSortState),
  }
  const sizeList = (size: SlSize) => st.aboveOrder.filter(k => groupOf(st, k) === size)
  const touchList = sizeList('H1')
  // a card's name as the band draws it (a 開關卡's with its mark)
  const bandNameOf = (key: string) => {
    const card = st.cards.find(c => c.id === key)
    return card === undefined ? key : bandName(st, card)
  }
  // at the AbovePrompt level only what no menu holds (a 開關卡 until s38, which made it H1's: none since)
  const aboveList = st.aboveOrder.filter(k => isAbove(st, k) && groupOf(st, k) === undefined)
  // Status Line's and TouchBar's 排序 each show the arrows, numbers and 刪除 under their own cards alone; AbovePrompt has none of its own (s30)
  const sortingFor = (key: string) => {
    const group = groupOf(st, key)
    return group !== undefined ? sizeSorting[group] : isAbove(st, key) ? false : sorting
  }
  // a deleted built-in card (s29) is not drawn and a move passes over it
  const statusList = st.order.filter(k => !st.removed.includes(k))
  const listFor = (key: string) => {
    const group = groupOf(st, key)
    return group !== undefined ? sizeList(group) : isAbove(st, key) ? aboveList : statusList
  }
  const deleting = await read($, deletingState)
  // 刪除 under an added card while sorting: the first press asks, the second removes it (its value, place and on/off go with it)
  // every card has one but 版本號 (the owner 2026-10-09 s29 「預設12張卡片也開放刪除按鈕 只有版本號不能刪」); a built-in card is put in removed,
  // an added one goes for good
  const remover = (key: string) => {
    if (!sortingFor(key) || key === 'ver') return undefined
    const isAsking = deleting === key
    return (
      <Box key={`delete-row-${key}`} marginTop={ARROW_GAP}>
        <Button
          key={`delete-${key}`}
          label={ui(tr(isAsking ? 'btn.confirmDelete' : 'btn.delete'))}
          variant="secondary"
          onPress={async () => {
            if (!isAsking) {
              await update($, deletingState, () => key)
              return
            }
            await update($, deletingState, () => '')
            await deleteCard($, key)
          }}
        />
      </Box>
    )
  }
  const switchError = await read($, switchErrorState)
  // The card's place in the order (the owner 2026-10-09 「卡片左上角顯示目前排序號碼」), only while 排序 is on (「數字改按排序才會出現」): a small dim number in its top left
  // corner, laid over the card without moving anything; the 符號 card is not in the order and has none.
  const card = (key: string, isOn: boolean, children: unknown) => {
    const place = listFor(key).indexOf(key)

    return (
      <Box key={`card-${key}`} position="relative" flexDirection="column" alignItems="center" borderStyle="round" borderColor={isOn ? 'text' : 'subtle'} paddingX={1}>
        {place >= 0 && sortingFor(key) && (
          <Box key={`number-${key}`} position="absolute" top={0} left={isTerminal ? 1 : 0}>
            {isTerminal ? (
              <Text dimColor>{fullWidth(place + 1)}</Text>
            ) : (
              <Svg source={withDay(numberSvg(fullWidth(place + 1)))} alt={fullWidth(place + 1)} width={40} height={26} />
            )}
          </Box>
        )}
        {isTerminal ? (
          children
        ) : (
          <Box key={`body-${key}`} width={CARD_CELLS} flexDirection="column" alignItems="center">
            {children}
          </Box>
        )}
      </Box>
    )
  }

  // the name button in its room, one row below the dial (s33 put a frame round it, white while lit and grey while off; the owner 2026-10-13 s36
  // 「按鈕裡面加的那個小白框拿掉」: no frame, the card's own border says lit or grey); the room keeps NAME_ROOM_CELLS so no name is cut
  const nameFrame = (key: string, _isOn: boolean, press: unknown) => (
    <Box key={`name-${key}`} marginTop={1}>
      <Box key={`name-room-${key}`} width={NAME_ROOM_CELLS} justifyContent="center">
        {press}
      </Box>
    </Box>
  )
  // What goes inside a card is one column that centres its items (the owner 2026-10-09 「內容的部分也置中對其」). A bare
  // fragment would become a column that does not, and the content would sit on the left of a wider card.
  const stack = (...items: unknown[]) => (
    <Box flexDirection="column" alignItems="center">
      {items}
    </Box>
  )
  const preview = lineText(tools, st) ?? tr('pane.allOff')
  // the owner 2026-10-09 (C): while sorting, ← → under every card swap it with its neighbour; the two ends can go no
  // further and are dim. The order is the status line's too.
  const arrows = (key: string) => {
    if (!sortingFor(key)) return undefined
    const list = listFor(key)
    const at = list.indexOf(key)
    const move = (delta: -1 | 1) => () =>
      change($, s =>
        isAbove(s, key)
          ? { ...s, aboveOrder: moveWithin(s.aboveOrder, key, delta, k => groupOf(s, k) === groupOf(s, key)) }
          : { ...s, order: moveWithin(s.order, key, delta, k => !s.removed.includes(k)) },
      )

    return (
      // the same one cell below the name as between the two arrows (the owner 2026-10-09 「間距要跟箭頭中間預設的一樣」)
      <Box key={`move-${key}`} flexDirection="row" gap={ARROW_GAP} marginTop={ARROW_GAP}>
        <Button key={`left-${key}`} label={ARROW_PAD + '←' + ARROW_PAD} dimColor={at <= 0} onPress={move(-1)} />
        <Button key={`right-${key}`} label={ARROW_PAD + '→' + ARROW_PAD} dimColor={at === list.length - 1} onPress={move(1)} />
      </Box>
    )
  }

  // One card, in either section.
  const cardFor = (key: string) => {
          const row = panelRow(key, tools, st)
          const isOn = !st.off.includes(key)
          if (row === null) {
            // nothing in this project for it: a grey dial that says so, and the same name button as every card, so the card keeps
            // every card's size and parts (the owner 2026-10-09 s29 「沒有內容的時候元素也不能跑位」; it was a dim name, 20 px narrower)
            const blank = button(`toggle-${key}`, nameOf(key as Key), isOn, () => change($, toggle(key)), true)
            return card(
              key,
              isOn,
              isTerminal
                ? stack(<Text dimColor>{tr('card.none')}</Text>, blank, arrows(key), remover(key))
                : stack(
                    <Svg source={withDay(dialSvg(tr('card.none'), undefined, undefined, false))} alt={`${nameOf(key as Key)} ${tr('card.none')}`} width={72} height={72} />,
                    nameFrame(key, isOn, blank),
                    arrows(key),
                    remover(key),
                  ),
            )
          }
          const name = row.label !== '' ? row.label : nameOf(key as Key)
          const sw = st.cards.find(c => c.id === key && c.kind === 'switch')
          // an AbovePrompt display card holds its size in the middle, as a button that goes H2 ↔ H3 (s28 on 按鈕卡; ruling 2026-10-10 s29: a
          // 按鈕卡 is always H1 and has none)
          const pressable = st.cards.find(c => c.id === key && isDisplay(c))
          const sizer = pressable && (
            <Button
              key={`size-${key}`}
              label={fixed(sizeOf(pressable))}
              variant="secondary"
              onPress={async () => {
                // a lit card moves only into a block with room (Claude Design step 5b, s38); an off card takes no place and moves
                const to = nextSize(sizeOf(pressable))
                if (isOn && isFullIn(st, to)) return void $.ui.toast(fullLine(to))
                await change($, s => ({ ...s, cards: s.cards.map(c => (c.id === key ? { ...c, size: nextSize(sizeOf(c)) } : c)) }))
              }}
            />
          )
          // and its name heads the card, so the size button reads as that button's (the owner 2026-10-09 s28)
          const head = pressable && (
            <Box key={`head-${key}`}>
              <Text weight="semibold">{pressable.name}</Text>
            </Box>
          )
          // an AbovePrompt card lights only in a block with room (Claude Design step 5b, s38): else a toast names the block; turning off always works
          const block = groupOf(st, key)
          const light = async () => (!isOn && block !== undefined && isFullIn(st, block) ? void $.ui.toast(fullLine(block)) : change($, toggle(key)))
          const press = button(`toggle-${key}`, name, isOn, () => (sw === undefined ? light() : flip($, sw, isOn)), isKey(key))

          // On a surface with pictures every card is one dial and the name under it (after one row of margin); the
          // terminal has no pictures, so its card is the value as text and the name.
          return card(
            key,
            isOn,
            isTerminal
              ? sizer
                ? stack(head, sizer, press, arrows(key), remover(key))
                : stack(
                  row.bar !== undefined ? (
                    <Text color={isOn ? row.tone : undefined} dimColor={!isOn}>
                      {row.bar}
                    </Text>
                  ) : undefined,
                  <Text weight={isOn ? 'semibold' : undefined} dimColor={!isOn} color={isOn ? row.tone : undefined}>
                    {row.value}
                  </Text>,
                  press,
                  arrows(key),
                  remover(key),
                )
              : stack(
                  head,
                  sizer ?? <Svg source={withDay(dialSvg(row.dial, row.arc, row.tone, isOn))} alt={`${name} ${row.dial}`} width={72} height={72} />,
                  nameFrame(key, isOn, press),
                  arrows(key),
                  remover(key),
                ),
          )
        }
  // Every card, in the order (the 符號 card last), stood four to a row.
  const everyCard = [
    ...statusList.map(cardFor),
    !st.removed.includes('icons') &&
    card(
          'icons',
          st.icons,
          isTerminal
            ? stack(
                <Text weight={st.icons ? 'semibold' : undefined} dimColor={!st.icons}>
                  {st.icons ? '◉ ★ ⎇ ✓' : tr('card.iconsWords')}
                </Text>,
                button('toggle-icons', tr('card.icons'), st.icons, () => change($, s => ({ ...s, icons: !s.icons })), true),
                remover('icons'),
              )
            : stack(
                <Svg source={withDay(dialSvg(st.icons ? '◉★⎇' : tr('card.iconsWords'), undefined, undefined, st.icons))} alt={`${tr('card.icons')} ${st.icons ? '◉★⎇' : tr('card.iconsWords')}`} width={72} height={72} />,
                nameFrame('icons', st.icons, button('toggle-icons', tr('card.icons'), st.icons, () => change($, s => ({ ...s, icons: !s.icons })), true)),
                remover('icons'),
              ),
        ),
  ].filter(Boolean)
  // A section's grid while its 編輯 is on (s36): the cards in its order (符號 last, not moved), each with its place, its name as the panel
  // names it, whether it is lit, and what may be done to it (版本號 is never deleted; only a card the owner added is renamed).
  const gridWords = {
    delete: ui(tr('btn.delete')),
    confirm: ui(tr('btn.confirmDelete')),
    builtIn: tr('grid.builtIn'),
    nameLong: tr('add.err.nameLong', { max: lang.rules.nameMax }),
    nameEmpty: tr('grid.nameEmpty'),
    fixed: tr('grid.fixed'),
  }
  const gridName = (key: string) => {
    const added = st.cards.find(c => c.id === key)
    if (added !== undefined) return added.name
    if (key === 'icons') return tr('card.icons')
    const row = panelRow(key, tools, st)
    return row !== null && row.label !== '' ? row.label : nameOf(key as Key)
  }
  // Claude Design step 7 (s38): 版本號 first and fixed (固定 under it, not moved), the others numbered after it; a hint over the grid
  const grid = (section: GridSection, list: readonly string[]) => {
    const keys = [...list.filter(k => k === 'ver'), ...list.filter(k => k !== 'ver')]
    const fixedCount = keys.filter(k => k === 'ver').length
    const movable = keys.filter(k => k !== 'icons' && k !== 'ver')
    const cards = keys.map(k => ({
      key: k,
      name: gridName(k),
      place: k === 'ver' ? 1 : k === 'icons' ? 0 : fixedCount + movable.indexOf(k) + 1,
      isOn: k === 'icons' ? st.icons : !st.off.includes(k),
      canMove: k !== 'icons' && k !== 'ver',
      canDelete: k !== 'ver',
      canRename: st.cards.some(c => c.id === k),
      isFixed: k === 'ver',
    }))
    return (
      <Box key={`grid-${section}-part`} flexDirection="column">
        <Text dimColor>{tr('grid.hint')}</Text>
        {gridClient(e, section, { cards, nameMax: lang.rules.nameMax, words: gridWords, perRow })}
        {movable.length === 0 && <Text dimColor>{tr('empty.grid')}</Text>}
      </Box>
    )
  }
  const toRows = (items: unknown[]) => Array.from({ length: Math.ceil(items.length / perRow) }, (_, i) => items.slice(i * perRow, (i + 1) * perRow))
  // Claude Design steps 1 and 2 (s37): a row of the desktop panel's things in its columns, one a column, a cell apart, as many rows as it
  // takes; right: each row pushed to the right by empty columns (編輯 預設 新增卡片: wide in the last three, narrow [編輯][預設] / [ ][新增卡片])
  // rows: how far apart its rows stand (s39: AbovePrompt's switches half a row, the owner's B on gap-lab, 14.webp 5-6 px; the rest touching)
  const inColumns = (key: string, items: [string, unknown][], right: boolean, rows = 0) => (
    <Box key={key} flexDirection="column" {...(rows > 0 ? { gap: rows } : {})}>
      {(toRows(items) as [string, unknown][][]).map((row, i) => (
        <Box key={`${key}-${i}`} flexDirection="row" alignItems="center" gap={1}>
          {[...(right ? Array.from({ length: perRow - row.length }, (_, j): [string, unknown] => [`empty-${j}`, undefined]) : []), ...row].map(([k, item]) => (
            <Box key={`${key}-${i}-${k}`} width={COLUMN_CELLS}>
              {item}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
  const rows = toRows(everyCard)
  const aboveRows = toRows(aboveList.map(cardFor))
  // TouchBar's buttons that are on, as the band numbers them
  const touchLabels = touchList.filter(k => takesPlace(st, k)).map((k, i) => numbered(i + 1, bandNameOf(k)))
  const defaultListOf = (size: SlSize) => aboveDefault(st.cards).filter(k => groupOf(st, k) === size)
  // the owner 2026-10-10 s33 「最右邊對其上方快轉卡片的右側」: a picture row is as wide as a row of four cards (CARD_ROW_CELLS), its name on the left
  // and its picture at the right end, so the picture ends where the fourth card ends; a menu's indent is inside that width, so all four end
  // at the Status Line's 快轉 card, as ruled (s34 tried the menus' own cards, 2 cells further: against the ruling). The terminal has none.
  const pictureRow = (key: string, left: unknown, picture: unknown, indent: number) =>
    isTerminal ? (
      <Box key={key} flexDirection="row" gap={2} paddingLeft={indent}>
        {left}
        {picture}
      </Box>
    ) : (
      <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" width={panelCells} paddingLeft={indent}>
        {left}
        {picture}
      </Box>
    )
  const namesOf = (size: SlSize) => sizeList(size).filter(k => !st.off.includes(k)).map(k => st.cards.find(c => c.id === k)?.name ?? k)
  const brackets = (labels: string[]) => labels.map(l => `[${l}]`).join(' ')
  // beside each menu's name (s33): showchart three boxes, showinfo five, TouchBar the buttons (moved from AbovePrompt's header)
  const menuPicture = (size: SlSize) => {
    const { key, name } = MENU[size]
    if (size === 'H1') {
      if (touchLabels.length === 0) return undefined
      return (
        <Box key={`${key}-band`}>
          {isTerminal ? (
            <Text>{brackets(touchLabels)}</Text>
          ) : (
            <Svg source={withDay(bandPictureSvg(touchLabels))} alt={`${name} ${touchLabels.join(' ')}`} width={BAND_PICTURE_WIDTH} height={BAND_PICTURE_HEIGHT} />
          )}
        </Box>
      )
    }
    const names = namesOf(size)
    const slots = TILES[size].perRow
    // Claude Design step 8 (s38, 「收合的空選單右邊留空」): a menu with no card draws no picture on the desktop
    if (isLaidOut && sizeList(size).length === 0) return undefined
    return (
      <Box key={`${key}-band`}>
        {isTerminal ? (
          <Text>{brackets(names)}</Text>
        ) : (
          <Svg
            source={withDay(tilesSvg(names, slots, st.aboveOff.includes(BLOCK_OF[size])))}
            alt={`${name} ${names.join(' ')}`.trim()}
            width={BAND_PICTURE_WIDTH}
            height={TILES_PICTURE_HEIGHT}
          />
        )}
      </Box>
    )
  }
  // A menu under AbovePrompt for one size's 按鈕卡 (H3 is TouchBar, keys touch-*; H1 and H2 keys h1-* h2-*): its fold, 排序 預設 新增卡片, cards
  // named after their switches (「H2 菜單 showinfo」「H1 菜單 showchart」, renumbered by the ruling of 2026-10-10: showchart holds H3)
  // s34: seven, as the band stacks them; TouchBar named touchbar (「改成全小寫」)
  type Fold = 'touchCollapsed' | 'h3Collapsed' | 'h2Collapsed' | 'h3HalfCollapsed' | 'h3FullCollapsed' | 'h2HalfCollapsed' | 'h2FullCollapsed'
  const MENU: Record<SlSize, { key: string; name: string; collapsed: Fold }> = {
    'H3-full': { key: 'h3full', name: 'showchart-full', collapsed: 'h3FullCollapsed' },
    'H3-half': { key: 'h3half', name: 'showchart-half', collapsed: 'h3HalfCollapsed' },
    H3: { key: 'h3', name: 'showchart', collapsed: 'h3Collapsed' },
    'H2-full': { key: 'h2full', name: 'showinfo-full', collapsed: 'h2FullCollapsed' },
    'H2-half': { key: 'h2half', name: 'showinfo-half', collapsed: 'h2HalfCollapsed' },
    H2: { key: 'h2', name: 'showinfo', collapsed: 'h2Collapsed' },
    H1: { key: 'touch', name: 'touchbar', collapsed: 'touchCollapsed' },
  }
  // each atom named where it is written: the state library lists what a module reads and writes from the call sites
  const flipSorting = async (size: SlSize) => {
    if (size === 'H3') await update($, h3SortState, v => !v)
    else if (size === 'H3-half') await update($, h3HalfSortState, v => !v)
    else if (size === 'H3-full') await update($, h3FullSortState, v => !v)
    else if (size === 'H2') await update($, h2SortState, v => !v)
    else if (size === 'H2-half') await update($, h2HalfSortState, v => !v)
    else if (size === 'H2-full') await update($, h2FullSortState, v => !v)
    else await update($, touchSortState, v => !v)
  }
  const menu = (size: SlSize) => {
    const { key, name, collapsed } = MENU[size]
    const list = sizeList(size)
    const tools: [string, unknown][] = [
      [
        'sort',
        uiButton(`${key}-sort`, tr('btn.sort'), sizeSorting[size], async () => {
          await update($, deletingState, () => '')
          await flipSorting(size)
        }, true),
      ],
      [
        'default-order',
        <Button
          key={`${key}-default-order`}
          label={spreadWord(tr('btn.default'))}
          variant="secondary"
          dimColor={list.join() === defaultListOf(size).join()}
          onPress={() =>
            change($, s => ({ ...s, aboveOrder: withGroupOrder(s.aboveOrder, k => groupOf(s, k) === size, aboveDefault(s.cards).filter(k => groupOf(s, k) === size)) }))
          }
        />,
      ],
      [
        'add-card',
        // the pane opens on this menu's block (Claude Design step 5, s38), at its first kind: 按鈕卡 for TouchBar, 文字卡 for the others
        <Button
          key={`${key}-add-card`}
          label={spreadWord(tr('btn.addCard'))}
          variant="secondary"
          onPress={async () => {
            await update($, draftState, () => ({ ...EMPTY_DRAFT, section: 'above' as const, kind: kindsOf('above', size)[0] as SlCardKind, size }))
            await $.ui.open({ id: ADD_PANE, title: tr('pane.addTitle'), focus: true, closeOnEscape: true })
          }}
        />,
      ],
    ]
    return (
      <Box key={key} flexDirection="column" gap={1}>
        {/* narrow, the picture stands under the header, from the left (Claude Design step 4, s37) */}
        <Box key={`${key}-top`} flexDirection="column">
          {pictureRow(
            `${key}-header`,
            <Box key={`${key}-name`} flexDirection="row" gap={1}>
              <Button key={`${key}-fold`} label={st[collapsed] ? '▶' : '▼'} variant="secondary" onPress={() => change($, s => ({ ...s, [collapsed]: !s[collapsed] }))} />
              <Text weight="semibold">{name}</Text>
            </Box>,
            isNarrow ? undefined : menuPicture(size),
            2,
          )}
          {isNarrow && menuPicture(size)}
        </Box>
        {/* on the desktop the menu's three buttons stand in the panel's columns, out of the menu's indent (Claude Design step 2, s37) */}
        {!st[collapsed] && isLaidOut && (isNarrow ? spreadRow(`${key}-tools-row`, tools) : inColumns(`${key}-tools-row`, tools, true))}
        {!st[collapsed] && (
        <Box key={`${key}-cards`} flexDirection="column" alignSelf="flex-start" marginLeft={isLaidOut ? 0 : 2} gap={1}>
          {!isLaidOut && (
          <Box key={`${key}-tools-row`} flexDirection="row" justifyContent="flex-end" gap={1}>
            {tools.map(([, item]) => item)}
          </Box>
          )}
          {sizeSorting[size] && isGrid
            ? grid(size, list)
            : toRows(list.map(cardFor)).map((cardsInRow, i) => (
                <Box key={`${key}-row-${i}`} flexDirection="row" gap={1}>
                  {cardsInRow}
                </Box>
              ))}
          {/* Claude Design step 8 (s38): a menu with no card says so and how many it holds */}
          {isLaidOut && list.length === 0 && (
            <Box key={`${key}-empty`}>
              <Text dimColor>{tr('empty.menu', { menu: name, n: placesOf(size) })}</Text>
            </Box>
          )}
        </Box>
        )}
      </Box>
    )
  }
  const previewBlocks: PreviewBlock[] = DISPLAY_SIZES.map(size => ({ size, names: namesOf(size) })).filter(b => b.size === 'H3' || b.size === 'H2' || b.names.length > 0)
  const bandSmall = bandPreview(previewBlocks, touchLabels, st.aboveOff)
  // the desktop's (Claude Design step 4): the blocks shown that hold cards, and the buttons that are on unless their row is folded
  const laidBlocks: PreviewBlock[] = DISPLAY_SIZES.filter(size => !st.aboveOff.includes(BLOCK_OF[size])).map(size => ({ size, names: namesOf(size) })).filter(b => b.names.length > 0)
  const touchNames = touchList.filter(k => takesPlace(st, k)).map(bandNameOf)
  const laidButtons = touchNames.length > 0 && !st.aboveOff.includes('touch') ? touchNames.slice(0, BAND_SLOTS) : undefined
  const laid = isLaidOut ? laidPreview(laidBlocks, laidButtons, isNarrow ? PREVIEW_NARROW_PX : PREVIEW_PX, isNarrow) : undefined
  // the text cards' line; with buttons on, the picture under the header says the rest
  const abovePreview = aboveText(tools, st) ?? (st.aboveOrder.length === 0 ? tr('pane.noCards') : touchLabels.length > 0 ? '' : tr('pane.allOff'))

  // the owner 2026-10-10 s33 「你可以做個重新加載的按鈕在pane嗎」: the panel's first row, 重新載入 on its right; s36 Profile before it
  const profileButton = <Button key="profile" label={spreadWord(tr('btn.profile'))} variant="secondary" onPress={() => openProfiles($)} />
  const reloadButton = <Button key="panel-reload" label={spreadWord(tr('btn.reload'))} variant="secondary" onPress={() => reloadAll($)} />
  // Claude Design step 1 (s37): on the desktop the first row heads the panel from the left, a column each: the language list (no label;
  // its last option 新增語言… reads the folder, then the list is drawn again on the language in use), the switch to the other width (named
  // after it), Profile, 重新載入; narrow, two by two, the rows touching
  const firstRow: [string, unknown][] = isLaidOut
    ? [
        [
          'language',
          <Select
            key="language"
            options={[...languages.map(l => ({ value: l.code, label: l.name })), { value: ADD_LANGUAGE, label: `${tr('btn.addLanguage')}…` }]}
            value={lang.code}
            onSelect={(code: string) => {
              void (code === ADD_LANGUAGE ? addLanguage($) : pickLanguage($, code))
            }}
          />,
        ],
        [
          'panel-layout',
          <Button
            key="panel-layout"
            label={spreadWord(tr(st.narrow === true ? 'btn.wide' : 'btn.narrow'))}
            variant="secondary"
            onPress={() => change($, s => (s.narrow === true ? { ...s, narrow: undefined } : { ...s, narrow: true }))}
          />,
        ],
        ['profile', profileButton],
        ['panel-reload', reloadButton],
      ]
    : []

  // Claude Design step 3 (s37, the owner 「OK，照設計的順序開始第 3 步」): on the desktop each of AbovePrompt's switches is its system name (never
  // translated) and a button one column wide, 顯示 lit while its block shows, 隱藏 grey while folded; in the band's order, top to bottom, as
  // the menus (replacing s34's three rows there), two pairs a row, narrow one
  const flipBlock = (block: AboveBlock) => () =>
    change($, s => ({ ...s, aboveOff: s.aboveOff.includes(block) ? s.aboveOff.filter(b => b !== block) : [...s.aboveOff, block] }))
  const aboveSwitches: [string, unknown][] = STACK.map(size => BLOCK_OF[size]).flatMap((block): [string, unknown][] => {
    const isShown = !st.aboveOff.includes(block)
    return [
      [`name-${block}`, <Text>{BLOCK_LABEL[block]}</Text>],
      [
        `show-${block}`,
        <Button
          key={`above-show-${block}`}
          label={word(tr(isShown ? 'btn.shown' : 'btn.hidden'))}
          variant={isShown ? 'primary' : 'secondary'}
          dimColor={!isShown}
          onPress={flipBlock(block)}
        />,
      ],
    ]
  })
  // s41 (the owner 「…可以在pane做個打勾按鈕 讓我選 A或B這樣嗎？」, 「go」): under AbovePrompt's switches, how the touchbar pages: A ‹ › (the default)
  // or B n/N, the chosen one lit with ✓; on the desktop in the panel's columns (narrow: the name and A, B under A), elsewhere one row
  const isCounterPaging = st.paging === 'counter'
  const pickPaging = (counter: boolean) => () =>
    change($, s => {
      const { paging: _paging, ...rest } = s
      return counter ? { ...rest, paging: 'counter' as const } : rest
    })
  const pagingButton = (key: string, label: string, isOn: boolean, counter: boolean) => (
    <Button
      key={key}
      label={isLaidOut ? columnLabel(`${isOn ? '✓ ' : ''}${label}`, isChinesePanel(), isOn) : ui(`${isOn ? '✓ ' : ''}${label}`)}
      variant={isOn ? 'primary' : 'secondary'}
      dimColor={!isOn}
      onPress={pickPaging(counter)}
    />
  )
  // version D (s43): one more switch under the blocks' — each card says how often it is read. Off unless he turns it on.
  const isShowEvery = st.showEvery === true
  const everyName: [string, unknown] = ['every-name', <Text>{tr('pane.showEvery')}</Text>]
  const everySwitch: [string, unknown] = [
    'show-every',
    <Button
      key="above-every"
      label={word(tr(isShowEvery ? 'btn.shown' : 'btn.hidden'))}
      variant={isShowEvery ? 'primary' : 'secondary'}
      dimColor={!isShowEvery}
      onPress={() => change($, s => (s.showEvery === true ? { ...s, showEvery: undefined } : { ...s, showEvery: true }))}
    />,
  ]
  const pagingName: [string, unknown] = ['paging-name', <Text>{tr('pane.paging')}</Text>]
  const pagingA: [string, unknown] = ['paging-arrows', pagingButton('paging-arrows', tr('paging.arrows'), !isCounterPaging, false)]
  const pagingB: [string, unknown] = ['paging-counter', pagingButton('paging-counter', tr('paging.counter'), isCounterPaging, true)]
  // Claude Design step 8 (s38): 版本號 alone in Status Line (every other card and 符號 deleted): a line beside its card says 預設 brings them
  // back; narrow, under it
  const onlyVersion = isLaidOut && statusList.every(k => k === 'ver') && st.removed.includes('icons')
  const versionAlone = (
    <Box key="sl-empty" width={isNarrow ? panelCells : panelCells - COLUMN_CELLS - 1}>
      <Text dimColor>{tr('empty.sl')}</Text>
    </Box>
  )
  const statusTools: [string, unknown][] = [
    [
      'sort',
      uiButton('sort', tr('btn.sort'), sorting, async () => {
        await update($, deletingState, () => '')
        await update($, sortState, v => !v)
      }, true),
    ],
    [
      'default-order',
      // the owner 2026-10-09: back to the default order, nothing else; dim while it already is the default
      <Button
        key="default-order"
        label={spreadWord(tr('btn.default'))}
        variant="secondary"
        dimColor={st.order.join() === defaultOrder(st.cards).join() && st.removed.length === 0}
        onPress={() => change($, s => ({ ...s, order: defaultOrder(s.cards), removed: [] }))}
      />,
    ],
    [
      'add-card',
      // the owner 2026-10-09 s28: opens the 新增卡片 pane on the right (option 3)
      <Button
        key="add-card"
        label={spreadWord(tr('btn.addCard'))}
        variant="secondary"
        onPress={async () => {
          await update($, draftState, () => ({ ...EMPTY_DRAFT, section: 'status' as const }))
          await $.ui.open({ id: ADD_PANE, title: tr('pane.addTitle'), focus: true, closeOnEscape: true })
        }}
      />,
    ],
  ]

  return (
    <Box flexDirection="column" gap={1} {...(isLaidOut ? { width: panelCells } : {})}>
      {isLaidOut ? (
        isNarrow ? (
          // narrow (s39, 乙): the language list alone in its column, then the three buttons spread on the next row
          <Box key="panel-tools" flexDirection="column">
            <Box key="panel-tools-0" flexDirection="row" alignItems="center" gap={1}>
              <Box key="panel-tools-0-language" width={COLUMN_CELLS}>
                {firstRow[0]?.[1]}
              </Box>
            </Box>
            {spreadRow('panel-tools-buttons', firstRow.slice(1))}
          </Box>
        ) : (
          inColumns('panel-tools', firstRow, false)
        )
      ) : (
      <Box key="panel-tools" flexDirection="row" justifyContent="flex-end">
        {Select !== undefined && (
        <Select
          key="language"
          label={tr('lang.label')}
          options={languages.map(l => ({ value: l.code, label: l.name }))}
          value={lang.code}
          onSelect={(code: string) => {
            void pickLanguage($, code)
          }}
        />
        )}
        <Button key="add-language" label={ui(tr('btn.addLanguage'))} variant="secondary" onPress={() => scanLanguages($, true)} />
        {/* s36: the Profile pane, beside the other buttons that work the whole panel */}
        {profileButton}
        {reloadButton}
      </Box>
      )}
      {langNote !== '' && <Text dimColor>{langNote}</Text>}
      {modNote !== '' && <Text dimColor>{modNote}</Text>}
      {/* the owner 2026-10-09 s28: the section name with a small arrow that folds the cards away (remembered), then the status line as
          it reads now (預覽, moved up here in place of the 狀態列 sentence) */}
      <Box key="header" flexDirection="row" gap={2}>
        <Box flexDirection="row" gap={1}>
          <Button key="fold" label={st.collapsed ? '▶' : '▼'} variant="secondary" onPress={() => change($, s => ({ ...s, collapsed: !s.collapsed }))} />
          <Text weight="semibold">StatusLine</Text>
          <Text>{preview}</Text>
        </Box>
      </Box>
      {!st.collapsed && (
      <Box key="cards" flexDirection="column" alignSelf="flex-start" gap={1}>
        {/* the owner 2026-10-09 s28: the three buttons in the folding part, pushed right: the cards part is only as wide as its widest row,
            so 新增卡片 ends where the fourth card (目前剩下 by default) ends; not named card-…, which means a card */}
        {/* the desktop's stand in the panel's columns, right-aligned (Claude Design step 2, s37) */}
        {isLaidOut ? (
          isNarrow ? spreadRow('tools-row', statusTools) : inColumns('tools-row', statusTools, true)
        ) : (
          <Box key="tools-row" flexDirection="row" justifyContent="flex-end" gap={1}>
            {statusTools.map(([, item]) => item)}
          </Box>
        )}
        {sorting && isGrid
          ? grid('status', [...statusList, ...(st.removed.includes('icons') ? [] : ['icons'])])
          : rows.map((cardsInRow, i) => (
              <Box key={`row-${i}`} flexDirection="row" gap={1}>
                {cardsInRow}
                {onlyVersion && !isNarrow && i === 0 && versionAlone}
              </Box>
            ))}
        {!(sorting && isGrid) && onlyVersion && isNarrow && versionAlone}
      </Box>
      )}
      {/* the owner 2026-10-09 s28: the AbovePrompt section, Status Line's equal: its own fold, switches (s30) and cards; what is on in it shows in the
          band above the prompt */}
      {/* the owner 2026-10-10 s33 「AP 旁邊這邊畫個Aboveprompt 的縮小版 prieview 把現在的顯示替代」: beside the name, the band made small (its text
          line and the TouchBar picture of s29 gone from here; the TouchBar picture is beside TouchBar now); kept when folded, as Status Line
          keeps its preview. The terminal has no pictures: the text line as before. An Svg takes no key: the Box holds it. */}
      {pictureRow(
        'above-header',
        <Box key="above-name" flexDirection="row" gap={1}>
          <Button key="above-fold" label={st.aboveCollapsed ? '▶' : '▼'} variant="secondary" onPress={() => change($, s => ({ ...s, aboveCollapsed: !s.aboveCollapsed }))} />
          <Text weight="semibold">AbovePrompt</Text>
          {isTerminal && abovePreview !== '' && <Text>{abovePreview}</Text>}
        </Box>,
        isTerminal || isLaidOut ? undefined : (
          <Box key="above-preview">
            <Svg source={withDay(bandSmall.source)} alt={`AbovePrompt：${[...previewBlocks.map(b => b.names.join(' ')), touchLabels.join(' ')].join('｜')}`} width={BAND_PICTURE_WIDTH} height={bandSmall.height} />
          </Box>
        ),
        0,
      )}
      {/* Claude Design step 4 (s37): on the desktop the picture is a row of its own under the header; with no card, a line says so */}
      {isLaidOut && (laid !== undefined || st.aboveOrder.length === 0) && (
        <Box key="above-preview">
          {laid !== undefined ? (
            <Svg source={withDay(laid.source)} alt={`AbovePrompt：${[...laidBlocks.map(b => b.names.join(' ')), ...(laidButtons !== undefined ? [laidButtons.map((n, i) => numbered(i + 1, n)).join(' ')] : [])].join('｜')}`} width={isNarrow ? PREVIEW_NARROW_PX : PREVIEW_PX} height={laid.height} />
          ) : (
            <Text dimColor>{tr('pane.noCards')}</Text>
          )}
        </Box>
      )}
      {!st.aboveCollapsed && (
      <Box key="above-cards" flexDirection="column" alignSelf="flex-start" gap={1}>
        {isLaidOut ? (
          <Box key="above-switches" flexDirection="column" gap={SWITCH_ROW_GAP}>
            {inColumns('above-tools-row', aboveSwitches, false, SWITCH_ROW_GAP)}
            {inColumns('above-paging-row', isNarrow ? [pagingName, pagingA, ['paging-empty', undefined], pagingB] : [pagingName, pagingA, pagingB], false, SWITCH_ROW_GAP)}
            {inColumns('above-every-row', [everyName, everySwitch], false, SWITCH_ROW_GAP)}
          </Box>
        ) : (
        <Box key="above-tools-row" flexDirection="column" gap={1}>
          {SWITCH_ROWS.map((row, i) => (
            <Box key={`above-switch-row-${i}`} flexDirection="row" gap={1}>
              {row.map(block => (
                <Box key={`above-switch-${block}`} width={SWITCH_CELLS} justifyContent="center">
                  {button(`above-show-${block}`, padded(BLOCK_LABEL[block], SWITCH_EM, SWITCH_LABEL_EM[block]), !st.aboveOff.includes(block), flipBlock(block))}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
        )}
        {!isLaidOut && (
          <Box key="above-paging-row" flexDirection="row" gap={1} alignItems="center">
            <Text>{tr('pane.paging')}</Text>
            {pagingA[1]}
            {pagingB[1]}
          </Box>
        )}
        {!isLaidOut && (
          <Box key="above-every-row" flexDirection="row" gap={1} alignItems="center">
            <Text>{tr('pane.showEvery')}</Text>
            {everySwitch[1] as never}
          </Box>
        )}
        {aboveRows.map((cardsInRow, i) => (
          <Box key={`above-row-${i}`} flexDirection="row" gap={1}>
            {cardsInRow}
          </Box>
        ))}
      </Box>
      )}
      {/* the owner 2026-10-09 s29: TouchBar, AbovePrompt's first layer (the bottom of the band), a second level here with its own fold,
          排序 預設 新增卡片 and the 按鈕卡, indented under AbovePrompt and folded away with it. s30 「SS 裡面新增幾個同級菜單跟 touchbar
          一樣的」: an H1 and an H2 menu beside it, the same, in the band's order */}
      {!st.aboveCollapsed && STACK.map(size => menu(size))}
      {switchError !== '' && <Text color="warning">{switchError}</Text>}
      {problems.length > 0 && <Text dimColor>{tr('pane.problems', { v: problems.join('；') })}</Text>}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await loadSettings($)
    await loadLanguage($)
    await registerSs($)
    await registerCardTools($)
    // a 開關卡's yellow line is in $.state, which a reload keeps, but its 5 s timer and its card were the old module's: clear it
    // (the owner 2026-10-09 s28 「這邊還是沒有消失」)
    await update($, switchErrorState, () => '')
    await seed($)
    await refresh($)
    await render($)
    arm($)

    return next(e)
  })

  // Observes the rows the session stores and hands each one on unchanged.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId === undefined && e.message.type === 'assistant') {
      const calls = e.message.content.filter(block => block.type === 'tool_use').length
      if (calls > 0) await update($, toolCount, count => Math.max(count, 0) + calls)
      await ensure($)
      facts = { ...facts, ...(await readUsage($, false)) }
      await render($)
    }

    return stored
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await refresh($)
      await render($)
    }

    return done
  })

  // What a 編輯 grid did (s36): a move, a delete or a rename, checked against its section, then kept; the panel's redraw hands the grid its
  // cards again. A post from any other region is not this hook's.
  on('ui.message', async ($, e, next) => {
    const section = gridSection(e.element)
    if (section === undefined) return next(e)
    await ensure($)
    await gridPost($, section, (e.data ?? {}) as GridPost)
    return {}
  })

  // The /ss reply row, drawn by the mod so the engine's "superstatus:" in front does not show (the stored text keeps it).
  // A reply with arguments is plain text; bare /ss is the panel (rows from before s30, and where no pane can be placed).
  on('ui.render', { component: 'CommandOutput', props: { command: 'ss' } }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    await ensure($)

    if (e.props.args.trim() !== '') {
      const lines = e.props.text.replace(new RegExp(`^${NAME}:\\s*`), '').split('\n')

      return (
        <Box flexDirection="column">
          {lines.map(line => (
            <Text>{line}</Text>
          ))}
        </Box>
      )
    }

    return drawPanel($, e)
  })

  // The same panel in the pane a 按鈕卡 sending /ss opens.
  on('ui.render', { component: 'Pane', requestId: PANEL_PANE }, async ($, e) => {
    await ensure($)

    return drawPanel($, e)
  })

  // The Profile pane (s36): a name and 存檔 on top, the line saying what the last press did, one row per profile (its name, cards and time,
  // 載入 and 刪除; under the one 載入 asks about, the cards in it that run things), the files refused, then the folder and 重新整理.
  // Claude Design step 6 (s38, the design's screen 3 and its decided list): on the desktop in the panel's columns: the name field two columns
  // wide (no label of its own: a label column before it), Save in the fourth, the hint under them; each profile its name two columns wide,
  // its cards and time under it, Load and Delete in the third and fourth columns; Load asks in a box (the cards that run things in three
  // columns, the look saved as before-load first, Yes, load and Cancel), Delete under its row (Yes, delete and Cancel); the folder's path in
  // a field beside Refresh, the export and import lines under it; narrow, a field's label above it and its button under it.
  on('ui.render', { component: 'Pane', requestId: PROFILE_PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e) as ReturnType<typeof $.ui.resolve> & { Input?: never }
    await read($, languageState)
    const pf = await read($, profilesState)
    const st = await read($, settingsState)
    const asking = (what: string, file: string) => pf.asking === `${what}:${file}`
    const nameInput = (label: string | undefined) => (
      <Input
        key="profile-name"
        label={label}
        placeholder={tr('profile.namePlaceholder')}
        value={pf.name}
        onInput={(value: string) => {
          void update($, profilesState, p => ({ ...p, name: value, asking: p.asking.startsWith('save:') ? '' : p.asking, note: '' }))
        }}
        onSubmit={() => {
          void saveProfile($)
        }}
      />
    )
    const saveLabel = tr(pf.asking.startsWith('save:') ? 'profile.confirmSave' : 'profile.save')
    const notes = (
      <>
        {pf.note !== '' && <Text dimColor>{pf.note}</Text>}
        {pf.error !== '' && <Text color="warning">{pf.error}</Text>}
      </>
    )

    if (e.surface !== 'desktop' || Input === undefined) {
      return (
        <Box flexDirection="column" gap={1}>
          <Box key="profile-new" flexDirection="row" gap={1}>
            {Input !== undefined && nameInput(tr('profile.nameLabel'))}
            <Button key="profile-save" label={ui(saveLabel)} variant="secondary" onPress={() => saveProfile($)} />
          </Box>
          {notes}
          {pf.error === '' && pf.rows.length === 0 && <Text dimColor>{tr('profile.none')}</Text>}
          {pf.rows.map((row, i) => (
            <Box key={`profile-row-${i}`} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text weight="semibold">{row.name}</Text>
                <Text dimColor>{tr('profile.meta', { n: row.cards, saved: row.saved })}</Text>
                <Button key={`profile-load-${i}`} label={ui(tr(asking('load', row.file) ? 'profile.confirmLoad' : 'profile.load'))} variant="secondary" onPress={() => loadProfile($, i)} />
                <Button key={`profile-delete-${i}`} label={ui(tr(asking('delete', row.file) ? 'btn.confirmDelete' : 'btn.delete'))} variant="secondary" onPress={() => deleteProfile($, i)} />
              </Box>
              {asking('load', row.file) && (
                <Box flexDirection="column">
                  <Text color={row.runs.length > 0 ? 'warning' : undefined}>{tr(row.runs.length > 0 ? 'profile.runs' : 'profile.runsNone')}</Text>
                  {row.runs.map(run => (
                    <Text dimColor>{tr(`profile.run.${run.how}`, { name: run.name, text: run.text })}</Text>
                  ))}
                </Box>
              )}
            </Box>
          ))}
          {pf.refused.map(line => (
            <Text dimColor>{line}</Text>
          ))}
          <Box key="profile-folder" flexDirection="row" gap={1}>
            {pf.dir !== '' && <Text dimColor>{tr('profile.folder', { dir: pf.dir })}</Text>}
            <Button key="profile-refresh" label={ui(tr('profile.refresh'))} variant="secondary" onPress={() => scanProfiles($)} />
          </Box>
        </Box>
      )
    }

    // the desktop: in the panel's columns, four or (narrow) two
    const isNarrow = st.narrow === true
    const panelCells = isNarrow ? rowCells(NARROW_PER_ROW) : CARD_ROW_CELLS
    const fieldCells = 2 * COLUMN_CELLS + 1
    const word = (label: string) => columnLabel(label, isChinesePanel())
    const cell = (key: string, width: number, item: unknown) => (
      <Box key={key} width={width}>
        {item}
      </Box>
    )
    const cancel = () => update($, profilesState, p => ({ ...p, asking: '' }))
    // a label column, a field two columns wide and a button in the fourth; narrow, the label above the field and the button under it, second
    const fieldRow = (key: string, label: string, field: unknown, button: unknown) =>
      isNarrow ? (
        <Box key={key} flexDirection="column">
          {cell(`${key}-label`, fieldCells, <Text dimColor>{label}</Text>)}
          {cell(`${key}-field`, fieldCells, field)}
          <Box key={`${key}-under`} flexDirection="row" gap={1}>
            {cell(`${key}-blank`, COLUMN_CELLS, undefined)}
            {cell(`${key}-button`, COLUMN_CELLS, button)}
          </Box>
        </Box>
      ) : (
        <Box key={key} flexDirection="row" gap={1}>
          {cell(`${key}-label`, COLUMN_CELLS, <Text dimColor>{label}</Text>)}
          {cell(`${key}-field`, fieldCells, field)}
          {cell(`${key}-button`, COLUMN_CELLS, button)}
        </Box>
      )
    // two buttons in the last two columns (wide, after two empty ones; narrow, the two there are): pushed to the panel's edge they stood a
    // cell right of the columns, the panel being a cell wider than its four (s38 5.png)
    const rightPair = (key: string, first: unknown, second: unknown) => (
      <Box key={key} flexDirection="row" gap={1}>
        {!isNarrow && cell(`${key}-blank-1`, COLUMN_CELLS, undefined)}
        {!isNarrow && cell(`${key}-blank-2`, COLUMN_CELLS, undefined)}
        {cell(`${key}-1`, COLUMN_CELLS, first)}
        {cell(`${key}-2`, COLUMN_CELLS, second)}
      </Box>
    )
    const cancelButton = <Button key="profile-cancel" label={word(tr('add.cancel'))} variant="secondary" onPress={cancel} />
    const yesDelete = (i: number) => <Button key="profile-yes-delete" label={word(tr('profile.confirmDelete'))} variant="primary" onPress={() => deleteProfile($, i)} />
    const kindOfRun = (how: string) => tr(`kind.${how === 'command' ? 'command' : how === 'switch' ? 'switch' : 'button'}`)
    const runText = (run: { how: string; text: string }) => (run.how === 'host' ? `!${run.text}` : run.text)
    const row = (r: (typeof pf.rows)[number], i: number) => {
      const isLoading = asking('load', r.file)
      const isDeleting = asking('delete', r.file)
      const load = <Button key={`profile-load-${i}`} label={word(tr('profile.load'))} variant={isLoading ? 'primary' : 'secondary'} onPress={() => loadProfile($, i)} />
      const remove = <Button key={`profile-delete-${i}`} label={word(tr('btn.delete'))} variant={isDeleting ? 'primary' : 'secondary'} onPress={() => deleteProfile($, i)} />
      return (
        <Box key={`profile-row-${i}`} flexDirection="column">
          <Box key={`profile-row-${i}-top`} flexDirection="row" gap={1}>
            {cell(`profile-row-${i}-name`, fieldCells, <Text weight="semibold">{r.name}</Text>)}
            {!isNarrow && cell(`profile-row-${i}-load`, COLUMN_CELLS, load)}
            {!isNarrow && cell(`profile-row-${i}-delete`, COLUMN_CELLS, remove)}
          </Box>
          <Box key={`profile-row-${i}-meta`} width={fieldCells}>
            <Text dimColor>{tr('profile.meta', { n: r.cards, saved: r.saved })}</Text>
          </Box>
          {isNarrow && (
            <Box key={`profile-row-${i}-buttons`} flexDirection="row" gap={1}>
              {cell(`profile-row-${i}-load`, COLUMN_CELLS, load)}
              {cell(`profile-row-${i}-delete`, COLUMN_CELLS, remove)}
            </Box>
          )}
          {isLoading && (
            <Box key={`profile-confirm-${i}`} flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} width={panelCells}>
              <Text color={r.runs.length > 0 ? 'warning' : undefined}>{tr(r.runs.length > 0 ? 'profile.runs' : 'profile.runsNone')}</Text>
              {r.runs.map((run, j) =>
                isNarrow ? (
                  <Box key={`profile-run-${i}-${j}`}>
                    <Text>{`${run.name} · ${runText(run)}`}</Text>
                  </Box>
                ) : (
                  <Box key={`profile-run-${i}-${j}`} flexDirection="row" gap={1}>
                    {cell(`profile-run-${i}-${j}-kind`, 13, <Text>{kindOfRun(run.how)}</Text>)}
                    {cell(`profile-run-${i}-${j}-name`, 15, <Text>{run.name}</Text>)}
                    {cell(`profile-run-${i}-${j}-text`, 29, <Text>{runText(run)}</Text>)}
                  </Box>
                ),
              )}
              <Text dimColor>{tr('profile.beforeNote', { before: tr('profile.beforeLoad') })}</Text>
            </Box>
          )}
          {isLoading &&
            rightPair(
              `profile-confirm-${i}-buttons`,
              <Button key="profile-yes-load" label={word(tr('profile.confirmLoad'))} variant="primary" onPress={() => loadProfile($, i)} />,
              cancelButton,
            )}
          {isDeleting && (
            // wide one row: the question in the first two columns, its buttons in the third and fourth; narrow, the buttons under it
            <Box key={`profile-delete-${i}-ask`} flexDirection={isNarrow ? 'column' : 'row'} gap={isNarrow ? 0 : 1}>
              {cell(`profile-delete-${i}-note`, fieldCells, <Text color="error">{tr('profile.deleteAsk', { file: r.file })}</Text>)}
              {isNarrow ? (
                <Box key={`profile-delete-${i}-buttons`} flexDirection="row" gap={1}>
                  {cell(`profile-delete-${i}-yes`, COLUMN_CELLS, yesDelete(i))}
                  {cell(`profile-delete-${i}-cancel`, COLUMN_CELLS, cancelButton)}
                </Box>
              ) : (
                [cell(`profile-delete-${i}-yes`, COLUMN_CELLS, yesDelete(i)), cell(`profile-delete-${i}-cancel`, COLUMN_CELLS, cancelButton)]
              )}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} width={panelCells}>
        {fieldRow('profile-new', tr('profile.nameLabel'), nameInput(undefined), <Button key="profile-save" label={word(saveLabel)} variant="secondary" onPress={() => saveProfile($)} />)}
        <Box key="profile-hint" width={panelCells}>
          <Text dimColor>{tr('profile.hint', { max: PROFILE_NAME_MAX, confirm: tr('profile.confirmSave') })}</Text>
        </Box>
        {notes}
        <Box key="profile-head" flexDirection="row" gap={1}>
          {cell('profile-head-name', COLUMN_CELLS, <Text weight="semibold">{tr('profile.listHead')}</Text>)}
          {cell('profile-head-count', COLUMN_CELLS, <Text dimColor>{tr(pf.rows.length === 1 ? 'profile.count1' : 'profile.count', { n: pf.rows.length })}</Text>)}
        </Box>
        {pf.error === '' && pf.rows.length === 0 && <Text dimColor>{tr('profile.none')}</Text>}
        {pf.rows.map(row)}
        {pf.refused.map(line => (
          <Text dimColor>{line}</Text>
        ))}
        {fieldRow(
          'profile-folder',
          tr('profile.folderLabel'),
          pf.dir !== '' ? <Input key="profile-dir" value={pf.dir} onSubmit={() => undefined} /> : undefined,
          <Button key="profile-refresh" label={word(tr('profile.refresh'))} variant="secondary" onPress={() => scanProfiles($)} />,
        )}
        {/* the field shows what its own width holds (s38 5.png): the whole path on a line under it (the owner 「好，加那行完整路徑」) */}
        {pf.dir !== '' && (
          <Box key="profile-dir-full" width={panelCells}>
            <Text dimColor>{pf.dir}</Text>
          </Box>
        )}
        <Box key="profile-io" flexDirection="column" width={panelCells}>
          <Text dimColor>{tr('profile.export')}</Text>
          <Text dimColor>{tr('profile.import')}</Text>
        </Box>
      </Box>
    )
  })

  // The 新增卡片 pane (the owner 2026-10-09 s28, option 3 「我先看看怎麼顯示」; 「全加」: four kinds): the kind, a name, and the field
  // the kind needs; 加入 checks them, adds the card lit, reads its value and closes the pane. Claude Design step 5 (s38, the owner 「1–4 照建議」):
  // AbovePrompt's is a block's (the menu's Add card opens it): on the desktop the seven block tabs and fold rows, one block open, its places
  // drawn, Place, the form in the panel's columns and the block's places under it; elsewhere the form as before. Either way the block offers
  // its kinds, a full block (its lit cards fill its places) adds nothing, and a card goes to the place picked. Status Line's is as before.
  on('ui.render', { component: 'Pane', requestId: ADD_PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Select, Svg } = $.ui.resolve(e) as ReturnType<typeof $.ui.resolve> & {
      Input: never
      Select: never
      Svg?: never
    }
    await read($, languageState)
    const draft = await read($, draftState)
    const st = await read($, settingsState)
    const close = () => $.ui.close({ id: ADD_PANE })
    const keep = (field: 'name' | 'text' | 'prefix' | 'offArgs') => (value: string) => {
      void update($, draftState, d => ({ ...d, [field]: value, error: '' }))
    }
    const isAbove = draft.section === 'above'
    // AbovePrompt's open block, its lit cards, its places, whether they are all taken, and the place picked (the next free one at first)
    const block = isAbove ? draft.size : undefined
    const lit = block !== undefined ? litIn(st, block) : []
    const places = block !== undefined ? placesOf(block) : 0
    const isFull = block !== undefined && isFullIn(st, block)
    const picked = isFull ? undefined : Math.min(Math.max(Number(draft.place) || lit.length + 1, 1), lit.length + 1)
    const nameIn = (key: string) => st.cards.find(c => c.id === key)?.name ?? key
    const add = async () => {
      const now = await read($, draftState)
      const into = now.section === 'above' ? now.size : undefined
      if (now.section === 'above') {
        // no block open, or a full one (its standing line says why): a dim Add still fires (a Button has no disabled, the types), so it is refused here
        if (into === undefined || isFullIn(await read($, settingsState), into)) return
      }
      const wrong = draftProblem(now)
      if (wrong !== '') {
        await update($, draftState, d => ({ ...d, error: wrong }))
        return
      }
      // the newer store first, as change() does, so the new card joins it (s33)
      await adopt($)
      await update($, settingsState, s => withCard(s, now, into).settings)
      await readCards($)
      await change($, s => s)
      await update($, draftState, () => EMPTY_DRAFT)
      await close()
    }
    const cancel = async () => {
      await update($, draftState, () => EMPTY_DRAFT)
      await close()
    }
    const field = {
      text: { label: tr('add.f.text'), placeholder: tr('add.f.textPh') },
      countdown: { label: tr('add.f.countdown'), placeholder: '2027-08-27' },
      file: { label: tr('add.f.file'), placeholder: 'MEMORY.md' },
      command: { label: tr('add.f.command'), placeholder: 'df -h / | tail -1' },
      switch: { label: tr('add.f.switch'), placeholder: 'probe' },
      button: { label: tr('add.f.button'), placeholder: tr('add.f.buttonPh') },
      module: { label: tr('add.f.module'), placeholder: '' },
    }[draft.kind]
    const pickedModule = draft.kind === 'module' ? moduleOf(draft.text) : undefined
    const kindOptions = kindsOf(draft.section, draft.size).map(value => ({ value, label: tr(`kind.${value}`) }))
    const pickKind = (value: string) => {
      // a 模組卡 starts on the first module offered here; a kind that takes no rhythm drops the one picked, so it cannot be carried in unseen
      void update($, draftState, d => ({
        ...d,
        kind: value as SlCardKind,
        error: '',
        ...(value === 'module' ? { text: modulesFor(d)[0]?.id ?? '' } : {}),
        ...(TAKES_RHYTHM.includes(value as SlCardKind) ? {} : { every: undefined }),
      }))
    }
    // s44 (the owner 「節奏做成乙（打勾按鈕）」): the 節奏 row. 預設 is first and is where every card starts, so he never has to pick
    // one (his product-logic ruling, s43); the picked word is lit with ✓, as the touchbar's A / B row is (s41).
    const pickEvery = (name: Rhythm | undefined) => () =>
      void update($, draftState, d => ({ ...d, every: name, error: '' }))
    const everyButton = (name: Rhythm | undefined, label: string): [string, unknown] => {
      const isOn = draft.every === name
      const key = `add-every-${name ?? 'default'}`
      // a lit button draws its label bold and wider, so its room is asked for in the state it is drawn in (s38)
      return [key, <Button key={key} label={columnLabel(`${isOn ? '✓ ' : ''}${label}`, isChinesePanel(), isOn)} variant={isOn ? 'primary' : 'secondary'} dimColor={!isOn} onPress={pickEvery(name)} />]
    }
    // the name and the five words in the panel's own columns; narrow, they fall to the next row as the tabs do
    const everyRow = () => {
      const items: [string, unknown][] = [
        ['add-every-name', <Text>{tr('add.every')}</Text>],
        everyButton(undefined, tr('rhythm.default')),
        ...RHYTHMS.map(name => everyButton(name, tr(`rhythm.${name}`))),
      ]
      const rows = Array.from({ length: Math.ceil(items.length / perRow) }, (_, i) => items.slice(i * perRow, (i + 1) * perRow))
      return (
        <Box key="add-row-every" flexDirection="column" gap={SWITCH_ROW_GAP}>
          {rows.map((row, i) => (
            <Box key={`add-row-every-${i}`} flexDirection="row" alignItems="center" gap={1}>
              {row.map(([k, item]) => (
                <Box key={`add-every-box-${k}`} width={COLUMN_CELLS}>
                  {item}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )
    }
    const moduleOptions = modulesFor(draft).map(m => ({ value: m.id, label: tr('add.moduleOption', { group: tr(`mod.group.${m.group}`, undefined, m.group), name: moduleName(m), about: tr(`mod.${m.id}.about`, undefined, m.about) }) }))
    const pickModule = (value: string) => {
      void update($, draftState, d => ({ ...d, text: value, error: '' }))
    }
    const namePlaceholder = tr(draft.kind === 'module' ? 'add.namePhModule' : 'add.namePh', { max: lang.rules.nameMax })
    // the lines under the fields: what the card will run, how a 開關卡 works, a 指令卡's warning, what is wrong
    const notes: [string, string, 'warning' | undefined][] = [
      ...(pickedModule !== undefined && (pickedModule.runs ?? []).length > 0
        ? [['add-warn-module', tr('add.warnModule', { cmds: [...new Set((pickedModule.runs ?? []).map(argv => argv[0]))].join('、'), when: tr(pickedModule.role === 'tile' ? 'add.warnModuleTile' : 'add.warnModuleButton') }), 'warning'] as [string, string, 'warning']]
        : []),
      ...(draft.kind === 'button' && draft.text.trim().startsWith('!') ? [['add-warn-bang', tr('add.warnBang'), 'warning'] as [string, string, 'warning']] : []),
      ...(draft.kind === 'switch' ? [['add-switch-help', tr('add.switchHelp'), undefined] as [string, string, undefined]] : []),
      ...(draft.kind === 'command' ? [['add-warn-command', tr('add.commandWarn'), 'warning'] as [string, string, 'warning']] : []),
      ...(draft.error !== '' ? [['add-error', draft.error, 'warning'] as [string, string, 'warning']] : []),
    ]
    const fullNote = block !== undefined && isFull ? fullLine(block) : undefined

    if (!(e.surface === 'desktop' && Svg !== undefined)) {
      // the form as before away from the desktop (s39: Status Line's too), with the block's kinds and its full line
      return (
        <Box flexDirection="column" gap={1}>
          <Select key="add-kind" label={tr('add.kind')} options={kindOptions} value={draft.kind} onSelect={pickKind} />
          {draft.kind === 'module' && <Select key="add-module" label={tr('add.module')} options={moduleOptions} value={draft.text} onSelect={pickModule} />}
          <Input key="add-name" label={tr('add.name')} placeholder={namePlaceholder} value={draft.name} onInput={keep('name')} onSubmit={keep('name')} />
          {draft.kind !== 'module' && <Input key="add-text" label={field.label} placeholder={field.placeholder} value={draft.text} onInput={keep('text')} onSubmit={keep('text')} />}
          {draft.kind === 'file' && <Input key="add-prefix" label={tr('add.prefix')} placeholder="current_milestone:" value={draft.prefix} onInput={keep('prefix')} onSubmit={keep('prefix')} />}
          {draft.kind === 'switch' && <Input key="add-prefix" label={tr('add.on')} placeholder={tr('add.onPh')} value={draft.prefix} onInput={keep('prefix')} onSubmit={keep('prefix')} />}
          {draft.kind === 'switch' && <Input key="add-off" label={tr('add.off')} placeholder="off" value={draft.offArgs} onInput={keep('offArgs')} onSubmit={keep('offArgs')} />}
          {fullNote !== undefined && <Text color="error">{fullNote}</Text>}
          {notes.map(([, text, colour]) => (colour === undefined ? <Text dimColor>{text}</Text> : <Text color={colour}>{text}</Text>))}
          <Box flexDirection="row" gap={1}>
            <Button key="add-ok" label={ui(tr('add.ok'))} variant="primary" dimColor={isFull} onPress={add} />
            <Button key="add-cancel" label={ui(tr('add.cancel'))} variant="secondary" onPress={cancel} />
          </Box>
        </Box>
      )
    }

    // the desktop: in the panel's columns (Claude Design step 5's screen 2), four to a row or, narrow, two
    const isNarrow = st.narrow === true
    const perRow = isNarrow ? NARROW_PER_ROW : CARDS_PER_ROW
    const panelCells = isNarrow ? rowCells(NARROW_PER_ROW) : CARD_ROW_CELLS
    // a field two columns wide (31 cells), its label a column of its own: the field draws no label of its own (the types: label is optional)
    const fieldCells = 2 * COLUMN_CELLS + 1
    const word = (label: string) => columnLabel(label, isChinesePanel())
    // a tab or a closed fold opens its block at its first kind, the place back to the next free one; the open block's fold closes it
    const openBlock = (id: SlSize) =>
      update($, draftState, d => ({ ...d, section: 'above' as const, size: id, place: undefined, error: '', kind: kindsOf('above', id)[0] as SlCardKind, text: d.kind === 'module' ? '' : d.text }))
    const fold = (id: SlSize) => (id === block ? update($, draftState, d => ({ ...d, size: undefined, place: undefined, error: '' })) : openBlock(id))
    const tab = (id: SlSize) => (
      <Button key={`add-tab-${id}`} label={word(id)} variant={isAbove && id === block ? 'primary' : 'secondary'} dimColor={!(isAbove && id === block)} onPress={() => openBlock(id)} />
    )
    // s39 (the owner 「StatusLine的新增卡片應該也要到這個Pane裡面吧」, the four points and 「可以」): Status Line's tab first; it opens Status Line's
    // form (every kind, no place, no block's list) under the tabs, the seven fold rows closed under it
    const openStatus = () =>
      update($, draftState, d => ({ ...d, section: 'status' as const, size: undefined, place: undefined, error: '', kind: kindsOf('status')[0] as SlCardKind, text: d.kind === 'module' ? '' : d.text }))
    const statusTab = (
      <Button key="add-tab-StatusLine" label={word('StatusLine')} variant={isAbove ? 'secondary' : 'primary'} dimColor={isAbove} onPress={openStatus} />
    )
    // wide: StatusLine H1 H2 H2-half, then H2-full H3 H3-half H3-full; narrow, two by two (s39 「這個字可以刪掉了」: the one-block note gone)
    const tabItems: [string, unknown][] = [['StatusLine', statusTab], ...BLOCKS.map((id): [string, unknown] => [id, tab(id)])]
    const tabRows = isNarrow
      ? Array.from({ length: Math.ceil(tabItems.length / perRow) }, (_, i) => tabItems.slice(i * perRow, (i + 1) * perRow))
      : [tabItems.slice(0, 4), tabItems.slice(4)]
    const foldRow = (id: SlSize) => {
      const pic = blockSvg(id, litIn(st, id).map(nameIn), id === block ? picked : undefined)
      const left = (
        <Box key={`add-fold-left-${id}`} flexDirection="row" alignItems="center" gap={1}>
          <Box key={`add-fold-box-${id}`} width={4}>
            <Button key={`add-fold-${id}`} label={id === block ? '▼' : '▶'} variant="secondary" onPress={() => fold(id)} />
          </Box>
          <Box key={`add-id-${id}`} width={9}>
            <Text weight="semibold">{id}</Text>
          </Box>
          <Box key={`add-menu-${id}`} width={15}>
            <Text dimColor>{MENU_NAME[id]}</Text>
          </Box>
        </Box>
      )
      const picture = (
        <Box key={`add-pic-${id}`}>
          <Svg source={withDay(pic.source)} alt={pic.alt} width={BLOCK_PICTURE_PX} height={TILES_PICTURE_HEIGHT} />
        </Box>
      )
      return isNarrow ? (
        <Box key={`add-fold-row-${id}`} flexDirection="column">
          {left}
          {picture}
        </Box>
      ) : (
        <Box key={`add-fold-row-${id}`} flexDirection="row" justifyContent="space-between" alignItems="center" width={panelCells}>
          {left}
          {picture}
        </Box>
      )
    }
    const labelBox = (key: string, label: string, width: number) => (
      <Box key={key} width={width}>
        <Text dimColor>{label}</Text>
      </Box>
    )
    // a list: its label in the first column, the list in the second (wide: a module list the second and third)
    const selectRow = (key: string, label: string, select: unknown, cells: number = COLUMN_CELLS) => (
      <Box key={key} flexDirection="row" gap={1}>
        {labelBox(`${key}-label`, label, COLUMN_CELLS)}
        <Box key={`${key}-field`} width={isNarrow ? COLUMN_CELLS : cells}>
          {select}
        </Box>
      </Box>
    )
    // a field: its label in the first column and the field in the next two; narrow, the label on the line above (the design's)
    const inputRow = (key: string, label: string, input: unknown) => (
      <Box key={key} flexDirection={isNarrow ? 'column' : 'row'} gap={isNarrow ? 0 : 1}>
        {labelBox(`${key}-label`, label, isNarrow ? fieldCells : COLUMN_CELLS)}
        <Box key={`${key}-field`} width={fieldCells}>
          {input}
        </Box>
      </Box>
    )
    const line = (key: string, text: string, colour: 'warning' | 'error' | undefined) => (
      <Box key={key} width={panelCells}>
        {colour === undefined ? <Text dimColor>{text}</Text> : <Text color={colour}>{text}</Text>}
      </Box>
    )
    // under the form, the block's places: up to six a row each, its card or (empty); past six one row for the rest
    const LIST_ROWS = 6
    const listPart = (id: SlSize) => {
      const names = lit.map(nameIn)
      const rows: [string, string, boolean][] = Array.from({ length: Math.min(places, LIST_ROWS) }, (_, i) => [placeName(id, i + 1), names[i] ?? tr('add.empty'), names[i] === undefined])
      const more: [string, string, boolean] | undefined =
        places > LIST_ROWS
          ? [`${id}-${LIST_ROWS + 1}…${places}`, names.length > LIST_ROWS ? tr('add.more', { n: names.length - LIST_ROWS }) : tr('add.empty'), names.length <= LIST_ROWS]
          : undefined
      const row = (key: string, [place, name, isEmpty]: [string, string, boolean]) => (
        <Box key={key} flexDirection="row" gap={1}>
          {labelBox(`${key}-place`, place, COLUMN_CELLS)}
          <Box key={`${key}-card`} width={panelCells - COLUMN_CELLS - 1}>
            {isEmpty ? <Text dimColor>{name}</Text> : <Text>{name}</Text>}
          </Box>
        </Box>
      )
      return (
        <Box key="add-occ-part" flexDirection="column">
          <Text weight="semibold">{tr('add.inBlock')}</Text>
          {names.length === 0 ? (
            line('add-occ-none', tr(places === 1 ? 'add.blockEmpty1' : 'add.blockEmpty', { n: places }), undefined)
          ) : (
            <Box key="add-occ" flexDirection="column">
              {rows.map((r, i) => row(`add-occ-${i}`, r))}
              {more !== undefined && row('add-occ-more', more)}
            </Box>
          )}
        </Box>
      )
    }
    const placeOptions = isFull
      ? [{ value: '', label: tr('add.placeNone') }]
      : Array.from({ length: lit.length + 1 }, (_, i) => ({ value: String(i + 1), label: placeName(block as SlSize, i + 1) }))
    // the fields and buttons a card is made with: a block's form puts its place above them and its list under them; Status Line's has neither
    const fields = [
      selectRow('add-row-kind', tr('add.kind'), <Select key="add-kind" options={kindOptions} value={draft.kind} onSelect={pickKind} />),
      ...(draft.kind === 'module' ? [selectRow('add-row-module', tr('add.module'), <Select key="add-module" options={moduleOptions} value={draft.text} onSelect={pickModule} />, fieldCells)] : []),
      inputRow('add-row-name', tr('add.name'), <Input key="add-name" placeholder={namePlaceholder} value={draft.name} onInput={keep('name')} onSubmit={keep('name')} />),
      ...(draft.kind !== 'module'
        ? [inputRow('add-row-text', field.label, <Input key="add-text" placeholder={field.placeholder} value={draft.text} onInput={keep('text')} onSubmit={keep('text')} />)]
        : []),
      ...(draft.kind === 'file'
        ? [inputRow('add-row-prefix', tr('add.prefix'), <Input key="add-prefix" placeholder="current_milestone:" value={draft.prefix} onInput={keep('prefix')} onSubmit={keep('prefix')} />)]
        : []),
      ...(draft.kind === 'switch'
        ? [
            inputRow('add-row-prefix', tr('add.on'), <Input key="add-prefix" placeholder={tr('add.onPh')} value={draft.prefix} onInput={keep('prefix')} onSubmit={keep('prefix')} />),
            inputRow('add-row-off', tr('add.off'), <Input key="add-off" placeholder="off" value={draft.offArgs} onInput={keep('offArgs')} onSubmit={keep('offArgs')} />),
          ]
        : []),
      ...(TAKES_RHYTHM.includes(draft.kind) ? [everyRow()] : []),
      ...(fullNote !== undefined ? [line('add-full', fullNote, 'error')] : []),
      ...notes.map(([key, text, colour]) => line(key, text, colour)),
      <Box key="add-buttons" flexDirection="row" gap={1}>
        <Box key="add-ok-box" width={COLUMN_CELLS}>
          <Button key="add-ok" label={word(tr('add.ok'))} variant="primary" dimColor={isFull} onPress={add} />
        </Box>
        <Box key="add-cancel-box" width={COLUMN_CELLS}>
          <Button key="add-cancel" label={word(tr('add.cancel'))} variant="secondary" onPress={cancel} />
        </Box>
      </Box>,
    ]
    const form = (id: SlSize) => [
      selectRow(
        'add-row-place',
        tr('add.place'),
        <Select key="add-place" options={placeOptions} value={picked === undefined ? '' : String(picked)} onSelect={(value: string) => void update($, draftState, d => ({ ...d, place: value || undefined, error: '' }))} />,
      ),
      ...fields,
      listPart(id),
    ]

    return (
      <Box flexDirection="column" gap={1} width={panelCells}>
        {/* s39 (「這裡的間隔沒有改到」): the tabs' rows half a row apart, as the switches' */}
        <Box key="add-tabs" flexDirection="column" gap={SWITCH_ROW_GAP}>
          {tabRows.map((row, i) => (
            <Box key={`add-tabs-${i}`} flexDirection="row" gap={1}>
              {row.map(([k, item]) => (
                <Box key={`add-tab-box-${k}`} width={COLUMN_CELLS}>
                  {item}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
        {!isAbove && fields}
        {BLOCKS.flatMap(id => (isAbove && id === block ? [foldRow(id), ...form(id)] : [foldRow(id)]))}
      </Box>
    )
  })

  // The band above the prompt (the owner 2026-10-09 s28): the AbovePrompt section's cards that are on; nothing on, or a survey up, and
  // the band is left to what is beneath.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await ensure($)
    await read($, readCountState)
    await read($, languageState)
    const st = await read($, settingsState)
    const tools = await read($, toolCount)
    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    // a chart needs a surface that draws pictures (the terminal's Svg is a stand-in)
    const drawsPictures = e.surface !== 'terminal'
    // in the section's order (ruling 2026-10-10 s29): the 按鈕卡 stand in the H1 row at the bottom (no frame: 「你把說明的白框拿掉」; 4.5 characters
    // wide: 「把寬度縮小到可以放12個」); every other card (a display) in a tile of H2 or H3 above it; a 開關卡 is drawn in neither. A region
    // folded away by its switch is not drawn (TouchBar: the button row; showinfo: H2; showchart: H3, 「showchart 不能關閉H1」 then renumbered).
    const pressables: SlCard[] = []
    const displays: SlCard[] = []
    for (const key of st.aboveOrder) {
      // a 開關卡 is drawn on or off (s38): the others only lit
      if (!takesPlace(st, key)) continue
      const card = st.cards.find(c => c.id === key)
      if (card === undefined || st.aboveOff.includes(BLOCK_OF[sizeOf(card)])) continue
      if (isPress(card) || card.kind === 'switch') pressables.push(card)
      else if (segment(key, tools, st) !== null) displays.push(card)
    }
    if (displays.length === 0 && pressables.length === 0) return next(e)
    const columns = e.props.bodyColumns
    // the owner 「H2 3 的左右邊界要對齊按鈕的左右邊界 然後分散對齊每個區塊的大小一樣」「H1 歸則就是12個按鈕那是錨釘」: a tile row spans the button row's
    // span (its head cell, then to the end), its tiles one size in cells (a third, a fifth, less the gaps), spread edge to edge; blanks of that
    // size keep a short row's places. A tile is its slot's dashed bounds (「現在的白框是H2 的隱性邊界」「你用虛線標注」) half a row short of the slot
    // (「框123456 下方都縮一點」), showing its card's name and value on its bottom, centred across.
    const tileBlock = (size: DisplaySize, cards: SlCard[], head: number) => {
      if (cards.length === 0) return false
      const { rows, perRow } = TILES[size]
      const tileCells = Math.floor((columns - head - (perRow - 1) * BAND_GAP) / perRow)
      const lines = Array.from({ length: Math.ceil(cards.length / perRow) }, (_, r) => cards.slice(r * perRow, (r + 1) * perRow))
      const charts: Record<string, string | undefined> = {}
      if (drawsPictures && size.startsWith('H3')) {
        for (const card of cards) if (card.kind === 'module') charts[card.id] = moduleChart(card, tools, chartBox(tileCells, rows))
      }
      // s39 (the owner's B): on the desktop a showinfo tile is its module's small picture (「不改：手機和終端機」; VS Code keeps its line too)
      if (e.surface === 'desktop' && size.startsWith('H2')) {
        for (const card of cards) if (card.kind === 'module') charts[card.id] = moduleTile(card, tools, chartBox(tileCells, rows))
      }
      return (
        <Box key={`band-${size}`} flexDirection="column" width={columns}>
          {lines.map((line, r) => (
            <Box key={`band-${size}-row-${r}`} flexDirection="row" width={columns} height={rows} paddingLeft={head} justifyContent="space-between" flexShrink={0}>
              {Array.from({ length: perRow }, (_, i) => {
                const card = line[i]
                // s39 (「無卡片…有細線方框可以顯示卡片位置」): an empty place is a dashed frame of the tile's size, holding nothing
                return card === undefined ? (
                  <Box key={`band-blank-${size}-${r}-${i}`} width={tileCells} height={rows} flexDirection="column">
                    <Box key={`band-blank-frame-${size}-${r}-${i}`} height={rows - FRAME_SHORT_ROWS} borderStyle="dashed" />
                  </Box>
                ) : (
                  <Box key={`band-tile-${card.id}`} width={tileCells} height={rows} flexDirection="column">
                    {/* s39: a picture takes the frame's whole size and draws no dashed line; words keep it (「只有文字」) */}
                    <Box key={`band-frame-${card.id}`} height={rows - FRAME_SHORT_ROWS} {...(charts[card.id] === undefined ? { borderStyle: 'dashed' } : {})} flexDirection="column" justifyContent="flex-end" alignItems="center">
                      {/* a 模組卡 shows its module's lines (s33): an H3 tile up to five, an H2 tile the first; s35: a chart module in an H3
                          tile its picture, the lines its alt (an Svg takes no key: the Box holds it) */}
                      {charts[card.id] !== undefined ? (
                        <Box key={`band-chart-${card.id}`}>
                          <Svg source={withDay(charts[card.id] as string)} alt={moduleLines(card, tools).join(' · ')} />
                        </Box>
                      ) : card.kind === 'module' ? (
                        moduleLines(card, tools)
                          .slice(0, size.startsWith('H3') ? H3_LINES : 1)
                          .map((line, i) => (
                            <Box key={`band-line-${card.id}-${i}`}>
                              <Text wrap="truncate">{line}</Text>
                            </Box>
                          ))
                      ) : (
                        <Text wrap="truncate">{segment(card.id, tools, st)}</Text>
                      )}
                      {st.showEvery === true && TAKES_RHYTHM.includes(card.kind) && (
                        <Box key={`band-every-${card.id}`}>
                          {/* s44 (the owner 「更新頻率的字也太大了吧還會遮擋」): a caption, the smallest the engine draws — it is a note under the
                              value, not a second value, and two body lines crowded a three-row tile on his desktop */}
                          <Text dimColor size="caption" wrap="truncate">{rhythmWord(everyMs(card, card.kind === 'module' ? moduleOf(card.text) : undefined))}</Text>
                        </Box>
                      )}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>
      )
    }
    const wanted = pressables.slice(0, BAND_SLOTS)
    // a 開關卡 off is grey (「丙」); its press sends its off or on command and turns it, as its name in the panel does
    const isOffSwitch = (card: SlCard) => card.kind === 'switch' && st.off.includes(card.id)
    const press = (card: SlCard) => (card.kind === 'switch' ? flip($, card, !st.off.includes(card.id)) : send($, card))
    const base = 0
    // the own size of the first n: 4.5 characters, or the widest of their labels unpadded (the number and the whole name, no gaps)
    const ownEmOf = (n: number) => Math.max(BAND_EM, ...wanted.slice(0, n).map((card, i) => textEm(numbered(base + i + 1, bandName(st, card)))))
    const ownFits = (n: number) => n * (BAND_FRAME_CELLS + ownEmOf(n) * BAND_EM_CELLS) + (n - 1) * BAND_GAP <= columns
    // the slots share the row less its 1-cell left padding; each holds the least label of every card in it
    const roomy = (n: number) =>
      ((columns - BAND_GAP) * Math.floor(100 / n)) / 100 >=
      BAND_GAP + BAND_FRAME_CELLS + Math.max(...wanted.slice(0, n).map((card, i) => leastEm(base + i + 1, bandName(st, card)))) * BAND_EM_CELLS
    let count = wanted.length
    while (count > 1 && !roomy(count)) count--
    // stage 1's count and size, and one cell before the first button where it fits (s28 「頭尾間距要跟第一個一樣」; s30 1.webp: the desktop
    // leaves 8 px at the head, 15 at the tail); a row filled to the cell keeps none, so no count changes. The tile rows take the same span.
    let fit = wanted.length
    while (fit > 1 && !ownFits(fit)) fit--
    const ownEm = ownEmOf(fit)
    const head = ownFits(fit) && fit * (BAND_FRAME_CELLS + ownEm * BAND_EM_CELLS) + fit * BAND_GAP <= columns ? BAND_GAP : 0
    // from the top H3-full, H3-half, H3, H2-full, H2-half, H2, then the button row; past the band's rows it scrolls (s34 「讓他捲動」)
    const tiles = DISPLAY_SIZES.map(size => tileBlock(size, displays.filter(c => sizeOf(c) === size), head))

    // s41 (the owner 「A感覺比較好 可以在pane做個打勾按鈕 讓我選 A或B這樣嗎？」, 「go，照這 7 個預設做」; docs/rulings.md; replacing s29's stage 3
    // "the rest not drawn"): when the stages leave lit buttons out, the touchbar pages. The room of its controls is set aside first, A's ‹ and
    // › at the two ends or B's counter n/N at the right end, each reckoned as a band button is (its frame and label, s34's 1.83 and 1.51; the
    // terminal draws [ label ], four cells more than its label) with its gap; s41's lab saw them narrower on the desktop, so this keeps a
    // spare. The rest is laid out by the same stages over all the labels, so every page is alike: fixed slots (a short last page keeps the
    // first places), each button numbered by its place in the row (⁷ stays ⁷). The page is the session's bandFirst, the first button shown:
    // a press on a button keeps it, a narrower band keeps that button in view. A's arrow at an end is dim and stays put (no wrap); B's
    // counter goes back to page 1 after the last.
    const shownByStages = !ownFits(wanted.length) && count > BAND_FEW ? count : fit
    if (shownByStages < wanted.length) {
      const isCounter = st.paging === 'counter'
      const controlCells = (label: string) => (e.surface === 'terminal' ? [...label].length + 4 : BAND_FRAME_CELLS + textEm(label) * BAND_EM_CELLS) + BAND_GAP
      const ownEmAll = Math.max(BAND_EM, ...wanted.map((card, i) => textEm(numbered(i + 1, bandName(st, card)))))
      const leastAll = Math.max(...wanted.map((card, i) => leastEm(i + 1, bandName(st, card))))
      // a page's size in the room left: whole buttons at their own size, each with its gap, or the stage-2 slots when they hold more than BAND_FEW
      const pageIn = (room: number) => {
        let own = wanted.length - 1
        while (own > 1 && own * (BAND_FRAME_CELLS + ownEmAll * BAND_EM_CELLS + BAND_GAP) > room) own--
        let slots = wanted.length - 1
        while (slots > 1 && ((room - BAND_GAP) * Math.floor(100 / slots)) / 100 < BAND_GAP + BAND_FRAME_CELLS + leastAll * BAND_EM_CELLS) slots--
        return slots > BAND_FEW && slots > own ? { size: slots, isSlots: true } : { size: own, isSlots: false }
      }
      const pagesOf = (size: number) => Math.ceil(wanted.length / size)
      // B's label grows with the pages (2/2 … 12/12): reckoned again for the pages its first reckoning gives
      const reserve = (pages: number) => (isCounter ? controlCells(`${pages}/${pages}`) : 2 * controlCells('‹'))
      let laid = pageIn(columns - reserve(2))
      if (reserve(pagesOf(laid.size)) > reserve(2)) laid = pageIn(columns - reserve(pagesOf(laid.size)))
      const { size, isSlots } = laid
      const room = columns - reserve(pagesOf(size))
      const pages = pagesOf(size)
      const last = (pages - 1) * size
      const first = Math.min(Math.floor((await read($, bandFirstState)) / size) * size, last)
      const slotCells = Math.floor(room / size)
      const labelEm = isSlots ? Math.min((slotCells - BAND_GAP - BAND_FRAME_CELLS) / BAND_EM_CELLS, ownEmAll) : ownEmAll
      const turn = (to: number) => () => update($, bandFirstState, () => to)

      return (
        <Box flexDirection="column">
          {tiles}
          <Box key="band-buttons" flexDirection="row" alignItems="center" justifyContent="space-between" width={columns}>
            {!isCounter && <Button key="band-page-prev" label="‹" variant="secondary" dimColor={first === 0} onPress={turn(Math.max(0, first - size))} />}
            <Box key="band-page" flexDirection="row" width={size * slotCells} flexShrink={0}>
              {Array.from({ length: size }, (_, i) => {
                const card = wanted[first + i]
                return (
                  <Box key={`band-slot-${i}`} width={slotCells} flexDirection="column" alignItems="center" overflow="hidden">
                    {card !== undefined && (
                      <Button key={`band-${card.id}`} label={bandLabel(first + i + 1, bandName(st, card), labelEm)} variant="secondary" dimColor={isOffSwitch(card)} onPress={() => press(card)} />
                    )}
                  </Box>
                )
              })}
            </Box>
            {isCounter ? (
              <Button key="band-page-count" label={`${first / size + 1}/${pages}`} variant="secondary" onPress={turn(first >= last ? 0 : first + size)} />
            ) : (
              <Button key="band-page-next" label="›" variant="secondary" dimColor={first >= last} onPress={turn(Math.min(first + size, last))} />
            )}
          </Box>
        </Box>
      )
    }

    if (!ownFits(wanted.length) && count > BAND_FEW) {
      const percent = Math.floor(100 / count)
      const labelEm = Math.min((((columns - BAND_GAP) * percent) / 100 - BAND_GAP - BAND_FRAME_CELLS) / BAND_EM_CELLS, ownEmOf(count))
      const inSlots = wanted.slice(0, count)

      return (
        <Box flexDirection="column">
            {tiles}
          <Box key="band-buttons" flexDirection="row" alignItems="center" justifyContent="center" width={columns} paddingLeft={BAND_GAP}>
            {inSlots.map((card, i) => (
              <Box key={`band-slot-${i}`} width={`${percent}%`} flexDirection="column" alignItems="center" overflow="hidden" paddingRight={BAND_GAP}>
                <Button key={`band-${card.id}`} label={bandLabel(base + i + 1, bandName(st, card), labelEm)} variant="secondary" dimColor={isOffSwitch(card)} onPress={() => press(card)} />
              </Box>
            ))}
          </Box>
        </Box>
      )
    }
    // stages 1 and 3: the own size, as many as fit, spread edge to edge (「頭尾間距要跟第一個一樣」)
    const shown = wanted.slice(0, fit)

    return (
      <Box flexDirection="column">
        {tiles}
        {shown.length > 0 && (
          <Box key="band-buttons" flexDirection="row" gap={BAND_GAP} alignItems="center" justifyContent="space-between" width={columns} paddingLeft={head}>
            {shown.map((card, i) => (
              <Button key={`band-${card.id}`} label={bandLabel(base + i + 1, bandName(st, card), ownEm)} variant="secondary" dimColor={isOffSwitch(card)} onPress={() => press(card)} />
            ))}
          </Box>
        )}
      </Box>
    )
  })

  // The card tools (s41): served here, each on the newest store (adopt), each change through change() as a press is.
  on('tool.call', { tool: CARD_TOOLS.cards }, async $ => {
    await adopt($)
    return { result: cardsReport(await read($, settingsState)) }
  })

  on('tool.call', { tool: CARD_TOOLS.add }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
    const kind = str('kind') as SlCardKind
    const blockName = str('block')
    if (!KIND_VALUES.includes(kind)) return { deny: `kind is one of ${KIND_VALUES.join(', ')}` }
    const into = blockName === 'StatusLine' ? undefined : BLOCKS.find(b => b === blockName)
    if (blockName !== 'StatusLine' && into === undefined) return { deny: `block is StatusLine or one of ${BLOCKS.join(', ')}` }
    const section = into === undefined ? 'status' : 'above'
    const kinds = kindsOf(section, into)
    if (!kinds.includes(kind)) return { deny: `${blockName} takes ${kinds.join(', ')}` }
    const draft: SlDraft = {
      kind,
      name: str('name'),
      text: str('text'),
      prefix: kind === 'switch' ? str('onArgs') : str('prefix'),
      offArgs: str('offArgs'),
      error: '',
      section,
      ...(into === undefined ? {} : { size: into }),
      ...(typeof input['place'] === 'number' ? { place: String(input['place']) } : {}),
    }
    const wrong = draftProblem(draft)
    if (wrong !== '') return { deny: wrong }
    const asked = input['every']
    if (asked !== undefined && !isRhythm(asked)) return { deny: `every is one of ${RHYTHMS.join(', ')}` }
    if (asked !== undefined && !TAKES_RHYTHM.includes(kind)) return { deny: `a 指令卡 and a 按鈕卡 take no rhythm: a 指令卡 runs at a turn's end and nowhere else` }
    await adopt($)
    const st = await read($, settingsState)
    const runs = runsThings({ cards: [withCard(st, draft, into).card] }).length > 0
    // a lit card needs room in its block; a 開關卡 takes a place on or off
    if (into !== undefined && (!runs || kind === 'switch') && isFullIn(st, into)) return { deny: fullLine(into) }
    // a card added off takes no place yet: it joins the end, where the owner's press finds it
    const { settings, card } = withCard(st, runs ? { ...draft, place: '' } : draft, into)
    const withEvery = asked === undefined
      ? settings
      : { ...settings, cards: settings.cards.map(c => (c.id === card.id ? { ...c, every: RHYTHM_SECONDS[asked] } : c)) }
    await update($, settingsState, () => (runs ? { ...withEvery, off: [...withEvery.off, card.id] } : withEvery))
    await readCards($)
    await change($, s => s)
    const after = await read($, settingsState)
    const at = into === undefined ? 'at the end of the Status Line' : `${into}${runs ? '' : ` at ${placeName(into, litIn(after, into).indexOf(card.id) + 1)}`}`
    const hidden = into !== undefined && after.aboveOff.includes(BLOCK_OF[into]) ? ` ${MENU_NAME[into]} is hidden: the user shows it with its switch in /ss.` : ''
    const what = runsWhat(card)
    return {
      result:
        what === undefined
          ? `Added ${card.id} 「${card.name}」 (${card.kind}) to ${at}, on.${hidden}`
          : `Added ${card.id} 「${card.name}」 (${card.kind}) to ${at}, off: it ${what}. Only the user turns it on, in /ss (its name button), once they have read that; tell them.${hidden}`,
    }
  })

  on('tool.call', { tool: CARD_TOOLS.addModule }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const text = typeof input['file'] === 'string' ? (input['file'] as string) : ''
    const checked = checkUserModule(text)
    if (!checked.ok) return { deny: tr(checked.why, checked.vars) }
    const asked = typeof input['name'] === 'string' && (input['name'] as string).trim() !== '' ? (input['name'] as string).trim() : checked.def.id
    if (/[/\\:*?"<>|]/.test(asked) || asked.startsWith('.')) return { deny: 'name is a file name: no slashes, and it may not start with a dot' }
    const file = `${asked}.json`
    // the folder as it is now, so a file written beside this session is seen too
    await scanUserModules($)
    const already = userModuleFiles[checked.def.id]
    if (already !== undefined && already !== file) return { deny: `${checked.def.id} is already ${already}'s: change the id, or change that file` }
    const dir = `${cwd}/${MODULE_DIR}`
    try {
      await $.fs.write(`${dir}/${file}`, text.endsWith('\n') ? text : `${text}\n`)
    } catch (error) {
      return { deny: `${MODULE_DIR}/${file} could not be written: ${reason(error)}` }
    }
    await scanUserModules($)
    await update($, readCountState, n => n + 1)

    return { result: `${checked.def.id} written to ${MODULE_DIR}/${file} and on offer now: add_card with kind module and text ${checked.def.id} puts it in a block.` }
  })

  on('tool.call', { tool: CARD_TOOLS.change }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const has = (key: string) => typeof input[key] === 'string'
    const str = (key: string) => (has(key) ? (input[key] as string) : '')
    const id = str('id')
    await adopt($)
    const st = await read($, settingsState)
    const card = st.cards.find(c => c.id === id)
    if (card === undefined) return { deny: isKey(id) ? `${id} is a built-in Status Line item: the user turns it on and off in /ss` : `no card ${id}: the cards tool lists them` }
    const next: SlCard = {
      ...card,
      ...(has('name') ? { name: str('name').trim() } : {}),
      ...(has('text') ? { text: card.kind === 'switch' ? str('text').trim().replace(/^\//, '') : str('text').trim() } : {}),
      ...(has('prefix') && card.kind === 'file' ? { prefix: str('prefix').trim() } : {}),
      ...(has('onArgs') && card.kind === 'switch' ? { onArgs: str('onArgs').trim() } : {}),
      ...(has('offArgs') && card.kind === 'switch' ? { offArgs: str('offArgs').trim() } : {}),
      ...(has('every') && isRhythm(input['every']) ? { every: RHYTHM_SECONDS[input['every'] as Rhythm] } : {}),
    }
    if (has('every') && !isRhythm(input['every'])) return { deny: `every is one of ${RHYTHMS.join(', ')}` }
    if (has('every') && !TAKES_RHYTHM.includes(card.kind)) return { deny: `a 指令卡 and a 按鈕卡 take no rhythm: a 指令卡 runs at a turn's end and nowhere else` }
    const section = card.section === 'above' ? 'above' : 'status'
    const size = section === 'above' ? sizeOf(card) : undefined
    const wrong = draftProblem({
      kind: next.kind,
      name: next.name,
      text: next.text,
      prefix: next.kind === 'switch' ? next.onArgs ?? '' : next.prefix,
      offArgs: next.offArgs ?? '',
      error: '',
      section,
      ...(size === undefined ? {} : { size }),
    })
    if (wrong !== '') return { deny: wrong }
    const wantOn = typeof input['on'] === 'boolean' ? (input['on'] as boolean) : undefined
    if (wantOn !== undefined && card.kind === 'switch') return { deny: `a switch's on and off send its command: the user presses it, in /ss or on the band` }
    const what = runsWhat(next)
    if (wantOn === true && what !== undefined) return { deny: `only the user turns on a card that runs things, in /ss (its name button): this one ${what}` }
    // what a card that runs things runs changed: it goes off until the owner has read the new one
    const ranChanged = what !== undefined && card.kind !== 'switch' && next.text !== card.text
    let off = st.off
    if (wantOn === false || ranChanged) off = off.includes(id) ? off : [...off, id]
    if (wantOn === true && off.includes(id)) {
      if (size !== undefined && isFullIn(st, size)) return { deny: fullLine(size) }
      off = off.filter(k => k !== id)
    }
    await update($, settingsState, s => ({ ...s, cards: s.cards.map(c => (c.id === id ? next : c)), off }))
    await readCards($)
    await change($, s => s)
    const state = off.includes(id) ? 'off' : 'on'
    return {
      result: ranChanged
        ? `Changed ${id} 「${next.name}」: off now, since what it runs changed: it ${what}. Only the user turns it on again, in /ss; tell them.`
        : `Changed ${id} 「${next.name}」, ${state}.`,
    }
  })

  on('command.run', { command: 'ss' }, async ($, e) => {
    const args = e.args.trim()
    const [verb = '', name = ''] = args.split(/\s+/)

    // the owner 2026-10-09 s30 「設定要到pane裡面記得不用出現在對話了」: bare /ss opens the panel in its pane and leaves no row in the
    // conversation; where no pane can be placed, the listing row as before.
    if (verb === '') {
      const opened = await $.ui.open({ id: PANEL_PANE, title: tr('pane.panelTitle'), focus: true, closeOnEscape: true })
      if (opened.isPlaced) return {}
      await ensure($)

      return { text: listing(await read($, toolCount), await read($, settingsState)) }
    }

    if (verb === 'reload') {
      await reload($)
      return { text: tr('reply.reloaded') }
    }

    // s44 (the owner 「蕃茄鐘現在做」): the pomodoro is worked from here, so an ordinary 按鈕卡 sending /ss pomo start is all the
    // button it needs. The state is kept in the settings, with everything else he has set.
    if (verb === 'pomo') return { text: await pomoCommand($, name) }

    // s35: the example cards a block does not hold yet (a module already in that block is not added twice), named as a card added with no
    // name is (the module's name in the panel's language, cut to its rule); then the six display blocks are turned on to be seen
    if (verb === 'examples') {
      let added = 0
      await change($, st => {
        added = 0
        const cards = [...st.cards]
        const order = [...st.aboveOrder]
        for (const { size, modules } of EXAMPLES) {
          for (const id of modules) {
            if (cards.some(c => c.kind === 'module' && c.text === id && sizeOf(c) === size)) continue
            // a block holds its places of lit cards (Claude Design step 5b, s38): a full one gets no more
            if (isFullIn({ ...st, cards, aboveOrder: order }, size)) continue
            const card: SlCard = { id: nextCardId(cards), kind: 'module', name: cut(moduleName(moduleOf(id)), lang.rules.nameMax), text: id, prefix: '', section: 'above', size }
            cards.push(card)
            order.push(card.id)
            added++
          }
        }
        return { ...st, cards, aboveOrder: order, aboveOff: st.aboveOff.filter(block => !DISPLAY_SIZES.some(size => BLOCK_OF[size] === block)) }
      })
      return { text: tr('reply.examples', { n: added }) }
    }

    if (verb === 'note') {
      await change($, st => ({ ...st, note: args.slice(4).trim() }))
    } else if (verb === 'icons' && (name === 'on' || name === 'off')) {
      await change($, st => ({ ...st, icons: name === 'on' }))
    } else if (verb === 'on' || verb === 'off') {
      // s39 (his /ss off answered 「No item .」): no item named, the reply says one is wanted, with the verb and an example
      if (name === '') return { text: tr('reply.needItem', { verb, items: KEYS.join(' ') }) }
      const keys = GROUPS[name] ?? (KEYS.includes(name as Key) ? [name as Key] : [])
      if (keys.length === 0) {
        return { text: tr('reply.noItem', { name, items: KEYS.join(' ') }) }
      }
      await change($, st => {
        const rest = st.off.filter(key => !keys.includes(key))
        return { ...st, off: verb === 'off' ? [...rest, ...keys] : rest }
      })
    } else {
      return { text: tr('reply.usage') }
    }

    return { text: tr('reply.updated', { args }) }
  })
}
