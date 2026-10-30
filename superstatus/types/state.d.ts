// The mod's types and its $.state contract in one self-contained file (`claude plugin validate` holds the contract against
// every $.state key register.tsx names and allows it no import; plugin.json's `types` points here). Since s45 the hooks
// reach these types through ./index.d.ts, a type-only re-export: the plugin directory refused the `declare` below where a
// hooks module's import led it (MOD_SOURCE_UNCERTAIN on the old types/index.d.ts line 56).
// Tool calls of this session's main loop counted so far; -1 until seeded from the stored conversation.
export type ToolCount = number

export type SlKey = 'ver' | 'who' | 'block' | 'tools' | 'ctx' | '5h' | '7d' | 'score' | 'pending' | 'branch' | 'dirty' | 'ff'

// Which items are off, the note, whether symbols (not words) show, and the order of the items (the owner moves them with the
// arrows; the status line and the panel share it); also kept in the store between sessions.
// A card the owner added himself in the 新增卡片 pane (2026-10-09 s28); its id (c1, c2, …) goes in off and order. text is the
// text (文字卡), the date YYYY-MM-DD (倒數卡), the path inside the project (檔案卡) or the bash command (指令卡); prefix is the
// start of the line a 檔案卡 looks for, empty for the others.
// A 開關卡 (switch) keeps the slash command's name in text and the arguments it sends to turn on and off in onArgs and offArgs.
// A 按鈕卡 (button, AbovePrompt only) keeps what it sends in text: a / command, or words sent as if typed.
// The region a card stands in (ruling 2026-10-10 s29, which renumbered s30's): H1 the button row (every 按鈕卡), H2 a row of five display
// tiles, H3 a row of three above it; a display card (text, countdown, file, command) is H2 or H3, cycled from its card, H2 unless kept H3.
// s34 (the owner): -half and -full of each, as tall as their series, half two tiles to a row (buttons 1-6, 7-12), full one (buttons 1-12).
export type SlSize = 'H1' | 'H2' | 'H2-half' | 'H2-full' | 'H3' | 'H3-half' | 'H3-full'
// A 模組卡 (module, 2026-10-10 s33) keeps a module's id in text (hooks/modules): a tile module is a display (H2 or H3), a button module
// stands in the button row (H1). A 按鈕卡 whose text starts with ! runs the rest on the host (s33).
export type SlCardKind = 'text' | 'countdown' | 'file' | 'command' | 'switch' | 'button' | 'module'
// section 'above': the card belongs to the AbovePrompt section (the owner 2026-10-09 s28); absent, to Status Line.
// every: how often this card is read again, in seconds (s43, 待你裁決 5 from s34). Absent, or under the floor, the minute
// superstatus has always used. Where two lit cards share a module, the shorter of the two decides how often it is read.
export type SlCard = { id: string; kind: SlCardKind; name: string; text: string; prefix: string; onArgs?: string; offArgs?: string; section?: 'above'; size?: SlSize; every?: number }
// collapsed: the cards of /ss (the section headed Status Line) are folded away (the owner 2026-10-09 s28 「做記得」).
// aboveOrder and aboveCollapsed: the AbovePrompt section's own order and fold. touchCollapsed: TouchBar's fold (2026-10-09 s29),
// AbovePrompt's first layer; its 按鈕卡 keep their places in aboveOrder. removed: the built-in Status Line cards deleted with 刪除
// (s29; 符號 is icons; 版本號, ver, cannot be); 預設 empties it.
// aboveOff: the blocks of the band folded away by AbovePrompt's switches (the owner 2026-10-09 s30): touch = the 按鈕卡 row (TouchBar), info =
// the text cards' line, chart = a chart block not built yet. s34: info-half info-full chart-half chart-full, one switch each.
export type AboveBlock = 'touch' | 'info' | 'info-half' | 'info-full' | 'chart' | 'chart-half' | 'chart-full'
// h3Collapsed, h2Collapsed: the folds of the showchart (H3) and showinfo (H2) menus beside TouchBar (2026-10-09 s30, renumbered 2026-10-10);
// h3HalfCollapsed h3FullCollapsed h2HalfCollapsed h2FullCollapsed those of the -half and -full menus (s34).
// narrow: the desktop's panel two cards to a row, 32 cells (Claude Design step 1, s37); absent, four and 64. Kept with the cards, so a profile
// carries it.
// paging: how the touchbar pages when its lit buttons do not all fit (s41, the owner 「A感覺比較好 … 讓我選 A或B」): 'counter' is B, a page counter
// n/N at the right end; absent, A, ‹ and › at the two ends.
export type SlSettings = { off: string[]; note: string; icons: boolean; order: string[]; cards: SlCard[]; collapsed: boolean; aboveOrder: string[]; aboveCollapsed: boolean; touchCollapsed: boolean; h3Collapsed: boolean; h2Collapsed: boolean; h3HalfCollapsed: boolean; h3FullCollapsed: boolean; h2HalfCollapsed: boolean; h2FullCollapsed: boolean; removed: string[]; aboveOff: AboveBlock[]; narrow?: boolean; paging?: 'counter'; showEvery?: boolean; pomo?: { state: 'idle' | 'run' | 'pause' | 'break'; endsAt?: number; leftMs?: number; done: number } }
// showEvery: each card carries a dim line saying how often it is read (s43, version D of the 1019 page, the owner 「D 可以」).
// Off unless he turns it on: the band's height is capped and a line added to a full row is an old trap (s28).
// What the 新增卡片 pane holds while it is filled in; error is the line under the fields.
// section: which section's 新增卡片 opened the pane.
// size: the size a 按鈕卡 is added at, set by the H1 or H2 menu's 新增卡片 (s30); absent, H3.
// size: AbovePrompt's block the pane has open (Claude Design step 5, s38: H1 too; none while every fold is closed); place: the place picked in
// it, '1' on, none for the next free one
// every: the rhythm picked in the pane's 節奏 row (s44), by name; absent, the card takes its module's own rhythm, which is what 預設 means.
export type SlDraft = { kind: SlCardKind; name: string; text: string; prefix: string; offArgs: string; error: string; section: 'status' | 'above'; size?: SlSize; place?: string; every?: 'fast' | 'normal' | 'slow' | 'turn' }

// The Profile pane (s36): the profiles folder ('' until found) or why it cannot be found, each good profile file read there (its file, name,
// how many cards it shows, when it was saved, the cards in it that run things), a line for each file refused, what a press asks again for
// ('save:<file>', 'load:<file>' or 'delete:<file>', '' for nothing), the line under the name field, and the name typed.
export type SsProfileRuns = { name: string; how: 'command' | 'host' | 'send' | 'switch'; text: string }
export type SsProfileRow = { file: string; name: string; cards: number; saved: string; runs: SsProfileRuns[] }
export type SsProfiles = { dir: string; error: string; rows: SsProfileRow[]; refused: string[]; asking: string; note: string; name: string }

// The status line always shows the mod's name in front; the name cannot be empty or non-kebab-case (the owner 2026-10-09).
declare module 'claude-code' {
  interface PluginState {
    // sorting: whether the arrows show under the cards; not stored, a panel opened later starts without them
    // readCount: moves when a card's or a module's value changed (s33), so the drawings that show them redraw
    // language: the panel's language code (s34; kept in the store under 'language'); langNote: what the last 新增語言 found
    // profiles: the Profile pane's (s36); not stored, read from the folder when the pane opens
    // bandFirst: the first touchbar button of the page shown while it pages (s41); not stored, a session starts on page 1
    'superstatus': { toolCount: ToolCount; readCount: number; settings: SlSettings; sorting: boolean; touchSorting: boolean; h3Sorting: boolean; h2Sorting: boolean; h3HalfSorting: boolean; h3FullSorting: boolean; h2HalfSorting: boolean; h2FullSorting: boolean; language: string; langNote: string; draft: SlDraft; switchError: string; deleting: string; profiles: SsProfiles; bandFirst: number }
  }
}
