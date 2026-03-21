// src/app/api/errors/[id]/diagnose/route.ts
// B7: 个性化AI诊断 — 用户主动触发，写回 customAiAnalysis（§功能45）

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { callAIJson } from '@/lib/ai/provider'
import { evolveKnowledgeFromText } from '@/lib/knowledge-evolution'

function buildFallbackDiagnosis(userError: {
  myAnswer: string
  errorReason: string | null
  aiRootReason: string | null
  reviewCount: number
  correctCount: number
  masteryPercent: number
  question: { answer: string; type: string; subtype: string | null }
}) {
  const missedDirection =
    userError.myAnswer === userError.question.answer
      ? '你这次答案是对的，但稳定性还不够。'
      : '你这次答案没有对上，说明这类题的判断线索还没抓稳。'

  const reviewSignal =
    userError.reviewCount >= 3 && userError.correctCount === 0
      ? '这不是偶发失误，而是重复性错误。'
      : userError.reviewCount >= 3
        ? '你已经反复见过这类题，下一步重点是提炼稳定规则。'
        : '这类题还处在建立方法感的阶段。'

  const weakness =
    userError.masteryPercent <= 30
      ? '先别追求做快，先把判断顺序固定下来。'
      : userError.masteryPercent <= 60
        ? '会做但不稳定，说明规则还没压缩成一句可执行的话。'
        : '基础已有，重点是减少犹豫和重复犯错。'

  const root = userError.errorReason || userError.aiRootReason || '未形成稳定的判断规则'
  const actionRule = `看到${userError.question.type}${userError.question.subtype ? `的${userError.question.subtype}` : ''}，先写出判断依据再选项对比`

  return {
    deepAnalysis: `${missedDirection}${reviewSignal}${weakness} 当前最明显的问题是：${root}。`,
    targetedTip: actionRule.slice(0, 50),
    warningPattern: userError.reviewCount >= 3 ? '重复犯同类规则错误' : '凭感觉抢答',
  }
}

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

  const q = userError.question
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
    const result = await callAIJson<{
      deepAnalysis: string
      targetedTip: string
      warningPattern: string
    }>(
      prompt,
      '你是公务员考试专家，分析深入精准，结合学生具体情况输出个性化建议。严格只输出 JSON。',
    )

    const fullAnalysis = `【个性化深度诊断】\n${result.deepAnalysis}\n\n💡 针对你的建议：${result.targetedTip}\n\n⚠️ 警惕模式：${result.warningPattern}`
    await prisma.userError.update({
      where: { id: params.id },
      data:  { customAiAnalysis: fullAnalysis },
    })
    await evolveKnowledgeFromText({
      userId,
      title: `${q.type}${q.subtype ? `-${q.subtype}` : ''}错题复盘`,
      content: fullAnalysis,
      questionType: q.type || '错题复盘',
      visibility: 'private',
      sourceErrorIds: params.id,
    }).catch(() => {})

    return NextResponse.json({ analysis: fullAnalysis })
  } catch (err: any) {
    console.error('[custom-diagnose] fallback:', err?.message ?? err)
    const fallback = buildFallbackDiagnosis(userError)
    const fullAnalysis = `【个性化深度诊断】\n${fallback.deepAnalysis}\n\n💡 针对你的建议：${fallback.targetedTip}\n\n⚠️ 警惕模式：${fallback.warningPattern}`
    await prisma.userError.update({
      where: { id: params.id },
      data:  { customAiAnalysis: fullAnalysis },
    })
    await evolveKnowledgeFromText({
      userId,
      title: `${q.type}${q.subtype ? `-${q.subtype}` : ''}错题复盘`,
      content: fullAnalysis,
      questionType: q.type || '错题复盘',
      visibility: 'private',
      sourceErrorIds: params.id,
    }).catch(() => {})
    return NextResponse.json({
      analysis: fullAnalysis,
      degraded: true,
      message: 'AI 服务暂时不可用，已为你生成本地诊断建议。',
    })
  }
}
