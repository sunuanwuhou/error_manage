import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const originalCwd = process.cwd()
const originalNextAuthUrl = process.env.NEXTAUTH_URL
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-public-url-'))

process.chdir(tempRoot)

const runtimeModule = await import('./runtime-public-url.ts')

test.after(() => {
  process.chdir(originalCwd)
  if (originalNextAuthUrl === undefined) {
    delete process.env.NEXTAUTH_URL
  } else {
    process.env.NEXTAUTH_URL = originalNextAuthUrl
  }
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

test('prefers runtime public origin over tunnel and env', () => {
  process.env.NEXTAUTH_URL = 'http://localhost:3000'
  runtimeModule.writeTunnelUrl('https://paper.trycloudflare.com')
  runtimeModule.writeRuntimePublicOrigin('https://public.example.com/path')

  assert.equal(runtimeModule.getEffectivePublicOrigin(), 'https://public.example.com')
  assert.equal(runtimeModule.syncNextAuthUrlFromRuntime(), 'https://public.example.com')
  assert.equal(process.env.NEXTAUTH_URL, 'https://public.example.com')
})

test('falls back to tunnel url when runtime override is absent', () => {
  runtimeModule.clearRuntimePublicOrigin()
  runtimeModule.writeTunnelUrl('https://fresh.trycloudflare.com')

  assert.equal(runtimeModule.getEffectivePublicOrigin(), 'https://fresh.trycloudflare.com')

  const state = runtimeModule.getPublicOriginState()
  assert.equal(state.publicOriginSource, 'tunnel')
  assert.equal(state.tunnelUrl, 'https://fresh.trycloudflare.com')
})

test('clears tunnel and runtime files cleanly', () => {
  runtimeModule.writeTunnelUrl('https://clear.trycloudflare.com')
  runtimeModule.writeRuntimePublicOrigin('https://clear.example.com')

  runtimeModule.clearTunnelUrl()
  runtimeModule.clearRuntimePublicOrigin()

  assert.equal(runtimeModule.readTunnelUrl(), null)
  assert.equal(runtimeModule.readRuntimePublicOrigin(), null)
})
