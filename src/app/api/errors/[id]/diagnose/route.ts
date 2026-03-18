// src/app/api/errors/[id]/diagnose/route.ts
// B7: 个性化AI诊断 — 用户主动触发，写回 customAiAnalysis（§功能45）

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const userId = (session.user as any).id

  const userError = await prisma.userError.findFirst({
    where:   { id: params.id, userId },
    include: { question: true },
  })
  if (!userError) return NextResponse.json({ error: '不存在' }, { status: 404 })

  const apiKey = process.env.MINIMAX_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI 未配置' }, { status: 500 })

  const q = userError.question
  // 个性化诊断考虑用户的具体错误历史
  const prompt = `
你是公务员行测解题专家，请针对这位学生的具体情况做个性化深度诊断。

题目：${q.content}
正确答案：${q.answer}
该学生选了：${userError.myAnswer}
学生自己认为的错误原因：${userError.errorReason ?? '未填写'}
AI之前的诊断：${userError.aiRootReason ?? '无'}
学生复习次数：${userError.reviewCount}，正确次数：${userError.correctCount}
掌握度：${userError.masteryPercent}%

请给出比通用解析更个性化的诊断，重点找出学生的认知盲点，输出 JSON：
{
  "deepAnalysis": "针对该学生的个性化分析，200字以内，指出其独特的思维误区",
  "targetedTip": "专门针对该学生的提升建议，具体可执行，≤50字",
  "warningPattern": "该学生最需要警惕的错误模式，≤30字"
}
只返回JSON。`

  try {
    const res  = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'abab6.5s-chat',
        messages: [
          { role: 'system', content: '你是公务员考试专家，分析深入精准，结合学生具体情况输出个性化建议。' },
          { role: 'user',   content: prompt },
        ],
        max_tokens: 500,
      }),
    })
    const data  = await res.json()
    const text  = data.choices?.[0]?.message?.content ?? ''
    const clean = text.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean)

    // 写回 customAiAnalysis
    const fullAnalysis = `【个性化深度诊断】\n${result.deepAnalysis}\n\n💡 针对你的建议：${result.targetedTip}\n\n⚠️ 警惕模式：${result.warningPattern}`
    await prisma.userError.update({
      where: { id: params.id },
      data:  { customAiAnalysis: fullAnalysis },
    })

    return NextResponse.json({ analysis: fullAnalysis })
  } catch (err: any) {
    return NextResponse.json({ error: `诊断失败：${err.message}` }, { status: 500 })
  }
}
