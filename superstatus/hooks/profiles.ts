// Profiles (the owner 2026-10-12 s36 「我要做個Profile 存檔跟載入的機制 要直接在Pane 可以匯入匯出」; the design left to Claude, then 「go」):
// one .json file a profile, holding the whole look (the settings and the language), with a kind and a format number so a file of
// another kind or a newer format is refused (as a language file is). The file is what is exported and imported: the kit has no upload,
// download or clipboard to a remote surface. Plain functions here; the pane and the folder are register.tsx's.
import type { SlSettings } from '../types'
import { zoneOffsetMs } from './zone'

export const PROFILE_KIND = 'superstatus-profile'
export const PROFILE_FORMAT = 1
// a name is a file name: long enough for 「公司 Mac 開發用」, short enough for a row of the pane
export const PROFILE_NAME_MAX = 30

export type Profile = { kind: string; format: number; name: string; savedAt: string; version: string; language?: string; settings: Record<string, unknown> }

export type ProfileCheck =
  | { ok: true; profile: Profile }
  // why: a key of the language files ('profile.bad.…'), with what fills it
  | { ok: false; why: string; vars?: Record<string, string | number> }

export function makeProfile(args: { name: string; savedAt: number; version: string; language: string; settings: SlSettings }): string {
  const profile: Profile = {
    kind: PROFILE_KIND,
    format: PROFILE_FORMAT,
    name: args.name.trim(),
    savedAt: new Date(args.savedAt).toISOString(),
    version: args.version,
    language: args.language,
    settings: args.settings as unknown as Record<string, unknown>,
  }

  return `${JSON.stringify(profile, null, 2)}\n`
}

// A file as read (its text): refused when it is not JSON, not a superstatus profile, of another format, or without a name or settings.
// The settings are taken as they are; register.tsx puts them through the same checks as the store's when it loads them.
export function checkProfile(text: string): ProfileCheck {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, why: 'profile.bad.json' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'profile.bad.kind' }
  const file = raw as Partial<Profile>
  if (file.kind !== PROFILE_KIND) return { ok: false, why: 'profile.bad.kind' }
  if (file.format !== PROFILE_FORMAT) return { ok: false, why: 'profile.bad.format', vars: { got: String(file.format ?? '?'), want: PROFILE_FORMAT } }
  const settings = file.settings as unknown
  if (typeof file.name !== 'string' || file.name.trim() === '' || settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, why: 'profile.bad.fields' }
  }
  const profile: Profile = {
    kind: PROFILE_KIND,
    format: PROFILE_FORMAT,
    name: file.name.trim(),
    savedAt: typeof file.savedAt === 'string' ? file.savedAt : '',
    version: typeof file.version === 'string' ? file.version : '',
    settings: settings as Record<string, unknown>,
  }
  if (typeof file.language === 'string') profile.language = file.language

  return { ok: true, profile }
}

export const fileOf = (name: string) => `${name.trim()}.json`

// What is wrong with a name typed for 存檔, or undefined: a name is a file name in the profiles folder, on Linux and on a Mac.
export function nameProblem(name: string): { why: string; vars?: Record<string, string | number> } | undefined {
  const trimmed = name.trim()
  if (trimmed === '') return { why: 'profile.err.name' }
  const n = [...trimmed].length
  if (n > PROFILE_NAME_MAX) return { why: 'profile.err.nameLong', vars: { n, max: PROFILE_NAME_MAX } }
  if (/[/\\:*?"<>|\u0000-\u001f\u007f]/.test(trimmed) || trimmed.startsWith('.')) return { why: 'profile.err.nameChars' }
  return undefined
}

// A card that runs something, as the pane lists it before a load: how ('command' a 指令卡, bash on this machine at every turn end;
// 'host' a ! 按鈕卡, bash on this machine when pressed; 'send' a 按鈕卡 that sends words or a / command as the user; 'switch' a 開關卡,
// its command with the on and the off arguments) and what.
export type Runs = { name: string; how: 'command' | 'host' | 'send' | 'switch'; text: string }

export function runsThings(settings: { cards?: unknown }): Runs[] {
  const cards = Array.isArray(settings.cards) ? settings.cards : []
  const runs: Runs[] = []
  for (const raw of cards) {
    if (raw === null || typeof raw !== 'object') continue
    const card = raw as Record<string, unknown>
    const name = typeof card['name'] === 'string' ? card['name'] : ''
    const text = typeof card['text'] === 'string' ? card['text'].trim() : ''
    if (card['kind'] === 'command') runs.push({ name, how: 'command', text })
    else if (card['kind'] === 'button' && text.startsWith('!')) runs.push({ name, how: 'host', text: text.slice(1).trim() })
    else if (card['kind'] === 'button') runs.push({ name, how: 'send', text })
    else if (card['kind'] === 'switch') {
      const command = `/${text.replace(/^\//, '')}`
      const arg = (key: string) => (typeof card[key] === 'string' ? ` ${String(card[key]).trim()}` : '')
      runs.push({ name, how: 'switch', text: `${command}${arg('onArgs')} · ${command}${arg('offArgs')}` })
    }
  }

  return runs
}

// When a profile was saved, as month-day hour:minute in the machine's own time zone (s45; Taiwan's until then), or one handed in
// as its offset; ? when it cannot be read.
export function savedLabel(savedAt: string, offsetMs?: number): string {
  const ms = Date.parse(savedAt)
  if (Number.isNaN(ms)) return '?'
  const t = new Date(ms + (offsetMs ?? zoneOffsetMs(ms)))
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())} ${two(t.getUTCHours())}:${two(t.getUTCMinutes())}`
}
