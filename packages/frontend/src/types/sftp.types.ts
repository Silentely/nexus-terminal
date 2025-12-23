// 类型定义：用于 SFTP 文件和目录属性
export interface FileAttributes {
  size: number;
  uid: number;
  gid: number;
  mode: number; // 文件模式 (例如 0o755)
  atime: number; // 最后访问时间 (毫秒时间戳)
  mtime: number; // 最后修改时间 (毫秒时间戳)
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

// 类型定义：用于文件列表中的单个条目
export interface FileListItem {
  filename: string; // 文件或目录名
  longname: string; // ls -l 风格的长名称字符串
  attrs: FileAttributes; // 文件属性
}

// 类型定义：用于编辑器文件内容和编码 (从 useFileEditor 迁移)
export interface EditorFileContent {
  content: string;
  encoding: 'utf8' | 'base64';
}

// 类型定义：编辑器保存状态 (从 useFileEditor 迁移)
export type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

// 类型定义：后端 readFile 请求的 payload 结构
export interface SftpReadFileRequestPayload {
  path: string;
  encoding?: string; // 可选：请求使用的特定编码
}

// 类型定义：后端 readFile 成功时返回的 payload 结构 (更新)
export interface SftpReadFileSuccessPayload {
  rawContentBase64: string; // Base64 编码的原始文件内容
  encodingUsed: string; // 后端自动检测或用户请求时实际使用的编码
}
