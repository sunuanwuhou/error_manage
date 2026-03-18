// src/app/api/ai/config/route.ts
// 返回当前 AI 配置状态（前端展示用哪个模型）

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAIConfig } from '@/lib/ai/provider'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  return NextResponse.json(getAIConfig())
}
