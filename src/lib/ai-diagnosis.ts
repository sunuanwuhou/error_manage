// src/lib/ai-diagnosis.ts
// AI 首次诊断 — 现在通过统一 provider 调用 Claude（优先）或 MiniMax（降级）

import { prisma } from './prisma'
import { callAIJson } from './ai/provider'
import { enhancedDiagnosis, retrieveRelevantPatterns } from './ai/knowledge-extractor'

// ============================================================
// 公共解析生成（第一个做错的用户触发）
// ============================================================
export async function generateSharedAnalysis(questionId: string): Promise<void> {
  const question = await prisma.question.findUnique({ where: { id: questionId } })
  if (!question || question.sharedAiAnalysis) return

  try {
    const result = await callAIJson<{
      thinking:      string
      keyRule:       string
      memoryAnchor:  string
    }>(`
行测题目：${question.content}
选项：${question.options ?? ''}
正确答案：${question.answer}
${question.analysis ? `官方解析：${question.analysis}` : ''}

请输出 JSON：
{
  "thinking": "正确解题思路，步骤化，≤150字",
  "keyRule": "这道题的核心规律或技巧，1句话≤30字",
  "memoryAnchor": "记忆口诀，看到类似题能立刻想起来，≤20字"
}`,
      '你是公务员行测专家，给出清晰步骤化的解析。'
    )

    await prisma.question.update({
      where: { id: questionId },
      data:  { sharedAiAnalysis: result.thinking, sharedMemoryAnchor: result.memoryAnchor },
    })
    console.log(`[AI] 公共解析生成完成：questionId=${questionId}`)
  } catch (err: any) {
    console.error(`[AI] 公共解析失败：${err.message}`)
  }
}

// ============================================================
// 个人诊断（带 RAG 检索知识库）
// ============================================================
export async function generatePersonalDiagnosis(userErrorId: string): Promise<void> {
  const userError = await prisma.userError.findUnique({
    where: { id: userErrorId }, include: { question: true },
  })
  if (!userError || userError.aiAnalyzedAt) return

  const q = userError.question

  try {
    // 使用增强诊断（带知识库 RAG）
    const result = await enhancedDiagnosis(
      q.content,
      q.type,
      q.answer,
      userError.myAnswer,
      userError.errorReason ?? undefined
    )

    await prisma.userError.update({
      where: { id: userErrorId },
      data:  {
        aiRootReason:  result.aiRootReason,
        aiErrorReason: result.aiErrorReason,
        aiActionRule:  result.aiActionRule,
        aiThinking:    result.aiThinking,
        aiReasonTag:   result.aiReasonTag,
        aiAnalyzedAt:  new Date(),
        // 记录用了哪些知识库方法
        customAiAnalysis: result.usedPatterns.length > 0
          ? `[参考解法：${result.usedPatterns.join('、')}]`
          : null,
      },
    })
    console.log(`[AI] 个人诊断完成（RAG增强）：${userErrorId}`)
  } catch (err: any) {
    console.error(`[AI] 个人诊断失败：${err.message}`)
  }
}

export async function triggerPostRecordDiagnosis(
  userErrorId: string,
  questionId:  string,
): Promise<void> {
  await generateSharedAnalysis(questionId)
  await generatePersonalDiagnosis(userErrorId)
}
