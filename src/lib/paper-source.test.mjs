import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCanonicalPaperTitle, inferPaperSourceMeta } from './paper-source.ts'

test('inferPaperSourceMeta extracts year province examType and specialization from file name', () => {
  const meta = inferPaperSourceMeta({
    fileName: '2025年广东省考试录用公务员《行政执法专业》试卷（考生回忆版）.pdf',
  })

  assert.equal(meta.srcYear, '2025')
  assert.equal(meta.srcProvince, '广东')
  assert.equal(meta.examType, 'sheng_kao')
  assert.equal(meta.specialization, '行政执法专业')
  assert.equal(meta.srcName, '2025年广东省考试录用公务员《行政执法专业》试卷（考生回忆版）')
})

test('buildCanonicalPaperTitle keeps stable session title for real papers', () => {
  const title = buildCanonicalPaperTitle({
    srcExamSession: '2025年广东省考试录用公务员《行政执法专业》试卷（考生回忆版）.pdf',
    srcYear: '2025',
    srcProvince: '广东',
    examType: 'sheng_kao',
  })

  assert.equal(title, '2025年广东省考试录用公务员《行政执法专业》试卷（考生回忆版）')
})
