// The action modules: buttons that work superstatus itself (the owner 2026-10-10 s33 「把9按鈕設定為重新載入」).
import type { SsModule } from './types'

export const ACTION_MODULES: readonly SsModule[] = [
  { id: 'action.reload', name: 'Reload', group: 'action', about: "a press: read the settings and the project's files again, then reload the plugins (/reload-plugins)", role: 'button', press: () => ({ kind: 'reload' }) },
  { id: 'action.panel', name: 'Settings', group: 'action', about: 'a press: open the /ss panel', role: 'button', press: () => ({ kind: 'panel' }) },
]
