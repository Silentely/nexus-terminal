import { describe, it, expect } from 'vitest';
import { sftpBaseSchema, messageSchemaRegistry } from './schemas';

/**
 * SFTP Schema 集成测试 — 验证 z.union 的 payload 匹配行为
 *
 * 历史问题：z.union 中 sftpPathPayloadSchema（仅声明 path）在 strip 模式下
 * 会匹配任何含 path 的 payload，导致 writefile 的 content 被静默剥离。
 * 修复方案：所有 payload schema 添加 .strict() 拒绝未知字段。
 */
describe('SFTP Schema — z.union payload 匹配', () => {
  describe('sftp:writefile — content 不应被剥离', () => {
    it('应保留 content 和 encoding 字段', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/home/user/file.txt',
          content: 'hello world',
          encoding: 'utf8',
        },
        requestId: 'req-123',
      };

      const result = sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.path).toBe('/home/user/file.txt');
      expect(payload.content).toBe('hello world');
      expect(payload.encoding).toBe('utf8');
    });

    it('应保留 data 字段（备选内容字段）', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/home/user/file.txt',
          data: 'base64content',
        },
        requestId: 'req-456',
      };

      const result = sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.path).toBe('/home/user/file.txt');
      expect(payload.data).toBe('base64content');
    });

    it('content 为空字符串时也应保留', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/home/user/empty.txt',
          content: '',
        },
        requestId: 'req-789',
      };

      const result = sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.path).toBe('/home/user/empty.txt');
      expect(payload.content).toBe('');
    });

    it('应拒绝 writefile payload 中的未知字段', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/home/user/file.txt',
          content: 'hello',
          unknownField: 'should fail',
        },
        requestId: 'req-strict',
      };

      // .strict() 应拒绝未知字段
      expect(() => sftpBaseSchema.parse(message)).toThrow();
    });
  });

  describe('sftp:readdir — path-only payload', () => {
    it('应正确验证 readdir 的 path payload', () => {
      const message = {
        type: 'sftp:readdir',
        payload: {
          path: '/home/user',
        },
        requestId: 'req-dir',
      };

      const result = sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.path).toBe('/home/user');
    });

    it('应拒绝 readdir payload 中的未知字段', () => {
      const message = {
        type: 'sftp:readdir',
        payload: {
          path: '/home/user',
          extra: 'field',
        },
        requestId: 'req-dir-strict',
      };

      expect(() => sftpBaseSchema.parse(message)).toThrow();
    });
  });

  describe('sftp:readfile — path + encoding', () => {
    it('应正确验证 readfile payload', () => {
      const message = {
        type: 'sftp:readfile',
        payload: {
          path: '/home/user/file.txt',
          encoding: 'gbk',
        },
        requestId: 'req-read',
      };

      const result = sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.path).toBe('/home/user/file.txt');
      expect(payload.encoding).toBe('gbk');
    });

    it('readfile payload 带 content 时应由 writefile schema 匹配（union 行为）', () => {
      // readfile 消息意外携带 content 字段时，z.union 会匹配到 writefile schema
      // 这是安全的 — 后端 readfile handler 只使用 path 和 encoding
      const message = {
        type: 'sftp:readfile',
        payload: {
          path: '/home/user/file.txt',
          content: 'unexpected field',
        },
        requestId: 'req-read-coerce',
      };

      const result = sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      // 由 writefile schema 匹配，path 保留
      expect(payload.path).toBe('/home/user/file.txt');
    });
  });

  describe('sftp:rename — 双路径 payload', () => {
    it('应正确验证 rename payload', () => {
      const message = {
        type: 'sftp:rename',
        payload: {
          oldPath: '/home/old.txt',
          newPath: '/home/new.txt',
        },
        requestId: 'req-rename',
      };

      const result = sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.oldPath).toBe('/home/old.txt');
      expect(payload.newPath).toBe('/home/new.txt');
    });
  });

  describe('sftp:chmod — path + mode', () => {
    it('应正确验证 chmod payload', () => {
      const message = {
        type: 'sftp:chmod',
        payload: {
          path: '/home/user/script.sh',
          mode: 0o755,
        },
        requestId: 'req-chmod',
      };

      const result = sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.path).toBe('/home/user/script.sh');
      expect(payload.mode).toBe(0o755);
    });
  });

  describe('各 SFTP 操作 payload 不应互相干扰', () => {
    const operations = [
      {
        type: 'sftp:mkdir',
        payload: { path: '/home/newdir' },
        name: 'mkdir',
      },
      {
        type: 'sftp:rmdir',
        payload: { path: '/home/olddir' },
        name: 'rmdir',
      },
      {
        type: 'sftp:unlink',
        payload: { path: '/home/file.txt' },
        name: 'unlink',
      },
      {
        type: 'sftp:stat',
        payload: { path: '/home/user' },
        name: 'stat',
      },
      {
        type: 'sftp:realpath',
        payload: { path: '/home/user/.' },
        name: 'realpath',
      },
    ];

    for (const op of operations) {
      it(`${op.name} 应通过验证`, () => {
        const message = {
          type: op.type,
          payload: op.payload,
          requestId: `req-${op.name}`,
        };

        const result = sftpBaseSchema.parse(message);
        const payload = result.payload as Record<string, unknown>;

        expect(payload.path).toBe(op.payload.path);
      });
    }
  });

  describe('messageSchemaRegistry 完整性', () => {
    it('所有 SFTP 消息类型都应注册到 registry', () => {
      const sftpTypes = [
        'sftp:readdir',
        'sftp:stat',
        'sftp:readfile',
        'sftp:writefile',
        'sftp:mkdir',
        'sftp:rmdir',
        'sftp:unlink',
        'sftp:rename',
        'sftp:chmod',
        'sftp:realpath',
        'sftp:copy',
        'sftp:move',
        'sftp:compress',
        'sftp:decompress',
      ];

      for (const type of sftpTypes) {
        expect(messageSchemaRegistry).toHaveProperty(type);
      }
    });

    it('应注册多路复用 session:close 消息类型', () => {
      expect(messageSchemaRegistry).toHaveProperty('session:close');
      const result = messageSchemaRegistry['session:close'].parse({
        type: 'session:close',
        payload: {},
      });
      expect(result.type).toBe('session:close');
    });
  });
});
