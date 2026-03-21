import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCanonicalPaperSession, buildCanonicalPaperTitle, inferPaperSourceMeta } from './paper-source.ts'

test('inferPaperSourceMeta extracts year province examType and specialization from file name', () => {
  const meta = inferPaperSourceMeta({
    fileName: '2025年广东省考试录用公务员《行政执法专业》试卷（考生回忆版）.pdf',
  })

  assert.equal(meta.srcYear, '2025')
  assert.equal(meta.srcProvince, '广东')
  assert.equal(meta.examType, 'sheng_kao')
  assert.equal(meta.specialization, '行政执法专业')
  assert.equal(meta.baseTitle, '考试录用公务员《行政执法专业》试卷（考生回忆版）')
  assert.equal(meta.srcName, '2025 省考/广东 考试录用公务员《行政执法专业》试卷（考生回忆版）')
})

test('buildCanonicalPaperTitle returns base title for display', () => {
  const title = buildCanonicalPaperTitle({
    srcExamSession: '2025年广东省考试录用公务员《行政执法专业》试卷（考生回忆版）.pdf',
    srcYear: '2025',
    srcProvince: '广东',
    examType: 'sheng_kao',
  })

  assert.equal(title, '考试录用公务员《行政执法专业》试卷（考生回忆版）')
})

test('buildCanonicalPaperSession returns stable grouped session label', () => {
  const session = buildCanonicalPaperSession({
    srcExamSession: '2025年广东省公务员录用考试《行测》题（网友回忆版）.docx',
    srcYear: '2025',
    srcProvince: '广东',
    examType: 'sheng_kao',
  })

  assert.equal(session, '2025 省考/广东 公务员录用考试《行测》题（网友回忆版）')
})
