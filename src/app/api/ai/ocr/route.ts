// src/app/api/ai/ocr/route.ts — 截图识别（B6）MiniMax 视觉API
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
  if (!apiKey) return NextResponse.json({ error: 'AI API 未配置' }, { status: 500 })

  const buffer   = Buffer.from(await file.arrayBuffer())
  const base64   = buffer.toString('base64')
  const mimeType = file.type || 'image/jpeg'

  const prompt = `这是一道公务员行测题目的截图，请提取以下信息并以JSON格式返回：
{
  "content": "题目正文（完整）",
  "options": ["A.选项内容", "B.选项内容", "C.选项内容", "D.选项内容"],
  "answer": "正确答案字母（如有）",
  "analysis": "解析文字（如有）",
  "type": "题型（判断推理/言语理解/数量关系/资料分析/常识判断）"
}
只返回JSON，不要其他内容。如果图片中没有完整题目，返回 {"error": "无法识别完整题目"}`

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
            { type: 'text', text: prompt },
          ],
        }],
        max_tokens: 800,
      }),
    })

    const data  = await res.json()
    const text  = data.choices?.[0]?.message?.content ?? ''
    const clean = text.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean)

    if (result.error) return NextResponse.json({ error: result.error }, { status: 422 })
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: `识别失败：${err.message}` }, { status: 500 })
  }
}
