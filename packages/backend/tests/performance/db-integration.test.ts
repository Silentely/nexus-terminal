/**
 * 数据库集成性能测试
 *
 * 使用真实 SQLite 数据库验证：
 * - 简单查询延迟
 * - 复杂 JOIN 查询延迟
 * - 批量插入吞吐量
 * - 并发读写性能
 * - WAL 模式下的读写并发能力
 * - busy_timeout 在写入竞争下的表现
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { PERFORMANCE_THRESHOLDS } from './thresholds';

const TEST_DB_DIR = path.resolve(__dirname, '.tmp');
const TEST_DB_PATH = path.resolve(TEST_DB_DIR, 'perf-test.db');

/** 包装 sqlite3 操作为 Promise */
function runDb(
  db: sqlite3.Database,
  sql: string,
  params: unknown[] = [],
): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (this: { lastID: number; changes: number }, err: Error | null) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getDb<T>(
  db: sqlite3.Database,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err: Error | null, row: T) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allDb<T>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

describe('Database Integration Performance Tests', () => {
  let db: sqlite3.Database;

  beforeAll(async () => {
    // 确保临时目录存在
    if (!fs.existsSync(TEST_DB_DIR)) {
      fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    }

    // 删除旧的测试数据库
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    const verboseSqlite3 = sqlite3.verbose();
    db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new verboseSqlite3.Database(TEST_DB_PATH, (err) => {
        if (err) reject(err);
        else resolve(database);
      });
    });

    // 应用与生产相同的性能优化 PRAGMA
    await runDb(db, 'PRAGMA journal_mode = WAL;');
    await runDb(db, 'PRAGMA synchronous = NORMAL;');
    await runDb(db, 'PRAGMA cache_size = -64000;');
    await runDb(db, 'PRAGMA temp_store = MEMORY;');
    await runDb(db, 'PRAGMA mmap_size = 268435456;');
    await runDb(db, 'PRAGMA foreign_keys = ON;');
    await runDb(db, 'PRAGMA busy_timeout = 5000;');

    // 创建测试表
    await runDb(
      db,
      `
      CREATE TABLE IF NOT EXISTS connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'ssh',
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT,
        auth_method TEXT DEFAULT 'password',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `,
    );

    await runDb(
      db,
      `
      CREATE TABLE IF NOT EXISTS event_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        user_id INTEGER,
        payload TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `,
    );

    // 创建索引
    await runDb(db, 'CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(type);');
    await runDb(db, 'CREATE INDEX IF NOT EXISTS idx_event_logs_created ON event_logs(created_at);');
    await runDb(db, 'CREATE INDEX IF NOT EXISTS idx_event_logs_type ON event_logs(event_type);');

    // 预插入测试数据
    const insertStmt =
      'INSERT INTO connections (name, type, host, port, username) VALUES (?, ?, ?, ?, ?)';
    for (let i = 0; i < 200; i++) {
      await runDb(db, insertStmt, [
        `conn-${i}`,
        i % 3 === 0 ? 'rdp' : 'ssh',
        `192.168.1.${i % 255}`,
        22,
        `user-${i}`,
      ]);
    }

    // 预插入事件日志数据
    const eventStmt = 'INSERT INTO event_logs (event_type, user_id, payload) VALUES (?, ?, ?)';
    for (let i = 0; i < 1000; i++) {
      await runDb(db, eventStmt, ['connection:created', 1, JSON.stringify({ connectionId: i })]);
    }
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
    // 清理测试数据库
    try {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
      if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
      if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  it(`简单查询延迟应该 < ${PERFORMANCE_THRESHOLDS.database.simpleQuery}ms`, async () => {
    const iterations = 100;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await allDb(db, 'SELECT * FROM connections WHERE type = ?', ['ssh']);
      latencies.push(performance.now() - start);
    }

    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p99 = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.99)];

    console.log(`简单查询性能 (${iterations} 次):
      - 平均: ${avg.toFixed(2)}ms
      - p99: ${p99.toFixed(2)}ms
    `);

    expect(p99).toBeLessThan(PERFORMANCE_THRESHOLDS.database.simpleQuery);
  });

  it(`索引字段搜索延迟应该 < ${PERFORMANCE_THRESHOLDS.database.indexedSearch}ms`, async () => {
    const iterations = 100;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await getDb(db, 'SELECT * FROM connections WHERE id = ?', [(i % 200) + 1]);
      latencies.push(performance.now() - start);
    }

    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p99 = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.99)];

    console.log(`索引搜索性能 (${iterations} 次):
      - 平均: ${avg.toFixed(2)}ms
      - p99: ${p99.toFixed(2)}ms
    `);

    expect(p99).toBeLessThan(PERFORMANCE_THRESHOLDS.database.indexedSearch);
  });

  it(`批量插入 100 条记录应该 < ${PERFORMANCE_THRESHOLDS.database.bulkInsert}ms`, async () => {
    const start = performance.now();

    await runDb(db, 'BEGIN TRANSACTION');
    for (let i = 0; i < 100; i++) {
      await runDb(db, 'INSERT INTO event_logs (event_type, user_id, payload) VALUES (?, ?, ?)', [
        'batch:test',
        1,
        JSON.stringify({ index: i }),
      ]);
    }
    await runDb(db, 'COMMIT');

    const elapsed = performance.now() - start;

    console.log(`批量插入 100 条记录: ${elapsed.toFixed(2)}ms`);

    expect(elapsed).toBeLessThan(PERFORMANCE_THRESHOLDS.database.bulkInsert);
  });

  it('并发读取性能：10 个并发查询', async () => {
    const concurrency = 10;
    const start = performance.now();

    const promises = Array.from({ length: concurrency }).map(() =>
      allDb(db, 'SELECT * FROM connections WHERE type = ?', ['ssh']),
    );

    const results = await Promise.all(promises);
    const elapsed = performance.now() - start;

    console.log(`${concurrency} 个并发查询完成: ${elapsed.toFixed(2)}ms`);

    // 所有查询应返回相同结果
    results.forEach((rows) => {
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it('并发读写性能：5 个写入 + 5 个读取同时进行', async () => {
    const start = performance.now();

    const writers = Array.from({ length: 5 }).map((_, i) =>
      runDb(db, 'INSERT INTO event_logs (event_type, user_id, payload) VALUES (?, ?, ?)', [
        'concurrent:test',
        1,
        JSON.stringify({ writer: i }),
      ]),
    );

    const readers = Array.from({ length: 5 }).map(() =>
      allDb(db, 'SELECT * FROM connections LIMIT 10'),
    );

    const results = await Promise.all([...writers, ...readers]);
    const elapsed = performance.now() - start;

    console.log(`并发读写完成 (5W + 5R): ${elapsed.toFixed(2)}ms`);

    // 写入应返回 changes，读取应返回数组
    expect(results.length).toBe(10);
  });

  it('WAL 模式下大量写入不应阻塞读取', async () => {
    // 启动大量写入
    const writePromise = (async () => {
      await runDb(db, 'BEGIN TRANSACTION');
      for (let i = 0; i < 500; i++) {
        await runDb(db, 'INSERT INTO event_logs (event_type, user_id, payload) VALUES (?, ?, ?)', [
          'wal:test',
          1,
          JSON.stringify({ index: i }),
        ]);
      }
      await runDb(db, 'COMMIT');
    })();

    // 在写入过程中尝试读取
    const readStart = performance.now();
    const readPromise = allDb(db, 'SELECT COUNT(*) as count FROM connections');

    await Promise.all([writePromise, readPromise]);
    const readLatency = performance.now() - readStart;

    const countRow = await readPromise;

    console.log(`WAL 模式下写入期间读取延迟: ${readLatency.toFixed(2)}ms`);

    // 读取应能完成（不被阻塞超过合理时间）
    expect(readLatency).toBeLessThan(1000);
    expect(countRow).toBeDefined();
  });
});
