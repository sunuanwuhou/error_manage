import test from 'node:test'
import assert from 'node:assert/strict'

import { parsePdfText } from '../parsers/pdf-parser.ts'

const samplePdfText = `
· 本试卷由粉笔用户用户0aoF09生成第 2 页，共 7 页
2025年广东省考试录用公务员《行政执法专业》试卷（考生回忆版）
一. 判断题：
二. 单项选择题：
判断下列说法的正误。
每小题后的四个备选答案中只有一个最符合题意的答案。
（判断题）全面依法治国必须更好发挥法治固根本、稳预期、利长远的保障作用，在法治轨道上全面建设社会
主义现代化国家。（ ）
1.
（判断题）中国共产党人继续推进实践基础上的理论创新，首先要把握好新时代中国特色社会主义思想的世界
观和方法论，坚持好、运用好贯穿其中的立场观点方法。（ ）
2.
人民民主是社会主义的生命，是全面建设社会主义现代化国家的应有之义，（ ）是全过程人民民主的重要体
现。
21.
A.人民当家作主B.协商民主C.基层民主D.民主监督
领导人指出，“不论处在什么发展水平上，（ ）是社会公平正义的重要保证。”22.
A.制度B.司法C.宪法D.法治
某餐饮公司向消费者张某提供变质的食物，致使张某中毒，某县市场监督管理局依照《食品安全法》对该餐饮
公司罚款10万元，法院依照《民典法》判决该餐饮公司向张某支付赔偿金10万元，目前，该餐饮公司仅有财产
18万元，且不存在其他财产责任。
关于餐饮公司的法律责任，下列说法正确的是（ ）。
33.
A.赔偿张某9万元，缴纳罚款9万元B.赔偿张某6万元，缴纳罚款6万元
C.赔偿张某10万元，缴纳罚款8万元D.赔偿张某8万元，缴纳罚款10万元
`

test('parsePdfText splits Fenbi-style PDF questions with trailing question numbers', () => {
  const result = parsePdfText(samplePdfText)

  assert.equal(result.questions.length, 5)
  assert.equal(result.questions[0].no, '1')
  assert.match(result.questions[0].content, /全面依法治国/)

  const q22 = result.questions.find(item => item.no === '22')
  assert.ok(q22)
  assert.deepEqual(q22.options, ['A.制度', 'B.司法', 'C.宪法', 'D.法治'])

  const q33 = result.questions.find(item => item.no === '33')
  assert.ok(q33)
  assert.equal(q33.options[3], 'D.赔偿张某8万元，缴纳罚款10万元')
})
