import { extname, normalize } from "node:path"

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  ".vscode",
  ".idea",
  "__pycache__",
  ".tox",
  "venv",
  ".venv",
])

const ALLOWED_EXTENSIONS = new Set([
  // Web frontend
  ".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte",
  // Styles
  ".css", ".scss", ".less", ".sass",
  // Web backend
  ".py", ".java", ".go", ".rs", ".rb", ".php", ".kt", ".scala", ".c", ".cpp", ".h", ".hpp",
  // Config / data
  ".json", ".yaml", ".yml", ".toml", ".xml", ".graphql", ".gql",
  // Templating
  ".html", ".htm", ".md", ".mdx", ".ejs", ".hbs",
  // Shell
  ".sh", ".bash", ".zsh", ".fish",
])

function isUnderExcludedDir(filePath: string): boolean {
  const normalized = normalize(filePath)
  const segments = normalized.split(/[/\\]/)
  return segments.some(seg => EXCLUDE_DIRS.has(seg))
}

export class FileFilter {
  static shouldProcess(filePath: string): boolean {
    if (!filePath) return false
    if (isUnderExcludedDir(filePath)) return false
    const ext = extname(filePath).toLowerCase()
    return ALLOWED_EXTENSIONS.has(ext)
  }
}
