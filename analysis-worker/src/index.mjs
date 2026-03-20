import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Pool } from 'pg'

const WORKSPACE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')

loadEnvFile(path.join(WORKSPACE_ROOT, '.env'))
loadEnvFile(path.join(WORKSPACE_ROOT, '.env.local'))

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL 未配置')
}

const pool = new Pool({
  connectionString,
})

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    return
  }

  if (args.autopilot) {
    const autopilotSummary = await runAutopilot(args)
    console.log(JSON.stringify(autopilotSummary, null, 2))
    return
  }

  if (args.enqueueStaleStrategy) {
    const count = await enqueueStaleStrategyTasks({
      intervalHours: args.intervalHours,
      lookbackDays: args.lookbackDays,
      userId: args.userId,
    })
    console.log(`[analysis-worker] enqueued ${count} stale user_strategy_refresh task(s)`)
  }

  if (args.enqueueUserErrorId) {
    const taskId = await enqueueUserErrorDiagnosisTask(args.enqueueUserErrorId)
    console.log(taskId
      ? `[analysis-worker] enqueued user_error_diagnosis task ${taskId} for ${args.enqueueUserErrorId}`
      : `[analysis-worker] skipped enqueue for ${args.enqueueUserErrorId} (task already open or user error missing)`)
  }

  if (args.claimAndExport) {
    const claimedTask = await claimNextTask(args.task)
    if (!claimedTask) {
      console.log('[analysis-worker] no pending task to process')
      return
    }

    const task = normalizeTask(claimedTask)
    const exportInfo = await exportTaskContext(task)
    console.log(`[analysis-worker] exported task ${task.id} to ${exportInfo.contextFile}`)
    return
  }

  if (args.exportTaskId) {
    const taskResult = await query(
      `SELECT *
       FROM analysis_queue
       WHERE id = $1
       LIMIT 1`,
      [args.exportTaskId]
    )
    const task = taskResult.rows[0] ? normalizeTask(taskResult.rows[0]) : null
    if (!task) throw new Error(`analysis task not found: ${args.exportTaskId}`)
    const exportInfo = await exportTaskContext(task)
    console.log(`[analysis-worker] re-exported task ${task.id} to ${exportInfo.contextFile}`)
    return
  }

  if (args.showLatest) {
    printLatestBundleInstructions()
    return
  }

  if (args.applyResult) {
    if (!args.taskId) {
      throw new Error('--apply-result requires --task-id')
    }
    const applyStatus = await applyResultFile({
      taskId: args.taskId,
      resultFile: args.resultFile ?? defaultResultFileForTask(args.taskId),
    })
    console.log(applyStatus === 'skipped'
      ? `[analysis-worker] task ${args.taskId} already done, skip apply`
      : `[analysis-worker] applied result for task ${args.taskId}`)
    return
  }

}

function parseArgs(argv) {
  const values = {
    help: false,
    enqueueStaleStrategy: false,
    claimAndExport: false,
    applyResult: false,
    showLatest: false,
    autopilot: false,
    enqueueUserErrorId: null,
    task: null,
    exportTaskId: null,
    taskId: null,
    resultFile: null,
    userId: null,
    intervalHours: 6,
    lookbackDays: 30,
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') values.help = true
    else if (arg === '--enqueue-stale-strategy') values.enqueueStaleStrategy = true
    else if (arg === '--claim-and-export') values.claimAndExport = true
    else if (arg === '--apply-result') values.applyResult = true
    else if (arg === '--show-latest') values.showLatest = true
    else if (arg === '--autopilot') values.autopilot = true
    else if (arg.startsWith('--enqueue-user-error-id=')) values.enqueueUserErrorId = arg.slice('--enqueue-user-error-id='.length)
    else if (arg.startsWith('--task=')) values.task = arg.slice('--task='.length)
    else if (arg.startsWith('--export-task-id=')) values.exportTaskId = arg.slice('--export-task-id='.length)
    else if (arg.startsWith('--task-id=')) values.taskId = arg.slice('--task-id='.length)
    else if (arg.startsWith('--result-file=')) values.resultFile = arg.slice('--result-file='.length)
    else if (arg.startsWith('--userId=')) values.userId = arg.slice('--userId='.length)
    else if (arg.startsWith('--interval-hours=')) values.intervalHours = parseInt(arg.slice('--interval-hours='.length), 10)
    else if (arg.startsWith('--lookback-days=')) values.lookbackDays = parseInt(arg.slice('--lookback-days='.length), 10)
  }

  if (!values.enqueueStaleStrategy && !values.claimAndExport && !values.applyResult && !values.exportTaskId && !values.showLatest && !values.help && !values.enqueueUserErrorId && !values.autopilot) {
    values.enqueueStaleStrategy = true
    values.claimAndExport = true
  }

  return values
}

function printHelp() {
  console.log(`
Usage:
  node analysis-worker/src/index.mjs --enqueue-stale-strategy
  node analysis-worker/src/index.mjs --claim-and-export --task=user_strategy_refresh
  node analysis-worker/src/index.mjs --export-task-id=<id>
  node analysis-worker/src/index.mjs --show-latest
  node analysis-worker/src/index.mjs --apply-result --task-id=<id> --result-file=<path>
  node analysis-worker/src/index.mjs --enqueue-user-error-id=<userErrorId>
  node analysis-worker/src/index.mjs --autopilot --task=user_strategy_refresh
  node analysis-worker/src/index.mjs --enqueue-stale-strategy --claim-and-export

Options:
  --userId=<id>             only enqueue strategy task for one user
  --interval-hours=<n>      minimum hours between strategy snapshots (default: 6)
  --lookback-days=<n>       activity lookback window (default: 30)
  --task=<targetType>       only process one targetType
  --export-task-id=<id>     re-export an existing task into bundle files
  --show-latest             print the latest exported Codex bundle instructions
  --autopilot               enqueue stale tasks, apply ready result.json files, and export one next bundle
  --enqueue-user-error-id=<id> enqueue one user_error_diagnosis task
  --task-id=<id>            apply-result target task id
  --result-file=<path>      apply-result input JSON file
`)
}

async function runAutopilot(args) {
  const enqueued = await enqueueStaleStrategyTasks({
    intervalHours: args.intervalHours,
    lookbackDays: args.lookbackDays,
    userId: args.userId,
  })

  const applied = await applyReadyBundleResults()
  const claimedTask = await claimNextTask(args.task)

  if (!claimedTask) {
    return {
      mode: 'autopilot',
      enqueued,
      appliedCount: applied.length,
      appliedTaskIds: applied,
      exportedTaskId: null,
      bundleDir: null,
      needsCodex: false,
      message: applied.length > 0
        ? 'Applied ready Codex results. No new pending task to export.'
        : 'No pending task to export.',
    }
  }

  const task = normalizeTask(claimedTask)
  const exportInfo = await exportTaskContext(task)

  return {
    mode: 'autopilot',
    enqueued,
    appliedCount: applied.length,
    appliedTaskIds: applied,
    exportedTaskId: task.id,
    bundleDir: exportInfo.bundleDir,
    codexFile: path.join(exportInfo.bundleDir, 'TASK_FOR_CODEX.md'),
    resultFile: path.join(exportInfo.bundleDir, 'result.json'),
    needsCodex: true,
    message: `Exported task ${task.id} for Codex.`,
  }
}

async function applyReadyBundleResults() {
  const analysisRoot = path.join(WORKSPACE_ROOT, '.runtime', 'analysis')
  const bundleRoot = path.join(analysisRoot, 'bundles')
  if (!fs.existsSync(bundleRoot)) return []

  const taskResult = await query(
    `SELECT id
     FROM analysis_queue
     WHERE status = 'processing'`
  )
  const processingIds = new Set(taskResult.rows.map((row) => row.id))
  const applied = []

  for (const taskId of processingIds) {
    const resultFile = path.join(bundleRoot, taskId, 'result.json')
    if (!fs.existsSync(resultFile)) continue
    const status = await applyResultFile({ taskId, resultFile })
    if (status === 'applied') {
      applied.push(taskId)
    }
  }

  return applied
}

async function enqueueStaleStrategyTasks({ intervalHours, lookbackDays, userId }) {
  const lookbackDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
  const staleBefore = new Date(Date.now() - intervalHours * 60 * 60 * 1000)
  const usersResult = await query(
    `SELECT id
     FROM users
     WHERE "onboardingCompletedAt" IS NOT NULL
       AND ($1::text IS NULL OR id = $1)`,
    [userId ?? null]
  )

  let created = 0

  for (const user of usersResult.rows) {
    const [recentActivity, openTask, latestSnapshot] = await Promise.all([
      query(
        `SELECT id
         FROM activity_logs
         WHERE "userId" = $1
           AND "createdAt" >= $2
         LIMIT 1`,
        [user.id, lookbackDate]
      ),
      query(
        `SELECT id
         FROM analysis_queue
         WHERE "userId" = $1
           AND "targetType" = 'user_strategy_refresh'
           AND status IN ('pending', 'processing')
         LIMIT 1`,
        [user.id]
      ),
      query(
        `SELECT "createdAt"
         FROM analysis_snapshots
         WHERE "userId" = $1
           AND "analysisType" = 'user_strategy_refresh'
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [user.id]
      ),
    ])

    const hasRecentActivity = recentActivity.rowCount > 0
    const hasOpenTask = openTask.rowCount > 0
    const latestSnapshotAt = latestSnapshot.rows[0]?.createdAt ?? null
    const isStale = !latestSnapshotAt || new Date(latestSnapshotAt) <= staleBefore

    if (!hasRecentActivity || hasOpenTask || !isStale) continue

    await query(
      `INSERT INTO analysis_queue (
        id, "userId", "triggeredBy", "targetType", "targetId", priority, status, "targetMeta", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, 'codex_schedule', 'user_strategy_refresh', $1, 0.8, 'pending', $2, NOW(), NOW()
      )`,
      [
        user.id,
        JSON.stringify({
          lookbackDays,
          intervalHours,
          reason: 'stale_strategy_refresh',
        }),
      ]
    )
    created += 1
  }

  return created
}

async function enqueueStrategyRefreshTaskForUser(userId, meta = {}, priority = 0.88) {
  const openTask = await query(
    `SELECT id
     FROM analysis_queue
     WHERE "userId" = $1
       AND "targetType" = 'user_strategy_refresh'
       AND status IN ('pending', 'processing')
     LIMIT 1`,
    [userId]
  )

  if (openTask.rowCount > 0) {
    return {
      taskId: openTask.rows[0].id,
      created: false,
    }
  }

  const inserted = await query(
    `INSERT INTO analysis_queue (
      id, "userId", "triggeredBy", "targetType", "targetId", priority, status, "targetMeta", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, $1, 'codex_schedule', 'user_strategy_refresh', $1, $2, 'pending', $3, NOW(), NOW()
    )
    RETURNING id`,
    [
      userId,
      priority,
      JSON.stringify({
        ...meta,
        reason: meta.reason ?? 'diagnosis_escalation',
      }),
    ]
  )

  return {
    taskId: inserted.rows[0]?.id ?? null,
    created: true,
  }
}

async function enqueueUserErrorDiagnosisTask(userErrorId) {
  const existing = await query(
    `SELECT id
     FROM analysis_queue
     WHERE "targetType" = 'user_error_diagnosis'
       AND "targetId" = $1
       AND status IN ('pending', 'processing')
     LIMIT 1`,
    [userErrorId]
  )
  if (existing.rowCount > 0) return null

  const userErrorResult = await query(
    `SELECT id, "userId"
     FROM user_errors
     WHERE id = $1
     LIMIT 1`,
    [userErrorId]
  )
  const userError = userErrorResult.rows[0] ?? null
  if (!userError) return null

  const inserted = await query(
    `INSERT INTO analysis_queue (
      id, "userId", "triggeredBy", "targetType", "targetId", priority, status, "targetMeta", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, $1, 'manual_enqueue', 'user_error_diagnosis', $2, 0.95, 'pending', $3, NOW(), NOW()
    )
    RETURNING id`,
    [
      userError.userId,
      userErrorId,
      JSON.stringify({
        reason: 'manual_user_error_diagnosis',
      }),
    ]
  )

  return inserted.rows[0]?.id ?? null
}

async function claimNextTask(targetType) {
  const pendingTasks = await query(
    `SELECT *
     FROM analysis_queue
     WHERE status = 'pending'
       AND ($1::text IS NULL OR "targetType" = $1)
     ORDER BY priority DESC, "createdAt" ASC
     LIMIT 20`,
    [targetType ?? null]
  )

  for (const task of pendingTasks.rows) {
    const updated = await query(
      `UPDATE analysis_queue
       SET status = 'processing', "updatedAt" = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [task.id]
    )
    if (updated.rowCount === 1) {
      return updated.rows[0]
    }
  }

  return null
}

async function exportTaskContext(task) {
  if (task.targetType === 'user_strategy_refresh') {
    return exportUserStrategyRefreshContext(task)
  }

  if (task.targetType === 'user_error_diagnosis') {
    return exportUserErrorDiagnosisContext(task)
  }

  await markTaskSkipped(task.id, `analysis-worker does not support targetType=${task.targetType} yet`)
  throw new Error(`unsupported targetType: ${task.targetType}`)
}

async function exportUserStrategyRefreshContext(task) {
  const userResult = await query(
    `SELECT id, username, "examType", "targetProvince", "targetScore", "examDate", "dailyGoal"
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [task.targetId]
  )

  const user = userResult.rows[0]
  if (!user) {
    await markTaskSkipped(task.id, 'user not found')
    throw new Error(`user not found: ${task.targetId}`)
  }

  const lookbackDays = readLookbackDays(task.targetMeta)
  const summary = await buildUserStrategySummary(user.id, lookbackDays)
  const previousResult = await query(
    `SELECT id, findings, recommendations, "confidenceScore", "createdAt"
     FROM analysis_snapshots
     WHERE "userId" = $1
       AND "analysisType" = 'user_strategy_refresh'
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    [user.id]
  )
  const previous = previousResult.rows[0] ?? null
  const normalizedUser = normalizeUser(user)
  const baselineStrategy = deriveDailyTaskStrategy(normalizedUser, summary)
  const retrievedKnowledge = await retrieveRelevantStrategyKnowledge(normalizedUser, summary, baselineStrategy)
  const diagnosisFeedbackSummary = await buildDiagnosisFeedbackSummary(user.id)
  const recentRulePerformance = await buildRecentRulePerformance(user.id)
  const baselineFindings = buildFindings(summary, previous, retrievedKnowledge)
  const baselineRecommendations = buildRecommendations(normalizedUser, summary, baselineStrategy, retrievedKnowledge)

  const payload = {
    protocolVersion: 1,
    task: {
      id: task.id,
      targetType: task.targetType,
      targetId: task.targetId,
      targetMeta: safeJsonParse(task.targetMeta) ?? task.targetMeta ?? null,
    },
    analysisType: 'user_strategy_refresh',
    user: normalizedUser,
    summary,
    previousSnapshot: previous
      ? {
          id: previous.id,
          confidenceScore: Number(previous.confidenceScore ?? 0),
          createdAt: previous.createdAt,
          findings: safeJsonParse(previous.findings) ?? [],
          recommendations: safeJsonParse(previous.recommendations) ?? [],
        }
      : null,
    retrievedKnowledge,
    diagnosisFeedbackSummary,
    recentRulePerformance,
    baseline: {
      strategy: baselineStrategy,
      findings: baselineFindings,
      recommendations: baselineRecommendations,
    },
    outputContract: buildOutputContractForType('user_strategy_refresh'),
  }

  const exportInfo = await writeTaskFiles(task.id, payload, buildCodexPrompt(payload))
  const { contextFile, promptFile } = exportInfo

  await query(
    `UPDATE analysis_queue
     SET "targetMeta" = $2,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [task.id, JSON.stringify({
      ...toPlainObject(safeJsonParse(task.targetMeta)),
      exportContextFile: contextFile,
      exportPromptFile: promptFile,
      exportedAt: new Date().toISOString(),
      protocolVersion: 1,
    })]
  )

  return exportInfo
}

async function exportUserErrorDiagnosisContext(task) {
  const userErrorResult = await query(
    `SELECT
       ue.id,
       ue."userId",
       ue."questionId",
       ue."myAnswer",
       ue."errorReason",
       ue."rootReason",
       ue."reasonTag",
       ue."aiRootReason",
       ue."aiErrorReason",
       ue."aiThinking",
       ue."aiReasonTag",
       ue."aiActionRule",
       ue."customAiAnalysis",
       ue."reviewCount",
       ue."correctCount",
       ue."masteryPercent",
       ue."lastReviewedAt",
       q.content,
       q.options,
       q.answer,
       q.analysis,
       q.type,
       q.subtype,
       q."questionImage"
     FROM user_errors ue
     JOIN questions q ON q.id = ue."questionId"
     WHERE ue.id = $1
     LIMIT 1`,
    [task.targetId]
  )

  const userError = userErrorResult.rows[0] ?? null
  if (!userError) {
    await markTaskSkipped(task.id, 'user error not found')
    throw new Error(`user error not found: ${task.targetId}`)
  }

  const imageOcr = await maybeRecognizeQuestionImage(userError.questionImage, userError.content, userError.type)
  const retrievedKnowledge = await retrieveRelevantDiagnosisKnowledge(userError, imageOcr)
  const historicalPatterns = await buildHistoricalPatterns(userError)
  const ruleEffectiveness = await buildRuleEffectiveness(userError)
  const userProfileSignals = await buildUserProfileSignals(userError.userId, userError.type)
  const latestStrategySnapshot = await getLatestStrategySnapshot(userError.userId)

  const payload = {
    protocolVersion: 1,
    task: {
      id: task.id,
      targetType: task.targetType,
      targetId: task.targetId,
      targetMeta: safeJsonParse(task.targetMeta) ?? task.targetMeta ?? null,
    },
    analysisType: 'user_error_diagnosis',
    userId: userError.userId,
    userError: {
      id: userError.id,
      questionId: userError.questionId,
      myAnswer: userError.myAnswer,
      errorReason: userError.errorReason,
      rootReason: userError.rootReason,
      reasonTag: userError.reasonTag,
      reviewCount: Number(userError.reviewCount ?? 0),
      correctCount: Number(userError.correctCount ?? 0),
      masteryPercent: Number(userError.masteryPercent ?? 0),
      lastReviewedAt: userError.lastReviewedAt,
      previousDiagnosis: {
        aiRootReason: userError.aiRootReason,
        aiErrorReason: userError.aiErrorReason,
        aiThinking: userError.aiThinking,
        aiReasonTag: userError.aiReasonTag,
        aiActionRule: userError.aiActionRule,
        customAiAnalysis: userError.customAiAnalysis,
      },
    },
    question: {
      id: userError.questionId,
      type: userError.type,
      subtype: userError.subtype,
      content: userError.content,
      options: safeJsonParse(userError.options) ?? userError.options ?? '',
      answer: userError.answer,
      analysis: userError.analysis,
      questionImage: userError.questionImage ?? null,
      imageOcr,
    },
    historicalPatterns,
    ruleEffectiveness,
    userProfileSignals,
    latestStrategySnapshot,
    retrievedKnowledge,
    outputContract: buildOutputContractForType('user_error_diagnosis'),
  }

  const exportInfo = await writeTaskFiles(task.id, payload, buildCodexPrompt(payload))
  const { contextFile, promptFile } = exportInfo

  await query(
    `UPDATE analysis_queue
     SET "targetMeta" = $2,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [task.id, JSON.stringify({
      ...toPlainObject(safeJsonParse(task.targetMeta)),
      exportContextFile: contextFile,
      exportPromptFile: promptFile,
      exportedAt: new Date().toISOString(),
      protocolVersion: 1,
      imageOcrUsed: Boolean(imageOcr),
    })]
  )

  return exportInfo
}

async function applyResultFile({ taskId, resultFile }) {
  const resolvedPath = path.isAbsolute(resultFile)
    ? resultFile
    : path.resolve(WORKSPACE_ROOT, resultFile)

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`result file not found: ${resolvedPath}`)
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8')
  const parsed = JSON.parse(raw)
  const result = validateCodexResult(parsed, taskId)

  const taskResult = await query(
    `SELECT *
     FROM analysis_queue
     WHERE id = $1
     LIMIT 1`,
    [taskId]
  )
  const task = taskResult.rows[0] ? normalizeTask(taskResult.rows[0]) : null
  if (!task) throw new Error(`analysis task not found: ${taskId}`)
  if (task.status === 'done') {
    return 'skipped'
  }

  if (task.userId && task.userId !== result.userId) {
    throw new Error(`result userId ${result.userId} does not match task userId ${task.userId}`)
  }

  if (result.analysisType !== 'user_error_diagnosis' && task.targetId !== result.userId) {
    throw new Error(`result userId ${result.userId} does not match task targetId ${task.targetId}`)
  }

  if (task.targetType !== result.analysisType) {
    throw new Error(`task targetType ${task.targetType} does not match result analysisType ${result.analysisType}`)
  }

  if (result.analysisType === 'user_error_diagnosis') {
    if (result.userErrorId !== task.targetId) {
      throw new Error(`result userErrorId ${result.userErrorId} does not match task targetId ${task.targetId}`)
    }

    const strategyEscalation = result.strategyImpact?.shouldEscalateToStrategyRefresh
      ? await enqueueStrategyRefreshTaskForUser(result.userId ?? task.userId, {
          reason: 'diagnosis_escalation',
          sourceTaskId: taskId,
          sourceUserErrorId: result.userErrorId,
          riskLevel: result.strategyImpact?.riskLevel ?? 'medium',
          diagnosisMode: result.diagnosisDecision?.mode ?? null,
          suggestedFocusType: result.strategyImpact?.suggestedFocusType ?? null,
        }, result.strategyImpact?.riskLevel === 'high' ? 0.96 : 0.9)
      : null

    await query(
      `UPDATE user_errors
       SET "aiRootReason" = $2,
           "aiErrorReason" = $3,
           "aiActionRule" = $4,
           "aiThinking" = $5,
           "aiReasonTag" = $6,
           "customAiAnalysis" = $7,
           "aiAnalyzedAt" = NOW(),
           "updatedAt" = NOW()
       WHERE id = $1`,
      [
        result.userErrorId,
        result.diagnosis.aiRootReason,
        result.diagnosis.aiErrorReason,
        result.diagnosis.aiActionRule,
        result.diagnosis.aiThinking,
        result.diagnosis.aiReasonTag,
        result.diagnosis.customAiAnalysis ?? null,
      ]
    )

    if (result.knowledge) {
      await persistKnowledgeFromResult({
        userId: result.userId ?? task.targetId,
        knowledge: result.knowledge,
        snapshotId: `user_error:${result.userErrorId}`,
      })
    }

    const snapshotId = await writeSnapshot({
      userId: result.userId ?? task.userId,
      analysisType: result.analysisType,
      prevSnapshotId: null,
      inputSummary: buildUserErrorDiagnosisSnapshotInput({
        taskId,
        resolvedPath,
        task,
        result,
        strategyEscalation,
      }),
      findings: buildUserErrorDiagnosisFindings(result),
      recommendations: buildUserErrorDiagnosisRecommendations(result, strategyEscalation),
      confidenceScore: result.confidenceScore,
      dataPointsUsed: countDiagnosisDataPoints(result),
    })

    await query(
      `UPDATE analysis_queue
       SET status = 'done',
           "resultId" = $2,
           "resultSummary" = $3,
           "analyzedAt" = NOW(),
           "failReason" = NULL,
           "updatedAt" = NOW()
       WHERE id = $1`,
      [taskId, snapshotId, result.resultSummary ?? result.diagnosis.aiRootReason]
    )

    return 'applied'
  }

  const snapshotId = await writeSnapshot({
    userId: result.userId ?? task.targetId,
    analysisType: result.analysisType,
    prevSnapshotId: result.prevSnapshotId ?? null,
    inputSummary: result.inputSummary ?? {
      taskId,
      appliedFrom: resolvedPath,
    },
    findings: result.findings,
    recommendations: result.recommendations,
    confidenceScore: result.confidenceScore,
    dataPointsUsed: result.dataPointsUsed,
  })

  if (result.knowledge) {
    await persistKnowledgeFromResult({
      userId: result.userId ?? task.targetId,
      knowledge: result.knowledge,
      snapshotId,
    })
  }

  await query(
    `UPDATE analysis_queue
     SET status = 'done',
         "resultId" = $2,
         "resultSummary" = $3,
         "analyzedAt" = NOW(),
         "failReason" = NULL,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [taskId, snapshotId, result.resultSummary ?? result.findings[0]?.title ?? 'Codex analysis applied']
  )

  return 'applied'
}

async function retrieveRelevantStrategyKnowledge(user, summary, strategy) {
  const queryText = [
    '策略分析',
    summary.weakTypes.map((item) => item.type).join(' '),
    strategy.activationQuestionTypes.join(' '),
    `accuracy ${summary.accuracy}`,
    `due ${summary.dueReviewCount}`,
    `target ${strategy.totalTarget}`,
    `error ${strategy.errorLimit}`,
    `guard ${strategy.guardLimit}`,
  ].join(' ')

  const embedding = await getEmbedding(queryText)
  let result

  if (embedding) {
    result = await query(
      `SELECT id, "methodName", "qualityScore", "usageCount", "rawAnalysis"
       FROM knowledge_entries
       WHERE "questionType" = '策略分析'
         AND ("userId" = $1 OR "isPublic" = true)
         AND "contentEmbedding" IS NOT NULL
       ORDER BY "contentEmbedding" <-> $2::vector, "qualityScore" DESC
       LIMIT 3`,
      [user.id, JSON.stringify(embedding)]
    )
  } else {
    const keywords = [...new Set([
      ...summary.weakTypes.map((item) => item.type),
      ...strategy.activationQuestionTypes,
      summary.dueReviewCount > 0 ? '到期错题' : null,
      '日任务',
      '复盘',
    ].filter(Boolean))]

    const patterns = keywords.map((_, index) => `"triggerKeywords" ILIKE $${index + 2}`)
    const params = [user.id, ...keywords.map((item) => `%${item}%`)]
    const whereKeyword = patterns.length > 0 ? `AND (${patterns.join(' OR ')})` : ''
    result = await query(
      `SELECT id, "methodName", "qualityScore", "usageCount", "rawAnalysis"
       FROM knowledge_entries
       WHERE "questionType" = '策略分析'
         AND ("userId" = $1 OR "isPublic" = true)
         ${whereKeyword}
       ORDER BY "qualityScore" DESC, "usageCount" DESC, "updatedAt" DESC
       LIMIT 3`,
      params
    )
  }

  if (result.rowCount === 0) return []

  const ids = result.rows.map((row) => row.id)
  await query(
    `UPDATE knowledge_entries
     SET "usageCount" = COALESCE("usageCount", 0) + 1,
         "updatedAt" = NOW()
     WHERE id = ANY($1::text[])`,
    [ids]
  )

  return result.rows.map((row) => ({
    id: row.id,
    methodName: row.methodName,
    qualityScore: Number(row.qualityScore),
    usageCount: Number(row.usageCount ?? 0) + 1,
    rawAnalysis: row.rawAnalysis,
  }))
}

async function buildUserStrategySummary(userId, lookbackDays) {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

  const [logsResult, errorsResult, activeInsightResult] = await Promise.all([
    query(
      `SELECT "eventType", payload, "hourOfDay", "createdAt"
       FROM activity_logs
       WHERE "userId" = $1
         AND "createdAt" >= $2`,
      [userId, since]
    ),
    query(
      `SELECT ue."nextReviewAt", ue."isHot", ue."isStockified", ue."masteryPercent", q.type
       FROM user_errors ue
       JOIN questions q ON q.id = ue."questionId"
       WHERE ue."userId" = $1`,
      [userId]
    ),
    query(
      `SELECT id, "paramValueNew", "updatedAt"
       FROM system_insights
       WHERE "userId" = $1
         AND status = 'applied'
         AND "paramKey" = 'daily_task_strategy'
         AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
       ORDER BY COALESCE("appliedAt", "createdAt") DESC, "createdAt" DESC
       LIMIT 1`,
      [userId]
    ),
  ])

  const logs = logsResult.rows.map((row) => ({
    eventType: row.eventType,
    payload: row.payload,
    hourOfDay: row.hourOfDay,
    createdAt: row.createdAt,
  }))
  const errors = errorsResult.rows.map((row) => ({
    nextReviewAt: row.nextReviewAt,
    isHot: row.isHot,
    isStockified: row.isStockified,
    masteryPercent: row.masteryPercent,
    question: { type: row.type },
  }))
  const activeInsight = activeInsightResult.rows[0] ?? null

  const practiceAnswers = logs
    .filter((log) => log.eventType === 'practice.answer')
    .map((log) => typeof log.payload === 'string' ? safeJsonParse(log.payload) : log.payload)
    .filter(Boolean)

  const totalPractice = practiceAnswers.length
  const correctPractice = practiceAnswers.filter((payload) => payload.isCorrect).length
  const accuracy = totalPractice > 0 ? Math.round((correctPractice / totalPractice) * 100) : 0
  const slowCorrectCount = practiceAnswers.filter((payload) => payload.isSlowCorrect).length

  const weakTypeMap = new Map()
  for (const payload of practiceAnswers) {
    if (!payload.questionType) continue
    const current = weakTypeMap.get(payload.questionType) ?? { total: 0, correct: 0 }
    current.total += 1
    if (payload.isCorrect) current.correct += 1
    weakTypeMap.set(payload.questionType, current)
  }

  const weakTypes = Array.from(weakTypeMap.entries())
    .filter(([, value]) => value.total >= 3)
    .map(([type, value]) => ({
      type,
      accuracy: value.total > 0 ? value.correct / value.total : 0,
      total: value.total,
    }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3)

  const hourCounts = new Map()
  for (const log of logs) {
    if (log.hourOfDay == null) continue
    hourCounts.set(log.hourOfDay, (hourCounts.get(log.hourOfDay) ?? 0) + 1)
  }
  const hotHours = Array.from(hourCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => hour)

  const dueReviewCount = errors.filter((error) => error.nextReviewAt && new Date(error.nextReviewAt) <= new Date()).length
  const hotErrorCount = errors.filter((error) => error.isHot).length
  const stockifiedCount = errors.filter((error) => error.isStockified).length
  const lowMasteryCount = errors.filter((error) => error.masteryPercent < 60).length

  const weakestErrorTypes = [...errors].reduce((acc, error) => {
    const type = error.question.type
    const current = acc.get(type) ?? { count: 0, sum: 0 }
    current.count += 1
    current.sum += Number(error.masteryPercent)
    acc.set(type, current)
    return acc
  }, new Map())

  const weakestErrorTypeList = Array.from(weakestErrorTypes.entries())
    .map(([type, value]) => ({
      type,
      avgMastery: value.count > 0 ? value.sum / value.count : 0,
      count: value.count,
    }))
    .filter((item) => item.count >= 2)
    .sort((a, b) => a.avgMastery - b.avgMastery)
    .slice(0, 3)

  return {
    since: since.toISOString(),
    totalEvents: logs.length,
    totalPractice,
    accuracy,
    slowCorrectCount,
    weakTypes,
    hotHours,
    totalUserErrors: errors.length,
    dueReviewCount,
    hotErrorCount,
    stockifiedCount,
    lowMasteryCount,
    weakestErrorTypeList,
    activeInsight: activeInsight
      ? {
          id: activeInsight.id,
          updatedAt: new Date(activeInsight.updatedAt).toISOString(),
          value: typeof activeInsight.paramValueNew === 'string' ? safeJsonParse(activeInsight.paramValueNew) : activeInsight.paramValueNew,
        }
      : null,
  }
}

async function buildHistoricalPatterns(userError) {
  const recentResult = await query(
    `SELECT
       ue.id,
       ue."aiRootReason",
       ue."aiErrorReason",
       ue."aiActionRule",
       ue."aiReasonTag",
       ue."customAiAnalysis",
       ue."masteryPercent",
       ue."reviewCount",
       ue."correctCount",
       ue."isHot",
       ue."reboundAlert",
       ue."lastReviewedAt",
       ue."createdAt",
       q.type,
       q.subtype,
       left(q.content, 120) AS "contentPreview"
     FROM user_errors ue
     JOIN questions q ON q.id = ue."questionId"
     WHERE ue."userId" = $1
       AND ue.id <> $2
     ORDER BY COALESCE(ue."lastReviewedAt", ue."createdAt") DESC
     LIMIT 20`,
    [userError.userId, userError.id]
  )

  const rows = recentResult.rows
  const sameTypeRows = rows.filter((row) => row.type === userError.type)
  const sameReasonTagRecentCount = userError.aiReasonTag
    ? rows.filter((row) => row.aiReasonTag && row.aiReasonTag === userError.aiReasonTag).length
    : 0
  const sameActionRuleRecentCount = userError.aiActionRule
    ? rows.filter((row) => row.aiActionRule && row.aiActionRule === userError.aiActionRule).length
    : 0

  return {
    sameTypeRecentErrors: sameTypeRows.slice(0, 8).map((row) => ({
      id: row.id,
      questionType: row.type,
      questionSubtype: row.subtype,
      contentPreview: row.contentPreview,
      aiReasonTag: row.aiReasonTag,
      aiActionRule: row.aiActionRule,
      masteryPercent: Number(row.masteryPercent ?? 0),
      reviewCount: Number(row.reviewCount ?? 0),
      correctCount: Number(row.correctCount ?? 0),
      isHot: Boolean(row.isHot),
      reboundAlert: Boolean(row.reboundAlert),
      lastReviewedAt: row.lastReviewedAt,
    })),
    sameReasonTagRecentCount,
    sameActionRuleRecentCount,
    lastThreeDiagnoses: rows
      .filter((row) => row.aiRootReason || row.aiActionRule || row.customAiAnalysis)
      .slice(0, 3)
      .map((row) => ({
        id: row.id,
        questionType: row.type,
        aiRootReason: row.aiRootReason,
        aiErrorReason: row.aiErrorReason,
        aiActionRule: row.aiActionRule,
        aiReasonTag: row.aiReasonTag,
        createdAt: row.createdAt,
      })),
  }
}

async function buildRuleEffectiveness(userError) {
  const priorRuleResult = await query(
    `SELECT
       ue.id,
       ue."aiActionRule",
       ue."aiReasonTag",
       ue."aiAnalyzedAt",
       q.type
     FROM user_errors ue
     JOIN questions q ON q.id = ue."questionId"
     WHERE ue."userId" = $1
       AND ue.id <> $2
       AND q.type = $3
       AND ue."aiActionRule" IS NOT NULL
       AND ue."aiAnalyzedAt" IS NOT NULL
     ORDER BY ue."aiAnalyzedAt" DESC
     LIMIT 1`,
    [userError.userId, userError.id, userError.type]
  )

  const priorRule = priorRuleResult.rows[0] ?? null
  if (!priorRule) {
    return {
      currentRule: null,
      currentReasonTag: null,
      ruleIssuedAt: null,
      sameTypeAfterRuleTotal: 0,
      sameTypeAfterRuleCorrect: 0,
      sameTypeAfterRuleAccuracy: null,
      followupSlowCorrectRate: null,
      repeatWrongAfterRuleCount: 0,
      masteryLiftAfterRule: null,
    }
  }

  const followupResult = await query(
    `SELECT
       rr."isCorrect",
       rr."isSlowCorrect",
       ue."masteryPercent"
     FROM review_records rr
     JOIN user_errors ue ON ue.id = rr."userErrorId"
     JOIN questions q ON q.id = ue."questionId"
     WHERE ue."userId" = $1
       AND q.type = $2
       AND rr."createdAt" >= $3`,
    [userError.userId, userError.type, priorRule.aiAnalyzedAt]
  )

  const followupRows = followupResult.rows
  const sameTypeAfterRuleTotal = followupRows.length
  const sameTypeAfterRuleCorrect = followupRows.filter((row) => row.isCorrect).length
  const slowCorrectCount = followupRows.filter((row) => row.isSlowCorrect).length
  const sameTypeAfterRuleAccuracy = sameTypeAfterRuleTotal > 0
    ? Number((sameTypeAfterRuleCorrect / sameTypeAfterRuleTotal).toFixed(2))
    : null
  const followupSlowCorrectRate = sameTypeAfterRuleTotal > 0
    ? Number((slowCorrectCount / sameTypeAfterRuleTotal).toFixed(2))
    : null

  const repeatWrongResult = await query(
    `SELECT COUNT(*)::int AS count
     FROM user_errors ue
     JOIN questions q ON q.id = ue."questionId"
     WHERE ue."userId" = $1
       AND q.type = $2
       AND COALESCE(ue."aiReasonTag", '') = COALESCE($3, '')
       AND COALESCE(ue."lastReviewedAt", ue."createdAt") >= $4
       AND ue."correctCount" = 0`,
    [userError.userId, userError.type, priorRule.aiReasonTag ?? null, priorRule.aiAnalyzedAt]
  )

  const masteryValues = followupRows
    .map((row) => Number(row.masteryPercent ?? 0))
    .filter((value) => Number.isFinite(value))
  const masteryLiftAfterRule = masteryValues.length > 0
    ? Number((masteryValues.reduce((sum, value) => sum + value, 0) / masteryValues.length).toFixed(1))
    : null

  return {
    currentRule: priorRule.aiActionRule,
    currentReasonTag: priorRule.aiReasonTag,
    ruleIssuedAt: priorRule.aiAnalyzedAt,
    sameTypeAfterRuleTotal,
    sameTypeAfterRuleCorrect,
    sameTypeAfterRuleAccuracy,
    followupSlowCorrectRate,
    repeatWrongAfterRuleCount: Number(repeatWrongResult.rows[0]?.count ?? 0),
    masteryLiftAfterRule,
  }
}

async function buildUserProfileSignals(userId, currentQuestionType) {
  const [errorResult, reviewResult] = await Promise.all([
    query(
      `SELECT
         COALESCE(ue."aiReasonTag", '未标注') AS "reasonTag",
         q.type,
         ue."masteryPercent",
         ue."reviewCount",
         ue."correctCount",
         ue."isHot",
         ue."reboundAlert",
         COALESCE(ue."lastReviewedAt", ue."createdAt") AS "touchedAt"
       FROM user_errors ue
       JOIN questions q ON q.id = ue."questionId"
       WHERE ue."userId" = $1`,
      [userId]
    ),
    query(
      `SELECT
         rr."isCorrect",
         rr."isSlowCorrect",
         rr."createdAt",
         q.type
       FROM review_records rr
       JOIN user_errors ue ON ue.id = rr."userErrorId"
       JOIN questions q ON q.id = ue."questionId"
       WHERE ue."userId" = $1
         AND rr."createdAt" >= NOW() - INTERVAL '30 days'`,
      [userId]
    ),
  ])

  const errorRows = errorResult.rows
  const reviewRows = reviewResult.rows

  const reasonCounts = new Map()
  const typeBuckets = new Map()
  let currentTypeRepeatCount = 0

  for (const row of errorRows) {
    reasonCounts.set(row.reasonTag, (reasonCounts.get(row.reasonTag) ?? 0) + 1)
    const bucket = typeBuckets.get(row.type) ?? { count: 0, masterySum: 0, hotCount: 0, reboundCount: 0 }
    bucket.count += 1
    bucket.masterySum += Number(row.masteryPercent ?? 0)
    if (row.isHot) bucket.hotCount += 1
    if (row.reboundAlert) bucket.reboundCount += 1
    typeBuckets.set(row.type, bucket)
    if (row.type === currentQuestionType && Number(row.reviewCount ?? 0) >= 1) {
      currentTypeRepeatCount += 1
    }
  }

  const highFrequencyReasonTags = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag, count]) => ({ tag, count }))

  const weakQuestionTypes = Array.from(typeBuckets.entries())
    .map(([type, value]) => ({
      type,
      count: value.count,
      avgMastery: value.count > 0 ? Number((value.masterySum / value.count).toFixed(1)) : 0,
      hotCount: value.hotCount,
      reboundCount: value.reboundCount,
    }))
    .sort((a, b) => a.avgMastery - b.avgMastery || b.count - a.count)
    .slice(0, 3)

  const recentCorrect = reviewRows.filter((row) => row.isCorrect).length
  const recentTotal = reviewRows.length
  const recentSlowCorrect = reviewRows.filter((row) => row.isSlowCorrect).length

  return {
    highFrequencyReasonTags,
    weakQuestionTypes,
    recentMasteryTrend: weakQuestionTypes.find((item) => item.type === currentQuestionType) ?? null,
    reviewStability: {
      recentTotal,
      recentAccuracy: recentTotal > 0 ? Number((recentCorrect / recentTotal).toFixed(2)) : null,
      recentSlowCorrectRate: recentTotal > 0 ? Number((recentSlowCorrect / recentTotal).toFixed(2)) : null,
    },
    isRepeatOffenderOnSameType: currentTypeRepeatCount >= 3,
  }
}

async function getLatestStrategySnapshot(userId) {
  const snapshotResult = await query(
    `SELECT id, findings, recommendations, "confidenceScore", "createdAt"
     FROM analysis_snapshots
     WHERE "userId" = $1
       AND "analysisType" = 'user_strategy_refresh'
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    [userId]
  )
  const snapshot = snapshotResult.rows[0] ?? null
  if (!snapshot) return null

  return {
    id: snapshot.id,
    confidenceScore: Number(snapshot.confidenceScore ?? 0),
    createdAt: snapshot.createdAt,
    findings: safeJsonParse(snapshot.findings) ?? [],
    recommendations: safeJsonParse(snapshot.recommendations) ?? [],
  }
}

async function buildDiagnosisFeedbackSummary(userId) {
  const result = await query(
    `SELECT
       COALESCE(ue."aiReasonTag", '未标注') AS "reasonTag",
       ue."aiActionRule",
       q.type,
       ue."reboundAlert",
       ue."correctCount",
       ue."reviewCount"
     FROM user_errors ue
     JOIN questions q ON q.id = ue."questionId"
     WHERE ue."userId" = $1`,
    [userId]
  )

  const rows = result.rows
  const topReasonTags = aggregateTopCounts(rows.map((row) => row.reasonTag), 3)
  const repeatWrongPatterns = aggregateTopCounts(
    rows.filter((row) => Number(row.correctCount ?? 0) === 0).map((row) => `${row.type}:${row.reasonTag}`),
    5,
  )
  const bestActionRules = aggregateTopCounts(
    rows.filter((row) => row.aiActionRule && Number(row.correctCount ?? 0) >= 1).map((row) => row.aiActionRule),
    3,
  )
  const worstActionRules = aggregateTopCounts(
    rows.filter((row) => row.aiActionRule && Number(row.correctCount ?? 0) === 0 && Number(row.reviewCount ?? 0) >= 2).map((row) => row.aiActionRule),
    3,
  )
  const ruleFailureHotspots = aggregateTopCounts(
    rows.filter((row) => row.aiActionRule && row.reboundAlert).map((row) => `${row.type}:${row.aiActionRule}`),
    3,
  )

  return {
    topReasonTags,
    repeatWrongPatterns,
    bestActionRules,
    worstActionRules,
    ruleFailureHotspots,
  }
}

async function buildRecentRulePerformance(userId) {
  const result = await query(
    `SELECT
       ue."aiActionRule",
       q.type,
       rr."isCorrect",
       rr."createdAt"
     FROM review_records rr
     JOIN user_errors ue ON ue.id = rr."userErrorId"
     JOIN questions q ON q.id = ue."questionId"
     WHERE ue."userId" = $1
       AND ue."aiActionRule" IS NOT NULL
       AND rr."createdAt" >= NOW() - INTERVAL '30 days'`,
    [userId]
  )

  const ruleMap = new Map()
  for (const row of result.rows) {
    const key = row.aiActionRule
    const bucket = ruleMap.get(key) ?? { issuedCount: 0, followupCorrect: 0, total: 0, types: new Set() }
    bucket.total += 1
    if (row.isCorrect) bucket.followupCorrect += 1
    bucket.types.add(row.type)
    ruleMap.set(key, bucket)
  }

  return Array.from(ruleMap.entries())
    .map(([ruleName, value]) => ({
      ruleName,
      issuedCount: value.total,
      followupCorrectRate: value.total > 0 ? Number((value.followupCorrect / value.total).toFixed(2)) : null,
      repeatWrongRate: value.total > 0 ? Number(((value.total - value.followupCorrect) / value.total).toFixed(2)) : null,
      questionTypes: Array.from(value.types),
    }))
    .sort((a, b) => (b.issuedCount - a.issuedCount) || ((b.followupCorrectRate ?? 0) - (a.followupCorrectRate ?? 0)))
    .slice(0, 5)
}

function aggregateTopCounts(values, limit) {
  const counts = new Map()
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }))
}

function deriveDailyTaskStrategy(user, summary) {
  const examDate = user.examDate ? new Date(user.examDate) : null
  const daysToExam = examDate
    ? Math.max(0, Math.ceil((examDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null
  const inActivationWindow = daysToExam !== null && daysToExam <= 14

  let totalTarget = Number(user.dailyGoal)
  if (summary.totalPractice < 20 && summary.dueReviewCount > 15) totalTarget = Math.max(totalTarget, 35)
  if (summary.accuracy >= 75 && summary.totalPractice >= 20) totalTarget = Math.max(totalTarget, Number(user.dailyGoal) + 10)
  if (summary.accuracy < 50) totalTarget = Math.min(totalTarget, Math.max(20, Number(user.dailyGoal)))

  let errorLimit = 18
  if (summary.dueReviewCount >= 25) errorLimit = 30
  else if (summary.dueReviewCount >= 12) errorLimit = 24

  let guardLimit = summary.stockifiedCount >= 20 ? 10 : 6
  if (summary.accuracy < 55) guardLimit = Math.max(guardLimit, 8)

  const activationQuestionTypes = summary.weakTypes.length > 0
    ? summary.weakTypes.map((item) => item.type)
    : summary.weakestErrorTypeList.map((item) => item.type)

  return {
    totalTarget,
    activationTotalTarget: inActivationWindow ? Math.max(totalTarget, 45) : Math.max(totalTarget, 40),
    errorLimit,
    guardLimit,
    activationThresholdDays: 14,
    activationQuestionTypes,
    examWindowDays: daysToExam,
  }
}

function buildFindings(summary, previous, retrievedKnowledge = []) {
  const findings = []

  if (summary.weakTypes.length > 0) {
    const mainWeak = summary.weakTypes[0]
    findings.push({
      type: 'weakness',
      skillTag: mainWeak.type,
      title: `${mainWeak.type} 是当前主要短板`,
      detail: `近阶段 ${mainWeak.type} 共练 ${mainWeak.total} 题，正确率约 ${Math.round(mainWeak.accuracy * 100)}%，应优先进入每日任务前排。`,
      confidence: Math.min(0.9, 0.55 + mainWeak.total * 0.05),
      trend: previous ? 'stable' : undefined,
      evidence: `weakTypes=${summary.weakTypes.map((item) => `${item.type}:${Math.round(item.accuracy * 100)}%`).join(', ')}`,
    })
  }

  if (summary.dueReviewCount > 0) {
    findings.push({
      type: 'optimization',
      title: '到期错题积压正在拖慢训练节奏',
      detail: `当前有 ${summary.dueReviewCount} 道到期错题待处理，若继续把真题补位放在前面，会拉低复盘闭环完成率。`,
      confidence: summary.dueReviewCount >= 20 ? 0.88 : 0.72,
      trend: summary.dueReviewCount >= 20 ? 'worsening' : 'stable',
      evidence: `dueReviewCount=${summary.dueReviewCount}`,
    })
  }

  if (summary.hotHours.length > 0) {
    findings.push({
      type: 'pattern',
      title: '训练高峰时段已经出现',
      detail: `最近活跃主要集中在 ${summary.hotHours.map(formatHour).join('、')}，适合把复盘优先级最高的任务固定放在这个时间段前半程。`,
      confidence: 0.66,
      trend: 'stable',
      evidence: `hotHours=${summary.hotHours.join(',')}`,
    })
  }

  if (retrievedKnowledge.length > 0) {
    findings.push({
      type: 'optimization',
      title: '已命中历史有效策略，可直接复用',
      detail: `本次分析命中了 ${retrievedKnowledge.map((item) => item.methodName).join('、')}，可优先沿用这些已沉淀的方法，而不是从零重排训练节奏。`,
      confidence: 0.74,
      trend: 'stable',
      evidence: `knowledge=${retrievedKnowledge.map((item) => item.methodName).join(',')}`,
    })
  }

  if (findings.length === 0) {
    findings.push({
      type: 'pattern',
      title: '可用数据还偏少，先维持基础训练节奏',
      detail: '当前最近活动量不足，先保持稳定日任务与错题回看，再等更多数据进入策略刷新。',
      confidence: 0.5,
      evidence: `totalEvents=${summary.totalEvents}`,
    })
  }

  return findings
}

function buildRecommendations(user, summary, strategy, retrievedKnowledge = []) {
  const bullets = []
  bullets.push(`把今日目标调整到 ${strategy.totalTarget} 道`)
  bullets.push(`把错题复盘上限设为 ${strategy.errorLimit} 道`)
  bullets.push(`守卫复习保留 ${strategy.guardLimit} 道`)
  if (strategy.activationQuestionTypes.length > 0) {
    bullets.push(`优先关注 ${strategy.activationQuestionTypes.join('、')}`)
  }
  if (retrievedKnowledge.length > 0) {
    bullets.push(`优先复用历史策略：${retrievedKnowledge.map((item) => item.methodName).join('、')}`)
  }

  let confidence = summary.totalPractice >= 15 || summary.totalUserErrors >= 20 ? 0.82 : 0.68
  if (retrievedKnowledge.length > 0) {
    confidence = Math.min(0.9, confidence + 0.05)
  }

  return [
    {
      action: 'change_strategy',
      target: 'daily_tasks',
      value: {
        totalTarget: strategy.totalTarget,
        activationTotalTarget: strategy.activationTotalTarget,
        errorLimit: strategy.errorLimit,
        guardLimit: strategy.guardLimit,
        activationThresholdDays: strategy.activationThresholdDays,
        activationQuestionTypes: strategy.activationQuestionTypes,
        generatedBy: 'analysis-worker',
        bullets,
        supportingKnowledge: retrievedKnowledge.map((item) => ({
          id: item.id,
          methodName: item.methodName,
          qualityScore: item.qualityScore,
        })),
      },
      reason: summary.dueReviewCount > 0
        ? `近期到期错题 ${summary.dueReviewCount} 道，需先稳住复盘再扩充真题补位。`
        : '按近期活跃题量和正确率，当前日任务结构需要重新平衡。',
      confidence,
      priority: confidence >= 0.75 ? 'high' : 'medium',
      paramKey: 'daily_task_strategy',
      paramValue: JSON.stringify(strategy),
    },
  ]
}

function computeConfidence(summary) {
  let base = 0.55
  if (summary.totalPractice >= 15) base += 0.15
  if (summary.totalUserErrors >= 10) base += 0.1
  if (summary.totalEvents >= 30) base += 0.1
  return Math.min(0.92, Number(base.toFixed(2)))
}

async function persistStrategyKnowledge({ user, summary, strategy, findings, recommendations, snapshotId }) {
  const primaryFinding = findings[0] ?? null
  const primaryRecommendation = recommendations[0] ?? null
  if (!primaryFinding || !primaryRecommendation) return

  const methodName = buildStrategyMethodName(summary, strategy)
  const questionType = '策略分析'
  const triggerKeywords = buildStrategyKeywords(summary, strategy)
  const solutionSteps = buildStrategySteps(strategy)
  const summaryLine = primaryRecommendation.reason
  const rawContent = [
    `用户：${user.username}`,
    `考试类型：${user.examType}`,
    `目标分：${user.targetScore}`,
    `近30天事件数：${summary.totalEvents}`,
    `练习题量：${summary.totalPractice}`,
    `正确率：${summary.accuracy}%`,
    `到期错题：${summary.dueReviewCount}`,
    `薄弱题型：${summary.weakTypes.map((item) => item.type).join('、') || '暂无'}`,
  ].join('\n')
  const rawAnalysis = [
    `快照：${snapshotId}`,
    `核心发现：${primaryFinding.title}`,
    primaryFinding.detail,
    `策略建议：${summaryLine}`,
    `执行结构：今日 ${strategy.totalTarget} 道，错题 ${strategy.errorLimit} 道，守卫 ${strategy.guardLimit} 道`,
  ].join('\n')
  const exampleSolution = [
    `先清理 ${strategy.errorLimit} 道错题到期任务`,
    `再做 ${strategy.guardLimit} 道守卫复习`,
    `最后补足到 ${strategy.totalTarget} 道总量`,
  ].join('；')
  const qualityScore = Number(Math.min(primaryRecommendation.confidence, 0.95).toFixed(2))
  const embeddingInput = `${questionType} ${methodName} ${triggerKeywords.join(' ')} ${summaryLine}`
  const embedding = await getEmbedding(embeddingInput)

  const existingResult = await query(
    `SELECT id, "usageCount", "qualityScore"
     FROM knowledge_entries
     WHERE "userId" = $1
       AND "questionType" = $2
       AND "methodName" = $3
     ORDER BY "updatedAt" DESC
     LIMIT 1`,
    [user.id, questionType, methodName]
  )
  const existing = existingResult.rows[0] ?? null

  if (existing) {
    const params = [
      existing.id,
      rawContent,
      rawAnalysis,
      JSON.stringify(strategy.activationQuestionTypes),
      JSON.stringify(triggerKeywords),
      JSON.stringify(solutionSteps),
      exampleSolution,
      Math.max(Number(existing.qualityScore), qualityScore),
      Number(existing.usageCount) + 1,
    ]
    let sql = `
      UPDATE knowledge_entries
      SET "rawContent" = $2,
          "rawAnalysis" = $3,
          "applicableTypes" = $4,
          "triggerKeywords" = $5,
          "solutionSteps" = $6,
          "exampleSolution" = $7,
          "qualityScore" = $8,
          "usageCount" = $9,
          "aiExtractedAt" = NOW(),
          "updatedAt" = NOW()
    `
    if (embedding) {
      params.push(JSON.stringify(embedding))
      sql += `, "contentEmbedding" = $10::vector`
    }
    sql += ` WHERE id = $1`
    await query(sql, params)
    return
  }

  if (embedding) {
    await query(
      `INSERT INTO knowledge_entries (
        id, "userId", "isPublic", "questionId", "rawContent", "rawAnalysis",
        "questionType", "methodName", "applicableTypes", "triggerKeywords",
        "solutionSteps", "exampleSolution", "qualityScore", "aiExtractedAt",
        "usageCount", "createdAt", "updatedAt", "contentEmbedding"
      ) VALUES (
        gen_random_uuid()::text, $1, false, null, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10, NOW(),
        1, NOW(), NOW(), $11::vector
      )`,
      [
        user.id,
        rawContent,
        rawAnalysis,
        questionType,
        methodName,
        JSON.stringify(strategy.activationQuestionTypes),
        JSON.stringify(triggerKeywords),
        JSON.stringify(solutionSteps),
        exampleSolution,
        qualityScore,
        JSON.stringify(embedding),
      ]
    )
    return
  }

  await query(
    `INSERT INTO knowledge_entries (
      id, "userId", "isPublic", "questionId", "rawContent", "rawAnalysis",
      "questionType", "methodName", "applicableTypes", "triggerKeywords",
      "solutionSteps", "exampleSolution", "qualityScore", "aiExtractedAt",
      "usageCount", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, $1, false, null, $2, $3,
      $4, $5, $6, $7,
      $8, $9, $10, NOW(),
      1, NOW(), NOW()
    )`,
    [
      user.id,
      rawContent,
      rawAnalysis,
      questionType,
      methodName,
      JSON.stringify(strategy.activationQuestionTypes),
      JSON.stringify(triggerKeywords),
      JSON.stringify(solutionSteps),
      exampleSolution,
      qualityScore,
    ]
  )
}

async function persistKnowledgeFromResult({ userId, knowledge, snapshotId }) {
  const triggerKeywords = Array.isArray(knowledge.triggerKeywords) ? knowledge.triggerKeywords : []
  const solutionSteps = Array.isArray(knowledge.solutionSteps) ? knowledge.solutionSteps : []
  const applicableTypes = Array.isArray(knowledge.applicableTypes) ? knowledge.applicableTypes : []
  const qualityScore = Number(knowledge.qualityScore ?? 0.7)
  const embeddingInput = `${knowledge.questionType} ${knowledge.methodName} ${triggerKeywords.join(' ')} ${knowledge.summary ?? ''}`
  const embedding = await getEmbedding(embeddingInput)

  const existingResult = await query(
    `SELECT id, "usageCount", "qualityScore"
     FROM knowledge_entries
     WHERE "userId" = $1
       AND "questionType" = $2
       AND "methodName" = $3
     ORDER BY "updatedAt" DESC
     LIMIT 1`,
    [userId, knowledge.questionType, knowledge.methodName]
  )
  const existing = existingResult.rows[0] ?? null

  if (existing) {
    const params = [
      existing.id,
      knowledge.rawContent ?? '',
      knowledge.rawAnalysis ?? `snapshot=${snapshotId}`,
      JSON.stringify(applicableTypes),
      JSON.stringify(triggerKeywords),
      JSON.stringify(solutionSteps),
      knowledge.exampleSolution ?? '',
      Math.max(Number(existing.qualityScore), qualityScore),
      Number(existing.usageCount) + 1,
    ]
    let sql = `
      UPDATE knowledge_entries
      SET "rawContent" = $2,
          "rawAnalysis" = $3,
          "applicableTypes" = $4,
          "triggerKeywords" = $5,
          "solutionSteps" = $6,
          "exampleSolution" = $7,
          "qualityScore" = $8,
          "usageCount" = $9,
          "aiExtractedAt" = NOW(),
          "updatedAt" = NOW()
    `
    if (embedding) {
      params.push(JSON.stringify(embedding))
      sql += `, "contentEmbedding" = $10::vector`
    }
    sql += ` WHERE id = $1`
    await query(sql, params)
    return
  }

  if (embedding) {
    await query(
      `INSERT INTO knowledge_entries (
        id, "userId", "isPublic", "questionId", "rawContent", "rawAnalysis",
        "questionType", "methodName", "applicableTypes", "triggerKeywords",
        "solutionSteps", "exampleSolution", "qualityScore", "aiExtractedAt",
        "usageCount", "createdAt", "updatedAt", "contentEmbedding"
      ) VALUES (
        gen_random_uuid()::text, $1, false, null, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10, NOW(),
        1, NOW(), NOW(), $11::vector
      )`,
      [
        userId,
        knowledge.rawContent ?? '',
        knowledge.rawAnalysis ?? `snapshot=${snapshotId}`,
        knowledge.questionType,
        knowledge.methodName,
        JSON.stringify(applicableTypes),
        JSON.stringify(triggerKeywords),
        JSON.stringify(solutionSteps),
        knowledge.exampleSolution ?? '',
        qualityScore,
        JSON.stringify(embedding),
      ]
    )
    return
  }

  await query(
    `INSERT INTO knowledge_entries (
      id, "userId", "isPublic", "questionId", "rawContent", "rawAnalysis",
      "questionType", "methodName", "applicableTypes", "triggerKeywords",
      "solutionSteps", "exampleSolution", "qualityScore", "aiExtractedAt",
      "usageCount", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, $1, false, null, $2, $3,
      $4, $5, $6, $7,
      $8, $9, $10, NOW(),
      1, NOW(), NOW()
    )`,
    [
      userId,
      knowledge.rawContent ?? '',
      knowledge.rawAnalysis ?? `snapshot=${snapshotId}`,
      knowledge.questionType,
      knowledge.methodName,
      JSON.stringify(applicableTypes),
      JSON.stringify(triggerKeywords),
      JSON.stringify(solutionSteps),
      knowledge.exampleSolution ?? '',
      qualityScore,
    ]
  )
}

function buildUserErrorDiagnosisSnapshotInput({ taskId, resolvedPath, task, result, strategyEscalation }) {
  return {
    source: 'codex-result',
    taskId,
    appliedFrom: resolvedPath,
    queueTargetType: task.targetType,
    queueTriggeredBy: task.triggeredBy,
    userErrorId: result.userErrorId,
    usedEvidence: result.usedEvidence ?? null,
    diagnosisDecision: result.diagnosisDecision ?? null,
    strategyImpact: result.strategyImpact ?? null,
    strategyEscalation,
  }
}

function buildUserErrorDiagnosisFindings(result) {
  return [
    {
      type: 'error_pattern',
      title: result.diagnosis.aiRootReason,
      detail: result.diagnosis.aiErrorReason,
      confidence: result.confidenceScore,
      evidence: result.diagnosis.aiThinking,
      skillTag: result.diagnosis.aiReasonTag,
      trend: inferDiagnosisTrend(result.diagnosisDecision?.mode),
    },
  ]
}

function buildUserErrorDiagnosisRecommendations(result, strategyEscalation) {
  const riskLevel = result.strategyImpact?.riskLevel ?? 'medium'
  const recommendations = [
    {
      action: 'update_rule',
      target: 'user_error',
      value: {
        userErrorId: result.userErrorId,
        aiActionRule: result.diagnosis.aiActionRule,
        aiReasonTag: result.diagnosis.aiReasonTag,
        diagnosisMode: result.diagnosisDecision?.mode ?? 'new_pattern',
      },
      reason: result.diagnosis.customAiAnalysis ?? result.diagnosis.aiThinking,
      confidence: result.confidenceScore,
      priority: riskLevel === 'high' ? 'high' : 'medium',
    },
  ]

  if (strategyEscalation?.taskId) {
    recommendations.push({
      action: 'enqueue_strategy_refresh',
      target: 'analysis_queue',
      value: {
        taskId: strategyEscalation.taskId,
        created: strategyEscalation.created,
        suggestedFocusType: result.strategyImpact?.suggestedFocusType ?? null,
        riskLevel,
      },
      reason: '单题诊断判定需要把风险回流到用户级策略分析',
      confidence: Math.max(result.confidenceScore - 0.02, 0.6),
      priority: riskLevel === 'high' ? 'high' : 'medium',
      paramKey: riskLevel === 'high' ? 'strategy_refresh_signal' : undefined,
    })
  }

  return recommendations
}

function countDiagnosisDataPoints(result) {
  let total = 1
  if (result.usedEvidence?.knowledgeIds) total += result.usedEvidence.knowledgeIds.length
  if (result.usedEvidence?.historicalErrorsUsed) total += result.usedEvidence.historicalErrorsUsed.length
  if (result.usedEvidence?.previousDiagnosisUsed) total += 1
  if (result.usedEvidence?.ruleEffectUsed) total += 1
  return total
}

function inferDiagnosisTrend(mode) {
  if (mode === 'new_pattern') return 'up'
  if (mode === 'repeat_pattern' || mode === 'rule_failed') return 'down'
  return 'stable'
}

function buildOutputContract() {
  return buildOutputContractForType('user_strategy_refresh')
}

function buildOutputContractForType(analysisType) {
  if (analysisType === 'user_error_diagnosis') {
    return {
      requiredTopLevelFields: [
        'taskId',
        'analysisType',
        'userId',
        'userErrorId',
        'confidenceScore',
        'diagnosis',
      ],
      diagnosisShape: {
        aiRootReason: 'string <= 30 chars preferred',
        aiErrorReason: 'string <= 30 chars preferred',
        aiActionRule: "string, format '看到XX就XX' preferred",
        aiThinking: 'string <= 180 chars preferred',
        aiReasonTag: 'string',
        customAiAnalysis: 'optional string',
      },
      optionalUsedEvidenceShape: {
        knowledgeIds: 'string[]',
        previousDiagnosisUsed: 'boolean',
        historicalErrorsUsed: 'string[]',
        ruleEffectUsed: 'boolean',
      },
      optionalDiagnosisDecisionShape: {
        mode: 'new_pattern | repeat_pattern | rule_failed | rule_confirmed',
        supersedesPreviousRule: 'boolean',
        keepPreviousRule: 'boolean',
      },
      optionalStrategyImpactShape: {
        shouldEscalateToStrategyRefresh: 'boolean',
        suggestedFocusType: 'optional string',
        riskLevel: 'low | medium | high',
      },
      optionalKnowledgeShape: {
        questionType: 'string',
        methodName: 'string',
        applicableTypes: 'string[]',
        triggerKeywords: 'string[]',
        solutionSteps: 'string[]',
        exampleSolution: 'string',
        qualityScore: 'number 0-1',
        summary: 'string',
        rawContent: 'optional string',
        rawAnalysis: 'optional string',
      },
    }
  }

  return {
    requiredTopLevelFields: [
      'taskId',
      'analysisType',
      'userId',
      'confidenceScore',
      'dataPointsUsed',
      'findings',
      'recommendations',
    ],
    findingShape: {
      type: 'weakness | strength | pattern | prediction | optimization',
      title: 'string',
      detail: 'string',
      confidence: 'number 0-1',
      evidence: 'string',
      skillTag: 'optional string',
      trend: 'optional improving | worsening | stable',
    },
    recommendationShape: {
      action: 'string',
      target: 'string',
      value: 'object',
      reason: 'string',
      confidence: 'number 0-1',
      priority: 'high | medium | low',
      paramKey: 'optional string',
      paramValue: 'optional string',
    },
    optionalKnowledgeShape: {
      questionType: 'string',
      methodName: 'string',
      applicableTypes: 'string[]',
      triggerKeywords: 'string[]',
      solutionSteps: 'string[]',
      exampleSolution: 'string',
      qualityScore: 'number 0-1',
      summary: 'string',
      rawContent: 'optional string',
      rawAnalysis: 'optional string',
    },
  }
}

function buildCodexPrompt(payload) {
  if (payload.analysisType === 'user_error_diagnosis') {
    return `你是本项目的 Codex 单题错因诊断执行器。请读取 tasks 目录中的同名 context JSON，并为 taskId=${payload.task.id} 生成严格结构化的分析结果 JSON。

要求：
1. 只输出 JSON，不要 markdown，不要解释。
2. 必须满足 outputContract。
3. 优先参考 retrievedKnowledge、historicalPatterns、ruleEffectiveness、userProfileSignals、latestStrategySnapshot、question.imageOcr 和 previousDiagnosis，避免空泛重复。
4. 如果题干存在 [图] 或 questionImage，请优先利用 imageOcr 补齐可见文本线索；若 OCR 不完整，也要明确基于现有信息推断。
5. diagnosis 必须能直接写回 user_errors 的 aiRootReason / aiErrorReason / aiActionRule / aiThinking / aiReasonTag / customAiAnalysis。
6. customAiAnalysis 要写成可直接展示给用户的完整文本，包含：
【个性化深度诊断】
💡 针对你的建议：
⚠️ 警惕模式：
7. 如果上下文显示这是旧错因复发或旧规则失效，请在 diagnosisDecision 里明确写出。
8. 如果你参考了历史知识、旧诊断或规则效果，请写入 usedEvidence。

本次重点：
- analysisType: ${payload.analysisType}
- userId: ${payload.userId}
- userErrorId: ${payload.userError.id}
- 目标是生成能直接写回 user_errors，并可选沉淀到 knowledge_entries 的结果。`
  }

  return `你是本项目的 Codex 分析执行器。请读取 tasks 目录中的同名 context JSON，并为 taskId=${payload.task.id} 生成严格结构化的分析结果 JSON。

要求：
1. 只输出 JSON，不要 markdown，不要解释。
2. 必须满足 outputContract。
3. 优先参考 retrievedKnowledge 和 previousSnapshot，避免重复给出已被证明无效的建议。
4. recommendations 必须可执行，且适配当前用户数据，不要空泛鸡汤。
5. 若建议可沉淀复用，请补 knowledge 字段。

本次重点：
- analysisType: ${payload.analysisType}
- userId: ${payload.user.id}
- 目标是生成可写回 analysis_snapshots / system_insights / knowledge_entries 的结果。`
}

async function writeTaskFiles(taskId, payload, prompt) {
  const analysisRoot = path.join(WORKSPACE_ROOT, '.runtime', 'analysis')
  const taskDir = path.join(analysisRoot, 'tasks')
  const promptDir = path.join(analysisRoot, 'prompts')
  const resultDir = path.join(analysisRoot, 'results')
  const bundleDir = path.join(analysisRoot, 'bundles', taskId)
  fs.mkdirSync(taskDir, { recursive: true })
  fs.mkdirSync(promptDir, { recursive: true })
  fs.mkdirSync(resultDir, { recursive: true })
  fs.mkdirSync(bundleDir, { recursive: true })

  const contextFile = path.join(taskDir, `${taskId}.json`)
  const promptFile = path.join(promptDir, `${taskId}.md`)
  const templateFile = path.join(resultDir, `${taskId}.template.json`)
  fs.writeFileSync(contextFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  fs.writeFileSync(promptFile, `${prompt}\n`, 'utf8')
  fs.writeFileSync(templateFile, `${JSON.stringify(buildResultTemplate(payload), null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(bundleDir, 'README.md'), `${buildBundleReadme(taskId, contextFile, promptFile, templateFile)}\n`, 'utf8')
  fs.writeFileSync(path.join(bundleDir, 'TASK_FOR_CODEX.md'), `${buildTaskForCodex(taskId)}\n`, 'utf8')
  fs.writeFileSync(path.join(bundleDir, 'context.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(bundleDir, 'prompt.md'), `${prompt}\n`, 'utf8')
  fs.writeFileSync(path.join(bundleDir, 'result.template.json'), `${JSON.stringify(buildResultTemplate(payload), null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(analysisRoot, 'latest-task-id.txt'), `${taskId}\n`, 'utf8')
  fs.writeFileSync(path.join(analysisRoot, 'latest-bundle.txt'), `${bundleDir}\n`, 'utf8')

  return { contextFile, promptFile, templateFile, bundleDir }
}

function buildResultTemplate(payload) {
  if (payload.analysisType === 'user_error_diagnosis') {
    return {
      taskId: payload.task.id,
      analysisType: payload.analysisType,
      userId: payload.userId,
      userErrorId: payload.userError.id,
      confidenceScore: 0.8,
      resultSummary: '',
      diagnosis: {
        aiRootReason: '',
        aiErrorReason: '',
        aiActionRule: '',
        aiThinking: '',
        aiReasonTag: '',
        customAiAnalysis: '',
      },
      usedEvidence: {
        knowledgeIds: payload.retrievedKnowledge.map((item) => item.id),
        previousDiagnosisUsed: Boolean(payload.userError.previousDiagnosis?.aiActionRule || payload.userError.previousDiagnosis?.aiRootReason),
        historicalErrorsUsed: payload.historicalPatterns?.sameTypeRecentErrors?.slice(0, 3).map((item) => item.id) ?? [],
        ruleEffectUsed: Boolean(payload.ruleEffectiveness?.currentRule),
      },
      diagnosisDecision: {
        mode: 'new_pattern',
        supersedesPreviousRule: false,
        keepPreviousRule: false,
      },
      strategyImpact: {
        shouldEscalateToStrategyRefresh: false,
        suggestedFocusType: payload.question.type || '',
        riskLevel: 'medium',
      },
      knowledge: {
        questionType: payload.question.type || '错因诊断',
        methodName: '',
        applicableTypes: [],
        triggerKeywords: [],
        solutionSteps: [],
        exampleSolution: '',
        qualityScore: 0.75,
        summary: '',
        rawContent: '',
        rawAnalysis: '',
      },
    }
  }

  return {
    taskId: payload.task.id,
    analysisType: payload.analysisType,
    userId: payload.user.id,
    confidenceScore: 0.75,
    dataPointsUsed: payload.summary.totalEvents + payload.summary.totalUserErrors + payload.summary.dueReviewCount,
    resultSummary: '',
    prevSnapshotId: payload.previousSnapshot?.id ?? null,
    inputSummary: {
      source: 'codex-result',
      referencedContextFile: `.runtime/analysis/tasks/${payload.task.id}.json`,
    },
    findings: [
      {
        type: 'weakness',
        title: '',
        detail: '',
        confidence: 0.75,
        evidence: '',
        skillTag: '',
        trend: 'stable',
      },
    ],
    recommendations: [
      {
        action: 'change_strategy',
        target: 'daily_tasks',
        value: {
          totalTarget: payload.baseline.strategy.totalTarget,
          activationTotalTarget: payload.baseline.strategy.activationTotalTarget,
          errorLimit: payload.baseline.strategy.errorLimit,
          guardLimit: payload.baseline.strategy.guardLimit,
          activationThresholdDays: payload.baseline.strategy.activationThresholdDays,
          activationQuestionTypes: payload.baseline.strategy.activationQuestionTypes,
          generatedBy: 'codex',
          bullets: [],
          supportingKnowledge: payload.retrievedKnowledge.map((item) => ({
            id: item.id,
            methodName: item.methodName,
            qualityScore: item.qualityScore,
          })),
        },
        reason: '',
        confidence: 0.75,
        priority: 'medium',
        paramKey: 'daily_task_strategy',
        paramValue: '',
      },
    ],
    knowledge: {
      questionType: '策略分析',
      methodName: '',
      applicableTypes: [],
      triggerKeywords: [],
      solutionSteps: [],
      exampleSolution: '',
      qualityScore: 0.75,
      summary: '',
      rawContent: '',
      rawAnalysis: '',
    },
  }
}

function buildBundleReadme(taskId, contextFile, promptFile, templateFile) {
  return `# Codex Task Bundle

Task ID: ${taskId}

## Files

- context: ${contextFile}
- prompt: ${promptFile}
- result template: ${templateFile}

## What Codex Should Do

1. Read \`context.json\`
2. Read \`prompt.md\`
3. Fill \`result.template.json\` into a final \`result.json\`
4. Keep JSON valid and do not add markdown fences

## Apply Command

\`\`\`bash
npm run analysis:apply -- --task-id=${taskId} --result-file=${path.join(WORKSPACE_ROOT, '.runtime', 'analysis', 'bundles', taskId, 'result.json')}
\`\`\`
`
}

function buildTaskForCodex(taskId) {
  return `请完成这个分析任务：

1. 阅读 \`context.json\`
2. 阅读 \`prompt.md\`
3. 以 \`result.template.json\` 为骨架填写完整结果
4. 输出到同目录的 \`result.json\`

要求：

- 只写有效 JSON
- 不要加 markdown 代码块
- \`taskId\` 必须保持为 \`${taskId}\`
- 不要修改 context.json 和 prompt.md

完成后可在项目根目录执行：

\`\`\`bash
npm run analysis:apply -- --task-id=${taskId}
\`\`\`
`
}

function validateCodexResult(input, expectedTaskId) {
  if (!input || typeof input !== 'object') throw new Error('result payload must be an object')
  if (input.taskId !== expectedTaskId) throw new Error(`result taskId mismatch: expected ${expectedTaskId}`)
  if (!['user_strategy_refresh', 'user_error_diagnosis'].includes(input.analysisType)) throw new Error(`unsupported result analysisType: ${input.analysisType}`)

  if (input.analysisType === 'user_error_diagnosis') {
    if (!input.userId || typeof input.userId !== 'string') throw new Error('result.userId must be a string')
    if (!input.userErrorId || typeof input.userErrorId !== 'string') throw new Error('result.userErrorId must be a string')
    if (typeof input.confidenceScore !== 'number') throw new Error('result.confidenceScore must be a number')
    if (!input.diagnosis || typeof input.diagnosis !== 'object') throw new Error('result.diagnosis must be an object')
    for (const key of ['aiRootReason', 'aiErrorReason', 'aiActionRule', 'aiThinking', 'aiReasonTag']) {
      if (typeof input.diagnosis[key] !== 'string' || !input.diagnosis[key].trim()) {
        throw new Error(`result.diagnosis.${key} is required`)
      }
    }

    if (input.knowledge != null) {
      if (!input.knowledge || typeof input.knowledge !== 'object') throw new Error('result.knowledge must be an object')
      if (typeof input.knowledge.questionType !== 'string' || !input.knowledge.questionType.trim()) throw new Error('result.knowledge.questionType is required')
      if (typeof input.knowledge.methodName !== 'string' || !input.knowledge.methodName.trim()) throw new Error('result.knowledge.methodName is required')
      if (!Array.isArray(input.knowledge.triggerKeywords)) throw new Error('result.knowledge.triggerKeywords must be an array')
      if (!Array.isArray(input.knowledge.solutionSteps)) throw new Error('result.knowledge.solutionSteps must be an array')
      if (typeof input.knowledge.qualityScore !== 'number') throw new Error('result.knowledge.qualityScore must be a number')
    }

    if (input.usedEvidence != null) {
      if (!input.usedEvidence || typeof input.usedEvidence !== 'object') throw new Error('result.usedEvidence must be an object')
      if (!Array.isArray(input.usedEvidence.knowledgeIds)) throw new Error('result.usedEvidence.knowledgeIds must be an array')
      if (!Array.isArray(input.usedEvidence.historicalErrorsUsed)) throw new Error('result.usedEvidence.historicalErrorsUsed must be an array')
      if (typeof input.usedEvidence.previousDiagnosisUsed !== 'boolean') throw new Error('result.usedEvidence.previousDiagnosisUsed must be a boolean')
      if (typeof input.usedEvidence.ruleEffectUsed !== 'boolean') throw new Error('result.usedEvidence.ruleEffectUsed must be a boolean')
    }

    if (input.diagnosisDecision != null) {
      if (!input.diagnosisDecision || typeof input.diagnosisDecision !== 'object') throw new Error('result.diagnosisDecision must be an object')
      if (!['new_pattern', 'repeat_pattern', 'rule_failed', 'rule_confirmed'].includes(input.diagnosisDecision.mode)) {
        throw new Error('result.diagnosisDecision.mode is invalid')
      }
    }

    if (input.strategyImpact != null) {
      if (!input.strategyImpact || typeof input.strategyImpact !== 'object') throw new Error('result.strategyImpact must be an object')
      if (typeof input.strategyImpact.shouldEscalateToStrategyRefresh !== 'boolean') {
        throw new Error('result.strategyImpact.shouldEscalateToStrategyRefresh must be a boolean')
      }
      if (!['low', 'medium', 'high'].includes(input.strategyImpact.riskLevel)) {
        throw new Error('result.strategyImpact.riskLevel must be low|medium|high')
      }
    }

    return {
      taskId: input.taskId,
      analysisType: input.analysisType,
      userId: input.userId,
      userErrorId: input.userErrorId,
      confidenceScore: input.confidenceScore,
      resultSummary: typeof input.resultSummary === 'string' ? input.resultSummary : null,
      diagnosis: {
        aiRootReason: input.diagnosis.aiRootReason,
        aiErrorReason: input.diagnosis.aiErrorReason,
        aiActionRule: input.diagnosis.aiActionRule,
        aiThinking: input.diagnosis.aiThinking,
        aiReasonTag: input.diagnosis.aiReasonTag,
        customAiAnalysis: typeof input.diagnosis.customAiAnalysis === 'string' ? input.diagnosis.customAiAnalysis : null,
      },
      usedEvidence: input.usedEvidence ?? null,
      diagnosisDecision: input.diagnosisDecision ?? null,
      strategyImpact: input.strategyImpact ?? null,
      knowledge: input.knowledge ?? null,
    }
  }

  if (!Array.isArray(input.findings) || input.findings.length === 0) throw new Error('result.findings must be a non-empty array')
  if (!Array.isArray(input.recommendations) || input.recommendations.length === 0) throw new Error('result.recommendations must be a non-empty array')
  if (typeof input.confidenceScore !== 'number') throw new Error('result.confidenceScore must be a number')
  if (typeof input.dataPointsUsed !== 'number') throw new Error('result.dataPointsUsed must be a number')
  if (!input.userId || typeof input.userId !== 'string') throw new Error('result.userId must be a string')

  for (const [index, finding] of input.findings.entries()) {
    if (!finding || typeof finding !== 'object') throw new Error(`finding[${index}] must be an object`)
    if (typeof finding.title !== 'string' || !finding.title.trim()) throw new Error(`finding[${index}].title is required`)
    if (typeof finding.detail !== 'string' || !finding.detail.trim()) throw new Error(`finding[${index}].detail is required`)
    if (typeof finding.evidence !== 'string' || !finding.evidence.trim()) throw new Error(`finding[${index}].evidence is required`)
    if (typeof finding.confidence !== 'number') throw new Error(`finding[${index}].confidence must be a number`)
  }

  for (const [index, recommendation] of input.recommendations.entries()) {
    if (!recommendation || typeof recommendation !== 'object') throw new Error(`recommendation[${index}] must be an object`)
    if (typeof recommendation.action !== 'string' || !recommendation.action.trim()) throw new Error(`recommendation[${index}].action is required`)
    if (typeof recommendation.target !== 'string' || !recommendation.target.trim()) throw new Error(`recommendation[${index}].target is required`)
    if (typeof recommendation.reason !== 'string' || !recommendation.reason.trim()) throw new Error(`recommendation[${index}].reason is required`)
    if (typeof recommendation.confidence !== 'number') throw new Error(`recommendation[${index}].confidence must be a number`)
    if (!['high', 'medium', 'low'].includes(recommendation.priority)) throw new Error(`recommendation[${index}].priority must be high|medium|low`)
  }

  if (input.knowledge != null) {
    if (!input.knowledge || typeof input.knowledge !== 'object') throw new Error('result.knowledge must be an object')
    if (typeof input.knowledge.questionType !== 'string' || !input.knowledge.questionType.trim()) throw new Error('result.knowledge.questionType is required')
    if (typeof input.knowledge.methodName !== 'string' || !input.knowledge.methodName.trim()) throw new Error('result.knowledge.methodName is required')
    if (!Array.isArray(input.knowledge.triggerKeywords)) throw new Error('result.knowledge.triggerKeywords must be an array')
    if (!Array.isArray(input.knowledge.solutionSteps)) throw new Error('result.knowledge.solutionSteps must be an array')
    if (typeof input.knowledge.qualityScore !== 'number') throw new Error('result.knowledge.qualityScore must be a number')
  }

  return {
    taskId: input.taskId,
    analysisType: input.analysisType,
    userId: input.userId,
    prevSnapshotId: typeof input.prevSnapshotId === 'string' ? input.prevSnapshotId : null,
    inputSummary: input.inputSummary ?? null,
    confidenceScore: input.confidenceScore,
    dataPointsUsed: input.dataPointsUsed,
    resultSummary: typeof input.resultSummary === 'string' ? input.resultSummary : null,
    findings: input.findings,
    recommendations: input.recommendations,
    knowledge: input.knowledge ?? null,
  }
}

function buildStrategyMethodName(summary, strategy) {
  if (summary.dueReviewCount >= 20) return '积压错题优先清仓法'
  if (strategy.activationQuestionTypes.length > 0) return '薄弱题型优先推进法'
  return '日任务结构平衡法'
}

function buildStrategyKeywords(summary, strategy) {
  const keywords = [
    '日任务策略',
    '错题复盘',
    '守卫复习',
    `总量${strategy.totalTarget}`,
    `错题${strategy.errorLimit}`,
    `守卫${strategy.guardLimit}`,
  ]
  if (summary.dueReviewCount > 0) keywords.push('到期错题')
  for (const item of summary.weakTypes) keywords.push(item.type)
  for (const item of strategy.activationQuestionTypes) keywords.push(item)
  return [...new Set(keywords)]
}

function buildStrategySteps(strategy) {
  const steps = [
    `先处理 ${strategy.errorLimit} 道以内到期错题，优先清掉高频重复失分项`,
    `补做 ${strategy.guardLimit} 道守卫复习，避免已稳住的内容掉线`,
    `再用真题补满到 ${strategy.totalTarget} 道今日目标，保持增量推进`,
  ]
  if (strategy.activationQuestionTypes.length > 0) {
    steps.push(`补位时优先选择 ${strategy.activationQuestionTypes.join('、')}，把最弱模块放到前排`)
  }
  return steps
}

async function writeSnapshot(input) {
  const snapshotResult = await query(
    `INSERT INTO analysis_snapshots (
      id, "userId", "analysisType", "triggerEvent",
      "dataRangeFrom", "dataRangeTo", "inputSummary",
      "prevSnapshotId", findings, recommendations,
      "confidenceScore", "dataPointsUsed", "wasActedUpon",
      "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, $1, $2, 'codex_schedule',
      $3, $4, $5, $6, $7, $8,
      $9, $10, false, NOW(), NOW()
    )
    RETURNING id`,
    [
      input.userId,
      input.analysisType,
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      new Date(),
      JSON.stringify(input.inputSummary),
      input.prevSnapshotId,
      JSON.stringify(input.findings),
      JSON.stringify(input.recommendations),
      input.confidenceScore,
      input.dataPointsUsed,
    ]
  )

  const snapshotId = snapshotResult.rows[0].id

  for (const recommendation of input.recommendations) {
    const allowStrategyInsight =
      recommendation.paramKey === 'daily_task_strategy' &&
      recommendation.confidence >= 0.65

    if (!(
      recommendation.paramKey &&
      (
        (recommendation.priority === 'high' && recommendation.confidence > 0.7) ||
        allowStrategyInsight
      )
    )) {
      continue
    }

    await query(
      `INSERT INTO system_insights (
        id, "userId", "sourceSnapshotId", "insightCategory",
        "targetEntity", "targetValue", "paramKey", "paramValueNew",
        status, confidence, "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3,
        $4, $5, $6, $7,
        'pending', $8, NOW() + INTERVAL '30 days', NOW(), NOW()
      )`,
      [
        input.userId,
        snapshotId,
        inferInsightCategory(recommendation),
        recommendation.target,
        recommendation.target,
        recommendation.paramKey,
        JSON.stringify(recommendation.value),
        recommendation.confidence,
      ]
    )
  }

  return snapshotId
}

async function retrieveRelevantDiagnosisKnowledge(userError, imageOcr = null) {
  const queryText = [
    userError.type ?? '',
    userError.subtype ?? '',
    userError.content?.slice(0, 200) ?? '',
    userError.errorReason ?? '',
    imageOcr?.visibleText ?? '',
    imageOcr?.diagramSummary ?? '',
  ].join(' ')

  const embedding = await getEmbedding(queryText)
  let result

  if (embedding) {
    result = await query(
      `SELECT id, "methodName", "qualityScore", "usageCount", "rawAnalysis", "updatedAt",
              "triggerKeywords", "isPublic", "userId"
       FROM knowledge_entries
       WHERE ("questionType" = $1 OR "questionType" = '错因诊断')
         AND ("userId" = $2 OR "isPublic" = true)
         AND "contentEmbedding" IS NOT NULL
       ORDER BY "contentEmbedding" <-> $3::vector, "qualityScore" DESC
       LIMIT 8`,
      [userError.type, userError.userId, JSON.stringify(embedding)]
    )
  } else {
    result = await query(
      `SELECT id, "methodName", "qualityScore", "usageCount", "rawAnalysis", "updatedAt",
              "triggerKeywords", "isPublic", "userId"
       FROM knowledge_entries
       WHERE ("questionType" = $1 OR "questionType" = '错因诊断')
         AND ("userId" = $2 OR "isPublic" = true)
       ORDER BY "qualityScore" DESC, "usageCount" DESC, "updatedAt" DESC
       LIMIT 8`,
      [userError.type, userError.userId]
    )
  }

  if (result.rowCount === 0) return []

  const contextTerms = collectDiagnosisContextTerms(userError, imageOcr)
  const reranked = result.rows
    .map((row) => {
      const triggerKeywords = parseStringArray(row.triggerKeywords)
      const matchedKeywords = triggerKeywords.filter((keyword) => contextTerms.has(keyword.toLowerCase()))
      const isPrivateHit = row.userId === userError.userId && !row.isPublic
      const usageBoost = Math.min(Number(row.usageCount ?? 0) * 0.01, 0.08)
      const keywordBoost = Math.min(matchedKeywords.length * 0.04, 0.16)
      const privateBoost = isPrivateHit ? 0.12 : 0
      const score = Number(row.qualityScore ?? 0) + usageBoost + keywordBoost + privateBoost
      return {
        ...row,
        score,
        matchedKeywords,
        matchReason: embedding ? 'vector_similarity_rerank' : 'keyword_quality_rerank',
        effectScore: Number(row.qualityScore ?? 0),
      }
    })
    .sort((a, b) => b.score - a.score || Number(b.qualityScore ?? 0) - Number(a.qualityScore ?? 0))
    .slice(0, 3)

  const ids = reranked.map((row) => row.id)
  await query(
    `UPDATE knowledge_entries
     SET "usageCount" = COALESCE("usageCount", 0) + 1,
         "updatedAt" = NOW()
     WHERE id = ANY($1::text[])`,
    [ids]
  )

  return reranked.map((row) => ({
    id: row.id,
    methodName: row.methodName,
    qualityScore: Number(row.qualityScore),
    usageCount: Number(row.usageCount ?? 0) + 1,
    rawAnalysis: row.rawAnalysis,
    effectScore: Number(row.effectScore ?? row.qualityScore ?? 0),
    lastUsedAt: row.updatedAt,
    matchReason: row.matchReason,
    matchedKeywords: row.matchedKeywords,
  }))
}

function collectDiagnosisContextTerms(userError, imageOcr = null) {
  const raw = [
    userError.type ?? '',
    userError.subtype ?? '',
    userError.content ?? '',
    userError.errorReason ?? '',
    imageOcr?.visibleText ?? '',
    imageOcr?.diagramSummary ?? '',
  ].join(' ')

  const normalized = String(raw).toLowerCase()
  const tokens = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)

  const phrases = []
  if (/需求侧/.test(raw)) phrases.push('需求侧')
  if (/供给侧/.test(raw)) phrases.push('供给侧')
  if (/政策/.test(raw)) phrases.push('政策')
  if (/分类/.test(raw)) phrases.push('分类')
  if (/\[图\]/.test(raw)) phrases.push('[图]')

  return new Set([...tokens, ...phrases.map((item) => item.toLowerCase())])
}

function parseStringArray(value) {
  const parsed = safeJsonParse(value)
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
  }
  return []
}

async function maybeRecognizeQuestionImage(questionImage, questionContent, questionType) {
  if (!questionImage || typeof questionImage !== 'string') return null
  const shouldAttempt =
    /\[图\]/.test(questionContent || '') ||
    (typeof questionContent === 'string' && questionContent.trim().length < 40)
  if (!shouldAttempt) return null

  const apiKey = process.env.MINIMAX_API_KEY
  if (!apiKey) return null

  try {
    const mimeMatch = questionImage.match(/^data:([^;]+);base64,(.+)$/)
    if (!mimeMatch) return null
    const [, mimeType] = mimeMatch
    const res = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'abab6.5s-chat',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: questionImage } },
            { type: 'text', text: buildQuestionImagePrompt(questionType) },
          ],
        }],
        max_tokens: 800,
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) return null
    const text = toTextContent(data.choices?.[0]?.message?.content)
    if (!text) return null
    return extractJsonLike(text)
  } catch {
    return null
  }
}

function buildQuestionImagePrompt(questionType) {
  return `这是一道${questionType || '行测'}题目的题图。请尽量识别图中可见的文字、关系和关键结构，并严格返回 JSON：
{
  "visibleText": "图中能识别出的文字，无法识别则留空",
  "diagramSummary": "图形/表格/关系的大意，100字以内",
  "ocrConfidence": 0.0到1.0
}
只返回 JSON，不要解释。`
}

function extractJsonLike(text) {
  const clean = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(clean.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

function toTextContent(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) return toTextContent(item.text)
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

async function getEmbedding(text) {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) return null

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    })

    if (!response.ok) {
      const payload = await response.text()
      console.warn('[analysis-worker] embedding request failed:', payload)
      return null
    }

    const data = await response.json()
    return data.data?.[0]?.embedding ?? null
  } catch (error) {
    console.warn('[analysis-worker] embedding unavailable:', error instanceof Error ? error.message : String(error))
    return null
  }
}

function inferInsightCategory(recommendation) {
  if (recommendation.paramKey === 'daily_task_strategy' || recommendation.action === 'change_strategy') {
    return 'task_strategy'
  }
  if (recommendation.paramKey?.startsWith('interval_sequence') || recommendation.action === 'adjust_interval') {
    return 'interval_optimization'
  }
  if (recommendation.paramKey?.startsWith('error_roi') || recommendation.action === 'adjust_roi_weight') {
    return 'roi_weight_optimization'
  }
  return recommendation.action || 'general_optimization'
}

function safeJsonParse(value) {
  if (typeof value !== 'string') return value ?? null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function formatHour(hour) {
  return `${String(Number(hour)).padStart(2, '0')}:00`
}

function readLookbackDays(targetMeta) {
  if (!targetMeta) return 30
  try {
    const meta = typeof targetMeta === 'string' ? JSON.parse(targetMeta) : targetMeta
    return Number.isFinite(meta.lookbackDays) ? meta.lookbackDays : 30
  } catch {
    return 30
  }
}

function normalizeTask(row) {
  return {
    id: row.id,
    userId: row.userId ?? row.userid ?? null,
    status: row.status ?? null,
    targetType: row.targetType ?? row.targettype,
    targetId: row.targetId ?? row.targetid,
    targetMeta: row.targetMeta ?? row.targetmeta ?? null,
  }
}

function defaultResultFileForTask(taskId) {
  return path.join(WORKSPACE_ROOT, '.runtime', 'analysis', 'bundles', taskId, 'result.json')
}

function printLatestBundleInstructions() {
  const analysisRoot = path.join(WORKSPACE_ROOT, '.runtime', 'analysis')
  const latestTaskFile = path.join(analysisRoot, 'latest-task-id.txt')
  const latestBundleFile = path.join(analysisRoot, 'latest-bundle.txt')

  if (!fs.existsSync(latestTaskFile) || !fs.existsSync(latestBundleFile)) {
    console.log('[analysis-worker] no latest bundle exported yet')
    return
  }

  const taskId = fs.readFileSync(latestTaskFile, 'utf8').trim()
  const bundleDir = fs.readFileSync(latestBundleFile, 'utf8').trim()

  console.log(`Latest task: ${taskId}`)
  console.log(`Bundle dir: ${bundleDir}`)
  console.log(`Codex file: ${path.join(bundleDir, 'TASK_FOR_CODEX.md')}`)
  console.log(`Apply command: npm run analysis:apply -- --task-id=${taskId}`)
}

function normalizeUser(row) {
  return {
    id: row.id,
    username: row.username,
    examType: row.examType ?? row.examtype,
    targetProvince: row.targetProvince ?? row.targetprovince,
    targetScore: row.targetScore ?? row.targetscore,
    examDate: row.examDate ?? row.examdate,
    dailyGoal: row.dailyGoal ?? row.dailygoal,
  }
}

async function markTaskSkipped(taskId, reason) {
  await query(
    `UPDATE analysis_queue
     SET status = 'skipped',
         "failReason" = $2,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [taskId, reason]
  )
}

async function query(sql, params = []) {
  return pool.query(sql, params)
}

function toPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return

  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    if (!key || key in process.env) continue
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

main()
  .catch((error) => {
    console.error('[analysis-worker] fatal error', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
