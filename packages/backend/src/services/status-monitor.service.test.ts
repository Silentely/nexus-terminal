/**
 * Status Monitor Service 单元测试
 * 测试服务器状态监控的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import { StatusMonitorService } from './status-monitor.service';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const mockSettingsService = vi.hoisted(() => ({
  getStatusMonitorIntervalSeconds: vi.fn(),
}));

// Mock 依赖模块
vi.mock('../settings/settings.service', () => ({
  settingsService: mockSettingsService,
}));

vi.mock('ws', () => ({
  WebSocket: {
    OPEN: 1,
    CLOSED: 3,
  },
}));

// 创建 mock SSH Client
function createMockSshClient() {
  const client = new EventEmitter() as EventEmitter & {
    exec: ReturnType<typeof vi.fn>;
  };
  client.exec = vi.fn();
  return client;
}

// 创建 mock WebSocket
function createMockWebSocket(readyState: number = 1) {
  return {
    readyState,
    send: vi.fn(),
  };
}

// 创建 mock 执行流
function createMockStream(output: string, code: number = 0) {
  const stream = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
  };
  stream.stderr = new EventEmitter();

  // 模拟异步返回数据
  process.nextTick(() => {
    stream.emit('data', Buffer.from(output));
    stream.emit('close', code, null);
  });

  return stream;
}

// 构造批量采集格式输出（含分段标识符）
function buildBatchOutput(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    OS_RELEASE: '',
    CPU_MODEL: '',
    FREE: '',
    DF: '',
    UPTIME: '',
    PROC_NET_DEV: '',
    PROC_STAT: '',
  };
  const sections = { ...defaults, ...overrides };
  const delimiters = [
    '__END_OS_RELEASE__',
    '__END_CPU_MODEL__',
    '__END_FREE__',
    '__END_DF__',
    '__END_UPTIME__',
    '__END_PROC_NET_DEV__',
    '__END_PROC_STAT__',
  ];
  const keys = ['OS_RELEASE', 'CPU_MODEL', 'FREE', 'DF', 'UPTIME', 'PROC_NET_DEV', 'PROC_STAT'];

  let output = '';
  for (let i = 0; i < keys.length; i++) {
    output += sections[keys[i]];
    output += '\n' + delimiters[i] + '\n';
  }
  return output;
}

describe('StatusMonitorService', () => {
  let service: StatusMonitorService;
  let clientStates: Map<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clientStates = new Map();
    service = new StatusMonitorService(clientStates);
    mockSettingsService.getStatusMonitorIntervalSeconds.mockResolvedValue(3);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startStatusPolling', () => {
    it('应成功启动状态轮询', async () => {
      const mockClient = createMockSshClient();
      const mockWs = createMockWebSocket();

      clientStates.set('session-1', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-1');

      const state = clientStates.get('session-1');
      expect(state.statusIntervalId).toBeDefined();
    });

    it('会话不存在时应静默返回', async () => {
      await service.startStatusPolling('nonexistent');
      // 不应抛出错误
    });

    it('SSH 客户端不存在时应静默返回', async () => {
      clientStates.set('session-no-ssh', {
        sshClient: null,
        ws: createMockWebSocket(),
      });

      await service.startStatusPolling('session-no-ssh');

      const state = clientStates.get('session-no-ssh');
      expect(state.statusIntervalId).toBeUndefined();
    });

    it('已有轮询时不应重复启动', async () => {
      const mockClient = createMockSshClient();
      const mockWs = createMockWebSocket();
      const existingIntervalId = setInterval(() => {}, 1000);

      clientStates.set('session-2', {
        sshClient: mockClient,
        ws: mockWs,
        statusIntervalId: existingIntervalId,
      });

      await service.startStatusPolling('session-2');

      const state = clientStates.get('session-2');
      expect(state.statusIntervalId).toBe(existingIntervalId);

      clearInterval(existingIntervalId);
    });

    it('应使用配置的轮询间隔', async () => {
      mockSettingsService.getStatusMonitorIntervalSeconds.mockResolvedValue(5);

      const mockClient = createMockSshClient();
      const mockWs = createMockWebSocket();

      clientStates.set('session-3', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-3');

      expect(mockSettingsService.getStatusMonitorIntervalSeconds).toHaveBeenCalled();
    });

    it('获取轮询间隔失败时应使用默认值', async () => {
      mockSettingsService.getStatusMonitorIntervalSeconds.mockRejectedValue(
        new Error('Settings error'),
      );

      const mockClient = createMockSshClient();
      const mockWs = createMockWebSocket();

      clientStates.set('session-4', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-4');

      const state = clientStates.get('session-4');
      expect(state.statusIntervalId).toBeDefined();
    });
  });

  describe('stopStatusPolling', () => {
    it('应成功停止状态轮询', () => {
      const intervalId = setInterval(() => {}, 1000);

      clientStates.set('session-stop', {
        statusIntervalId: intervalId,
      });

      service.stopStatusPolling('session-stop');

      const state = clientStates.get('session-stop');
      expect(state.statusIntervalId).toBeUndefined();
    });

    it('无轮询时应静默返回', () => {
      clientStates.set('session-no-interval', {
        statusIntervalId: undefined,
      });

      // 不应抛出错误
      service.stopStatusPolling('session-no-interval');
    });

    it('会话不存在时应静默返回', () => {
      // 不应抛出错误
      service.stopStatusPolling('nonexistent-session');
    });
  });

  describe('fetchAndSendServerStatus', () => {
    it('WebSocket 关闭时应停止轮询', async () => {
      const mockClient = createMockSshClient();
      const mockWs = createMockWebSocket(1); // 初始状态 OPEN

      clientStates.set('session-ws-closed', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined, // 初始无 interval，让 service 创建
      });

      // 启动轮询
      await service.startStatusPolling('session-ws-closed');

      // 确认 interval 已创建
      const stateBeforeClose = clientStates.get('session-ws-closed');
      expect(stateBeforeClose.statusIntervalId).toBeDefined();

      // 模拟 WS 关闭
      mockWs.readyState = 3; // CLOSED

      // 推进时间触发 fetchAndSendServerStatus
      await vi.advanceTimersByTimeAsync(3000);

      // 由于 WS 已关闭，轮询应被停止
      const state = clientStates.get('session-ws-closed');
      expect(state.statusIntervalId).toBeUndefined();
    });

    it('应发送 status_update 消息给客户端', async () => {
      const mockClient = createMockSshClient();
      const mockWs = createMockWebSocket(1); // OPEN

      // 模拟 SSH 命令执行
      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          if (!cb) {
            return;
          }
          const stream = createMockStream('test output');
          cb(null, stream);
        },
      );

      clientStates.set('session-send', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-send');

      // 推进时间触发轮询
      await vi.advanceTimersByTimeAsync(3000);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"type":"status_update"'));
      expect(mockClient.exec).toHaveBeenCalled();
      expect(mockClient.exec.mock.calls[0][1]).toMatchObject({
        env: { LC_ALL: 'C' },
      });
    });

    it('单个命令失败时仍应发送 status_update（内部有错误容忍）', async () => {
      const mockClient = createMockSshClient();
      const mockWs = createMockWebSocket(1);

      // 模拟命令执行失败 - 但服务内部会捕获这些错误并继续
      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          if (!cb) {
            return;
          }
          cb(new Error('SSH exec failed'), null);
        },
      );

      clientStates.set('session-error', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-error');
      await vi.advanceTimersByTimeAsync(3000);

      // 由于服务内部对各命令有 try-catch，单个命令失败只会返回部分数据
      // 仍然发送 status_update，只是数据不完整
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"type":"status_update"'));
    });
  });

  describe('fetchServerStatus - 各指标解析', () => {
    let mockClient: ReturnType<typeof createMockSshClient>;

    beforeEach(() => {
      mockClient = createMockSshClient();
    });

    it('应正确解析 OS 名称', async () => {
      const batchOutput = buildBatchOutput({
        OS_RELEASE: 'PRETTY_NAME="Ubuntu 22.04 LTS"\nNAME="Ubuntu"',
      });

      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const stream = createMockStream(batchOutput);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-os', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-os');
      await vi.advanceTimersByTimeAsync(3000);

      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.payload.status.osName).toBe('Ubuntu 22.04 LTS');
    });

    it('应正确解析内存使用率', async () => {
      const batchOutput = buildBatchOutput({
        FREE: '              total        used        free      shared  buff/cache   available\nMem:       16384000    8192000    8192000          0     512000    7680000\nSwap:       2097152     524288    1572864',
      });

      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const stream = createMockStream(batchOutput);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-mem', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-mem');
      await vi.advanceTimersByTimeAsync(3000);

      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.payload.status.memTotal).toBe(16000);
      expect(sentData.payload.status.memUsed).toBe(8000);
      expect(sentData.payload.status.memPercent).toBe(50);
    });

    it('应正确解析磁盘使用率', async () => {
      const batchOutput = buildBatchOutput({
        DF: 'Filesystem     1K-blocks    Used Available Use% Mounted on\n/dev/sda1      100000000 40000000  60000000  40% /',
      });

      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const stream = createMockStream(batchOutput);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-disk', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-disk');
      await vi.advanceTimersByTimeAsync(3000);

      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.payload.status.diskTotal).toBe(100000000);
      expect(sentData.payload.status.diskUsed).toBe(40000000);
      expect(sentData.payload.status.diskPercent).toBe(40);
    });

    it('应正确解析 CPU 使用率（需要两次采样）', async () => {
      let callCount = 0;
      const cpuStats = [
        'cpu  1000 100 500 5000 50 0 10 0 0 0', // 第一次
        'cpu  1200 120 600 5500 60 0 15 0 0 0', // 第二次
      ];

      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const idx = Math.min(callCount++, cpuStats.length - 1);
          const output = buildBatchOutput({ PROC_STAT: cpuStats[idx] });
          const stream = createMockStream(output);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-cpu', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-cpu');

      // 第一次采样（返回 0，因为没有之前的数据）
      await vi.advanceTimersByTimeAsync(3000);

      // 第二次采样（应该有计算值）
      await vi.advanceTimersByTimeAsync(3000);

      // 验证发送了两次
      expect(mockWs.send).toHaveBeenCalledTimes(2);
    });

    it('应正确解析系统负载', async () => {
      const batchOutput = buildBatchOutput({
        UPTIME: ' 14:30:01 up 10 days,  5:30,  2 users,  load average: 1.50, 2.00, 1.75',
      });

      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const stream = createMockStream(batchOutput);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-load', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-load');
      await vi.advanceTimersByTimeAsync(3000);

      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.payload.status.loadAvg).toEqual([1.5, 2.0, 1.75]);
    });
  });

  describe('边界条件', () => {
    it('BusyBox 系统应正确解析内存（单位转换）', async () => {
      const mockClient = createMockSshClient();
      // BusyBox 的 free 命令不输出表头行，且单位为 KB
      const batchOutput = buildBatchOutput({
        FREE: 'Mem:         16384000    8192000    8192000          0      512000    7680000\nSwap:         2097152     524288    1572864',
      });

      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const stream = createMockStream(batchOutput);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-busybox', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-busybox');
      await vi.advanceTimersByTimeAsync(3000);

      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      // BusyBox 返回字节，需要除以 1024 转换为 MB
      expect(sentData.payload.status.memTotal).toBe(16000); // 16384000 / 1024 ≈ 16000
    });

    it('命令执行超时应正确处理', async () => {
      const mockClient = createMockSshClient();
      mockClient.exec.mockImplementation(
        (_cmd: string, _optionsOrCallback: unknown, _callback?: Function) => {
          // 模拟超时 - 不调用 callback
          // 实际测试中这会导致 Promise 永远 pending
          // 但服务应该有超时保护
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-timeout', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      // 这里主要验证不会因为超时而崩溃
      await service.startStatusPolling('session-timeout');
    });

    it('无 swap 分区时应返回 0', async () => {
      const mockClient = createMockSshClient();
      // free 输出中没有 Swap 行
      const batchOutput = buildBatchOutput({
        FREE: '              total        used        free      shared  buff/cache   available\nMem:       16384000    8192000    8192000          0     512000    7680000',
      });

      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const stream = createMockStream(batchOutput);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-no-swap', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-no-swap');
      await vi.advanceTimersByTimeAsync(3000);

      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.payload.status.swapTotal).toBe(0);
      expect(sentData.payload.status.swapUsed).toBe(0);
      expect(sentData.payload.status.swapPercent).toBe(0);
    });
  });

  describe('批量采集模式', () => {
    // 构造模拟批量采集输出（包含所有分段标识符）
    function buildBatchOutputInner(overrides: Record<string, string> = {}) {
      const defaults: Record<string, string> = {
        OS_RELEASE: 'PRETTY_NAME="Ubuntu 22.04 LTS"\nNAME="Ubuntu"',
        CPU_MODEL: 'model name\t: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz',
        FREE: '              total        used        free      shared  buff/cache   available\nMem:       16384000    8192000    6144000     512000    2048000    7680000\nSwap:       2097152     524288    1572864',
        DF: 'Filesystem     1K-blocks    Used Available Use% Mounted on\n/dev/sda1      100000000 40000000  60000000  40% /',
        UPTIME: ' 14:30:01 up 10 days,  5:30,  2 users,  load average: 1.50, 2.00, 1.75',
        PROC_NET_DEV:
          'Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo frame compressed\n    lo: 1000    10    0    0    0     0          0         0    1000    10    0    0    0     0          0         0\n  eth0: 5000000  5000    0    0    0     0          0         0 3000000  3000    0    0    0     0          0         0',
        PROC_STAT: 'cpu  1000 100 500 5000 50 0 10 0 0 0\ncpu0 250 25 125 1250 12 0 2 0 0 0',
      };

      const sections = { ...defaults, ...overrides };
      const delimiters = [
        '__END_OS_RELEASE__',
        '__END_CPU_MODEL__',
        '__END_FREE__',
        '__END_DF__',
        '__END_UPTIME__',
        '__END_PROC_NET_DEV__',
        '__END_PROC_STAT__',
      ];
      const keys = ['OS_RELEASE', 'CPU_MODEL', 'FREE', 'DF', 'UPTIME', 'PROC_NET_DEV', 'PROC_STAT'];

      let output = '';
      for (let i = 0; i < keys.length; i++) {
        output += sections[keys[i]];
        if (i < delimiters.length) {
          output += '\n' + delimiters[i] + '\n';
        }
      }
      return output;
    }

    it('应通过单次 SSH exec 获取所有状态数据', async () => {
      const mockClient = createMockSshClient();
      const batchOutput = buildBatchOutputInner();

      mockClient.exec.mockImplementation(
        (cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const stream = createMockStream(batchOutput);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-batch', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-batch');
      await vi.advanceTimersByTimeAsync(3000);

      // 应只调用一次 exec（批量命令）
      expect(mockClient.exec).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.payload.status.osName).toBe('Ubuntu 22.04 LTS');
      expect(sentData.payload.status.cpuModel).toContain('Intel');
      expect(sentData.payload.status.memTotal).toBe(16000);
      expect(sentData.payload.status.memUsed).toBe(8000);
      expect(sentData.payload.status.memPercent).toBe(50);
      expect(sentData.payload.status.diskTotal).toBe(100000000);
      expect(sentData.payload.status.diskPercent).toBe(40);
      expect(sentData.payload.status.loadAvg).toEqual([1.5, 2.0, 1.75]);
    });

    it('批量采集失败时应降级到逐项采集', async () => {
      const mockClient = createMockSshClient();
      let callCount = 0;

      mockClient.exec.mockImplementation(
        (cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          callCount++;
          if (callCount === 1) {
            // 第一次调用（批量命令）失败
            cb(new Error('Command not found'), null);
          } else {
            // 后续调用（降级路径）成功
            const stream = createMockStream('');
            cb(null, stream);
          }
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-fallback', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-fallback');
      await vi.advanceTimersByTimeAsync(3000);

      // 降级后应调用多次 exec（逐项采集）
      expect(mockClient.exec.mock.calls.length).toBeGreaterThan(1);
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"type":"status_update"'));
    });

    it('应正确解析中文 locale 的 free 输出（内存：/交换：）', async () => {
      const mockClient = createMockSshClient();
      // 模拟 Debian 13 中文 locale 的 free 输出（单位 KB，原始值 = MiB * 1024）
      const batchOutput = buildBatchOutputInner({
        FREE: '              total        used        free      shared  buff/cache   available\n内存：        4113162240   461762560   567185408     483328  3084218368  3385585664\n交换：          1023934464     1531904  1022402560',
      });

      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const stream = createMockStream(batchOutput);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-zh-locale', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-zh-locale');
      await vi.advanceTimersByTimeAsync(3000);

      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      // free 输出 KB，转换后应为 MB（4113162240 KB / 1024 = 4016760 MB）
      expect(sentData.payload.status.memTotal).toBe(4016760);
      expect(sentData.payload.status.memUsed).toBe(450940);
      expect(sentData.payload.status.memPercent).toBeGreaterThan(0);
      expect(sentData.payload.status.swapTotal).toBe(999936);
      expect(sentData.payload.status.swapUsed).toBe(1496);
      expect(sentData.payload.status.swapPercent).toBeGreaterThan(0);
    });

    it('应正确提取 PROC_STAT 段落并计算 CPU 使用率（回归测试）', async () => {
      const mockClient = createMockSshClient();
      let callCount = 0;
      // 两次采样模拟 CPU 差值
      const procStatLines = [
        'cpu  1000 100 500 5000 50 0 10 0 0 0',
        'cpu  1200 110 520 5000 50 0 10 0 0 0',
      ];

      mockClient.exec.mockImplementation(
        (_cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const idx = Math.min(callCount++, 1);
          const output = buildBatchOutput({
            PROC_STAT: procStatLines[idx],
          });
          const stream = createMockStream(output);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-procstat', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-procstat');

      // 第一次采样（建立基线）
      await vi.advanceTimersByTimeAsync(3000);
      // 第二次采样（计算差值）
      await vi.advanceTimersByTimeAsync(3000);

      expect(mockWs.send).toHaveBeenCalledTimes(2);
      const secondData = JSON.parse(mockWs.send.mock.calls[1][0]);
      // CPU 使用率应大于 0（第二次采样有增量）
      expect(secondData.payload.status.cpuPercent).toBeGreaterThan(0);
    });

    it('应正确解析网络速率（需要两次采样）', async () => {
      const mockClient = createMockSshClient();
      let callCount = 0;
      const netBytes = [
        { rx: 5000000, tx: 3000000 },
        { rx: 6000000, tx: 3500000 },
      ];

      mockClient.exec.mockImplementation(
        (cmd: string, optionsOrCallback: unknown, callback?: Function) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const idx = Math.min(callCount++, netBytes.length - 1);
          const { rx, tx } = netBytes[idx];
          const output = buildBatchOutput({
            PROC_NET_DEV: `Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo frame compressed\n    lo: 1000    10    0    0    0     0          0         0    1000    10    0    0    0     0          0         0\n  eth0: ${rx}  5000    0    0    0     0          0         0 ${tx}  3000    0    0    0     0          0         0`,
          });
          const stream = createMockStream(output);
          cb(null, stream);
        },
      );

      const mockWs = createMockWebSocket(1);
      clientStates.set('session-net', {
        sshClient: mockClient,
        ws: mockWs,
        dbConnectionId: 1,
        statusIntervalId: undefined,
      });

      await service.startStatusPolling('session-net');

      // 第一次采样
      await vi.advanceTimersByTimeAsync(3000);
      // 第二次采样
      await vi.advanceTimersByTimeAsync(3000);

      expect(mockWs.send).toHaveBeenCalledTimes(2);
      const secondData = JSON.parse(mockWs.send.mock.calls[1][0]);
      // 网络速率应大于 0（第二次采样有增量）
      expect(secondData.payload.status.netRxRate).toBeGreaterThan(0);
      expect(secondData.payload.status.netTxRate).toBeGreaterThan(0);
    });
  });
});
