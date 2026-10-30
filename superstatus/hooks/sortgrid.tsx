import type { ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

// The 編輯 grid (the owner 2026-10-12 s36 「拖卡片換順序」「可以用編輯按鈕鎖定拖曳的動作嗎？按編輯才可以拖」「← → 箭頭 保留」「我想像之前一樣維持刪除
// 按鈕」, then 「你先做我們再細修」), the surface module of a Client region drawn while a section's 編輯 is on, on the desktop. Measured with
// drag-lab on his desktop (docs/measures.md, s36): the desktop sends a press, every move while held (in whole cells) and the let-go; a
// Button or an Input inside the region works, drawn bare. Each card is its place and name, 15 cells wide and 3 rows high, its ← 刪除 →
// in the 2 rows under it, a cell apart and four to a row (16 cells a column, 6 rows a card row; narrow, two). A card pressed and moved is dragged and
// let go in a new place; a press and a let-go on one card is a click: a card the owner added turns into a field for its name. What is done
// is posted to the hooks module (register.tsx gridPost), which checks it and keeps it; until the panel hands the grid its cards again,
// the grid shows what it posted.
// isFixed: stands first and never moves, the word fixed under it (版本號, Claude Design step 7, s38)
type Card = { key: string; name: string; place: number; isOn: boolean; canMove: boolean; canDelete: boolean; canRename: boolean; isFixed?: boolean }
type Words = { delete: string; confirm: string; builtIn: string; nameLong: string; nameEmpty: string; fixed: string }
// perRow: cards to a row, four (the panel's narrow width, Claude Design step 1 s37: two)
export type Props = { cards: Card[]; nameMax: number; words: Words; perRow?: number }
// pressed: the card the button went down on; over: the place it is held over; moved: it left its own place since the press; editing: the
// card whose name is a field; asking: the card whose 刪除 reads 確定刪除; shown and basis: what the grid posted, kept while the panel
// still hands the cards it had before (basis)
type State = { pressed: string; over: number; moved: boolean; editing: string; draft: string; asking: string; note: string; shown: Card[] | null; basis: string }

const UNIT_CELLS = 15
const CARD_ROWS = 3
const BUTTON_ROWS = 2
const GAP = 1
const PER_ROW = 4
const PITCH_X = UNIT_CELLS + GAP
const PITCH_Y = CARD_ROWS + BUTTON_ROWS + GAP

const signature = (cards: readonly Card[]) => cards.map(c => `${c.key}:${c.name}:${c.place}`).join('|')
const FRESH: State = { pressed: '', over: -1, moved: false, editing: '', draft: '', asking: '', note: '', shown: null, basis: '' }
// the props each instance was last drawn with, for its pointer listener (set once, it outlives the call that set it)
const latest = new WeakMap<object, Props>()

const perRowOf = (props: Props) => props.perRow ?? PER_ROW
// the card whose box (not its buttons) is under the cell, as an index, or -1
const cardAt = (x: number, y: number, n: number, perRow: number) => {
  if (x < 0 || y < 0) return -1
  const col = Math.floor(x / PITCH_X)
  const row = Math.floor(y / PITCH_Y)
  if (col >= perRow || x % PITCH_X >= UNIT_CELLS || y % PITCH_Y >= CARD_ROWS) return -1
  const i = row * perRow + col
  return i < n ? i : -1
}
// the place among the cards that move that the cell is over (beyond the last, the last; over a fixed card, the first)
const placeAt = (x: number, y: number, movable: number, perRow: number, fixed: number) => {
  const col = Math.min(perRow - 1, Math.max(0, Math.floor(x / PITCH_X)))
  const row = Math.max(0, Math.floor(y / PITCH_Y))
  return Math.max(0, Math.min(movable - 1, row * perRow + col - fixed))
}
// the cards with one moved to a place among those that move, numbered again after the fixed ones, which stay first
const movedTo = (cards: readonly Card[], key: string, to: number) => {
  const fixed = cards.filter(c => c.isFixed === true)
  const movable = cards.filter(c => c.canMove && c.key !== key)
  const card = cards.find(c => c.key === key)
  if (card === undefined) return [...cards]
  movable.splice(Math.max(0, Math.min(movable.length, to)), 0, card)
  return [...fixed, ...movable.map((c, i) => ({ ...c, place: fixed.length + i + 1 })), ...cards.filter(c => !c.canMove && c.isFixed !== true)]
}

function shownOf(props: Props, state: State): Card[] {
  return state.shown !== null && state.basis === signature(props.cards) ? state.shown : props.cards
}

function listen(surface: ClientSurface<State>) {
  surface.onPointer((e: ClientPointerEvent) => {
    const props = latest.get(surface)
    if (props === undefined) return
    const s = surface.state ?? FRESH
    const cards = shownOf(props, s)
    const movable = cards.filter(c => c.canMove).length
    const fixed = cards.filter(c => c.isFixed === true).length
    const under = cardAt(e.x, e.y, cards.length, perRowOf(props))
    const card = under >= 0 ? cards[under] : undefined
    if (e.type === 'down') {
      // a press in the field is the field's; a press on another card leaves it
      if (s.editing !== '' && card?.key === s.editing) return
      if (card === undefined || e.button !== 'left') return
      surface.setState({ ...s, pressed: card.key, over: under, moved: false, editing: '', note: '' })
      return
    }
    if (s.pressed === '') return
    const pressed = cards.find(c => c.key === s.pressed)
    if (e.type === 'move' && e.button !== undefined) {
      if (pressed === undefined || !pressed.canMove) return
      const over = placeAt(e.x, e.y, movable, perRowOf(props), fixed)
      const from = cards.filter(c => c.canMove).findIndex(c => c.key === pressed.key)
      if (over !== s.over || (!s.moved && over !== from)) surface.setState({ ...s, over, moved: s.moved || over !== from })
      return
    }
    if (e.type !== 'up') return
    if (pressed === undefined) return surface.setState({ ...s, pressed: '' })
    // a click: a card the owner added is renamed; a built-in one says it cannot be
    if (!s.moved && card?.key === pressed.key) {
      if (pressed.canRename) surface.setState({ ...s, pressed: '', editing: pressed.key, draft: pressed.name, asking: '', note: '' })
      else surface.setState({ ...s, pressed: '', note: props.words.builtIn })
      return
    }
    if (!pressed.canMove || !s.moved) return surface.setState({ ...s, pressed: '' })
    const to = placeAt(e.x, e.y, movable, perRowOf(props), fixed)
    surface.setState({ ...s, pressed: '', over: -1, moved: false, shown: movedTo(cards, pressed.key, to), basis: signature(props.cards) })
    surface.post({ move: { key: pressed.key, to } })
  })
}

const SortGrid: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Button, Input } = surface.elements
  latest.set(surface, props)
  if (surface.state === undefined) {
    listen(surface)
    surface.setState(FRESH)
  }
  const s = surface.state ?? FRESH
  const now = () => surface.state ?? FRESH
  const cards = shownOf(props, s)
  const movableKeys = cards.filter(c => c.canMove).map(c => c.key)
  // while a card is held over another place, the cards are shown with it there
  const isDragging = s.pressed !== '' && s.moved
  const drawn = isDragging ? movedTo(cards, s.pressed, s.over) : cards
  const keep = (next: Card[], data: object) => {
    surface.setState({ ...now(), shown: next, basis: signature(props.cards), asking: '', editing: '', note: '' })
    surface.post(data)
  }
  const step = (card: Card, delta: -1 | 1) => () => {
    const at = movableKeys.indexOf(card.key)
    const to = at + delta
    if (at < 0 || to < 0 || to >= movableKeys.length) return
    keep(movedTo(cards, card.key, to), { move: { key: card.key, to } })
  }
  const remove = (card: Card) => () => {
    if (now().asking !== card.key) return surface.setState({ ...now(), asking: card.key, note: '' })
    keep(cards.filter(c => c.key !== card.key), { remove: card.key })
  }
  const rename = (value: string) => {
    const st = now()
    const name = value.trim()
    const n = [...name].length
    if (n === 0) return surface.setState({ ...st, note: props.words.nameEmpty })
    if (n > props.nameMax) return surface.setState({ ...st, note: props.words.nameLong.replace('{n}', String(n)).replace('{max}', String(props.nameMax)) })
    keep(cards.map(c => (c.key === st.editing ? { ...c, name } : c)), { rename: { key: st.editing, name } })
  }
  const rows: Card[][] = []
  const perRow = perRowOf(props)
  for (let i = 0; i < drawn.length; i += perRow) rows.push(drawn.slice(i, i + perRow))

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" gap={GAP}>
        {rows.map((row, r) => (
          <Box key={`grid-row-${r}`} flexDirection="row" gap={GAP}>
            {row.map(card => {
              const isHeld = isDragging && card.key === s.pressed
              const isEditing = card.key === s.editing
              const at = movableKeys.indexOf(card.key)
              return (
                <Box key={`grid-card-${card.key}`} flexDirection="column" width={UNIT_CELLS} height={CARD_ROWS + BUTTON_ROWS}>
                  <Box
                    key={`grid-box-${card.key}`}
                    width={UNIT_CELLS}
                    height={CARD_ROWS}
                    borderStyle={isHeld ? 'double' : isEditing ? 'bold' : 'round'}
                    borderColor={card.isOn ? 'text' : 'subtle'}
                    paddingX={0}
                    justifyContent="center"
                    alignItems="center"
                  >
                    {isEditing ? (
                      <Input key="grid-rename" value={s.draft} autoFocus onInput={(value: string) => surface.setState({ ...now(), draft: value })} onSubmit={rename} />
                    ) : (
                      <Text weight={isHeld ? 'semibold' : undefined} dimColor={!card.isOn || (isDragging && !isHeld)}>{card.place > 0 ? `${card.place} ${card.name}` : card.name}</Text>
                    )}
                  </Box>
                  <Box key={`grid-buttons-${card.key}`} flexDirection="row" width={UNIT_CELLS} height={BUTTON_ROWS} justifyContent="center" alignItems="center" gap={1}>
                    {card.isFixed === true && <Text dimColor>{props.words.fixed}</Text>}
                    {card.canMove && <Button key={`grid-left-${card.key}`} label="←" variant="secondary" dimColor={at <= 0} onPress={step(card, -1)} />}
                    {card.canDelete && (
                      <Button key={`grid-delete-${card.key}`} label={s.asking === card.key ? props.words.confirm : props.words.delete} variant="secondary" onPress={remove(card)} />
                    )}
                    {card.canMove && <Button key={`grid-right-${card.key}`} label="→" variant="secondary" dimColor={at === movableKeys.length - 1} onPress={step(card, 1)} />}
                  </Box>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
      {s.note !== '' && <Text dimColor>{s.note}</Text>}
    </Box>
  )
}

export default SortGrid
