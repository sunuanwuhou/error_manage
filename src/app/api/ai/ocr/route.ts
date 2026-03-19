// src/app/api/ai/ocr/route.ts — 截图识别（B6）MiniMax 视觉API
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { recognizeQuestionFromImage } from '@/lib/import/ocr'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const formData = await req.formData()
  const file     = formData.get('image') as File | null
  if (!file) return NextResponse.json({ error: '请上传图片' }, { status: 400 })

  try {
    const result = await recognizeQuestionFromImage(file)
    return NextResponse.json(result)
  } catch (err: any) {
    const message = err instanceof Error ? err.message : '识别失败'
    const status = /无法识别完整题目|未识别到题目|未识别到题目正文/.test(message) ? 422 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
