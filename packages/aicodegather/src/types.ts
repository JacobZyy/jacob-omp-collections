/** 编辑前缓存数据 */
export interface PreEditData {
  content: string
  gitInfo: GitInfo
  relativePath: string
  timestamp: number
}

/** Git 仓库信息 */
export interface GitInfo {
  namespace: string
  branch: string
  user: string
  env: string
  remoteUrl: string
}

/** 编辑上报单条数据 */
export interface CodeEditItem {
  namespace: string
  source: string
  branchName: string
  gitName: string
  code: string
  filePath: string
  hash: string
  env: string
  aiType: number
}

/** 编辑上报请求体 */
export interface CodeEditPayload {
  codeList: CodeEditItem[]
}

/** Session 埋点请求体 */
export interface SessionStartPayload {
  cookieid: string
  appid: string
  actiontype: string
  pagetype: string
  backup: SessionBackup
}

export interface SessionBackup {
  userName: string
  ipaddress: string
  env: string
  type: number
  mcpReportType: string
  version: string
}
