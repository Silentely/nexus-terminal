/**
 * SFTP 工具函数和类型定义
 * 提供 SFTP 操作的共享工具
 */

import { SFTPWrapper, Stats } from 'ssh2';
import { logger } from '../utils/logger';
import * as pathModule from 'path';
import { getErrorMessage } from '../utils/AppError';

type MkdirWithRecursive = (
  path: string,
  attrs: { recursive?: boolean },
  callback: (err?: Error | undefined) => void,
) => void;

const getSftpErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
};

/** SFTP 目录条目 */
export interface SftpDirEntry {
  filename: string;
  longname: string;
  attrs: Stats;
}

/** 文件列表项格式 */
export interface FileListItem {
  filename: string;
  longname: string;
  attrs: {
    size: number;
    uid: number;
    gid: number;
    mode: number;
    atime: number;
    mtime: number;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
  };
}

/**
 * SFTP 工具类
 * 提供 Promise 包装和通用辅助方法
 */
export class SftpUtils {
  /**
   * 获取文件/目录状态 (Promise wrapper)
   */
  static getStats(sftp: SFTPWrapper, path: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      sftp.lstat(path, (err, stats) => {
        if (err) {
          reject(err);
        } else {
          resolve(stats);
        }
      });
    });
  }

  /**
   * 列出目录内容 (Promise wrapper)
   */
  static listDirectory(sftp: SFTPWrapper, path: string): Promise<SftpDirEntry[]> {
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (err, list) => {
        if (err) {
          reject(err);
        } else {
          resolve(list);
        }
      });
    });
  }

  /**
   * 执行重命名 (Promise wrapper)
   */
  static performRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 格式化 Stats 为 FileListItem
   */
  static formatStatsToFileListItem(itemPath: string, stats: Stats): FileListItem {
    return {
      filename: pathModule.basename(itemPath),
      longname: '',
      attrs: {
        size: stats.size,
        uid: stats.uid,
        gid: stats.gid,
        mode: stats.mode,
        atime: stats.atime * 1000,
        mtime: stats.mtime * 1000,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        isSymbolicLink: stats.isSymbolicLink(),
      },
    };
  }

  /**
   * 确保目录存在 (递归创建)
   */
  static async ensureDirectoryExists(sftp: SFTPWrapper, dirPath: string): Promise<void> {
    const normalizedPath = dirPath.replace(/\/$/, '');
    if (!normalizedPath || normalizedPath === '/') {
      return;
    }

    try {
      await SftpUtils.getStats(sftp, normalizedPath);
    } catch (statError: unknown) {
      const statErrCode = getSftpErrorCode(statError);
      const statErrMsg = getErrorMessage(statError);
      if (statErrCode === 'ENOENT' || statErrMsg.includes('No such file')) {
        try {
          const mkdirWithRecursive = sftp.mkdir as unknown as MkdirWithRecursive;
          await new Promise<void>((resolveMkdir, rejectMkdir) => {
            mkdirWithRecursive(normalizedPath, { recursive: true }, (mkdirErr) => {
              if (mkdirErr) {
                rejectMkdir(mkdirErr);
              } else {
                resolveMkdir();
              }
            });
          });
        } catch (err: unknown) {
          logger.debug({ err }, '操作失败，已忽略');
          const parentDir = pathModule.dirname(normalizedPath).replace(/\\/g, '/');
          if (parentDir && parentDir !== '/' && parentDir !== '.') {
            await SftpUtils.ensureDirectoryExists(sftp, parentDir);
          }
          try {
            await new Promise<void>((resolveMkdir, rejectMkdir) => {
              sftp.mkdir(normalizedPath, (mkdirErr) => {
                if (mkdirErr) {
                  rejectMkdir(new Error(`创建目录失败 ${normalizedPath}: ${mkdirErr.message}`));
                } else {
                  resolveMkdir();
                }
              });
            });
          } catch (iterativeMkdirError: unknown) {
            try {
              const finalStats = await SftpUtils.getStats(sftp, normalizedPath);
              if (!finalStats.isDirectory()) {
                throw new Error(`路径 ${normalizedPath} 已存在但不是目录`);
              }
            } catch (innerErr: unknown) {
              logger.debug({ err: innerErr }, '操作失败，已忽略');
              throw iterativeMkdirError;
            }
          }
        }
      } else {
        throw new Error(`检查目录失败 ${normalizedPath}: ${statErrMsg}`);
      }
    }
  }

  /**
   * 复制单个文件
   */
  static copyFile(sftp: SFTPWrapper, sourcePath: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = sftp.createReadStream(sourcePath);
      const writeStream = sftp.createWriteStream(destPath);
      let errorOccurred = false;

      const onError = (err: Error) => {
        if (errorOccurred) return;
        errorOccurred = true;
        readStream.destroy();
        writeStream.destroy();
        reject(new Error(`复制文件失败: ${err.message}`));
      };

      readStream.on('error', onError);
      writeStream.on('error', onError);

      writeStream.on('close', () => {
        if (!errorOccurred) {
          resolve();
        }
      });

      readStream.pipe(writeStream);
    });
  }

  /**
   * 递归复制目录
   */
  static async copyDirectoryRecursive(
    sftp: SFTPWrapper,
    sourcePath: string,
    destPath: string,
  ): Promise<void> {
    await SftpUtils.ensureDirectoryExists(sftp, destPath);
    const items = await SftpUtils.listDirectory(sftp, sourcePath);

    for (const item of items) {
      const currentSourcePath = pathModule.join(sourcePath, item.filename).replace(/\\/g, '/');
      const currentDestPath = pathModule.join(destPath, item.filename).replace(/\\/g, '/');
      const itemStats = item.attrs;

      if (itemStats.isDirectory()) {
        await SftpUtils.copyDirectoryRecursive(sftp, currentSourcePath, currentDestPath);
      } else if (itemStats.isFile()) {
        await SftpUtils.copyFile(sftp, currentSourcePath, currentDestPath);
      }
    }
  }
}
