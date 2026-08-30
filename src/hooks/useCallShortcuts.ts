import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isShortcutAction,
  setShortcutBinding,
  shortcutActions,
  shortcutFromKeyboardEvent,
} from '../services/shortcuts'
import { getShortcutBindings, saveShortcutBindings } from '../storage/preferences'
import type { ShortcutAction, ShortcutBindings } from '../types'

type ShortcutHandlers = Record<ShortcutAction, () => void>

export const useCallShortcuts = (handlers: ShortcutHandlers, webEnabled: boolean) => {
  const [bindings, setBindingsState] = useState<ShortcutBindings>(getShortcutBindings)
  const [failedActions, setFailedActions] = useState<ShortcutAction[]>([])
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const setBinding = useCallback((action: ShortcutAction, binding: string) => {
    setBindingsState((current) => {
      const next = setShortcutBinding(current, action, binding)
      saveShortcutBindings(next)
      return next
    })
  }, [])

  useEffect(() => {
    const desktop = window.fordKallDesktop
    if (!desktop) return
    const stopShortcut = desktop.onShortcut((action) => {
      if (isShortcutAction(action)) handlersRef.current[action]()
    })
    const stopStatus = desktop.onShortcutStatus((status) => {
      setFailedActions(status.failedActions.filter(isShortcutAction))
    })
    return () => {
      stopShortcut()
      stopStatus()
    }
  }, [])

  useEffect(() => {
    const desktop = window.fordKallDesktop
    if (!desktop) return
    desktop.setShortcutBindings(bindings)
  }, [bindings])

  useEffect(() => {
    const desktop = window.fordKallDesktop
    if (!desktop) return
    desktop.setShortcutCaptureActive(!webEnabled)
    return () => desktop.setShortcutCaptureActive(false)
  }, [webEnabled])

  useEffect(() => {
    if (window.fordKallDesktop || !webEnabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return

      const binding = shortcutFromKeyboardEvent(event)
      if (!binding) return
      const action = shortcutActions.find((candidate) => (
        Boolean(bindings[candidate]) && bindings[candidate] === binding
      ))
      if (!action) return
      event.preventDefault()
      handlersRef.current[action]()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [bindings, webEnabled])

  return { bindings, failedActions, setBinding }
}
