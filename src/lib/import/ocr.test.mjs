import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeOcrPayload, parseOcrCompletion } from './ocr.ts'

test('parseOcrCompletion strips markdown fences and normalizes answer', () => {
  const result = parseOcrCompletion([
    '```json',
    '{',
    '  "content": "甲、乙、丙三人参加比赛，问谁得分最高？",',
    '  "options": ["A.甲", "B.乙", "C.丙", "D.无法确定"],',
    '  "answer": "答案：b",',
    '  "type": "判断推理"',
    '}',
    '```',
  ].join('\n'))

  assert.equal(result.answer, 'B')
  assert.deepEqual(result.options, ['A.甲', 'B.乙', 'C.丙', 'D.无法确定'])
  assert.equal(result.type, '判断推理')
})

test('normalizeOcrPayload accepts object-form options', () => {
  const result = normalizeOcrPayload({
    content: '以下哪项属于行政许可？',
    options: {
      A: '行政审批',
      B: '行政处罚',
      C: '行政强制',
      D: '行政征收',
    },
    answer: '(1)',
    type: '常识判断',
  })

  assert.deepEqual(result.options, [
    'A.行政审批',
    'B.行政处罚',
    'C.行政强制',
    'D.行政征收',
  ])
  assert.equal(result.answer, '')
  assert.match(result.warnings.join(' '), /未识别到明确答案/)
})

test('normalizeOcrPayload can split inline options from content', () => {
  const result = normalizeOcrPayload({
    content: '某单位开展测评。以下说法正确的是？A.方案一 B.方案二 C.方案三 D.方案四',
    answer: 'D',
  })

  assert.equal(result.content, '某单位开展测评。以下说法正确的是？')
  assert.deepEqual(result.options, [
    'A.方案一',
    'B.方案二',
    'C.方案三',
    'D.方案四',
  ])
  assert.match(result.warnings.join(' '), /内联拆分/)
})

test('normalizeOcrPayload rejects explicit OCR errors', () => {
  assert.throws(
    () => normalizeOcrPayload({ error: '无法识别完整题目' }),
    /无法识别完整题目/
  )
})
