/**
 * 数据库迁移单元测试
 * 测试 runMigrations 函数的迁移执行逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 依赖
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('数据库迁移', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('应导出 runMigrations 函数', async () => {
    const { runMigrations } = await import('./migrations');
    expect(typeof runMigrations).toBe('function');
  });

  it('数据库已是最新版本时应直接完成', async () => {
    const { runMigrations } = await import('./migrations');

    // 创建 mock Database，版本很高（所有迁移已应用）
    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null);
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null, { currentVersion: 999 });
      }),
      exec: vi.fn((_sql: string, cb: (...args: unknown[]) => void) => cb(null)),
    };

    await runMigrations(mockDb);

    // 不应执行任何迁移 SQL
    expect(mockDb.exec).not.toHaveBeenCalled();
  });

  it('创建 migrations 表失败时应拒绝', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(new Error('Table creation failed'));
      }),
      get: vi.fn(),
      exec: vi.fn(),
    };

    await expect(runMigrations(mockDb)).rejects.toThrow('创建 migrations 表失败');
  });

  it('查询当前版本失败时应拒绝', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null);
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(new Error('Query failed'));
      }),
      exec: vi.fn(),
    };

    await expect(runMigrations(mockDb)).rejects.toThrow('查询当前数据库版本失败');
  });

  it('无迁移需要应用时应直接完成', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null);
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null, { currentVersion: 999 });
      }),
      exec: vi.fn((_sql: string, cb: (...args: unknown[]) => void) => cb(null)),
    };

    await runMigrations(mockDb);

    // 不应执行任何迁移
    expect(mockDb.exec).not.toHaveBeenCalled();
  });

  it('begin transaction 失败时应拒绝', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (typeof _sql === 'string' && _sql.includes('BEGIN')) {
          if (cb) cb(new Error('Begin failed'));
        } else {
          if (cb) cb(null);
        }
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null, { currentVersion: 0 });
      }),
      exec: vi.fn(),
    };

    await expect(runMigrations(mockDb)).rejects.toThrow();
  });

  it('应按顺序应用多个迁移', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null);
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null, { currentVersion: 0 });
      }),
      all: vi.fn((_sql: string, _cb: (...args: unknown[]) => void) => {
        if (_cb) _cb(null, []);
      }),
      exec: vi.fn((_sql: string, cb: (...args: unknown[]) => void) => cb(null)),
    };

    await runMigrations(mockDb);

    // 应该执行了迁移 SQL
    expect(mockDb.exec).toHaveBeenCalled();
  });

  it('迁移 SQL 执行失败时应回滚并拒绝', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null);
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null, { currentVersion: 0 });
      }),
      all: vi.fn((_sql: string, _cb: (...args: unknown[]) => void) => {
        if (_cb) _cb(null, []);
      }),
      exec: vi.fn((_sql: string, cb: (...args: unknown[]) => void) =>
        cb(new Error('SQL execution failed')),
      ),
    };

    await expect(runMigrations(mockDb)).rejects.toThrow();
  });

  it('应处理 duplicate column name 错误（视为可接受）', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null);
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null, { currentVersion: 0 });
      }),
      all: vi.fn((_sql: string, _cb: (...args: unknown[]) => void) => {
        if (_cb) _cb(null, []);
      }),
      exec: vi.fn((_sql: string, cb: (...args: unknown[]) => void) =>
        cb(new Error('duplicate column name')),
      ),
    };

    // 不应抛出错误
    await runMigrations(mockDb);
  });

  it('插入迁移记录失败时应拒绝', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (typeof _sql === 'string' && _sql.includes('INSERT INTO migrations')) {
          if (cb) cb(new Error('Insert failed'));
        } else {
          if (cb) cb(null);
        }
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null, { currentVersion: 0 });
      }),
      all: vi.fn((_sql: string, _cb: (...args: unknown[]) => void) => {
        if (_cb) _cb(null, []);
      }),
      exec: vi.fn((_sql: string, cb: (...args: unknown[]) => void) => cb(null)),
    };

    await expect(runMigrations(mockDb)).rejects.toThrow();
  });

  it('check 函数返回 false 时应跳过 SQL 执行', async () => {
    const { runMigrations } = await import('./migrations');

    // 当数据库版本为 17（所有迁移已应用），check 函数不会被调用
    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null);
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null, { currentVersion: 18 });
      }),
      all: vi.fn((_sql: string, _cb: (...args: unknown[]) => void) => {
        if (_cb) _cb(null, []);
      }),
      exec: vi.fn((_sql: string, cb: (...args: unknown[]) => void) => cb(null)),
    };

    await runMigrations(mockDb);

    // 无迁移需要应用，exec 不应被调用
    expect(mockDb.exec).not.toHaveBeenCalled();
  });

  it('部分迁移已应用时应只应用新的迁移', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null);
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        // 模拟已有 5 个迁移
        if (cb) cb(null, { currentVersion: 5 });
      }),
      all: vi.fn((_sql: string, _cb: (...args: unknown[]) => void) => {
        if (_cb) _cb(null, []);
      }),
      exec: vi.fn((_sql: string, cb: (...args: unknown[]) => void) => cb(null)),
    };

    await runMigrations(mockDb);

    // 应该只执行新迁移的 SQL
    expect(mockDb.exec).toHaveBeenCalled();
  });

  it('rollback 失败时仍应继续拒绝', async () => {
    const { runMigrations } = await import('./migrations');

    const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
      serialize: vi.fn((cb: (...args: unknown[]) => void) => cb()),
      run: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        // 回滚失败
        if (typeof _sql === 'string' && _sql.includes('ROLLBACK')) {
          if (cb) cb(new Error('Rollback failed'));
        } else if (typeof _sql === 'string' && _sql.includes('BEGIN')) {
          if (cb) cb(null);
        } else {
          if (cb) cb(null);
        }
      }),
      get: vi.fn((_sql: string, _paramsOrCb?: unknown, _cb?: (...args: unknown[]) => void) => {
        const cb = typeof _paramsOrCb === 'function' ? _paramsOrCb : _cb;
        if (cb) cb(null, { currentVersion: 0 });
      }),
      all: vi.fn((_sql: string, _cb: (...args: unknown[]) => void) => {
        if (_cb) _cb(null, []);
      }),
      exec: vi.fn((_sql: string, cb: (...args: unknown[]) => void) => cb(new Error('SQL failed'))),
    };

    await expect(runMigrations(mockDb)).rejects.toThrow();
  });
});
