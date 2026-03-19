// src/app/api/import/screenshot/route.ts
// B6: 截图识别 — MiniMax 视觉API读题

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { recognizeQuestionFromImage } from '@/lib/import/ocr'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const formData = await req.formData()
  const file     = formData.get('image') as File | null
  const examType = (formData.get('examType') as string) || 'common'
  const srcName  = (formData.get('srcName') as string) || '截图OCR'
  if (!file) return NextResponse.json({ error: '请上传图片' }, { status: 400 })

  try {
    const parsed = await recognizeQuestionFromImage(file)
    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = file.type || 'image/jpeg'
    const questionImage = `data:${mimeType};base64,${buffer.toString('base64')}`
    const payload = Buffer.from(JSON.stringify([{
      ...parsed,
      questionImage,
      index: 0,
      examType,
      srcName,
      srcOrigin: 'screenshot_ocr',
    }])).toString('base64')

    return NextResponse.json({
      ...parsed,
      total: 1,
      payload,
    })
  } catch (err: any) {
    const message = err instanceof Error ? err.message : '识别失败'
    const status = /无法识别完整题目|未识别到题目|未识别到题目正文/.test(message) ? 422 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
