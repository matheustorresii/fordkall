import { readFile, mkdir, writeFile, copyFile, access } from 'node:fs/promises'
import { randomBytes, X509Certificate, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const privateDir = resolve(root, '.android-signing')
const generatedDir = resolve(root, '.android-build')
const credentialsFile = resolve(privateDir, 'credentials.json')
const exists = async (path) => access(path).then(() => true, () => false)
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`)
  return result.stdout
}
await mkdir(generatedDir, { recursive: true, mode: 0o700 })
let config
if (process.env.ANDROID_KEYSTORE_BASE64) {
  const file = resolve(generatedDir, 'release.jks')
  await writeFile(file, Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, 'base64'), { mode: 0o600 })
  config = { file, alias: process.env.ANDROID_KEY_ALIAS || 'fordkall', password: process.env.ANDROID_KEYSTORE_PASSWORD, keyPassword: process.env.ANDROID_KEY_PASSWORD || process.env.ANDROID_KEYSTORE_PASSWORD }
} else if (await exists(credentialsFile)) {
  config = JSON.parse(await readFile(credentialsFile, 'utf8'))
  config.file = resolve(privateDir, 'release.jks')
} else if (process.argv.includes('--init-signing')) {
  await mkdir(privateDir, { recursive: true, mode: 0o700 })
  config = { file: resolve(privateDir, 'release.jks'), alias: 'fordkall', password: randomBytes(32).toString('hex') }
  config.keyPassword = config.password
  const env = { ...process.env, FK_ANDROID_STORE_PASSWORD: config.password, FK_ANDROID_KEY_PASSWORD: config.keyPassword }
  run('keytool', ['-genkeypair', '-keystore', config.file, '-alias', config.alias, '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-storepass:env', 'FK_ANDROID_STORE_PASSWORD', '-keypass:env', 'FK_ANDROID_KEY_PASSWORD', '-dname', 'CN=Ford Kall, OU=Mobile, O=11A3, C=BR'], { env })
  await writeFile(credentialsFile, JSON.stringify(config, null, 2), { mode: 0o600 })
} else {
  throw new Error('Release signing key is missing. Never regenerate the key for an existing app. Restore .android-signing or set ANDROID_KEYSTORE_BASE64 and ANDROID_KEYSTORE_PASSWORD.')
}
if (!config.password || !config.keyPassword) throw new Error('Signing password is missing.')
const env = { ...process.env, FK_ANDROID_KEYSTORE: config.file, FK_ANDROID_STORE_PASSWORD: config.password, FK_ANDROID_KEY_ALIAS: config.alias, FK_ANDROID_KEY_PASSWORD: config.keyPassword }
const cert = run('keytool', ['-exportcert', '-rfc', '-keystore', config.file, '-alias', config.alias, '-storepass:env', 'FK_ANDROID_STORE_PASSWORD'], { env })
const fingerprint = new X509Certificate(cert).fingerprint256
console.log(`Android signing certificate SHA-256: ${fingerprint}`)
if (process.argv.includes('--init-signing')) {
  console.log('Signing key generated in the ignored .android-signing directory. Keep a secure backup; never commit it.')
  process.exit(0)
}
const links = JSON.parse(await readFile(resolve(root, 'public/.well-known/assetlinks.json'), 'utf8'))
if (!links.some((link) => link.target?.package_name === 'dev.elevena3.fordkall' && link.target.sha256_cert_fingerprints?.includes(fingerprint))) throw new Error('Signing key does not match public/.well-known/assetlinks.json. Refusing an unverified APK.')
if (process.argv.includes('--publish-signing-secrets')) {
  for (const [name, value] of Object.entries({ ANDROID_KEYSTORE_BASE64: (await readFile(config.file)).toString('base64'), ANDROID_KEYSTORE_PASSWORD: config.password, ANDROID_KEY_ALIAS: config.alias, ANDROID_KEY_PASSWORD: config.keyPassword })) {
    run('/opt/homebrew/bin/gh', ['secret', 'set', name, '--repo', 'matheustorresii/fordkall'], { input: value })
  }
  console.log('Release signing configured in GitHub Actions encrypted secrets.')
  process.exit(0)
}
const gradle = process.env.FK_GRADLE || resolve(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
const result = spawnSync(gradle, ['--no-daemon', 'testReleaseUnitTest', 'lintRelease', 'assembleRelease'], { cwd: resolve(root, 'android'), stdio: 'inherit', env })
if (result.error || result.status !== 0) process.exit(result.status || 1)
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const dir = resolve(root, 'release')
await mkdir(dir, { recursive: true })
const apk = resolve(dir, `Ford-Kall-${version}-android.apk`)
await copyFile(resolve(root, 'android/app/build/outputs/apk/release/app-release.apk'), apk)
const sha = createHash('sha256').update(await readFile(apk)).digest('hex')
await writeFile(apk + '.sha256', `${sha}  Ford-Kall-${version}-android.apk\n`)
console.log(`Signed APK: ${apk}\nSHA-256: ${sha}`)
