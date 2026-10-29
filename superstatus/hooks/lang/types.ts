// A language file (the owner 2026-10-11 s34 「做繁體中文(zh-TW) English 日文 還有 新增語言」「語言文件未來可以開放自己翻譯自己新增的…(要做版本防呆）」
// 「寬度名稱定義在語言檔裡面」). The built-in ones are these objects; a user's is the same shape as JSON in .claude/superstatus/lang. Every
// string has a key; {name} in a string is filled in. A key the file does not have is English. What is never in a file: the names and sends
// a user typed for his cards, and the system names (StatusLine, AbovePrompt, showchart…, H1-1…, SL-0…: docs/modules.md).
export const LANG_FORMAT = 1

export type LangRules = {
  // the most characters a card's name may have (a name button holds 5.5 Chinese characters: four of them, or about nine Latin letters)
  nameMax: number
}

export type LangFile = {
  // which shape of file this is: a superstatus that reads another refuses it (版本防呆)
  format: number
  // the language's code (en, zh-TW, ja, fr, …) and its name in itself, as the language list shows it
  code: string
  name: string
  rules: LangRules
  strings: Record<string, string>
}

export type Translate = (key: string, vars?: Record<string, string | number>, fallback?: string) => string
