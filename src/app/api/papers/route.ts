import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPaperCatalog, getPaperDetail } from '@/lib/papers'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const paperKey = searchParams.get('paper') ?? searchParams.get('session')

  if (paperKey) {
    const detail = await getPaperDetail(paperKey)
    if (detail.error) {
      return NextResponse.json(
        { error: detail.error },
        { status: detail.error === '套卷标识无效' ? 400 : 404 }
      )
    }

    return NextResponse.json(detail)
  }

  const catalog = await getPaperCatalog()
  if (catalog.error) {
    return NextResponse.json({ error: catalog.error }, { status: 500 })
  }

  return NextResponse.json(catalog.papers)
}
