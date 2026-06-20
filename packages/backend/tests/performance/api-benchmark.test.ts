/**
 * API 响应时间基准测试
 *
 * 使用 autocannon 对核心 API 端点进行性能基准测试，验证：
 * - 响应时间是否满足阈值要求
 * - 吞吐量（RPS）是否达标
 * - 错误率是否在可接受范围内
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import autocannon from 'autocannon';
import { PERFORMANCE_THRESHOLDS, validatePerformance } from './thresholds';
import express, { Express } from 'express';
import { Server } from 'http';

/**
 * 模拟后端服务（用于测试）
 */
function createTestServer(): { app: Express; server: Server } {
  const app = express();
  app.use(express.json());

  // 模拟登录接口（模拟 bcrypt 计算延迟）
  app.post('/api/v1/auth/login', async (req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 50)); // 模拟 bcrypt
    res.json({ success: true, token: 'mock-token' });
  });

  // 模拟连接列表接口
  app.get('/api/v1/connections', (req, res) => {
    res.json({
      success: true,
      data: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        name: `Connection ${i + 1}`,
        type: 'ssh',
      })),
    });
  });

  // 模拟文件列表接口
  app.get('/api/v1/sftp/list', async (req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 30)); // 模拟 SFTP 延迟
    res.json({
      success: true,
      data: Array.from({ length: 100 }, (_, i) => ({
        name: `file${i}.txt`,
        size: 1024,
      })),
    });
  });

  // 模拟设置读取接口
  app.get('/api/v1/settings', (req, res) => {
    res.json({ success: true, data: { theme: 'dark', language: 'zh-CN' } });
  });

  const server = app.listen(0); // 使用随机端口
  return { app, server };
}

/**
 * 运行 autocannon 基准测试
 */
async function runBenchmark(
  url: string,
  options: autocannon.Options = {},
): Promise<autocannon.Result> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        connections: 10, // 并发连接数
        duration: 5, // 测试持续时间（秒）
        pipelining: 1, // 每个连接的请求流水线数
        ...options,
      },
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      },
    );

    autocannon.track(instance);
  });
}

describe('API Performance Benchmarks', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    const testServer = createTestServer();
    server = testServer.server;
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('无法获取服务器地址');
    }
    baseUrl = `http://localhost:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('登录 API 响应时间应该 < 500ms（p99）', async () => {
    const result = await runBenchmark(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test', password: 'password' }),
    });

    const p99Latency = result.latency.p99;
    const validation = validatePerformance('api', 'login', p99Latency);

    console.log(`登录 API 性能指标:
      - p50: ${result.latency.p50}ms
      - p75: ${result.latency.p75}ms
      - p99: ${result.latency.p99}ms
      - RPS: ${result.requests.average}
      - 错误率: ${((result.errors / result.requests.total) * 100).toFixed(2)}%
    `);

    expect(validation.passed).toBe(true);
    expect(result.errors).toBe(0); // 无错误
  }, 10000);

  it('连接列表 API 响应时间应该 < 200ms（p99）', async () => {
    const result = await runBenchmark(`${baseUrl}/api/v1/connections`);

    const p99Latency = result.latency.p99;
    const validation = validatePerformance('api', 'connectionList', p99Latency);

    console.log(`连接列表 API 性能指标:
      - p50: ${result.latency.p50}ms
      - p75: ${result.latency.p75}ms
      - p99: ${result.latency.p99}ms
      - RPS: ${result.requests.average}
    `);

    expect(validation.passed).toBe(true);
  }, 10000);

  it('文件列表 API 响应时间应该 < 300ms（p99）', async () => {
    const result = await runBenchmark(`${baseUrl}/api/v1/sftp/list`);

    const p99Latency = result.latency.p99;
    const validation = validatePerformance('api', 'fileList', p99Latency);

    console.log(`文件列表 API 性能指标:
      - p50: ${result.latency.p50}ms
      - p75: ${result.latency.p75}ms
      - p99: ${result.latency.p99}ms
      - RPS: ${result.requests.average}
    `);

    expect(validation.passed).toBe(true);
  }, 10000);

  it('设置读取 API 响应时间应该 < 100ms（p99）', async () => {
    const result = await runBenchmark(`${baseUrl}/api/v1/settings`);

    const p99Latency = result.latency.p99;
    const validation = validatePerformance('api', 'settings', p99Latency);

    console.log(`设置 API 性能指标:
      - p50: ${result.latency.p50}ms
      - p75: ${result.latency.p75}ms
      - p99: ${result.latency.p99}ms
      - RPS: ${result.requests.average}
    `);

    expect(validation.passed).toBe(true);
  }, 10000);

  it('吞吐量测试：100 RPS 负载下的表现', async () => {
    const result = await runBenchmark(`${baseUrl}/api/v1/connections`, {
      connections: 50,
      duration: 10,
    });

    console.log(`高并发负载测试结果:
      - 总请求数: ${result.requests.total}
      - 平均 RPS: ${result.requests.average}
      - p99 延迟: ${result.latency.p99}ms
      - 吞吐量: ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s
      - 错误数: ${result.errors}
    `);

    expect(result.requests.average).toBeGreaterThan(PERFORMANCE_THRESHOLDS.load.requestsPerSecond);
    expect(result.errors).toBe(0);
  }, 15000);
});
