import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDocxHtml } from '../parsers/docx-parser.ts'

const IMG = 'data:image/png;base64,AAAA'
const SMALL_SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="40" viewBox="0 0 24 40"><text x="12" y="28" text-anchor="middle" font-size="24">2/3</text></svg>').toString('base64')}`

test('parseDocxHtml keeps inline formula images in the question chain and applies known fixes', () => {
  const html = [
    '<p>数量关系第三部分 数量关系。</p>',
    `<p><strong>61. 【22国考地市.第61题】某单位办事大厅有3个相同的办事窗口，且每个办事窗口办理每笔业务的用时缩短到以前的</strong><img src="${SMALL_SVG}" />。问优化后的办事大厅办理6000笔业务最少需要多少天？</p>`,
    '<p><strong>A. 8</strong></p>',
    '<p><strong>B. 10</strong></p>',
    '<p><strong>C. 12</strong></p>',
    '<p><strong>D. 15</strong></p>',
    '<p>正确答案: A | 考点: 给具体单位型自定义备注: </p>',
  ].join('')

  const { questions } = parseDocxHtml(html)
  const question = questions[0]

  assert.equal(questions.length, 1)
  assert.match(question.content, /2\/3/)
  assert.equal(question.answer, 'A')
  assert.equal(question.type, '数量关系')
  assert.equal(question.questionImage, '')
})

test('parseDocxHtml turns image options into visible placeholders and keeps them on questionImage', () => {
  const html = [
    '<p>判断推理第四部分 判断推理。</p>',
    `<p><strong>67. 【22国考地市.第67题】一个圆柱体零件的高为1，则切去部分的总表面积为：</strong></p>`,
    `<p><strong>A. </strong><img src="${IMG}A" /></p>`,
    `<p><strong>B. </strong><img src="${IMG}B" /></p>`,
    `<p><strong>C. </strong><img src="${IMG}C" /></p>`,
    `<p><strong>D. </strong><img src="${IMG}D" /></p>`,
    '<p>正确答案: B | 考点: 图形推理自定义备注: </p>',
  ].join('')

  const { questions } = parseDocxHtml(html)
  const question = questions[0]

  assert.deepEqual(question.options, ['A.见图', 'B.见图', 'C.见图', 'D.见图'])
  assert.equal(question.answer, 'B')
  assert.ok(question.questionImage.startsWith('data:image/svg+xml;base64,'))
})

test('parseDocxHtml lets new text material reset previous image material in 资料分析', () => {
  const html = [
    '<p>资料分析第五部分 资料分析。</p>',
    '<p>==============================</p>',
    `<p><img src="${IMG}M1" /></p>`,
    '<p><strong>121. 【22国考地市.第121题】图表题一</strong></p>',
    '<p><strong>A. 1</strong></p>',
    '<p><strong>B. 2</strong></p>',
    '<p><strong>C. 3</strong></p>',
    '<p><strong>D. 4</strong></p>',
    '<p>正确答案: A | 考点: 统计图自定义备注: </p>',
    '<p>==============================</p>',
    '<p>2020年12月，C市天然气用量为9.67亿立方米，同比增长11.66%。</p>',
    '<p><strong>126. 【22国考地市.第126题】文字资料题一</strong></p>',
    '<p><strong>A. 1</strong></p>',
    '<p><strong>B. 2</strong></p>',
    '<p><strong>C. 3</strong></p>',
    '<p><strong>D. 4</strong></p>',
    '<p>正确答案: C | 考点: 文字资料自定义备注: </p>',
  ].join('')

  const { questions } = parseDocxHtml(html)
  const imageQuestion = questions.find((q) => q.no === '121')
  const textQuestion = questions.find((q) => q.no === '126')

  assert.ok(imageQuestion?.questionImage.startsWith('data:image/png;base64,'))
  assert.equal(textQuestion?.questionImage || '', '')
  assert.match(textQuestion?.content || '', /【资料】2020年12月，C市天然气用量/)
})
