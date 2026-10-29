// Every module superstatus offers in the 新增卡片 pane, in the order listed there. To add one (docs/modules.md): write a file beside
// these that exports SsModule objects, and add it to the list below.
import { ACTION_MODULES } from './actions'
import { HOST_MODULES } from './host'
import { SESSION_MODULES } from './session'
import type { SsModule } from './types'

export const MODULES: readonly SsModule[] = [...HOST_MODULES, ...SESSION_MODULES, ...ACTION_MODULES]

// A user's own modules, read from .claude/superstatus/modules at a session's start and at every reload (s43, register.tsx
// scanUserModules). A module variable, so a hot reload starts it empty and the scan fills it again, as the languages are.
let userModules: readonly SsModule[] = []
export const setUserModules = (list: readonly SsModule[]) => {
  userModules = list
}

// Every module on offer: the built-ins first, then the user's. The 新增卡片 pane and moduleOf both read this, so the two
// cannot drift apart (a user's id is always under user., so a built-in can never be taken: hooks/usermods USER_MOD_ID).
export const allModules = (): readonly SsModule[] => [...MODULES, ...userModules]

export const moduleOf = (id: string): SsModule | undefined => allModules().find(m => m.id === id)

export type { ChartBox, JournalEvent, ModuleEffect, ModuleInput, SessionFacts, SsModule } from './types'
export { H3_LINES, isRhythm, RHYTHM_SECONDS, RHYTHMS, runKey } from './types'
export type { Rhythm } from './types'
