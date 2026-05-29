import { describe, expect, it } from 'vitest'
import { extractFilePath } from './index'

describe('extractFilePath', () => {
  it('extracts path from replace/patch mode (direct path field)', () => {
    const result = extractFilePath({ path: 'src/foo.ts', edits: [] })
    expect(result).toBe('src/foo.ts')
  })

  it('extracts path from write tool input', () => {
    const result = extractFilePath({ path: 'src/bar.ts', content: 'hello' })
    expect(result).toBe('src/bar.ts')
  })

  it('extracts path from hashline mode (¶ prefix)', () => {
    const input = `¶src/foo.ts#abc\n1 1\n+new line`
    const result = extractFilePath({ input })
    expect(result).toBe('src/foo.ts')
  })

  it('extracts path from hashline mode (§ prefix)', () => {
    const input = `§src/bar.ts#def\n1 1\n+new line`
    const result = extractFilePath({ input })
    expect(result).toBe('src/bar.ts')
  })

  it('extracts path from hashline mode (@ prefix)', () => {
    const input = `@src/baz.ts#ghi\n1 1\n+new line`
    const result = extractFilePath({ input })
    expect(result).toBe('src/baz.ts')
  })

  it('extracts path from apply-patch Add File', () => {
    const input = `*** Add File: src/new-file.ts\n+content`
    const result = extractFilePath({ input })
    expect(result).toBe('src/new-file.ts')
  })

  it('extracts path from apply-patch Update File', () => {
    const input = `*** Update File: src/existing.ts\nold\n---\nnew`
    const result = extractFilePath({ input })
    expect(result).toBe('src/existing.ts')
  })

  it('extracts path from apply-patch Delete File', () => {
    const input = `*** Delete File: src/old.ts`
    const result = extractFilePath({ input })
    expect(result).toBe('src/old.ts')
  })

  it('returns undefined for empty input', () => {
    const result = extractFilePath({})
    expect(result).toBeUndefined()
  })

  it('returns undefined when path is empty string', () => {
    const result = extractFilePath({ path: '' })
    expect(result).toBeUndefined()
  })

  it('returns undefined when input string has no recognizable format', () => {
    const result = extractFilePath({ input: 'just some random text' })
    expect(result).toBeUndefined()
  })

  it('returns path for absolute paths', () => {
    const result = extractFilePath({ path: '/Users/jacob/project/src/index.ts' })
    expect(result).toBe('/Users/jacob/project/src/index.ts')
  })

  it('returns path for hashline with absolute path', () => {
    const input = `¶/Users/jacob/project/src/foo.ts#abc\n1 1\n+line`
    const result = extractFilePath({ input })
    expect(result).toBe('/Users/jacob/project/src/foo.ts')
  })
})
