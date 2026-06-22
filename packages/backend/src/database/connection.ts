import sqlite3 from 'sqlite3';
import fs from 'fs';
import { runMigrations } from './migrations'; // +++ Import runMigrations +++
import { getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';
import { DB_DIR, DB_PATH } from '../config/paths';

// SQLite 性能优化常量
const SQLITE_CACHE_SIZE_KB = 64_000; // 64MB 内存缓存（负值表示 KB）
const SQLITE_MMAP_SIZE_BYTES = 268_435_456; // 256MB 内存映射 I/O
const SQLITE_BUSY_TIMEOUT_MS = 5000; // 写入锁等待超时 5 秒，防止 SQLITE_BUSY

const dbDir = DB_DIR;
const dbPath = DB_PATH;

if (!fs.existsSync(dbDir)) {
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch (mkdirErr: unknown) {
    const mkdirErrMsg = getErrorMessage(mkdirErr);
    logger.error(`[数据库文件系统] 创建目录 ${dbDir} 失败:`, mkdirErrMsg);
    throw new Error(`创建数据库目录失败: ${mkdirErrMsg}`);
  }
} else {
}

const verboseSqlite3 = sqlite3.verbose();
let dbInstancePromise: Promise<sqlite3.Database> | null = null;

interface RunResult {
  lastID: number;
  changes: number;
}

export const runDb = (
  db: sqlite3.Database,
  sql: string,
  params: unknown[] = [],
): Promise<RunResult> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runDbCallback(this: RunResult, err: Error | null) {
      if (err) {
        logger.error(`[数据库错误] SQL: ${sql.substring(0, 100)}... 错误: ${err.message}`);
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
};

export const getDb = <T = unknown>(
  db: sqlite3.Database,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err: Error | null, row: T) => {
      if (err) {
        logger.error(`[数据库错误] SQL: ${sql.substring(0, 100)}... 错误: ${err.message}`);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

export const allDb = <T = unknown>(
  db: sqlite3.Database,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      if (err) {
        logger.error(`[数据库错误] SQL: ${sql.substring(0, 100)}... 错误: ${err.message}`);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

const runDatabaseInitializations = async (db: sqlite3.Database): Promise<void> => {
  const { tableDefinitions } = await import('./schema.registry.js');

  // SQLite 性能优化配置（必须在事务外执行）
  // WAL 模式：提升并发读写性能 2-3 倍
  await runDb(db, 'PRAGMA journal_mode = WAL;');
  // NORMAL 同步模式：平衡安全性与性能
  await runDb(db, 'PRAGMA synchronous = NORMAL;');
  // 内存缓存（负值表示 KB 单位）
  await runDb(db, `PRAGMA cache_size = -${SQLITE_CACHE_SIZE_KB};`);
  // 临时表使用内存存储
  await runDb(db, 'PRAGMA temp_store = MEMORY;');
  // 启用内存映射 I/O
  await runDb(db, `PRAGMA mmap_size = ${SQLITE_MMAP_SIZE_BYTES};`);
  // 启用外键约束
  await runDb(db, 'PRAGMA foreign_keys = ON;');
  // 写入锁等待超时，防止并发写入时 SQLITE_BUSY 错误
  await runDb(db, `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);

  logger.debug('[DB Init] SQLite 性能优化配置已应用 (WAL模式, 64MB缓存, busy_timeout=5s)');

  // 开始事务（用于表创建）
  await new Promise<void>((resolveTx, rejectTx) => {
    db.run('BEGIN TRANSACTION', (beginErr) => {
      if (beginErr) {
        logger.error('[DB Init] 开始数据库初始化事务失败:', beginErr);
        rejectTx(new Error(`开始数据库初始化事务失败: ${beginErr.message}`));
      } else {
        resolveTx();
      }
    });
  });

  try {
    for (const tableDef of tableDefinitions) {
      await runDb(db, tableDef.sql);
      if (tableDef.init) {
        await tableDef.init(db);
      }
    }

    // 提交事务
    await new Promise<void>((resolveCommit, rejectCommit) => {
      db.run('COMMIT', (commitErr) => {
        if (commitErr) {
          logger.error('[DB Init] 提交数据库初始化事务失败:', commitErr);
          rejectCommit(commitErr);
        } else {
          logger.debug('[DB Init] 数据库初始化事务提交成功');
          resolveCommit();
        }
      });
    });
  } catch (error: unknown) {
    // 回滚事务
    await new Promise<void>((resolveRollback) => {
      db.run('ROLLBACK', (rollbackErr) => {
        if (rollbackErr) {
          logger.error('[DB Init] 回滚数据库初始化事务失败:', rollbackErr);
        }
        logger.error('[DB Init] 数据库初始化序列失败，已回滚事务:', error);
        resolveRollback();
      });
    });
    throw error;
  }
};

export const getDbInstance = (): Promise<sqlite3.Database> => {
  if (!dbInstancePromise) {
    dbInstancePromise = new Promise((resolve, reject) => {
      const db = new verboseSqlite3.Database(
        dbPath,
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
        async (err) => {
          // Mark callback as async

          if (err) {
            logger.error(`[数据库连接] 打开数据库文件 ${dbPath} 时出错:`, err.message);
            dbInstancePromise = null;
            reject(err);
            return;
          }

          try {
            // 运行初始表创建
            await runDatabaseInitializations(db);
            // +++ 运行数据库迁移 +++
            await runMigrations(db);
            logger.info('[数据库] 初始化和迁移完成。');
            resolve(db);
          } catch (initError: unknown) {
            logger.error('[数据库] 连接后初始化失败，正在关闭连接...');
            dbInstancePromise = null;
            db.close((closeErr) => {
              if (closeErr) logger.error('[数据库] 初始化失败后关闭连接时出错:', closeErr.message);
              reject(initError);
            });
          }
        },
      );
    });
  }
  return dbInstancePromise;
};

process.on('SIGINT', async () => {
  if (dbInstancePromise) {
    logger.info('[DB] 收到 SIGINT，尝试关闭数据库连接...');
    try {
      const db = await dbInstancePromise;
      db.close((err) => {
        if (err) {
          logger.error('[DB] 关闭数据库时出错:', err.message);
        } else {
          logger.info('[DB] 数据库连接已关闭。');
        }
        process.exit(err ? 1 : 0);
      });
    } catch (error: unknown) {
      logger.error('[DB] 获取数据库实例以关闭时出错 (可能初始化失败):', error);
      process.exit(1);
    }
  } else {
    logger.info('[DB] 收到 SIGINT，但数据库连接从未初始化或已失败。');
    process.exit(0);
  }
});
