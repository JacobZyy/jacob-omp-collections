import { describe, expect, it } from 'vitest'
import { extractFilePath } from './index'

describe('extractFilePath', () => {
  it('should extract path from direct path field', () => {
    const input = { path: '/foo/bar.ts' }
    expect(extractFilePath(input)).toBe('/foo/bar.ts')
  })

  it('should extract path from hashline input', () => {
    const input = { input: '¶/foo/bar.ts#abc123\nreplace 1..1:\n+new line' }
    expect(extractFilePath(input)).toBe('/foo/bar.ts')
  })

  it('should extract path from apply-patch input', () => {
    const input = { input: '*** Add File: /foo/bar.ts\n+content' }
    expect(extractFilePath(input)).toBe('/foo/bar.ts')
  })

  it('should return undefined for missing path', () => {
    const input = { content: 'some content' }
    expect(extractFilePath(input)).toBeUndefined()
  })

  it('should return undefined for empty path', () => {
    const input = { path: '' }
    expect(extractFilePath(input)).toBeUndefined()
  })

  it('should handle Update File in apply-patch', () => {
    const input = { input: '*** Update File: /foo/bar.ts\n-old\n+new' }
    expect(extractFilePath(input)).toBe('/foo/bar.ts')
  })

  it('should handle Delete File in apply-patch', () => {
    const input = { input: '*** Delete File: /foo/bar.ts' }
    expect(extractFilePath(input)).toBe('/foo/bar.ts')
  })
})
