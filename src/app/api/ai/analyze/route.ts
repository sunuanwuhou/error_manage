// src/app/api/ai/analyze/route.ts
// AI 分析接口（思路验证 + 首次诊断）

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { callAI } from '@/lib/ai/provider'
import { rateLimit, AI_LIMIT } from '@/lib/rate-limit'

const schema = z.object({
  type: z.enum(['verify_thinking', 'first_diagnosis']),
  questionContent: z.string(),
  correctAnswer:   z.string(),
  // verify_thinking
  userThinking:    z.string().optional(),
  sharedAnalysis:  z.string().optional(),
  // first_diagnosis
  myAnswer:        z.string().optional(),
  errorReason:     z.string().optional(),
})

// 调用 MiniMax API
async function callMiniMax(prompt: string): Promise<string> {
  const apiKey  = process.env.MINIMAX_API_KEY
  const groupId = process.env.MINIMAX_GROUP_ID

  if (!apiKey || !groupId) throw new Error('MiniMax API Key 未配置')

  const res = await fetch(`https://api.minimax.chat/v1/text/chatcompletion_v2`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'abab6.5s-chat',
      messages: [
        { role: 'system', content: '你是公务员行测解题助手，分析简洁准确，不超过100字。' },
        { role: 'user',   content: prompt },
      ],
      max_tokens: 300,
    }),
  })

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  // AI 接口限流（10次/分钟）
  const userId2 = (session.user as any).id
  const rl = rateLimit(`ai:${userId2}`, AI_LIMIT)
  if (!rl.allowed) return NextResponse.json({ error: 'AI 调用过于频繁，请稍后再试' }, { status: 429 })

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 })

  const d = parsed.data

  try {
    if (d.type === 'verify_thinking') {
      const prompt = `
题目：${d.questionContent}
正确答案：${d.correctAnswer}
${d.sharedAnalysis ? `参考解析：${d.sharedAnalysis}` : ''}

用户的解题思路：
${d.userThinking}

请判断用户思路是否正确。
- 如果思路完全正确：返回 {"verdict":"correct","feedback":""}
- 如果思路部分正确（方向对但有遗漏）：返回 {"verdict":"partial","feedback":"指出缺失的关键步骤，≤50字"}
- 如果思路有根本性错误：返回 {"verdict":"wrong","feedback":"指出错误所在，≤50字"}

只返回 JSON，不要其他内容。`

      const res2 = await callAI([{ role: "user", content: prompt }], { jsonOutput: true })
      const raw = res2.text
      try {
        const result = JSON.parse(raw.trim())
        return NextResponse.json(result)
      } catch {
        return NextResponse.json({ verdict: 'partial', feedback: 'AI 解析结果异常，请自行判断' })
      }
    }

    if (d.type === 'first_diagnosis') {
      const prompt = `
行测题目：${d.questionContent}
正确答案：${d.correctAnswer}
用户选了：${d.myAnswer}
用户认为的原因：${d.errorReason ?? '未填写'}

请用 JSON 格式输出：
{
  "aiRootReason": "根本原因（≤30字）",
  "aiErrorReason": "错误表象（≤30字）",
  "aiActionRule": "下次行动规则，格式：看到XX就XX（≤30字）",
  "aiThinking": "正确解题思路（步骤化，≤100字）"
}

只返回 JSON，不要其他内容。`

      const res2 = await callAI([{ role: "user", content: prompt }], { jsonOutput: true })
      const raw = res2.text
      try {
        const result = JSON.parse(raw.trim())
        return NextResponse.json(result)
      } catch {
        return NextResponse.json({
          aiRootReason:  '待分析',
          aiErrorReason: '待分析',
          aiActionRule:  '',
          aiThinking:    raw,
        })
      }
    }
  } catch (err: any) {
    // API Key 未配置或网络错误，降级处理
    console.error('[AI] 调用失败：', err.message)
    if (d.type === 'verify_thinking') {
      return NextResponse.json({ verdict: 'partial', feedback: 'AI 暂时不可用，请自行判断' })
    }
    return NextResponse.json({
      aiRootReason: '', aiErrorReason: '', aiActionRule: '', aiThinking: ''
    })
  }

  return NextResponse.json({ error: '未知类型' }, { status: 400 })
}
