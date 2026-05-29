import { describe, expect, it } from 'vitest'
import { calculateHash, computeDiff, readFileContent } from './diff'

describe('diff', () => {
  describe('computeDiff', () => {
    it('returns null when content is identical', () => {
      expect(computeDiff('hello\nworld\n', 'hello\nworld\n')).toBeNull()
    })

    it('detects added lines', () => {
      const old = 'line1\nline2\n'
      const newContent = 'line1\nline2\nline3\n'
      const diff = computeDiff(old, newContent)
      expect(diff).toContain('+ line3')
      expect(diff).not.toContain('- ')
    })

    it('detects removed lines', () => {
      const old = 'line1\nline2\nline3\n'
      const newContent = 'line1\nline3\n'
      const diff = computeDiff(old, newContent)
      expect(diff).toContain('- line2')
      expect(diff).not.toContain('+ ')
    })

    it('detects modified lines (remove + add)', () => {
      const old = 'line1\nold\n'
      const newContent = 'line1\nnew\n'
      const diff = computeDiff(old, newContent)
      expect(diff).toContain('- old')
      expect(diff).toContain('+ new')
    })

    it('returns full new content for very large files (fallback)', () => {
      // m * n > 5_000_000 threshold
      const oldLines = Array(3000).fill('a')
      const newLines = Array(3000).fill('b')
      const diff = computeDiff(oldLines.join('\n'), newLines.join('\n'))
      // Falls back to returning full new content
      expect(diff).toBeTruthy()
    })

    it('returns null for empty identical strings', () => {
      expect(computeDiff('', '')).toBeNull()
    })
  })

  describe('calculateHash', () => {
    it('returns consistent hash for same input', () => {
      const a = calculateHash('hello world')
      const b = calculateHash('hello world')
      expect(a).toBe(b)
    })

    it('returns different hash for different input', () => {
      const a = calculateHash('hello')
      const b = calculateHash('world')
      expect(a).not.toBe(b)
    })

    it('returns a 32-char hex string', () => {
      const hash = calculateHash('test')
      expect(hash).toMatch(/^[0-9a-f]{32}$/)
    })
  })

  describe('readFileContent', () => {
    it('returns empty string for non-existent file', () => {
      expect(readFileContent('/tmp/this-file-does-not-exist-12345.ts')).toBe('')
    })
  })
})
