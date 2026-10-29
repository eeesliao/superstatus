// The languages: the built-in files, a translator for one of them, and the check a user's file passes before it is offered (版本防呆).
import { EN } from './en'
import { JA } from './ja'
import type { LangFile, Translate } from './types'
import { LANG_FORMAT } from './types'
import { ZH_TW } from './zh-TW'

export const BUILT_IN: readonly LangFile[] = [EN, ZH_TW, JA]

// A key's string in the language, else in English, else the fallback (a module's own words), else the key itself; {name} filled in.
export function translator(lang: LangFile): Translate {
  return (key, vars, fallback) => {
    const raw = lang.strings[key] ?? EN.strings[key] ?? fallback ?? key
    return vars === undefined ? raw : raw.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
  }
}

export type LangCheck =
  | { ok: true; lang: LangFile; missing: number }
  // why: a key of the language files ('lang.why.…'), with what fills it
  | { ok: false; why: string; vars?: Record<string, string | number> }

const CODE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

// A user's language file as read (its text): refused when it is not JSON, of another format, without a code or strings; a string that
// is not text is left out; what it leaves out is English (counted); a name rule out of reason is English's.
export function checkLang(text: string): LangCheck {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, why: 'lang.why.json' }
  }
  const file = (raw ?? {}) as Partial<LangFile>
  if (file.format !== LANG_FORMAT) return { ok: false, why: 'lang.why.format', vars: { got: String(file.format ?? '?'), want: LANG_FORMAT } }
  if (typeof file.code !== 'string' || !CODE.test(file.code)) return { ok: false, why: 'lang.why.code' }
  if (file.strings === null || typeof file.strings !== 'object' || Array.isArray(file.strings)) return { ok: false, why: 'lang.why.strings' }
  const strings: Record<string, string> = {}
  for (const [key, value] of Object.entries(file.strings)) if (typeof value === 'string' && key in EN.strings) strings[key] = value
  const nameMax = Number(file.rules?.nameMax)
  const lang: LangFile = {
    format: LANG_FORMAT,
    code: file.code,
    name: typeof file.name === 'string' && file.name.trim() !== '' ? file.name.trim() : file.code,
    rules: { nameMax: Number.isInteger(nameMax) && nameMax >= 1 && nameMax <= 20 ? nameMax : EN.rules.nameMax },
    strings,
  }

  return { ok: true, lang, missing: Object.keys(EN.strings).filter(key => !(key in strings)).length }
}

export { EN, JA, ZH_TW }
export type { LangFile, Translate } from './types'
export { LANG_FORMAT } from './types'
