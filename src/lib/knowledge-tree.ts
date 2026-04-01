import { prisma } from '@/lib/prisma'

const db = prisma as any

type KnowledgeNode = {
  id: string
  userId: string
  parentId: string | null
  nodeType: string
  title: string
  source: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

type UserNote = {
  id: string
  userId: string
  knowledgeNodeId: string | null
  type: string
  module2: string | null
  module3: string | null
  title: string
}

export const DEFAULT_SUBJECT_NODES = ['判断推理', '言语理解', '数量关系', '资料分析', '常识判断'] as const
export const UNCATEGORIZED_TITLE = '未分类'
export const SYSTEM_PENDING_TITLE = '系统待确认'
export const USER_STAGING_TITLE = '用户暂存'
export const GENERIC_MODULE_TITLE = '未细分模块'
export const GENERIC_KNOWLEDGE_TITLE = '待整理知识点'

type PlacementMode = 'system' | 'user'

type KnowledgePlacementInput = {
  type?: string | null
  module2?: string | null
  module3?: string | null
  title?: string | null
  mode?: PlacementMode
  knowledgeNodeId?: string | null
}

export type KnowledgeTreeNode = {
  id: string
  title: string
  nodeType: string
  parentId: string | null
  noteCount: number
  children: KnowledgeTreeNode[]
}

export type NoteNodeOption = {
  id: string
  title: string
  pathLabel: string
  nodeType: string
}

export type KnowledgeLibraryTemplate = {
  key: string
  title: string
  description: string
  entries: Array<{
    subject: string
    module: string
    points: string[]
  }>
}

export const DEFAULT_KNOWLEDGE_LIBRARY_TEMPLATES: KnowledgeLibraryTemplate[] = [
  {
    key: 'xingce-common',
    title: '通用行测知识库',
    description: '按常见行测产品的公开分类整理，导入后可直接选择知识点挂载。',
    entries: [
      { subject: '判断推理', module: '图形推理', points: ['对称', '平移旋转', '立体截面', '数量规律'] },
      { subject: '判断推理', module: '定义判断', points: ['定义要点拆分', '选项比对', '多定义干扰'] },
      { subject: '判断推理', module: '逻辑判断', points: ['加强削弱', '前提假设', '真假推理'] },
      { subject: '言语理解', module: '主旨概括', points: ['中心句定位', '转折递进', '错误选项排除'] },
      { subject: '言语理解', module: '逻辑填空', points: ['成语辨析', '语境对应', '感情色彩'] },
      { subject: '数量关系', module: '工程问题', points: ['效率统一', '合作与轮换'] },
      { subject: '数量关系', module: '行程问题', points: ['相遇追及', '比例法', '速度转换'] },
      { subject: '资料分析', module: '增长', points: ['增长率', '增长量', '平均数'] },
      { subject: '资料分析', module: '比重', points: ['现期比重', '基期比重', '比重变化'] },
      { subject: '常识判断', module: '法律', points: ['宪法', '行政法', '民法常识'] },
    ],
  },
]

export function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

async function findChildNode(userId: string, parentId: string | null, title: string) {
  return db.knowledgeNode.findFirst({
    where: { userId, parentId, title },
    orderBy: { createdAt: 'asc' },
  })
}

async function ensureNode(params: {
  userId: string
  parentId: string | null
  title: string
  nodeType: string
  source: string
  sortOrder?: number
}) {
  const existing = await findChildNode(params.userId, params.parentId, params.title)
  if (existing) return existing

  return db.knowledgeNode.create({
    data: {
      userId: params.userId,
      parentId: params.parentId,
      title: params.title,
      nodeType: params.nodeType,
      source: params.source,
      sortOrder: params.sortOrder ?? 0,
    },
  })
}

export async function ensureKnowledgeRoots(userId: string) {
  for (let index = 0; index < DEFAULT_SUBJECT_NODES.length; index += 1) {
    await ensureNode({
      userId,
      parentId: null,
      title: DEFAULT_SUBJECT_NODES[index],
      nodeType: 'subject',
      source: 'system',
      sortOrder: index,
    })
  }

  const uncategorized = await ensureNode({
    userId,
    parentId: null,
    title: UNCATEGORIZED_TITLE,
    nodeType: 'uncategorized',
    source: 'system',
    sortOrder: DEFAULT_SUBJECT_NODES.length,
  })

  await ensureNode({
    userId,
    parentId: uncategorized.id,
    title: SYSTEM_PENDING_TITLE,
    nodeType: 'bucket',
    source: 'system',
    sortOrder: 0,
  })
  await ensureNode({
    userId,
    parentId: uncategorized.id,
    title: USER_STAGING_TITLE,
    nodeType: 'bucket',
    source: 'system',
    sortOrder: 1,
  })
}

export async function seedKnowledgeLibraryFromTemplate(userId: string, templateKey: string) {
  const template = DEFAULT_KNOWLEDGE_LIBRARY_TEMPLATES.find(item => item.key === templateKey)
  if (!template) return null

  await ensureKnowledgeRoots(userId)

  for (const entry of template.entries) {
    const subjectNode = await ensureNode({
      userId,
      parentId: null,
      title: entry.subject,
      nodeType: 'subject',
      source: 'template',
    })
    const moduleNode = await ensureNode({
      userId,
      parentId: subjectNode.id,
      title: entry.module,
      nodeType: 'module',
      source: 'template',
    })

    for (const point of entry.points) {
      await ensureNode({
        userId,
        parentId: moduleNode.id,
        title: point,
        nodeType: 'knowledge',
        source: 'template',
      })
    }
  }

  return template
}

async function ensureNodePath(userId: string, titles: string[], mode: PlacementMode) {
  await ensureKnowledgeRoots(userId)

  let parentId: string | null = null
  let current: KnowledgeNode | null = null
  for (let index = 0; index < titles.length; index += 1) {
    const title = titles[index]
    const nodeType =
      index === 0
        ? title === UNCATEGORIZED_TITLE
          ? 'uncategorized'
          : 'subject'
        : index === titles.length - 1
          ? 'knowledge'
          : index === 1 && titles[0] === UNCATEGORIZED_TITLE
            ? 'bucket'
            : 'module'

    current = await ensureNode({
      userId,
      parentId,
      title,
      nodeType,
      source: mode,
      sortOrder: index,
    })
    parentId = current!.id
  }

  return current
}

function buildPlacementTitles(input: KnowledgePlacementInput) {
  const type = normalizeText(input.type)
  const module2 = normalizeText(input.module2)
  const module3 = normalizeText(input.module3)
  const title = normalizeText(input.title) || GENERIC_KNOWLEDGE_TITLE
  const mode = input.mode ?? 'user'

  if (type && (module2 || module3)) {
    const moduleTitle = module2 || GENERIC_MODULE_TITLE
    const knowledgeTitle = module3 || title
    return {
      mode,
      titles: [type, moduleTitle, knowledgeTitle],
    }
  }

  return {
    mode,
    titles: [UNCATEGORIZED_TITLE, mode === 'system' ? SYSTEM_PENDING_TITLE : USER_STAGING_TITLE, title],
  }
}

export async function resolveKnowledgeNode(userId: string, input: KnowledgePlacementInput) {
  if (input.knowledgeNodeId) {
    const existing = await db.knowledgeNode.findFirst({
      where: { id: input.knowledgeNodeId, userId },
    })
    if (existing) return existing
  }

  const placement = buildPlacementTitles(input)
  return ensureNodePath(userId, placement.titles, placement.mode)
}

export async function backfillNoteKnowledgeNode(note: Pick<UserNote, 'id' | 'userId' | 'knowledgeNodeId' | 'type' | 'module2' | 'module3' | 'title'>) {
  if (note.knowledgeNodeId) return note.knowledgeNodeId

  const node = await resolveKnowledgeNode(note.userId, {
    type: note.type,
    module2: note.module2,
    module3: note.module3,
    title: note.title,
    mode: 'user',
  })

  await db.userNote.update({
    where: { id: note.id },
    data: { knowledgeNodeId: node.id },
  })

  return node.id
}

export function buildKnowledgeTree(nodes: Array<KnowledgeNode & { notes: Pick<UserNote, 'id'>[] }>): KnowledgeTreeNode[] {
  const childrenByParent = new Map<string | null, Array<KnowledgeNode & { notes: Pick<UserNote, 'id'>[] }>>()

  nodes.forEach(node => {
    const key = node.parentId ?? null
    const list = childrenByParent.get(key) ?? []
    list.push(node)
    childrenByParent.set(key, list)
  })

  const buildBranch = (parentId: string | null): KnowledgeTreeNode[] => {
    const siblings = (childrenByParent.get(parentId) ?? []).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.title.localeCompare(b.title, 'zh-CN')
    })

    return siblings.map(node => {
      const children = buildBranch(node.id)
      const noteCount = node.notes.length + children.reduce((sum, child) => sum + child.noteCount, 0)
      return {
        id: node.id,
        title: node.title,
        nodeType: node.nodeType,
        parentId: node.parentId,
        noteCount,
        children,
      }
    })
  }

  return buildBranch(null)
}

export function buildNodeOptions(nodes: KnowledgeNode[]): NoteNodeOption[] {
  const byId = new Map(nodes.map(node => [node.id, node]))

  const buildPathLabel = (node: KnowledgeNode) => {
    const path: string[] = [node.title]
    let current = node
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent) break
      path.unshift(parent.title)
      current = parent
    }
    return path.join(' / ')
  }

  return nodes
    .filter(node => node.nodeType === 'knowledge' || node.nodeType === 'bucket' || node.nodeType === 'module')
    .map(node => ({
      id: node.id,
      title: node.title,
      pathLabel: buildPathLabel(node),
      nodeType: node.nodeType,
    }))
    .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel, 'zh-CN'))
}
