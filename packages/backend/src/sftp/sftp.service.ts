import {
  ClientState,
  SftpCompressRequestPayload,
  SftpDecompressRequestPayload,
} from '../websocket/types';
import { SftpUploadManager } from './sftp-upload.manager';
import { SftpArchiveManager } from './sftp-archive.manager';
import {
  executeMkdirPathOperation,
  executeRenamePathOperation,
  executeRmdirPathOperation,
  executeUnlinkPathOperation,
} from './sftp-path-operations';
import {
  executeReadFileContentOperation,
  executeWriteFileContentOperation,
} from './sftp-file-content-operations';
import {
  executeChmodPathQueryOperation,
  executeRealpathPathQueryOperation,
  executeStatPathQueryOperation,
} from './sftp-path-query-operations';
import { executeCopyOperation } from './sftp-copy-operations';
import { executeMoveOperation } from './sftp-move-operations';
import { executeReaddirSftpOperation } from './sftp-readdir-operations';
import {
  executeCleanupSftpSessionOperation,
  executeInitializeSftpSessionOperation,
} from './sftp-session-operations';

export class SftpService {
  private clientStates: Map<string, ClientState>;
  private uploadManager: SftpUploadManager;
  private archiveManager: SftpArchiveManager;

  constructor(clientStates: Map<string, ClientState>) {
    this.clientStates = clientStates;
    this.uploadManager = new SftpUploadManager(clientStates);
    this.archiveManager = new SftpArchiveManager(clientStates);
  }

  /**
   * 初始化 SFTP 会话
   * @param sessionId 会话 ID
   */
  async initializeSftpSession(sessionId: string): Promise<void> {
    await executeInitializeSftpSessionOperation(this.clientStates.get(sessionId), sessionId);
  }

  /**
   * 清理 SFTP 会话
   * @param sessionId 会话 ID
   */
  cleanupSftpSession(sessionId: string): void {
    executeCleanupSftpSessionOperation(this.clientStates.get(sessionId), sessionId);
    // Delegate upload cleanup to SftpUploadManager
    this.uploadManager.cleanupSessionUploads(sessionId);
  }

  // --- SFTP 操作方法 ---

  /** 读取目录内容 */
  async readdir(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeReaddirSftpOperation(this.clientStates.get(sessionId), sessionId, path, requestId);
  }

  /** 获取文件/目录状态信息 */
  async stat(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeStatPathQueryOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      requestId,
    );
  }

  /** 读取文件内容 (支持指定编码) */
  async readFile(
    sessionId: string,
    path: string,
    requestId: string,
    requestedEncoding?: string,
  ): Promise<void> {
    await executeReadFileContentOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      requestId,
      requestedEncoding,
    );
  }

  /** 写入文件内容 (支持指定编码) */
  // --- 修改：添加 encoding 参数 ---
  async writefile(
    sessionId: string,
    path: string,
    data: string,
    requestId: string,
    encoding?: string,
  ): Promise<void> {
    await executeWriteFileContentOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      data,
      requestId,
      encoding,
    );
  }

  /** 创建目录 */
  async mkdir(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeMkdirPathOperation(this.clientStates.get(sessionId), sessionId, path, requestId);
  }

  /** 删除目录 (强制递归) */
  async rmdir(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeRmdirPathOperation(this.clientStates.get(sessionId), sessionId, path, requestId);
  }

  /** 删除文件 */
  async unlink(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeUnlinkPathOperation(this.clientStates.get(sessionId), sessionId, path, requestId);
  }

  /** 重命名/移动文件或目录 */
  async rename(
    sessionId: string,
    oldPath: string,
    newPath: string,
    requestId: string,
  ): Promise<void> {
    await executeRenamePathOperation(
      this.clientStates.get(sessionId),
      sessionId,
      oldPath,
      newPath,
      requestId,
    );
  }

  /** 修改文件/目录权限 */
  async chmod(sessionId: string, path: string, mode: number, requestId: string): Promise<void> {
    await executeChmodPathQueryOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      mode,
      requestId,
    );
  }

  /** 获取路径的绝对表示 */
  async realpath(sessionId: string, path: string, requestId: string): Promise<void> {
    await executeRealpathPathQueryOperation(
      this.clientStates.get(sessionId),
      sessionId,
      path,
      requestId,
      () => this.clientStates.get(sessionId),
    );
  }

  // +++ 复制文件或目录 +++
  async copy(
    sessionId: string,
    sources: string[],
    destinationDir: string,
    requestId: string,
  ): Promise<void> {
    await executeCopyOperation(
      this.clientStates.get(sessionId),
      sessionId,
      sources,
      destinationDir,
      requestId,
    );
  }

  // +++ 移动文件或目录 +++
  async move(
    sessionId: string,
    sources: string[],
    destinationDir: string,
    requestId: string,
  ): Promise<void> {
    await executeMoveOperation(
      this.clientStates.get(sessionId),
      sessionId,
      sources,
      destinationDir,
      requestId,
    );
  }

  // --- Compress/Decompress Methods (delegated to SftpArchiveManager) ---
  /**
   * 压缩远程服务器上的文件/目录
   * @param sessionId 会话 ID
   * @param payload 压缩请求的 payload
   */
  async compress(sessionId: string, payload: SftpCompressRequestPayload): Promise<void> {
    return this.archiveManager.compress(sessionId, payload);
  }

  /**
   * 解压远程服务器上的压缩文件
   * @param sessionId 会话 ID
   * @param payload 解压请求的 payload
   */
  async decompress(sessionId: string, payload: SftpDecompressRequestPayload): Promise<void> {
    return this.archiveManager.decompress(sessionId, payload);
  }

  // --- File Upload Methods ---

  /** Start a new file upload (delegated to SftpUploadManager) */
  async startUpload(
    sessionId: string,
    uploadId: string,
    remotePath: string,
    totalSize: number,
    relativePath?: string,
  ): Promise<void> {
    return this.uploadManager.startUpload(sessionId, uploadId, remotePath, totalSize, relativePath);
  }

  /** Handle an incoming file chunk (delegated to SftpUploadManager) */
  async handleUploadChunk(
    sessionId: string,
    uploadId: string,
    chunkIndex: number,
    dataBase64: string,
    isLast?: boolean,
  ): Promise<void> {
    return this.uploadManager.handleUploadChunk(
      sessionId,
      uploadId,
      chunkIndex,
      dataBase64,
      isLast,
    );
  }

  /** Cancel an ongoing upload (delegated to SftpUploadManager) */
  cancelUpload(sessionId: string, uploadId: string): void {
    return this.uploadManager.cancelUpload(sessionId, uploadId);
  }
}
