// src/lib/activity/snapshot-writer.ts
// ============================================================
// AnalysisSnapshot 写入工具
// 分析服务完成一次分析后，调用这里存储结果
// 同时把可执行建议写入 SystemInsight
// ============================================================

import { prisma } from '../prisma'
import { logAIAnalysisDone } from './logger'

export interface Finding {
  type:       'weakness' | 'strength' | 'pattern' | 'prediction' | 'optimization'
  skillTag?:  string
  title:      string
  detail:     string
  confidence: number           // 0-1
  trend?:     'improving' | 'worsening' | 'stable'
  evidence:   string
}

export interface Recommendation {
  action:      string          // adjust_interval | add_to_queue | adjust_roi_weight | change_strategy
  target:      string
  value:       any
  reason:      string
  confidence:  number
  priority:    'high' | 'medium' | 'low'
  // 如果是系统参数变更，填以下字段
  paramKey?:   string
  paramValue?: string
}

export interface SnapshotInput {
  userId?:      string
  analysisType: string
  prevSnapshotId?: string
  dataRangeFrom?: Date
  dataRangeTo?:  Date
  inputSummary: Record<string, any>
  findings:     Finding[]
  recommendations: Recommendation[]
  confidenceScore: number
  dataPointsUsed:  number
}

export async function writeAnalysisSnapshot(input: SnapshotInput): Promise<string> {
  // 1. 写入 AnalysisSnapshot
  const snapshot = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    INSERT INTO analysis_snapshots (
      id, "userId", "analysisType", "triggerEvent",
      "dataRangeFrom", "dataRangeTo", "inputSummary",
      "prevSnapshotId", findings, recommendations,
      "confidenceScore", "dataPointsUsed", "wasActedUpon",
      "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, $1, $2, 'scheduled',
      $3, $4, $5::jsonb, $6,
      $7::jsonb, $8::jsonb,
      $9, $10, false, NOW(), NOW()
    ) RETURNING id
  `,
    input.userId ?? null,
    input.analysisType,
    input.dataRangeFrom ?? null,
    input.dataRangeTo ?? new Date(),
    JSON.stringify(input.inputSummary),
    input.prevSnapshotId ?? null,
    JSON.stringify(input.findings),
    JSON.stringify(input.recommendations),
    input.confidenceScore,
    input.dataPointsUsed,
  )

  const snapshotId = snapshot[0].id

  // 2. 高优先级的 recommendations → 写入 SystemInsight
  const highPriority = input.recommendations.filter(r =>
    r.priority === 'high' && r.paramKey && r.confidence > 0.7
  )

  for (const rec of highPriority) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO system_insights (
        id, "userId", "sourceSnapshotId", "insightCategory",
        "targetEntity", "targetValue", "paramKey", "paramValueNew",
        status, confidence, "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
        'pending', $8, NOW() + INTERVAL '30 days', NOW(), NOW()
      )
    `,
      input.userId ?? null,
      snapshotId,
      'interval_optimization',
      rec.target,
      rec.target,
      rec.paramKey,
      JSON.stringify(rec.value),
      rec.confidence,
    )
  }

  // 3. ActivityLog: 记录分析完成
  await logAIAnalysisDone(input.userId ?? null, {
    analysisType:         input.analysisType,
    snapshotId,
    findingsCount:        input.findings.length,
    recommendationsCount: input.recommendations.length,
    dataPointsUsed:       input.dataPointsUsed,
    confidenceScore:      input.confidenceScore,
  })

  // 4. 更新 AnalysisQueue 对应任务状态
  if (input.analysisType === 'skill_tag' && input.inputSummary.targetId) {
    await prisma.$executeRawUnsafe(`
      UPDATE analysis_queue SET status='done', "resultId"=$1,
        "resultSummary"=$2, "analyzedAt"=NOW(), "updatedAt"=NOW()
      WHERE "targetType"='skill_tag' AND "targetId"=$3 AND status IN ('pending','processing')
    `,
      snapshotId,
      input.findings[0]?.title ?? '分析完成',
      input.inputSummary.targetId,
    )
  }

  console.log(`[Snapshot] 写入完成: ${snapshotId}, findings=${input.findings.length}, insights=${highPriority.length}`)
  return snapshotId
}

// ── 读取最近一次同类分析（飞轮上下文）────────────────────────────

export async function getPrevSnapshot(params: {
  userId?:      string
  analysisType: string
}): Promise<{
  id:            string
  findings:      Finding[]
  recommendations: Recommendation[]
  confidenceScore: number
  createdAt:     Date
} | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, findings, recommendations, "confidenceScore", "createdAt"
    FROM analysis_snapshots
    WHERE "analysisType" = $1
      AND ($2::text IS NULL OR "userId" = $2)
    ORDER BY "createdAt" DESC
    LIMIT 1
  `, params.analysisType, params.userId ?? null)

  if (rows.length === 0) return null

  const r = rows[0]
  return {
    id:              r.id,
    findings:        JSON.parse(r.findings),
    recommendations: JSON.parse(r.recommendations),
    confidenceScore: r.confidenceScore,
    createdAt:       r.createdAt,
  }
}
