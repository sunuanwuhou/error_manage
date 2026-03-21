import { spawn } from 'node:child_process'
import process from 'node:process'

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
    return [key, value]
  }),
)

const requestedMode = args.get('mode') ?? 'auto'
const prepareOnly = args.get('prepare-only') === 'true'
const skipBrowserInstall = args.get('skip-browser-install') === 'true'
const mode = requestedMode === 'auto'
  ? process.platform === 'win32'
    ? 'docker'
    : 'local'
  : requestedMode

const baseEnv = { ...process.env }
const dockerDbPort = baseEnv.HOST_DB_PORT ?? '55432'
const defaultLocalDbUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/wrongquestion'
const defaultDockerDbUrl = `postgresql://postgres:postgres@127.0.0.1:${dockerDbPort}/wrongquestion`

function run(command, commandArgs, env = baseEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    })

    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${code}`))
    })
    child.on('error', reject)
  })
}

async function ensureDockerStack(env) {
  await run('docker', ['ps'], env)
  await run('docker', ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml', 'up', '-d', 'db', 'app'], env)
}

async function main() {
  const selectedDbUrl = mode === 'docker'
    ? baseEnv.E2E_DATABASE_URL ?? baseEnv.DATABASE_URL_DOCKER ?? defaultDockerDbUrl
    : baseEnv.E2E_DATABASE_URL ?? baseEnv.DATABASE_URL_LOCAL ?? defaultLocalDbUrl
  const selectedDirectUrl = mode === 'docker'
    ? baseEnv.E2E_DIRECT_URL ?? baseEnv.DIRECT_URL_DOCKER ?? selectedDbUrl
    : baseEnv.E2E_DIRECT_URL ?? baseEnv.DIRECT_URL_LOCAL ?? selectedDbUrl
  const env = {
    ...baseEnv,
    E2E_DATABASE_URL: selectedDbUrl,
    E2E_DIRECT_URL: selectedDirectUrl,
    DATABASE_URL: selectedDbUrl,
    DIRECT_URL: selectedDirectUrl,
  }

  if (mode === 'docker') {
    env.PLAYWRIGHT_BASE_URL = env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
    env.HOST_DB_PORT = dockerDbPort
    await ensureDockerStack(env)
  } else if (mode !== 'local') {
    throw new Error(`Unsupported smoke mode: ${mode}`)
  }

  await run('npx', ['prisma', 'db', 'push', '--skip-generate'], env)
  await run('node', ['scripts/seed-admin.ts'], env)
  if (prepareOnly) {
    return
  }
  if (!skipBrowserInstall) {
    await run('npx', ['playwright', 'install', 'chromium'], env)
  }
  await run('npx', ['playwright', 'test'], env)
}

main().catch((error) => {
  console.error(`[smoke:frontend] ${mode} mode failed`)
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
