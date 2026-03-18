// src/app/api/import/screenshot/route.ts
// B6: 截图识别 — MiniMax 视觉API读题

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const formData = await req.formData()
  const file     = formData.get('image') as File | null
  if (!file) return NextResponse.json({ error: '请上传图片' }, { status: 400 })

  const apiKey = process.env.MINIMAX_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'MiniMax API Key 未配置' }, { status: 500 })

  // 转 base64
  const buffer   = Buffer.from(await file.arrayBuffer())
  const base64   = buffer.toString('base64')
  const mimeType = file.type || 'image/jpeg'

  try {
    const res = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'abab6.5s-chat',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: `请识别图片中的行测题目，提取以下信息并以 JSON 格式输出：
{
  "content": "题目正文（完整）",
  "options": ["A.选项A内容", "B.选项B内容", "C.选项C内容", "D.选项D内容"],
  "answer": "正确答案字母（如有）",
  "type": "题型（判断推理/言语理解/数量关系/资料分析/常识判断）",
  "analysis": "解析文字（如有）"
}
只输出 JSON，不要其他内容。如果图片中没有题目，返回 {"error": "未识别到题目"}` },
          ],
        }],
        max_tokens: 1000,
      }),
    })

    const data   = await res.json()
    const text   = data.choices?.[0]?.message?.content ?? ''
    const clean  = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 422 })
    return NextResponse.json(parsed)
  } catch (err: any) {
    return NextResponse.json({ error: `识别失败：${err.message}` }, { status: 500 })
  }
}
