import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldReplaceExisting } from './duplicate-policy.ts'

const baseExisting = {
  content: '某单位开展测评。以下说法正确的是？',
  options: JSON.stringify(['A.方案一', 'B.方案二']),
  answer: '',
  analysis: '',
  type: '判断推理',
  srcExamSession: '旧题',
  srcQuestionNo: '1',
  srcQuestionOrder: 1,
}

const richerIncoming = {
  no: '1',
  content: '某单位开展测评。以下说法正确的是？',
  options: ['A.方案一', 'B.方案二', 'C.方案三', 'D.方案四'],
  answer: 'D',
  analysis: '结合题意可知 D 正确。',
  type: '判断推理',
  rawText: '',
}

test('skip mode never replaces duplicates', () => {
  assert.equal(shouldReplaceExisting('skip', richerIncoming, baseExisting), false)
})

test('replace_low_quality updates clearly worse duplicates', () => {
  assert.equal(shouldReplaceExisting('replace_low_quality', richerIncoming, baseExisting), true)
})

test('replace_low_quality does not replace already good duplicates', () => {
  const goodExisting = {
    ...baseExisting,
    options: JSON.stringify(['A.方案一', 'B.方案二', 'C.方案三', 'D.方案四']),
    answer: 'D',
    analysis: '旧解析也完整。',
  }
  assert.equal(shouldReplaceExisting('replace_low_quality', richerIncoming, goodExisting), false)
})

test('force_replace always replaces duplicates', () => {
  assert.equal(shouldReplaceExisting('force_replace', richerIncoming, baseExisting), true)
})

test('replace_low_quality updates duplicates missing analysis even when score is not very low', () => {
  const existing = {
    ...baseExisting,
    options: JSON.stringify(['A.方案一', 'B.方案二', 'C.方案三', 'D.方案四']),
    answer: 'D',
    analysis: '',
  }
  assert.equal(shouldReplaceExisting('replace_low_quality', richerIncoming, existing), true)
})

test('replace_low_quality updates duplicates with much shorter content', () => {
  const existing = {
    ...baseExisting,
    content: '某单位开展测评。',
    options: JSON.stringify(['A.方案一', 'B.方案二', 'C.方案三', 'D.方案四']),
    answer: 'D',
    analysis: '旧解析也完整。',
  }
  assert.equal(shouldReplaceExisting('replace_low_quality', richerIncoming, existing), true)
})
