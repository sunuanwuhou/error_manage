import test from 'node:test'
import assert from 'node:assert/strict'

import { buildPaperModuleGroups, buildPaperModuleLabel, parsePaperModuleLabel, smoothPaperModuleLabels } from './paper-modules.ts'

test('buildPaperModuleLabel keeps subtype when present', () => {
  assert.equal(buildPaperModuleLabel('判断推理', '图形推理'), '判断推理 · 图形推理')
  assert.equal(buildPaperModuleLabel('判断推理', null), '判断推理')
})

test('parsePaperModuleLabel restores type and subtype', () => {
  assert.deepEqual(parsePaperModuleLabel('判断推理 · 图形推理'), {
    type: '判断推理',
    subtype: '图形推理',
  })
  assert.deepEqual(parsePaperModuleLabel('资料分析'), {
    type: '资料分析',
    subtype: undefined,
  })
})

test('smoothPaperModuleLabels merges isolated misclassified runs between the same module', () => {
  const labels = [
    '常识判断',
    '常识判断',
    '判断推理',
    '判断推理',
    '判断推理',
    '资料分析',
    '判断推理',
    '判断推理',
    '判断推理',
    '常识判断',
    '常识判断',
    '判断推理',
    '判断推理',
  ]

  assert.deepEqual(smoothPaperModuleLabels(labels), [
    '常识判断',
    '常识判断',
    '判断推理',
    '判断推理',
    '判断推理',
    '判断推理',
    '判断推理',
    '判断推理',
    '判断推理',
    '判断推理',
    '判断推理',
    '判断推理',
    '判断推理',
  ])
})

test('buildPaperModuleGroups keeps contiguous groups after smoothing', () => {
  const groups = buildPaperModuleGroups(smoothPaperModuleLabels([
    '常识判断',
    '常识判断',
    '判断推理',
    '资料分析',
    '判断推理',
    '判断推理',
    '言语理解',
  ]))

  assert.deepEqual(groups, [
    { label: '常识判断', indexes: [0, 1] },
    { label: '判断推理', indexes: [2, 3, 4, 5] },
    { label: '言语理解', indexes: [6] },
  ])
})
