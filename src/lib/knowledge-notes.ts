import { prisma } from '@/lib/prisma'

function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function mergeSourceIds(existing: string | null | undefined, userErrorId: string) {
  const ids = new Set(
    normalizeText(existing)
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )
  ids.add(userErrorId)
  return Array.from(ids).join(', ')
}

function buildKnowledgeNoteContent(params: {
  body: string
  examples?: string | null
  sourceIds?: string | null
  insightType?: string | null
}) {
  const blocks = [
    `规则摘要：${normalizeText(params.body)}`,
    params.examples ? `典型例子：${normalizeText(params.examples)}` : '',
    params.sourceIds ? `来源题目：${normalizeText(params.sourceIds)}` : '',
    params.insightType ? `内容类型：${normalizeText(params.insightType)}` : '',
  ]
  return blocks.filter(Boolean).join('\n\n')
}

function inferKnowledgeModules(params: {
  type: string
  subtype?: string | null
  sub2?: string | null
  skillTags?: string | null
  content: string
}) {
  const explicitModule2 = normalizeText(params.subtype)
  const explicitModule3 = normalizeText(params.sub2) || normalizeText(params.skillTags?.split(/[，,]/)[0] ?? '')
  if (explicitModule2 || explicitModule3) {
    return {
      module2: explicitModule2,
      module3: explicitModule3,
    }
  }

  const type = normalizeText(params.type)
  const content = normalizeText(params.content)

  if (type === '判断推理') {
    if (content.includes('[图]') || content.includes('图形')) {
      return { module2: '图形推理', module3: '图形规律' }
    }
    if (content.includes('定义')) {
      return { module2: '定义判断', module3: '定义匹配' }
    }
    if (content.includes('推出') || content.includes('削弱') || content.includes('加强')) {
      return { module2: '逻辑判断', module3: '论证推理' }
    }
    return { module2: '判断推理', module3: '' }
  }

  if (type === '常识判断') {
    if (/(习近平|共产党|党|军队|马克思主义|社会主义|南昌起义|古田会议)/.test(content)) {
      return { module2: '政治', module3: '党史理论' }
    }
    if (/(宪法|刑法|民法|行政法|法律|法治)/.test(content)) {
      return { module2: '法律', module3: '法治常识' }
    }
    if (/(经济|消费|需求侧|供给侧|市场)/.test(content)) {
      return { module2: '经济', module3: '宏观经济' }
    }
    if (/(地理|气候|地形|河流|海洋)/.test(content)) {
      return { module2: '地理', module3: '自然地理' }
    }
    return { module2: '常识判断', module3: '' }
  }

  if (type === '资料分析') {
    if (/(增长率|增速|同比|环比)/.test(content)) return { module2: '增长', module3: '增长率计算' }
    if (/(比重|占比)/.test(content)) return { module2: '比重', module3: '比重比较' }
    if (/(平均数|均值)/.test(content)) return { module2: '平均数', module3: '平均数计算' }
    return { module2: '资料分析', module3: '' }
  }

  if (type === '数量关系') {
    if (/(工程|效率)/.test(content)) return { module2: '工程问题', module3: '效率计算' }
    if (/(行程|速度|路程)/.test(content)) return { module2: '行程问题', module3: '速度路程' }
    return { module2: '数量关系', module3: '' }
  }

  if (type === '言语理解') {
    if (/(主旨|概括|意在说明)/.test(content)) return { module2: '主旨概括', module3: '中心理解' }
    if (/(填入|最恰当|词语)/.test(content)) return { module2: '逻辑填空', module3: '词语辨析' }
    return { module2: '言语理解', module3: '' }
  }

  return { module2: '', module3: '' }
}

function inferKnowledgeTitle(params: {
  type: string
  subtype?: string | null
  sub2?: string | null
  skillTags?: string | null
  content: string
  knowledgeTitle?: string | null
}) {
  const explicit = normalizeText(params.knowledgeTitle)
  if (explicit) return explicit

  const skillTag = normalizeText(params.skillTags?.split(/[，,]/)[0] ?? '')
  const sub2 = normalizeText(params.sub2)
  const subtype = normalizeText(params.subtype)
  if (sub2) return sub2
  if (skillTag) return skillTag
  if (subtype) return subtype

  const content = normalizeText(params.content)
  const sentence = content
    .replace(/\s+/g, ' ')
    .split(/[。！？；\n]/)
    .map(part => part.trim())
    .find(Boolean) ?? ''

  const shortSentence = sentence.slice(0, 24)
  return shortSentence || `${normalizeText(params.type) || '通用'}核心规则`
}

export async function attachErrorToKnowledgeNote(params: {
  userId: string
  userErrorId: string
  question: {
    type: string
    subtype?: string | null
    sub2?: string | null
    skillTags?: string | null
    content: string
  }
  knowledgeTitle?: string | null
  summary?: string | null
  noteSource?: string
  sourceErrorIds?: string | null
}) {
  const level1 = normalizeText(params.question.type) || '通用'
  const inferredModules = inferKnowledgeModules({
    type: level1,
    subtype: params.question.subtype,
    sub2: params.question.sub2,
    skillTags: params.question.skillTags,
    content: params.question.content,
  })
  const level2 = inferredModules.module2
  const level3 = inferredModules.module3
  const title = inferKnowledgeTitle({
    type: level1,
    subtype: level2,
    sub2: level3,
    skillTags: params.question.skillTags,
    content: params.question.content,
    knowledgeTitle: params.knowledgeTitle,
  })
  const content = normalizeText(params.summary) || `题目：${params.question.content.slice(0, 180)}`
  const subtype = normalizeText(params.noteSource ?? '错题复盘')
  const incomingSourceIds = normalizeText(params.sourceErrorIds) || params.userErrorId

  const candidates = await prisma.userNote.findMany({
    where: {
      userId: params.userId,
      type: level1,
      module2: level2 || null,
      module3: level3 || null,
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  })

  const existing = candidates.find(note => normalizeText(note.title) === title)

  if (existing) {
    return prisma.userNote.update({
      where: { id: existing.id },
      data: {
        subtype,
        sourceErrorIds: mergeSourceIds(existing.sourceErrorIds, incomingSourceIds),
        content: existing.content || content,
      },
    })
  }

  return prisma.userNote.create({
    data: {
      userId: params.userId,
      type: level1,
      subtype,
      module2: level2 || null,
      module3: level3 || null,
      title,
      content,
      sourceErrorIds: incomingSourceIds,
      isPrivate: false,
    },
  })
}

export async function upsertKnowledgeNoteFromInsight(params: {
  userId: string
  skillTag: string
  insightType: string
  finalContent: string
  aiDraft?: string
  sourceErrorIds?: string
  domainExamples?: string
}) {
  const title = normalizeText(params.skillTag) || '通用规则'
  const subtype = '规则沉淀'
  const type = '知识树'
  const module2 = title
  const module3 = normalizeText(params.insightType) || 'rule'
  const sourceIds = normalizeText(params.sourceErrorIds)
  const content = buildKnowledgeNoteContent({
    body: normalizeText(params.finalContent) || normalizeText(params.aiDraft) || `${title} 的规则摘要`,
    examples: params.domainExamples,
    sourceIds,
    insightType: module3,
  })

  const existing = await prisma.userNote.findFirst({
    where: {
      userId: params.userId,
      type,
      subtype,
      module2,
      module3,
      title,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (existing) {
    return prisma.userNote.update({
      where: { id: existing.id },
      data: {
        content: existing.content || content,
        sourceErrorIds: sourceIds ? mergeSourceIds(existing.sourceErrorIds, sourceIds) : existing.sourceErrorIds,
        isPrivate: false,
      },
    })
  }

  return prisma.userNote.create({
    data: {
      userId: params.userId,
      type,
      subtype,
      module2,
      module3,
      title,
      content,
      sourceErrorIds: sourceIds || null,
      isPrivate: false,
    },
  })
}
