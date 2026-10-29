// How a button's name is laid out (the owner 2026-10-09 「字距固定 跟箭頭左右按鈕的間距一樣」).
// A Button has no width and no letter-spacing, so the layout is made of spaces that are fixed fractions of a Chinese
// character: U+2002 (en space) is half a character, U+2005 (four-per-em space) a quarter. U+3000 (ideographic space, one
// character) is not used since s28: the desktop drops it at the end of a label.
//
// The gap between two characters is always one en space: half a character, the same as the gap between the ← and → buttons
// (one cell). Every name is then centred in the same width, 5.5 characters = four characters and three gaps.
//
//   4 characters  字 字 字 字    3 gaps = 1.5       4 + 1.5 = 5.5, nothing to pad
//   3 characters  字 字 字       2 gaps = 1.0       4 + ... → 0.75 on each side (en space + quarter space)
//   2 characters  字 字          1 gap  = 0.5       2.5     → 1.5 on each side (three en spaces)
//   1 character   字                                1       → 2.25 on each side (four en spaces + quarter space)
//   (in the band, 4.5 characters: 1.0 on each side of two characters, two en spaces)
//   empty, or more than four characters: left as it is
export const MAX_CHARACTERS = 4
export const BUTTON_EM = 5.5
// the owner 2026-10-09 s28 「把寬度縮小到可以放12個」: a band button is 4.5 characters (11 of 5.5 fitted his window, 12 of 4.5 do).
export const BAND_EM = 4.5

const HALF = ' '
const QUARTER = ' '

// Spaces for a width in characters (a multiple of a quarter): ideographic spaces first, then en space, then quarter space.
function spaces(em: number): string {
  let quarters = Math.round(em * 4)
  let out = ''
  // en spaces only (the owner 2026-10-09 s28 「每個按鈕裡面的文字都跑掉」): the desktop drops a full-width space (U+3000) at the end of a
  // label, which pushed a 4.5-character name to the right; en spaces are kept at both ends
  while (quarters >= 2) {
    out += HALF
    quarters -= 2
  }
  if (quarters >= 1) out += QUARTER

  return out
}

// Kana (hiragana, katakana with its ー, half-width katakana): a word with any is Japanese, kept whole (s35, the owner 「1 不空格」: the half gaps
// are 繁中's; ツ ー ル reads broken).
export const hasKana = (text: string) => /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/.test(text)

// width: the characters the name is centred in; 5.5 for a name button, BAND_EM for a button in the band above the prompt.
export function fixed(label: string, width: number = BUTTON_EM): string {
  const chars = [...label]
  if (chars.length < 1 || chars.length > MAX_CHARACTERS || hasKana(label)) return label
  const natural = chars.length + (chars.length - 1) / 2
  if (natural > width) return chars.join(HALF)
  const side = spaces((width - natural) / 2)

  return side + chars.join(HALF) + side
}

// A label as it is, centred in a width of characters with en and quarter spaces at both ends, the odd quarter on the right (s34:
// AbovePrompt's switches, one width); own: the label's width when it was measured, else textEm's estimate.
export function padded(label: string, width: number, own: number = textEm(label)): string {
  const quarters = Math.max(0, Math.round((width - own) * 4))
  const left = Math.floor(quarters / 2)

  return spaces(left / 4) + label + spaces((quarters - left) / 4)
}

// A button one column of the desktop panel wide (Claude Design step 2; the owner 2026-10-14 s37 「OK，開始第 2 步，先做 lab」 on 15 cells): 15
// cells (9.53 px a cell, s36 10.webp) less a button's own 20.5 px, in characters of 15.5 px.
export const COLUMN_EM = (15 * 9.53 - 20.5) / 15.5
// Latin words measured on the desktop (pad-lab, s37 4.webp; Hidden from 11.webp, Shown from 14.webp), in characters: textEm's 0.575 a letter overrates most
// (Profile 3.01, not 4.03) and undercounts some (Shown, cut with … in 11.webp: 3.24, not 2.88).
export const MEASURED_EM: Readonly<Record<string, number>> = {
  'Narrow view': 5.85,
  'Wide view': 4.79,
  Profile: 3.01,
  Reload: 3.17,
  Edit: 1.85,
  Default: 3.41,
  'Add card': 4.23,
  Hidden: 3.37,
  Shown: 3.24,
}

// A label's width in characters where it was not measured (s37): a Chinese or kana character 1, the en and quarter spaces what they are,
// a Latin letter by its kind (the desktop's system font; within 0.15 of every word in MEASURED_EM, the test holds it there). A label with
// Latin letters is padded ESTIMATE_SPARE short of the column, so a word up to that much wider than estimated still fits (Shown, 11.webp).
export const ESTIMATE_SPARE = 0.25
const letterEm = (c: string) =>
  /[il.,:;'|!]/.test(c) ? 0.26
    : /[jft]/.test(c) ? 0.35
      : c === 'r' ? 0.37
        : c === ' ' ? 0.27
          : /[mw]/.test(c) ? 0.8
            : /[MW]/.test(c) ? 0.92
              : /[A-Z]/.test(c) ? 0.7
                : 0.57
export function estimateEm(text: string): number {
  return [...text].reduce((sum, c) => sum + (c === HALF ? 0.5 : c === QUARTER ? 0.25 : c.codePointAt(0)! >= 0x2e80 ? 1 : letterEm(c)), 0)
}

// An interface word on a button outside the cards (s37): laid out as uiLabel lays it out, then padded to COLUMN_EM, rounded down to a
// quarter (a Button wider than its Box is cut with …, s29), a measured word to the column, an estimated one with Latin letters
// ESTIMATE_SPARE short of it; the odd quarter on the right.
// lit: a button drawn lit (a primary one) at times, its label bold and wider than measured (s38 6.webp: a lit Edit cut with …), padded
// ESTIMATE_SPARE short as an estimate is, in every language
export function columnLabel(label: string, chinese = true, lit = false): string {
  const laid = uiLabel(label, chinese)
  const measured = laid === label ? MEASURED_EM[label] : undefined
  const own = measured ?? estimateEm(laid)
  const room = lit || (measured === undefined && /[A-Za-z0-9]/.test(laid)) ? COLUMN_EM - ESTIMATE_SPARE : COLUMN_EM

  return padded(laid, own + Math.floor((room - own) * 4) / 4, own)
}

// An interface word on a button (s34, the owner's 11.webp 「S o r t」): a Chinese one as fixed lays it out (its gaps, padded to the width), any
// other as it is, a word kept whole. chinese: whether the panel speaks Chinese (s35: a 日本語 panel's 削除 is kept whole too).
export function uiLabel(label: string, chinese = true): string {
  return chinese && [...label].every(c => c.codePointAt(0)! >= 0x2e80) ? fixed(label) : label
}

// How wide a label is, in Chinese characters (the owner 2026-10-09 s29, band slots). Measured on his desktop (/lab, 9.webp): a Latin letter
// or digit is 0.575 of a Chinese character, a superscript digit 0.34; … is counted as a whole character until it is measured; the spaces
// are what they are made to be. Anything else counts as a Latin letter.
const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const ELLIPSIS = '…'
// a 開關卡's mark on the band (s38, the owner 「丙」): ● while on, ○ while off, before its name; not measured, so counted as a whole character, as … is
export const ON_MARK = '●'
export const OFF_MARK = '○'
export function textEm(text: string): number {
  return [...text].reduce((sum, c) => {
    if (c === HALF) return sum + 0.5
    if (c === QUARTER) return sum + 0.25
    if (c === ELLIPSIS || c === ON_MARK || c === OFF_MARK) return sum + 1
    if (SUPERSCRIPTS.includes(c)) return sum + 0.34
    return sum + (c.codePointAt(0)! >= 0x2e80 ? 1 : 0.575)
  }, 0)
}

const superscript = (place: number) => [...String(place)].map(d => SUPERSCRIPTS[Number(d)]).join('')

// The forms a name can take in a band label, widest first (the owner 2026-10-09 s29 「字最少不包含前面的數字要留前兩個字」, 「最小的時候又超過
// 字數就是¹字 字 …」): with its half-character gaps; without them; cut to its first two characters, their gap, a gap and …. One or two
// characters are never cut (¹字, ²字 字).
function forms(name: string): string[] {
  const chars = [...name]
  // a Japanese name is kept whole, and cut whole (s35)
  if (hasKana(name)) return chars.length <= 2 ? [name] : [name, chars.slice(0, 2).join('') + HALF + ELLIPSIS]
  if (chars.length <= 2) return [chars.join(HALF)]
  return [chars.join(HALF), chars.join(''), chars.slice(0, 2).join(HALF) + HALF + ELLIPSIS]
}

// The label a name has at the least (its last form, 「最小的時候…就是¹字 字 …」): what a slot must hold.
export function leastEm(place: number, name: string): number {
  const all = forms(name)
  return textEm(superscript(place)) + textEm(all[all.length - 1] as string)
}

// A band label (s29): the place in superscript digits first (s28 「用 ¹²³⁴⁵⁶⁷⁸⁹⁰ 在左上角」), then the widest form of the name that fits the
// width asked, centred in it; when none fits, its last form (the least), unpadded. The spaces round to quarters, so a label is within an
// eighth of a character of the width asked.
export function bandLabel(place: number, name: string, width: number): string {
  const number = superscript(place)
  const all = forms(name)
  const content = all.find(f => textEm(number) + textEm(f) <= width) ?? (all[all.length - 1] as string)
  const spare = width - textEm(number) - textEm(content)
  if (spare < 0) return number + content
  // centred in the whole width, the number taking from the left side
  const quarters = (em: number) => Math.max(0, Math.round(em * 4))
  const left = quarters((width - textEm(content)) / 2 - textEm(number))
  const right = quarters(spare - left / 4)
  return number + spaces(left / 4) + content + spaces(right / 4)
}
