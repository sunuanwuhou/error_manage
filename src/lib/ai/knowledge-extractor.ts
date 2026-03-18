// src/lib/ai/knowledge-extractor.ts
// ============================================================
// 好题解法模式提取器
// 输入：一道好题 + 高质量解析
// 输出：结构化的解法模式（存入 KnowledgeBase，向量化用于 RAG）
// ============================================================

import { callAIJson, callAI } from './provider'
import { prisma } from '../prisma'

interface ExtractedPattern {
  questionType:    string      // 适用题型
  methodName:      string      // 方法名称
  applicableTypes: string[]    // 适用范围
  triggerKeywords: string[]    // 触发关键词
  solutionSteps:   string[]    // 标准化解题步骤
  exampleSolution: string      // 针对本题的示范解答
  qualityScore:    number      // 解法质量评分 0-1
  summary:         string      // 一句话总结这个解法
}

// ============================================================
// 核心提取函数
// ============================================================
export async function extractKnowledgePattern(
  questionContent: string,
  analysisContent: string,
  questionType:    string
): Promise<ExtractedPattern> {
  const prompt = `
你是公务员行测命题专家。请从下面这道高质量例题中，提取可以迁移到其他题目的通用解法模式。

【题目】
${questionContent}

【高质量解析】
${analysisContent}

【题型】${questionType}

请提取该解析中的解法模式，输出 JSON：
{
  "questionType": "适用的一级题型（判断推理/言语理解/数量关系/资料分析/常识判断）",
  "methodName": "这个解法的名称，如'充分必要条件翻译法'、'主旨句首尾定位法'",
  "applicableTypes": ["适用的二级题型，如['翻译推理','假言命题']"],
  "triggerKeywords": ["触发使用这个方法的关键词，如['如果','只有','才','必须']"],
  "solutionSteps": [
    "步骤1：识别题型的方法（看到什么特征）",
    "步骤2：核心操作（怎么做）",
    "步骤3：验证/排除（怎么确认答案）"
  ],
  "exampleSolution": "用这个方法解本题的示范过程（100字以内，作为few-shot示例）",
  "qualityScore": 0到1的分数（这个解法模式的普适性和清晰度，0.9以上=极佳），
  "summary": "一句话总结：'遇到[触发条件]时，用[方法名]，步骤是[核心步骤]'"
}`

  return callAIJson<ExtractedPattern>(prompt, '你是公务员行测命题专家，专注提取可迁移的解题方法论。')
}

// ============================================================
// 向量化（使用 Supabase 内置 embedding 或 OpenAI）
// ============================================================
async function getEmbedding(text: string): Promise<number[] | null> {
  // 优先用 OpenAI embedding（质量最好）
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    try {
      const res  = await fetch('https://api.openai.com/v1/embeddings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
      })
      const data = await res.json()
      return data.data?.[0]?.embedding ?? null
    } catch { return null }
  }

  // 降级：不向量化（RAG 功能降为关键词搜索）
  console.log('[Embedding] 未配置 OPENAI_API_KEY，跳过向量化')
  return null
}

// ============================================================
// 完整流程：提取 + 存库
// ============================================================
export async function processKnowledgeEntry(
  userId:          string,
  questionContent: string,
  analysisContent: string,
  questionType:    string,
  questionId?:     string,
  isPublic = true
): Promise<{ id: string; pattern: ExtractedPattern }> {
  // 1. AI 提取解法模式
  const pattern = await extractKnowledgePattern(questionContent, analysisContent, questionType)

  // 2. 构建向量化文本（题目 + 解析摘要，用于相似检索）
  const embeddingText = `${questionType} ${pattern.methodName} ${pattern.triggerKeywords.join(' ')} ${pattern.summary}`
  const embedding     = await getEmbedding(embeddingText)

  // 3. 存入数据库
  // 注意：pgvector 字段用原始 SQL 插入（Prisma 不原生支持 vector 类型写入）
  const entry = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    INSERT INTO knowledge_entries (
      id, "userId", "isPublic", "questionId", "rawContent", "rawAnalysis",
      "questionType", "methodName", "applicableTypes", "triggerKeywords",
      "solutionSteps", "exampleSolution", "qualityScore", "aiExtractedAt",
      "usageCount", "createdAt", "updatedAt"
      ${embedding ? ', "contentEmbedding"' : ''}
    ) VALUES (
      gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), 0, NOW(), NOW()
      ${embedding ? `, $13::vector` : ''}
    ) RETURNING id
  `,
    userId,
    isPublic,
    questionId ?? null,
    questionContent,
    analysisContent,
    pattern.questionType,
    pattern.methodName,
    JSON.stringify(pattern.applicableTypes),
    JSON.stringify(pattern.triggerKeywords),
    JSON.stringify(pattern.solutionSteps),
    pattern.exampleSolution,
    pattern.qualityScore,
    ...(embedding ? [JSON.stringify(embedding)] : [])
  )

  return { id: entry[0].id, pattern }
}

// ============================================================
// RAG 检索：给定一道新题，找最相关的解法模式
// ============================================================
export async function retrieveRelevantPatterns(
  questionContent: string,
  questionType:    string,
  topK = 3
): Promise<Array<{
  methodName:      string
  solutionSteps:   string[]
  exampleSolution: string
  triggerKeywords: string[]
  qualityScore:    number
}>> {
  // Step 1: 尝试向量检索
  const embeddingText = `${questionType} ${questionContent.slice(0, 200)}`
  const embedding     = await getEmbedding(embeddingText)

  if (embedding) {
    // 向量相似度检索
    const results = await prisma.$queryRawUnsafe<any[]>(`
      SELECT "methodName", "solutionSteps", "exampleSolution", "triggerKeywords", "qualityScore"
      FROM knowledge_entries
      WHERE "isPublic" = true
        AND "questionType" = $1
        AND "contentEmbedding" IS NOT NULL
      ORDER BY "contentEmbedding" <-> $2::vector
      LIMIT $3
    `, questionType, JSON.stringify(embedding), topK)

    if (results.length > 0) {
      // 更新 usageCount
      await prisma.$executeRawUnsafe(`
        UPDATE knowledge_entries SET "usageCount" = "usageCount" + 1
        WHERE "methodName" = ANY($1::text[])
      `, results.map((r: any) => r.methodName))

      return results.map((r: any) => ({
        methodName:      r.methodName,
        solutionSteps:   JSON.parse(r.solutionSteps),
        exampleSolution: r.exampleSolution,
        triggerKeywords: JSON.parse(r.triggerKeywords),
        qualityScore:    r.qualityScore,
      }))
    }
  }

  // Step 2: 降级为关键词检索（无向量时）
  const entries = await prisma.$queryRawUnsafe<any[]>(`
    SELECT "methodName", "solutionSteps", "exampleSolution", "triggerKeywords", "qualityScore"
    FROM knowledge_entries
    WHERE "isPublic" = true
      AND "questionType" = $1
    ORDER BY "qualityScore" DESC, "usageCount" DESC
    LIMIT $2
  `, questionType, topK)

  return entries.map((r: any) => ({
    methodName:      r.methodName,
    solutionSteps:   JSON.parse(r.solutionSteps),
    exampleSolution: r.exampleSolution,
    triggerKeywords: JSON.parse(r.triggerKeywords),
    qualityScore:    r.qualityScore,
  }))
}

// ============================================================
// 增强版 AI 诊断（带 RAG 检索）
// 在 ai-diagnosis.ts 的基础上，先检索知识库再诊断
// ============================================================
export async function enhancedDiagnosis(
  questionContent: string,
  questionType:    string,
  correctAnswer:   string,
  userAnswer:      string,
  errorReason?:    string
): Promise<{
  aiRootReason:  string
  aiErrorReason: string
  aiActionRule:  string
  aiThinking:    string
  aiReasonTag:   string
  usedPatterns:  string[]  // 用了哪些知识库中的方法
}> {
  // 1. 检索相关解法模式
  const patterns = await retrieveRelevantPatterns(questionContent, questionType, 2)
  const patternContext = patterns.length > 0
    ? `\n\n【知识库中相关解法模式】\n` + patterns.map(p =>
        `方法：${p.methodName}\n步骤：${p.solutionSteps.join(' → ')}\n示例：${p.exampleSolution}`
      ).join('\n\n')
    : ''

  // 2. 构建增强 prompt
  const prompt = `
行测题目：${questionContent}
正确答案：${correctAnswer}
用户选了：${userAnswer}
用户认为的原因：${errorReason ?? '未填写'}
${patternContext}

请结合上方知识库中的解法模式（如果有）分析用户的错误，输出 JSON：
{
  "aiRootReason":  "根本原因，≤30字",
  "aiErrorReason": "错误表象，≤30字",
  "aiActionRule":  "下次行动规则，格式'看到XX就XX'，≤30字",
  "aiThinking":    "正确解题思路，结合知识库方法，步骤化，≤150字",
  "aiReasonTag":   "错因分类（概念混淆/审题粗心/计算失误/方法不熟/时间不足/其他）",
  "usedPatterns":  ["用到的知识库方法名称列表，没用到则为空数组"]
}`

  return callAIJson(prompt, '你是公务员行测专家，结合知识库中的解法模式给出高质量诊断。')
}
