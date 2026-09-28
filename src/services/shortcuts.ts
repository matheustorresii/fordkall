import type { ShortcutAction, ShortcutBindings } from '../types'

export const shortcutActions: ShortcutAction[] = [
  'microphone',
  'deafen',
  'camera',
  'screenShare',
  'leave',
]

const modifierKeys = new Set(['Alt', 'Control', 'Meta', 'Shift'])

const shortcutKeysByCode: Record<string, string> = {
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Insert: 'Insert',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  CapsLock: 'Capslock',
  NumLock: 'Numlock',
  ScrollLock: 'Scrolllock',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Escape: 'Escape',
  Semicolon: ';',
  Equal: '=',
  Comma: ',',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  Backslash: '\\',
  BracketRight: ']',
  NumpadDecimal: 'numdec',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
}

const shortcutKey = (event: KeyboardEvent) => {
  if (modifierKeys.has(event.key)) return ''
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.key)) return event.key
  if (/^Numpad[0-9]$/.test(event.code)) return `num${event.code.slice(-1)}`
  if (/^[a-z0-9]$/i.test(event.key)) return event.key.toUpperCase()
  return shortcutKeysByCode[event.code] ?? shortcutKeysByCode[event.key] ?? ''
}

export const shortcutFromKeyboardEvent = (event: KeyboardEvent) => {
  const key = shortcutKey(event)
  if (!key) return ''

  const modifiers = [
    event.ctrlKey ? 'Control' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Super' : '',
  ].filter(Boolean)

  return [...modifiers, key].join('+')
}

export const formatShortcutBinding = (binding: string) => binding
  .replace('Control', 'Ctrl')
  .replace('Super', 'Win')
  .split('+')
  .join(' + ')

export const setShortcutBinding = (
  bindings: ShortcutBindings,
  action: ShortcutAction,
  binding: string,
) => Object.fromEntries(
  shortcutActions.map((candidate) => [
    candidate,
    candidate === action
      ? binding
      : binding && bindings[candidate] === binding
        ? ''
        : bindings[candidate],
  ]),
) as ShortcutBindings

export const isShortcutAction = (value: unknown): value is ShortcutAction =>
  typeof value === 'string' && shortcutActions.includes(value as ShortcutAction)
