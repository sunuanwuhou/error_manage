import fs from 'fs'
import path from 'path'

function parseEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return

  const contents = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) continue

    const key = line.slice(0, equalsIndex).trim()
    if (!key || process.env[key]) continue

    let value = line.slice(equalsIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}

export function loadProjectEnv() {
  const projectRoot = path.resolve(__dirname, '../..')
  parseEnvFile(path.join(projectRoot, '.env.local'))
  parseEnvFile(path.join(projectRoot, '.env'))
}
