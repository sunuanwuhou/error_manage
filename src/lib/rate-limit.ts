// src/lib/rate-limit.ts
// 内存限流（§二.6：登录接口 5次/15分钟）
// 生产环境建议换 Redis，开发和小规模使用内存版足够

interface RateLimitRecord {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitRecord>()

// 定期清理过期记录（防内存泄漏）
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    store.forEach((v, k) => { if (v.resetAt < now) store.delete(k) })
  }, 60 * 1000)
}

interface RateLimitOptions {
  windowMs: number  // 时间窗口（毫秒）
  max:      number  // 窗口内最大请求数
}

interface RateLimitResult {
  allowed:   boolean
  remaining: number
  resetAt:   number
}

export function rateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const record = store.get(key)

  if (!record || record.resetAt < now) {
    // 新窗口
    const newRecord = { count: 1, resetAt: now + options.windowMs }
    store.set(key, newRecord)
    return { allowed: true, remaining: options.max - 1, resetAt: newRecord.resetAt }
  }

  if (record.count >= options.max) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt }
  }

  record.count++
  return { allowed: true, remaining: options.max - record.count, resetAt: record.resetAt }
}

// 预置规则
export const LOGIN_LIMIT    = { windowMs: 15 * 60 * 1000, max: 5   }  // 5次/15分钟
export const API_LIMIT      = { windowMs: 60 * 1000,       max: 60  }  // 60次/分钟
export const AI_LIMIT       = { windowMs: 60 * 1000,       max: 10  }  // 10次/分钟（AI接口更严）
