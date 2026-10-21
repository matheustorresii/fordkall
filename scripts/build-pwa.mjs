import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

export async function buildPwa(root = resolve(import.meta.dirname, '..')) {
  const dir = resolve(root, 'dist')
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const source = await readFile(resolve(root, 'src/pwa/service-worker.js'), 'utf8')
  const files = ['/index.html', '/offline.html', '/manifest.webmanifest', '/favicon.svg']
  for (const folder of ['assets', 'icons']) {
    for (const entry of await readdir(resolve(dir, folder))) {
      const file = resolve(dir, folder, entry)
      if ((await stat(file)).isFile() && (folder === 'icons' || /\.(js|css)$/.test(file))) {
        files.push('/' + relative(dir, file).replaceAll('\\', '/'))
      }
    }
  }
  const hash = createHash('sha256')
  hash.update(source)
  // Include bytes of public assets too: replacing an icon/manifest without changing JS must update SW.
  for (const file of files.sort()) hash.update(file).update(await readFile(resolve(dir, '.' + file)))
  const buildId = `${pkg.version}-${hash.digest('hex').slice(0, 16)}`
  const worker = source.replace('/*__BUILD__*/', JSON.stringify({ version: pkg.version, buildId, files }))
  await writeFile(resolve(dir, 'sw.js'), worker)
  await writeFile(resolve(dir, 'pwa-version.json'), JSON.stringify({ version: pkg.version, buildId }) + '\n')
  // Pages otherwise drops .well-known files when Jekyll is enabled; the deployment uploads dist directly.
  await writeFile(resolve(dir, '.nojekyll'), '')
  console.log(`PWA ${buildId}: ${files.length} public shell files; no API responses cached.`)
  return { version: pkg.version, buildId, files }
}

if (process.argv[1] === import.meta.filename) await buildPwa()
