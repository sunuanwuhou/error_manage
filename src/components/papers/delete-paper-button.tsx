'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function DeletePaperButton({
  paperKey,
  paperTitle,
  questionCount,
}: {
  paperKey: string
  paperTitle: string
  questionCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    const confirmed = window.confirm(`确认删除试卷“${paperTitle}”吗？这会同时删除 ${questionCount} 道题及相关练习记录。`)
    if (!confirmed) return

    setError('')
    setIsDeleting(true)
    const res = await fetch(`/api/papers?paper=${encodeURIComponent(paperKey)}`, {
      method: 'DELETE',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? '删除失败')
      setIsDeleting(false)
      return
    }

    startTransition(() => {
      router.refresh()
    })
    setIsDeleting(false)
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending || isDeleting}
        className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending || isDeleting ? '删除中...' : '删除这套卷'}
      </button>
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
    </div>
  )
}
