import { describe, expect, test } from 'claude-code/testing'

import { checkProfile, fileOf, makeProfile, nameProblem, PROFILE_FORMAT, PROFILE_KIND, PROFILE_NAME_MAX, runsThings, savedLabel } from '../hooks/profiles'

// Profiles on their own (the owner 2026-10-12 s36 「我要做個Profile 存檔跟載入的機制 要直接在Pane 可以匯入匯出」, the design left to Claude, then
// 「go」): one .json file a profile, with a format number like a language file's, holding the whole look; the file is what is exported and
// imported. These are the plain functions; tests/status.test.tsx drives the Profile pane.

const SETTINGS = {
  off: ['tools'],
  note: '',
  icons: false,
  order: ['ver', 'who', 'c1'],
  cards: [
    { id: 'c1', kind: 'text', name: '下一步', text: '等回覆', prefix: '' },
    { id: 'c2', kind: 'command', name: '負載', text: 'uptime | cut -d, -f3', prefix: '', section: 'above', size: 'H2' },
    { id: 'c3', kind: 'button', name: '快照', text: '!vzdump 100', prefix: '', section: 'above' },
    { id: 'c4', kind: 'button', name: '說明', text: '--h', prefix: '', section: 'above' },
    { id: 'c5', kind: 'switch', name: '探針', text: 'probe', prefix: '', onArgs: 'on', offArgs: 'off', section: 'above' },
    { id: 'c6', kind: 'module', name: '主機', text: 'host.resources', prefix: '', section: 'above', size: 'H3' },
    { id: 'c7', kind: 'button', name: '存檔', text: '/ss reload', prefix: '', section: 'above' },
  ],
}
// 2026-10-12 17:40 in Taiwan
const AT = Date.UTC(2026, 9, 12, 9, 40)

describe('a profile file', () => {
  test('is JSON with the kind, the format, the name, when it was saved, the version, the language and the settings, read back whole', () => {
    const text = makeProfile({ name: '工作', savedAt: AT, version: '0.3', language: 'zh-TW', settings: SETTINGS as never })

    expect(text.endsWith('\n')).toBe(true)
    const raw = JSON.parse(text) as Record<string, unknown>
    expect(raw['kind']).toBe('superstatus-profile')
    expect(raw['format']).toBe(1)
    expect(raw['name']).toBe('工作')
    expect(raw['savedAt']).toBe('2026-10-12T09:40:00.000Z')
    expect(raw['version']).toBe('0.3')
    expect(raw['language']).toBe('zh-TW')
    expect(raw['settings']).toEqual(SETTINGS)

    const checked = checkProfile(text)
    expect(checked.ok).toBe(true)
    if (checked.ok) {
      expect(checked.profile.name).toBe('工作')
      expect(checked.profile.language).toBe('zh-TW')
      expect(checked.profile.settings).toEqual(SETTINGS)
    }
    expect(PROFILE_KIND).toBe('superstatus-profile')
    expect(PROFILE_FORMAT).toBe(1)
  })

  test('a file that is not JSON, not a profile, of a newer format, or without a name or settings is refused, saying which', () => {
    const good = JSON.parse(makeProfile({ name: 'a', savedAt: AT, version: '0.3', language: 'en', settings: SETTINGS as never })) as Record<string, unknown>
    const why = (text: string) => {
      const checked = checkProfile(text)
      return checked.ok ? 'ok' : `${checked.why} ${JSON.stringify(checked.vars ?? {})}`
    }

    expect(why('{ not json')).toBe('profile.bad.json {}')
    expect(why('[1, 2]')).toBe('profile.bad.kind {}')
    expect(why(JSON.stringify({ ...good, kind: 'something-else' }))).toBe('profile.bad.kind {}')
    expect(why(JSON.stringify({ ...good, format: 2 }))).toBe('profile.bad.format {"got":"2","want":1}')
    expect(why(JSON.stringify({ ...good, format: undefined }))).toBe('profile.bad.format {"got":"?","want":1}')
    expect(why(JSON.stringify({ ...good, name: '  ' }))).toBe('profile.bad.fields {}')
    expect(why(JSON.stringify({ ...good, settings: [] }))).toBe('profile.bad.fields {}')
    expect(why(JSON.stringify({ ...good, settings: undefined }))).toBe('profile.bad.fields {}')
    // a language that is not text is left out, the rest kept
    const noLang = checkProfile(JSON.stringify({ ...good, language: 7 }))
    expect(noLang.ok && noLang.profile.language).toBeUndefined()
  })

  test('the file is the name with .json; a name is refused when empty, longer than the most, or holding what a file name cannot', () => {
    expect(fileOf(' 工作 ')).toBe('工作.json')
    expect(PROFILE_NAME_MAX).toBe(30)
    expect(nameProblem('工作')).toBeUndefined()
    expect(nameProblem('Alex home 2')).toBeUndefined()
    expect(nameProblem('   ')).toEqual({ why: 'profile.err.name' })
    expect(nameProblem('x'.repeat(30))).toBeUndefined()
    expect(nameProblem('x'.repeat(31))).toEqual({ why: 'profile.err.nameLong', vars: { n: 31, max: 30 } })
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', '.hidden', 'a\nb', 'a\tb']) {
      expect(nameProblem(bad)).toEqual({ why: 'profile.err.nameChars' })
    }
  })

  test('the cards that run things are listed with what they run: a command card each turn, a ! button on this machine, a button that sends, a switch', () => {
    expect(runsThings(SETTINGS)).toEqual([
      { name: '負載', how: 'command', text: 'uptime | cut -d, -f3' },
      { name: '快照', how: 'host', text: 'vzdump 100' },
      { name: '說明', how: 'send', text: '--h' },
      { name: '探針', how: 'switch', text: '/probe on · /probe off' },
      { name: '存檔', how: 'send', text: '/ss reload' },
    ])
    // what a file holds may be anything: what is not a card of those kinds is passed over
    expect(runsThings({ cards: [null, 7, { kind: 'command' }, { kind: 'text', name: 'x', text: 'y' }] })).toEqual([
      { name: '', how: 'command', text: '' },
    ])
    expect(runsThings({})).toEqual([])
    expect(runsThings({ cards: 'x' })).toEqual([])
  })

  test('when it was saved reads as month-day hour:minute in Taiwan time; a time that cannot be read is ?', () => {
    expect(savedLabel('2026-10-12T09:40:00.000Z')).toBe('10-12 17:40')
    expect(savedLabel('2026-12-31T16:05:00.000Z')).toBe('01-01 00:05')
    expect(savedLabel('soon')).toBe('?')
  })
})
