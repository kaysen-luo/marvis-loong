export function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 估算阅读时间(分钟)。中文 350 字/分钟,英文 220 词/分钟,
 * 简单做法:总字符数 / 350 向上取整,最少 1 分钟。
 */
export function estimateReadTime(text: string): number {
  const cleaned = text.replace(/\s+/g, '')
  return Math.max(1, Math.ceil(cleaned.length / 350))
}
