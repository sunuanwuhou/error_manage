export const NOTE_ASSET_PREFIX = 'asset://'

export function extractAssetIdsFromMarkdown(content: string | null | undefined) {
  const ids = new Set<string>()
  const text = content ?? ''
  const regex = /(?:asset:\/\/|@img:)([a-zA-Z0-9_-]+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) ids.add(match[1])
  }
  return Array.from(ids)
}

export function buildNoteAssetMarkdown(assetId: string, altText = '图片') {
  return `![${altText}](${NOTE_ASSET_PREFIX}${assetId})`
}

export function parseNoteAssetReference(src: string) {
  if (src.startsWith(NOTE_ASSET_PREFIX)) return src.slice(NOTE_ASSET_PREFIX.length)
  if (src.startsWith('@img:')) return src.slice('@img:'.length)
  return null
}
