import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockSftpSession, MockSftpEntry, MockSftpStats } from '../ssh/mock-ssh-server';

describe('SFTP 服务集成测试', () => {
  let sftpSession: MockSftpSession;

  beforeEach(() => {
    sftpSession = new MockSftpSession();
  });

  describe('目录操作', () => {
    it('应该能够读取目录内容', async () => {
      const entries = await new Promise<MockSftpEntry[]>((resolve, reject) => {
        sftpSession.readdir('/home/testuser', (err, entries) => {
          if (err) reject(err);
          else resolve(entries || []);
        });
      });

      expect(entries).toBeDefined();
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);

      // 检查返回的条目结构
      const entry = entries[0];
      expect(entry).toHaveProperty('filename');
      expect(entry).toHaveProperty('longname');
      expect(entry).toHaveProperty('attrs');
    });

    it('应该能够创建新目录', async () => {
      const newDirPath = '/home/testuser/newdir';

      await new Promise<void>((resolve, reject) => {
        sftpSession.mkdir(newDirPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 验证目录已创建
      const stats = await new Promise<MockSftpStats>((resolve, reject) => {
        sftpSession.stat(newDirPath, (err, stats) => {
          if (err) reject(err);
          else resolve(stats!);
        });
      });

      expect(stats).toBeDefined();
      expect(stats.mode).toBe(0o755);
    });

    it('应该拒绝创建已存在的目录', async () => {
      const existingPath = '/home/testuser';

      await expect(
        new Promise<void>((resolve, reject) => {
          sftpSession.mkdir(existingPath, (err) => {
            if (err) reject(err);
            else resolve();
          });
        })
      ).rejects.toThrow('EEXIST');
    });

    it('应该能够删除目录', async () => {
      // 先创建目录
      const dirPath = '/home/testuser/todelete';
      await new Promise<void>((resolve, reject) => {
        sftpSession.mkdir(dirPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 删除目录
      await new Promise<void>((resolve, reject) => {
        sftpSession.rmdir(dirPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 验证目录已删除
      await expect(
        new Promise<MockSftpStats>((resolve, reject) => {
          sftpSession.stat(dirPath, (err, stats) => {
            if (err) reject(err);
            else resolve(stats!);
          });
        })
      ).rejects.toThrow('ENOENT');
    });
  });

  describe('文件操作', () => {
    it('应该能够获取文件状态', async () => {
      const stats = await new Promise<MockSftpStats>((resolve, reject) => {
        sftpSession.stat('/home/testuser/test.txt', (err, stats) => {
          if (err) reject(err);
          else resolve(stats!);
        });
      });

      expect(stats).toBeDefined();
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.mode).toBe(0o644);
      expect(stats.uid).toBe(1000);
      expect(stats.gid).toBe(1000);
    });

    it('应该对不存在的文件返回错误', async () => {
      await expect(
        new Promise<MockSftpStats>((resolve, reject) => {
          sftpSession.stat('/nonexistent/file.txt', (err, stats) => {
            if (err) reject(err);
            else resolve(stats!);
          });
        })
      ).rejects.toThrow('ENOENT');
    });

    it('应该能够读取文件内容', async () => {
      const filePath = '/home/testuser/test.txt';

      // 打开文件
      const handle = await new Promise<Buffer>((resolve, reject) => {
        sftpSession.open(filePath, 'r', (err, handle) => {
          if (err) reject(err);
          else resolve(handle!);
        });
      });

      // 读取内容
      const buffer = Buffer.alloc(1024);
      const bytesRead = await new Promise<number>((resolve, reject) => {
        sftpSession.read(handle, buffer, 0, buffer.length, 0, (err, bytesRead) => {
          if (err) reject(err);
          else resolve(bytesRead || 0);
        });
      });

      expect(bytesRead).toBeGreaterThan(0);
      const content = buffer.toString('utf-8', 0, bytesRead);
      expect(content).toBe('Test file content');

      // 关闭文件
      await new Promise<void>((resolve, reject) => {
        sftpSession.close(handle, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    it('应该能够写入文件内容', async () => {
      const filePath = '/home/testuser/newfile.txt';
      const content = 'New file content';

      // 打开/创建文件
      const handle = await new Promise<Buffer>((resolve, reject) => {
        sftpSession.open(filePath, 'w', (err, handle) => {
          if (err) reject(err);
          else resolve(handle!);
        });
      });

      // 写入内容
      const dataBuffer = Buffer.from(content);
      await new Promise<void>((resolve, reject) => {
        sftpSession.write(handle, dataBuffer, 0, dataBuffer.length, 0, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 关闭文件
      await new Promise<void>((resolve, reject) => {
        sftpSession.close(handle, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 验证文件已创建并有正确大小
      const stats = await new Promise<MockSftpStats>((resolve, reject) => {
        sftpSession.stat(filePath, (err, stats) => {
          if (err) reject(err);
          else resolve(stats!);
        });
      });

      expect(stats.size).toBe(content.length);
    });

    it('应该能够删除文件', async () => {
      // 先创建文件
      const filePath = '/home/testuser/todelete.txt';
      const handle = await new Promise<Buffer>((resolve, reject) => {
        sftpSession.open(filePath, 'w', (err, handle) => {
          if (err) reject(err);
          else resolve(handle!);
        });
      });

      await new Promise<void>((resolve, reject) => {
        sftpSession.write(handle, Buffer.from('test'), 0, 4, 0, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await new Promise<void>((resolve, reject) => {
        sftpSession.close(handle, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 删除文件
      await new Promise<void>((resolve, reject) => {
        sftpSession.unlink(filePath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 验证文件已删除
      await expect(
        new Promise<MockSftpStats>((resolve, reject) => {
          sftpSession.stat(filePath, (err, stats) => {
            if (err) reject(err);
            else resolve(stats!);
          });
        })
      ).rejects.toThrow('ENOENT');
    });

    it('应该能够重命名文件', async () => {
      const oldPath = '/home/testuser/test.txt';
      const newPath = '/home/testuser/renamed.txt';

      // 重命名文件
      await new Promise<void>((resolve, reject) => {
        sftpSession.rename(oldPath, newPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 验证新路径存在
      const newStats = await new Promise<MockSftpStats>((resolve, reject) => {
        sftpSession.stat(newPath, (err, stats) => {
          if (err) reject(err);
          else resolve(stats!);
        });
      });
      expect(newStats).toBeDefined();

      // 验证旧路径不存在
      await expect(
        new Promise<MockSftpStats>((resolve, reject) => {
          sftpSession.stat(oldPath, (err, stats) => {
            if (err) reject(err);
            else resolve(stats!);
          });
        })
      ).rejects.toThrow('ENOENT');
    });
  });

  describe('分块上传', () => {
    it('应该支持分块写入大文件', async () => {
      const filePath = '/home/testuser/largefile.bin';
      const chunkSize = 1024;
      const totalChunks = 4;

      // 打开文件
      const handle = await new Promise<Buffer>((resolve, reject) => {
        sftpSession.open(filePath, 'w', (err, handle) => {
          if (err) reject(err);
          else resolve(handle!);
        });
      });

      // 分块写入
      for (let i = 0; i < totalChunks; i++) {
        const chunk = Buffer.alloc(chunkSize, i.toString().charCodeAt(0));
        await new Promise<void>((resolve, reject) => {
          sftpSession.write(handle, chunk, 0, chunkSize, i * chunkSize, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      // 关闭文件
      await new Promise<void>((resolve, reject) => {
        sftpSession.close(handle, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 验证文件大小
      const stats = await new Promise<MockSftpStats>((resolve, reject) => {
        sftpSession.stat(filePath, (err, stats) => {
          if (err) reject(err);
          else resolve(stats!);
        });
      });

      expect(stats.size).toBe(chunkSize * totalChunks);
    });
  });

  describe('会话管理', () => {
    it('应该能够结束 SFTP 会话', async () => {
      const endPromise = new Promise<void>((resolve) => {
        sftpSession.once('end', resolve);
      });

      sftpSession.end();

      await expect(endPromise).resolves.toBeUndefined();
    });
  });
});
