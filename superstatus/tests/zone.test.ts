import { describe, expect, test } from 'claude-code/testing'

import { savedLabel } from '../hooks/profiles'
import { localDay, zoneOffsetMs } from '../hooks/zone'

// s45 (the owner 「都給你改」, after the countdown and the Profile times were found fixed to Taiwan's UTC+8): every clock the mod shows
// follows the time zone of the machine the session runs on. The test runtime is Asia/Taipei whatever TZ says (measured s45: TZ=
// America/New_York, Asia/Tokyo and UTC all read -480), so the zone is handed in here as an offset; the one place that reads the
// runtime's own is zoneOffsetMs.
const H = 3600000

describe("the clock follows the machine's own time zone, not Taiwan's (s45)", () => {
  test("a profile saved at 00:00 UTC reads as each zone's own time", () => {
    expect(savedLabel('2026-10-20T00:00:00.000Z', -4 * H)).toBe('10-19 20:00')
    expect(savedLabel('2026-10-20T00:00:00.000Z', 9 * H)).toBe('10-20 09:00')
    expect(savedLabel('2026-10-20T00:00:00.000Z', 0)).toBe('10-20 00:00')
    expect(savedLabel('soon', 9 * H)).toBe('?')
  })

  test("the day turns at each zone's own midnight", () => {
    const day = Date.UTC(2026, 9, 20) / 86400000
    // 15:30 UTC: 23:30 in Taipei, 00:30 the next day in Tokyo, 11:30 in New York
    const t = Date.UTC(2026, 9, 20, 15, 30)
    expect(localDay(t, 8 * H)).toBe(day)
    expect(localDay(t, 9 * H)).toBe(day + 1)
    expect(localDay(t, -4 * H)).toBe(day)
    // 02:00 UTC is still the evening before in New York
    expect(localDay(Date.UTC(2026, 9, 20, 2), -4 * H)).toBe(day - 1)
  })

  test("with no zone handed in, the runtime's own is used", () => {
    const t = Date.UTC(2026, 9, 20)
    expect(zoneOffsetMs(t)).toBe(-new Date(t).getTimezoneOffset() * 60000)
    expect(savedLabel('2026-10-20T00:00:00.000Z')).toBe(savedLabel('2026-10-20T00:00:00.000Z', zoneOffsetMs(t)))
  })
})
