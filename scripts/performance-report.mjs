// Initial HTML dependency graph only, not total assets or game FPS.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
const root = resolve(import.meta.dirname, '..', 'dist')
const references = (html, extension) => [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(path => path.startsWith('./assets/') && path.endsWith(extension)))]
async function measure(html, load) {
  const result = {}
  for (const extension of ['.js', '.css']) {
    const files = references(html, extension), buffers = await Promise.all(files.map(load))
    result[extension.slice(1)] = { files: files.length, bytes: buffers.reduce((sum, buffer) => sum + buffer.length, 0), gzipBytes: buffers.reduce((sum, buffer) => sum + gzipSync(buffer).length, 0) }
  }
  return result
}
const current = await measure(await readFile(resolve(root, 'index.html'), 'utf8'), path => readFile(resolve(root, path)))
const result = { local: current, note: 'Initial HTML entry + modulepreload/style dependencies. Does not measure game FPS or imply lower total precache downloads.' }
if (process.argv.includes('--compare-web')) {
  const base = 'https://fordkall.11a3.dev/'
  const get = async path => { const response = await fetch(new URL(path, base), { cache: 'no-store' }); if (!response.ok) throw Error(`Public asset HTTP ${response.status}`); return Buffer.from(await response.arrayBuffer()) }
  const version = JSON.parse((await get('pwa-version.json')).toString())
  result.production = { version: version.version, ...await measure((await get('')).toString(), get) }
  result.initialGzipReductionPercent = { js: Math.round(100 * (1 - current.js.gzipBytes / result.production.js.gzipBytes)), css: Math.round(100 * (1 - current.css.gzipBytes / result.production.css.gzipBytes)) }
}
console.log(JSON.stringify(result, null, 2))
