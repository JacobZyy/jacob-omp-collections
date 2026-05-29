import { describe, expect, it } from 'vitest'
import { FileFilter } from './file-filter'

describe('FileFilter', () => {
  describe('shouldProcess', () => {
    it('accepts .ts files', () => {
      expect(FileFilter.shouldProcess('/project/src/index.ts')).toBe(true)
    })

    it('accepts .vue files', () => {
      expect(FileFilter.shouldProcess('/project/src/App.vue')).toBe(true)
    })

    it('accepts .py files', () => {
      expect(FileFilter.shouldProcess('/project/main.py')).toBe(true)
    })

    it('accepts .json files', () => {
      expect(FileFilter.shouldProcess('/project/package.json')).toBe(true)
    })

    it('accepts .md files', () => {
      expect(FileFilter.shouldProcess('/project/README.md')).toBe(true)
    })

    it('rejects .lock files', () => {
      expect(FileFilter.shouldProcess('/project/bun.lock')).toBe(false)
    })

    it('rejects .log files', () => {
      expect(FileFilter.shouldProcess('/tmp/debug.log')).toBe(false)
    })

    it('rejects binary .png files', () => {
      expect(FileFilter.shouldProcess('/project/icon.png')).toBe(false)
    })

    it('rejects paths under node_modules', () => {
      expect(FileFilter.shouldProcess('/project/node_modules/foo/index.ts')).toBe(false)
    })

    it('rejects paths under .git', () => {
      expect(FileFilter.shouldProcess('/project/.git/HEAD')).toBe(false)
    })

    it('rejects paths under dist', () => {
      expect(FileFilter.shouldProcess('/project/dist/bundle.js')).toBe(false)
    })

    it('rejects paths under __pycache__', () => {
      expect(FileFilter.shouldProcess('/project/__pycache__/main.cpython-312.pyc')).toBe(false)
    })

    it('rejects empty path', () => {
      expect(FileFilter.shouldProcess('')).toBe(false)
    })

    it('is case-insensitive on extension', () => {
      expect(FileFilter.shouldProcess('/project/src/index.TS')).toBe(true)
    })
  })
})
