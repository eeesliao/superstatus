// The time zone the mod's clocks follow (s45, the owner 「都給你改」): the machine the session runs on, as its own runtime reports it
// (measured s45 on the dev host: getTimezoneOffset -480, Intl Asia/Taipei — the same as the host). Until s45 every clock was fixed to
// Taiwan's UTC+8, which put a Tokyo user's day change at 01:00 and a New York user's in the afternoon. The engine's API names no
// zone, so this is the one place the runtime's is read; everything else is handed the offset, which is how the tests try other zones.
export const DAY_MS = 86400000

// The zone's offset from UTC at that instant, in ms (east positive: Taipei +8 h). Taken per instant, so a summer-time change counts.
export const zoneOffsetMs = (ms: number) => -new Date(ms).getTimezoneOffset() * 60000

// The day number (days since 1970-01-01) an instant falls on in a zone given by its offset.
export const localDay = (ms: number, offsetMs: number) => Math.floor((ms + offsetMs) / DAY_MS)
