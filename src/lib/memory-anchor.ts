// src/lib/memory-anchor.ts
// 记忆锚点生成（§0.7⑤）
// 首次存量化触发，1句话口诀，AI调用1次永久复用

import { prisma } from './prisma'
import { callAI } from './ai/provider'

async function callMiniMax(prompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY
  if (!apiKey) throw new Error('MINIMAX_API_KEY 未配置')
  const res = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'abab6.5s-chat',
      messages: [
        { role: 'system', content: '你是记忆口诀专家，输出简短有力的记忆口诀，不超过20字。' },
        { role: 'user',   content: prompt },
      ],
      max_tokens: 60,
    }),
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

// 首次存量化时触发（在 review/submit API 中异步调用）
export async function generateMemoryAnchor(userErrorId: string): Promise<void> {
  const userError = await prisma.userError.findUnique({
    where:   { id: userErrorId },
    include: { question: true },
  })
  if (!userError || userError.personalMemoryAnchor) return  // 已有则跳过

  const q = userError.question

  // 优先用公共锚点（省AI费用）
  if (q.sharedMemoryAnchor) {
    // 不需要生成，展示时直接读 question.sharedMemoryAnchor
    return
  }

  const analysis = q.sharedAiAnalysis || q.analysis || ''
  const prompt = `
题目考察点：${q.type}${q.subtype ? ` - ${q.subtype}` : ''}
正确解法：${analysis.substring(0, 200)}

请生成一个≤20字的记忆口诀，让考生看到类似题时立刻想起解法。
只输出口诀本身，不要解释。`

  try {
    const resp = await callAI([{ role: "user", content: prompt }], { maxTokens: 60 })
    const anchor = resp.text.trim()
    if (!anchor) return

    // 同时写入 question.sharedMemoryAnchor（供后续用户复用）和 userError.personalMemoryAnchor
    await prisma.$transaction([
      prisma.question.update({
        where: { id: q.id },
        data:  { sharedMemoryAnchor: anchor },
      }),
      prisma.userError.update({
        where: { id: userErrorId },
        data:  { personalMemoryAnchor: anchor },
      }),
    ])
    console.log(`[锚点] 生成完成：${anchor}`)
  } catch (err: any) {
    console.error(`[锚点] 生成失败：${err.message}`)
  }
}
