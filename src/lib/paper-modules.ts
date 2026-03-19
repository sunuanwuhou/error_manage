export function buildPaperModuleLabel(type: string | null | undefined, subtype: string | null | undefined) {
  const safeType = type || '未分类'
  return subtype ? `${safeType} · ${subtype}` : safeType
}

export function parsePaperModuleLabel(label: string) {
  const [type, ...rest] = label.split(' · ')
  return {
    type: type || '未分类',
    subtype: rest.length > 0 ? rest.join(' · ') : undefined,
  }
}

type PaperModuleRun = {
  label: string
  start: number
  end: number
}

function collectRuns(labels: string[]) {
  const runs: PaperModuleRun[] = []

  labels.forEach((label, index) => {
    const last = runs[runs.length - 1]
    if (last?.label === label) {
      last.end = index
      return
    }

    runs.push({ label, start: index, end: index })
  })

  return runs
}

export function smoothPaperModuleLabels(labels: string[], isolatedRunMax = 2) {
  if (labels.length < 3) return [...labels]

  const smoothed = [...labels]
  const runs = collectRuns(labels)

  runs.forEach((run, index) => {
    const prev = runs[index - 1]
    const next = runs[index + 1]
    const size = run.end - run.start + 1

    if (!prev || !next) return
    if (size > isolatedRunMax) return
    if (prev.label !== next.label) return

    for (let cursor = run.start; cursor <= run.end; cursor += 1) {
      smoothed[cursor] = prev.label
    }
  })

  return smoothed
}

export function buildPaperModuleGroups(labels: string[]) {
  return labels.reduce<Array<{ label: string; indexes: number[] }>>((groups, label, questionIndex) => {
    const last = groups[groups.length - 1]
    if (last?.label === label) {
      last.indexes.push(questionIndex)
    } else {
      groups.push({ label, indexes: [questionIndex] })
    }
    return groups
  }, [])
}
