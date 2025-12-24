/**
 * useDockerManager Composable 单元测试
 * 测试 Docker 容器管理的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed, nextTick } from 'vue';
import {
  createDockerManager,
  type DockerManagerDependencies,
  type DockerContainer,
} from './useDockerManager';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// Mock stores
const mockDockerDefaultExpandBoolean = ref(false);
const mockUsedPanes = ref(new Set(['dockerManager']));

vi.mock('../stores/settings.store', () => ({
  useSettingsStore: () => ({
    dockerDefaultExpandBoolean: mockDockerDefaultExpandBoolean,
  }),
}));

vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>();
  return {
    ...actual,
    storeToRefs: (store: any) => ({
      dockerDefaultExpandBoolean: mockDockerDefaultExpandBoolean,
    }),
  };
});

vi.mock('../stores/layout.store', () => ({
  useLayoutStore: () => ({
    usedPanes: mockUsedPanes.value,
  }),
}));

describe('useDockerManager (createDockerManager)', () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockOnMessage: ReturnType<typeof vi.fn>;
  let mockIsConnected: ReturnType<typeof ref<boolean>>;
  let messageHandlers: Map<string, ((payload: any, message?: any) => void)[]>;

  // 模拟 i18n
  const mockI18n = {
    t: (key: string) => key,
  };

  // 辅助函数：创建 WebSocket 依赖
  function createWsDeps(): DockerManagerDependencies {
    return {
      sendMessage: mockSendMessage,
      onMessage: mockOnMessage,
      isConnected: computed(() => mockIsConnected.value ?? false),
    };
  }

  // 辅助函数：触发消息处理器
  function triggerMessage(type: string, payload: any, sessionId?: string) {
    const handlers = messageHandlers.get(type) || [];
    handlers.forEach((handler) => handler(payload, { sessionId }));
  }

  // 辅助函数：创建测试容器
  function createTestContainer(overrides?: Partial<DockerContainer>): DockerContainer {
    return {
      id: 'container-1',
      Names: ['/test-container'],
      Image: 'nginx:latest',
      ImageID: 'sha256:abc123',
      Command: 'nginx -g daemon off;',
      Created: Date.now() / 1000,
      State: 'running',
      Status: 'Up 5 hours',
      Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
      Labels: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockSendMessage = vi.fn();
    mockIsConnected = ref(false);
    messageHandlers = new Map();

    // 模拟 onMessage 注册消息处理器
    mockOnMessage = vi.fn((type: string, handler: (payload: any, message?: any) => void) => {
      if (!messageHandlers.has(type)) {
        messageHandlers.set(type, []);
      }
      messageHandlers.get(type)!.push(handler);
      return () => {
        const handlers = messageHandlers.get(type);
        if (handlers) {
          const index = handlers.indexOf(handler);
          if (index > -1) handlers.splice(index, 1);
        }
      };
    });

    // 重置 mock stores
    mockDockerDefaultExpandBoolean.value = false;
    mockUsedPanes.value = new Set(['dockerManager']);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('未连接时应显示断开连接错误', () => {
      mockIsConnected.value = false;

      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      expect(manager.containers.value).toEqual([]);
      expect(manager.isLoading.value).toBe(false);
      expect(manager.error.value).toBe('dockerManager.error.sshDisconnected');
      expect(manager.isDockerAvailable.value).toBe(false);
    });

    it('已连接时应请求 Docker 状态', () => {
      mockIsConnected.value = true;

      createDockerManager('session-1', createWsDeps(), mockI18n);

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'docker:get_status',
        sessionId: 'session-1',
      });
    });

    it('应暴露所需的方法和状态', () => {
      mockIsConnected.value = false;

      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      // 状态
      expect(manager.containers).toBeDefined();
      expect(manager.isLoading).toBeDefined();
      expect(manager.error).toBeDefined();
      expect(manager.isDockerAvailable).toBeDefined();
      expect(manager.expandedContainerIds).toBeDefined();

      // 方法
      expect(typeof manager.requestDockerStatus).toBe('function');
      expect(typeof manager.sendDockerCommand).toBe('function');
      expect(typeof manager.toggleExpand).toBe('function');
      expect(typeof manager.cleanup).toBe('function');
    });
  });

  describe('requestDockerStatus', () => {
    it('未连接时应重置状态并显示错误', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      // 模拟之前有容器
      triggerMessage('docker:status:update', {
        available: true,
        containers: [createTestContainer()],
      });
      expect(manager.containers.value.length).toBe(1);

      // 断开连接后请求
      mockIsConnected.value = false;
      manager.requestDockerStatus();

      expect(manager.containers.value).toEqual([]);
      expect(manager.error.value).toBe('dockerManager.error.sshDisconnected');
      expect(manager.isDockerAvailable.value).toBe(false);
    });

    it('已连接时应发送状态请求', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      mockSendMessage.mockClear();
      manager.requestDockerStatus();

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'docker:get_status',
        sessionId: 'session-1',
      });
      expect(manager.isLoading.value).toBe(true);
    });
  });

  describe('docker:status:update 消息处理', () => {
    it('应正确处理 Docker 可用且有容器的响应', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      const containers = [
        createTestContainer({ id: 'c1', Names: ['/web'] }),
        createTestContainer({ id: 'c2', Names: ['/db'], State: 'exited' }),
      ];

      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers,
        },
        'session-1'
      );

      expect(manager.containers.value.length).toBe(2);
      expect(manager.isLoading.value).toBe(false);
      expect(manager.error.value).toBeNull();
      expect(manager.isDockerAvailable.value).toBe(true);
    });

    it('应忽略其他会话的消息', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer()],
        },
        'session-2'
      ); // 不同的 sessionId

      // 应该仍然为空（初始状态）
      expect(manager.containers.value).toEqual([]);
    });

    it('Docker 不可用时应清空容器列表', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      // 先添加一些容器
      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer()],
        },
        'session-1'
      );
      expect(manager.containers.value.length).toBe(1);

      // Docker 不可用
      triggerMessage(
        'docker:status:update',
        {
          available: false,
        },
        'session-1'
      );

      expect(manager.containers.value).toEqual([]);
      expect(manager.isDockerAvailable.value).toBe(false);
    });

    it('无效响应应显示错误', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      triggerMessage('docker:status:update', null, 'session-1');

      expect(manager.error.value).toBe('dockerManager.error.invalidResponse');
      expect(manager.isDockerAvailable.value).toBe(false);
    });

    it('默认展开设置应在首次加载时展开所有容器', () => {
      mockDockerDefaultExpandBoolean.value = true;
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      const containers = [createTestContainer({ id: 'c1' }), createTestContainer({ id: 'c2' })];

      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers,
        },
        'session-1'
      );

      expect(manager.expandedContainerIds.value.has('c1')).toBe(true);
      expect(manager.expandedContainerIds.value.has('c2')).toBe(true);
    });

    it('应清理不存在容器的展开状态', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      // 初始化带容器
      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer({ id: 'c1' }), createTestContainer({ id: 'c2' })],
        },
        'session-1'
      );

      // 展开 c2
      manager.toggleExpand('c2');
      expect(manager.expandedContainerIds.value.has('c2')).toBe(true);

      // 更新时 c2 不存在了
      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer({ id: 'c1' })],
        },
        'session-1'
      );

      expect(manager.expandedContainerIds.value.has('c2')).toBe(false);
    });
  });

  describe('docker:status:error 消息处理', () => {
    it('应处理状态错误', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      triggerMessage(
        'docker:status:error',
        {
          message: 'Docker daemon not running',
        },
        'session-1'
      );

      expect(manager.error.value).toBe('Docker daemon not running');
      expect(manager.isLoading.value).toBe(false);
      expect(manager.isDockerAvailable.value).toBe(false);
    });

    it('无消息时应显示默认错误', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      triggerMessage('docker:status:error', {}, 'session-1');

      expect(manager.error.value).toBe('dockerManager.error.fetchFailed');
    });
  });

  describe('sendDockerCommand', () => {
    it('未连接时不应发送命令', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      mockIsConnected.value = false;
      mockSendMessage.mockClear();

      manager.sendDockerCommand('container-1', 'start');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('Docker 不可用时不应发送命令', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      // 设置 Docker 不可用
      triggerMessage(
        'docker:status:update',
        {
          available: false,
        },
        'session-1'
      );

      mockSendMessage.mockClear();
      manager.sendDockerCommand('container-1', 'start');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('应发送 start 命令', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      // 设置 Docker 可用
      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer({ id: 'c1', State: 'exited' })],
        },
        'session-1'
      );

      mockSendMessage.mockClear();
      manager.sendDockerCommand('c1', 'start');

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'docker:command',
        sessionId: 'session-1',
        payload: { containerId: 'c1', command: 'start' },
      });
    });

    it('应发送 stop 命令', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer({ id: 'c1' })],
        },
        'session-1'
      );

      mockSendMessage.mockClear();
      manager.sendDockerCommand('c1', 'stop');

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'docker:command',
        sessionId: 'session-1',
        payload: { containerId: 'c1', command: 'stop' },
      });
    });

    it('应发送 restart 命令', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer({ id: 'c1' })],
        },
        'session-1'
      );

      mockSendMessage.mockClear();
      manager.sendDockerCommand('c1', 'restart');

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'docker:command',
        sessionId: 'session-1',
        payload: { containerId: 'c1', command: 'restart' },
      });
    });

    it('应发送 remove 命令', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer({ id: 'c1', State: 'exited' })],
        },
        'session-1'
      );

      mockSendMessage.mockClear();
      manager.sendDockerCommand('c1', 'remove');

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'docker:command',
        sessionId: 'session-1',
        payload: { containerId: 'c1', command: 'remove' },
      });
    });
  });

  describe('toggleExpand', () => {
    it('应切换容器展开状态', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      expect(manager.expandedContainerIds.value.has('c1')).toBe(false);

      manager.toggleExpand('c1');
      expect(manager.expandedContainerIds.value.has('c1')).toBe(true);

      manager.toggleExpand('c1');
      expect(manager.expandedContainerIds.value.has('c1')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('应重置所有状态', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      // 添加一些数据
      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer({ id: 'c1' })],
        },
        'session-1'
      );
      manager.toggleExpand('c1');

      expect(manager.containers.value.length).toBe(1);
      expect(manager.expandedContainerIds.value.has('c1')).toBe(true);

      manager.cleanup();

      expect(manager.containers.value).toEqual([]);
      expect(manager.expandedContainerIds.value.size).toBe(0);
      expect(manager.isLoading.value).toBe(false);
      expect(manager.error.value).toBeNull();
    });
  });

  describe('request_docker_status_update 消息处理', () => {
    it('应在收到更新请求时刷新状态', () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      mockSendMessage.mockClear();

      triggerMessage('request_docker_status_update', {}, 'session-1');

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'docker:get_status',
        sessionId: 'session-1',
      });
    });
  });

  describe('连接状态变化', () => {
    it('断开连接时应重置状态并显示错误', async () => {
      mockIsConnected.value = true;
      const manager = createDockerManager('session-1', createWsDeps(), mockI18n);

      // 添加一些容器
      triggerMessage(
        'docker:status:update',
        {
          available: true,
          containers: [createTestContainer()],
        },
        'session-1'
      );
      expect(manager.containers.value.length).toBe(1);

      // 断开连接
      mockIsConnected.value = false;
      await nextTick();

      // watch 会触发重置
      expect(manager.error.value).toBe('dockerManager.error.sshDisconnected');
      expect(manager.isDockerAvailable.value).toBe(false);
    });
  });

  describe('Docker 管理器不在布局中', () => {
    it('不在布局中时不应发送请求', () => {
      mockUsedPanes.value = new Set(['terminal']); // dockerManager 不在其中
      mockIsConnected.value = true;

      createDockerManager('session-1', createWsDeps(), mockI18n);

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});
