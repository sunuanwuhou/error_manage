import fs from 'node:fs'
import path from 'node:path'

const RUNTIME_DIR = path.join(process.cwd(), '.runtime')
const TUNNEL_URL_FILE = path.join(RUNTIME_DIR, 'tunnel-url.txt')
const PUBLIC_ORIGIN_FILE = path.join(RUNTIME_DIR, 'public-origin.txt')
const LEGACY_TUNNEL_FILE = path.join(process.cwd(), '.tunnel-url')

function readTrimmedFile(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return null
    const value = fs.readFileSync(filePath, 'utf8').trim()
    return value || null
  } catch {
    return null
  }
}

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null

  try {
    const url = new URL(value)
    return url.origin.replace(/\/$/, '')
  } catch {
    return null
  }
}

export function getRuntimeDir() {
  return RUNTIME_DIR
}

export function getTunnelUrlFilePath() {
  return TUNNEL_URL_FILE
}

export function readTunnelUrl() {
  return normalizeOrigin(readTrimmedFile(TUNNEL_URL_FILE) ?? readTrimmedFile(LEGACY_TUNNEL_FILE))
}

export function writeTunnelUrl(url: string) {
  const normalized = normalizeOrigin(url)
  if (!normalized) return null

  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  fs.writeFileSync(TUNNEL_URL_FILE, normalized)
  return normalized
}

export function clearTunnelUrl() {
  for (const filePath of [TUNNEL_URL_FILE, LEGACY_TUNNEL_FILE]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {}
  }
}

export function readRuntimePublicOrigin() {
  return normalizeOrigin(readTrimmedFile(PUBLIC_ORIGIN_FILE))
}

export function writeRuntimePublicOrigin(url: string) {
  const normalized = normalizeOrigin(url)
  if (!normalized) return null

  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  fs.writeFileSync(PUBLIC_ORIGIN_FILE, normalized)
  return normalized
}

export function clearRuntimePublicOrigin() {
  try {
    if (fs.existsSync(PUBLIC_ORIGIN_FILE)) fs.unlinkSync(PUBLIC_ORIGIN_FILE)
  } catch {}
}

export function getConfiguredNextAuthOrigin() {
  return normalizeOrigin(process.env.NEXTAUTH_URL)
}

export function getEffectivePublicOrigin() {
  return readRuntimePublicOrigin() ?? readTunnelUrl() ?? getConfiguredNextAuthOrigin()
}

export function syncNextAuthUrlFromRuntime() {
  const effectiveOrigin = getEffectivePublicOrigin()
  if (effectiveOrigin) {
    process.env.NEXTAUTH_URL = effectiveOrigin
  }
  return effectiveOrigin
}

export function getPublicOriginState() {
  const configured = getConfiguredNextAuthOrigin()
  const tunnel = readTunnelUrl()
  const runtime = readRuntimePublicOrigin()
  const effective = runtime ?? tunnel ?? configured

  return {
    configuredNextAuthUrl: configured,
    tunnelUrl: tunnel,
    runtimePublicOrigin: runtime,
    effectivePublicOrigin: effective,
    publicOriginSource: runtime ? 'runtime' : tunnel ? 'tunnel' : configured ? 'env' : null,
    nextAuthMatchesEffectiveOrigin: !configured || !effective ? configured === effective : configured === effective,
  }
}
