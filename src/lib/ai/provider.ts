// src/lib/ai/provider.ts
// ============================================================
// AI 统一接口层
// 默认：Claude (Anthropic API)
// 降级：MiniMax（当 ANTHROPIC_API_KEY 未配置时）
// ============================================================

export type AIModel = 'claude-sonnet' | 'claude-haiku' | 'minimax'

export interface AIMessage {
  role:    'user' | 'assistant' | 'system'
  content: string
}

export interface AIResponse {
  text:     string
  model:    AIModel
  inputTokens?:  number
  outputTokens?: number
}

// ============================================================
// Claude (Anthropic) 调用
// ============================================================
async function callClaude(
  messages: AIMessage[],
  model: 'claude-sonnet' | 'claude-haiku' = 'claude-sonnet',
  maxTokens = 1000
): Promise<AIResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 未配置')

  const modelId = model === 'claude-sonnet'
    ? 'claude-sonnet-4-5'
    : 'claude-haiku-4-5-20251001'

  // 分离 system message
  const systemMsg = messages.find(m => m.role === 'system')?.content ?? '你是公务员行测解题专家，分析精准，输出简洁。'
  const userMsgs  = messages.filter(m => m.role !== 'system').map(m => ({
    role:    m.role as 'user' | 'assistant',
    content: m.content,
  }))

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      modelId,
      max_tokens: maxTokens,
      system:     systemMsg,
      messages:   userMsgs,
    }),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Claude API 错误 ${res.status}: ${err.error?.message ?? JSON.stringify(err)}`)
  }

  const data = await res.json()
  return {
    text:         data.content?.[0]?.text ?? '',
    model:        'claude-sonnet',
    inputTokens:  data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  }
}

// ============================================================
// MiniMax 调用（降级用）
// ============================================================
async function callMiniMax(
  messages: AIMessage[],
  maxTokens = 1000
): Promise<AIResponse> {
  const apiKey = process.env.MINIMAX_API_KEY
  if (!apiKey) throw new Error('MINIMAX_API_KEY 未配置')

  const res = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:    'abab6.5s-chat',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
    }),
  })

  const data = await res.json()
  return {
    text:  data.choices?.[0]?.message?.content ?? '',
    model: 'minimax',
  }
}

// ============================================================
// 主调用函数：自动选择可用的 AI
// ============================================================
export async function callAI(
  messages: AIMessage[],
  options?: {
    preferredModel?: AIModel
    maxTokens?:      number
    jsonOutput?:     boolean  // 是否期望 JSON 输出
  }
): Promise<AIResponse> {
  const { preferredModel = 'claude-sonnet', maxTokens = 1000, jsonOutput = false } = options ?? {}

  // 如果指定了 Claude 且有 API Key，优先用 Claude
  const hasClaudeKey   = !!process.env.ANTHROPIC_API_KEY
  const hasMiniMaxKey  = !!process.env.MINIMAX_API_KEY

  if (jsonOutput && hasClaudeKey) {
    // Claude 的 JSON 输出在 system prompt 里强调
    const msgs = messages.map(m =>
      m.role === 'system'
        ? { ...m, content: m.content + '\n\n严格要求：只输出 JSON，不要任何前言或解释，不要markdown代码块。' }
        : m
    )
    return callClaude(msgs, preferredModel === 'claude-haiku' ? 'claude-haiku' : 'claude-sonnet', maxTokens)
  }

  if (preferredModel !== 'minimax' && hasClaudeKey) {
    return callClaude(messages, preferredModel === 'claude-haiku' ? 'claude-haiku' : 'claude-sonnet', maxTokens)
  }

  if (hasMiniMaxKey) {
    return callMiniMax(messages, maxTokens)
  }

  throw new Error('没有可用的 AI API Key，请在 .env.local 中配置 ANTHROPIC_API_KEY 或 MINIMAX_API_KEY')
}

// ============================================================
// 便捷函数：JSON 输出专用
// ============================================================
export async function callAIJson<T = any>(
  prompt:  string,
  system?: string,
  model?:  AIModel
): Promise<T> {
  const messages: AIMessage[] = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })

  const res   = await callAI(messages, { preferredModel: model, jsonOutput: true })
  const clean = res.text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

// ============================================================
// 获取当前使用的 AI 配置（用于前端展示）
// ============================================================
export function getAIConfig() {
  return {
    primaryModel:    process.env.ANTHROPIC_API_KEY ? 'claude-sonnet-4-5'  : null,
    fallbackModel:   process.env.MINIMAX_API_KEY   ? 'minimax-abab6.5s'   : null,
    activeModel:     process.env.ANTHROPIC_API_KEY ? 'claude-sonnet-4-5'  : 'minimax-abab6.5s',
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasMiniMaxKey:   !!process.env.MINIMAX_API_KEY,
  }
}
