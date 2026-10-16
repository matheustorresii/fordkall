import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The drawing fonts must work in the desktop app too, without a CDN dependency.
const packageRoot = dirname(fileURLToPath(import.meta.resolve('@excalidraw/excalidraw')))
const target = resolve('public/excalitower')
mkdirSync(target, { recursive: true })
cpSync(resolve(packageRoot, 'fonts'), resolve(target, 'fonts'), { recursive: true })
