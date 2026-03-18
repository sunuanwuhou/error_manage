// src/app/api/analysis/snapshots/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const rows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, "analysisType", findings, recommendations,
           "confidenceScore", "dataPointsUsed", "createdAt", "prevSnapshotId"
    FROM analysis_snapshots WHERE id = $1
  `, params.id)

  if (rows.length === 0) return NextResponse.json({ error: '不存在' }, { status: 404 })
  return NextResponse.json(rows[0])
}
