import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** 读取文件全部内容，读取失败返回空字符串 */
export function readFileContent(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8')
  }
  catch {
    return ''
  }
}

/** LCS diff — 返回增量的变更内容（只包含有变化的行） */
export function computeDiff(oldContent: string, newContent: string): string | null {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  // Build LCS table
  const m = oldLines.length
  const n = newLines.length

  // Optimize: if both are huge, bail early with a simpler comparison
  if (m * n > 5_000_000) {
    // Large file fallback: just return the full new content if different
    return oldContent === newContent ? null : newContent
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }).fill(0) as number[])

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const oldLine = oldLines[i - 1]!
      const newLine = newLines[j - 1]!
      if (oldLine === newLine) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      }
      else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  // Backtrack to find diff lines
  const added: string[] = []
  const removed: string[] = []
  let i = m
  let j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      i--
      j--
    }
    else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      added.push(`+ ${newLines[j - 1]!}`)
      j--
    }
    else {
      removed.push(`- ${oldLines[i - 1]!}`)
      i--
    }
  }

  const diffLines = [...removed.reverse(), ...added.reverse()]
  if (diffLines.length === 0)
    return null
  return diffLines.join('\n')
}

/** 计算内容的 MD5 hash */
export function calculateHash(content: string): string {
  return createHash('md5').update(content).digest('hex')
}
