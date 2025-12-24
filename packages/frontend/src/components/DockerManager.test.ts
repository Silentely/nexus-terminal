/**
 * DockerManager.vue 单元测试
 * 测试 Docker 容器管理组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref, computed } from 'vue';
import DockerManager from './DockerManager.vue';

// Use vi.hoisted to ensure mockActiveSession exists before mocks are processed
const { mockActiveSession, mockEmitWorkspaceEvent, mockSendDockerCommand, mockToggleExpand } =
  vi.hoisted(() => ({
    mockActiveSession: { value: null as any },
    mockEmitWorkspaceEvent: vi.fn(),
    mockSendDockerCommand: vi.fn(),
    mockToggleExpand: vi.fn(),
  }));

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Mock workspace event emitter
vi.mock('../composables/workspaceEvents', () => ({
  useWorkspaceEventEmitter: () => mockEmitWorkspaceEvent,
}));

// Mock session store - return a getter that always reads current mockActiveSession.value
vi.mock('../stores/session.store', () => ({
  useSessionStore: () => ({
    get activeSession() {
      return mockActiveSession.value;
    },
  }),
}));

// Mock pinia's storeToRefs to return a Vue computed ref for activeSession
// This ensures proper ref unwrapping in Vue templates
vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>();
  const { computed: vueComputed } = await import('vue');
  return {
    ...actual,
    storeToRefs: () => ({
      activeSession: vueComputed(() => mockActiveSession.value),
    }),
  };
});

// Factory function to create mock active session with given state
function createMockActiveSession(
  options: {
    connectionStatus?: 'connecting' | 'connected' | 'disconnected' | 'error';
    statusMessage?: string;
    containers?: any[];
    isLoading?: boolean;
    error?: string | null;
    isDockerAvailable?: boolean;
    expandedContainerIds?: Set<string>;
  } = {}
) {
  const {
    connectionStatus = 'connected',
    statusMessage = '',
    containers = [],
    isLoading = false,
    error = null,
    isDockerAvailable = true,
    expandedContainerIds = new Set<string>(),
  } = options;

  return {
    sessionId: 'session-1',
    wsManager: {
      connectionStatus: { value: connectionStatus },
      statusMessage: { value: statusMessage },
    },
    dockerManager: {
      containers: { value: containers },
      isLoading: { value: isLoading },
      error: { value: error },
      isDockerAvailable: { value: isDockerAvailable },
      expandedContainerIds: { value: expandedContainerIds },
      sendDockerCommand: mockSendDockerCommand,
      toggleExpand: mockToggleExpand,
    },
  };
}

describe('DockerManager.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    mockActiveSession.value = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('状态显示测试', () => {
    it('无活动会话时应显示提示信息', () => {
      mockActiveSession.value = null;

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.error.noActiveSession');
      expect(wrapper.text()).toContain('dockerManager.error.connectFirst');
      expect(wrapper.find('.fa-plug').exists()).toBe(true);
    });

    it('SSH 连接中应显示等待状态', () => {
      mockActiveSession.value = createMockActiveSession({
        connectionStatus: 'connecting',
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.waitingForSsh');
      expect(wrapper.find('.fa-spinner').exists()).toBe(true);
    });

    it('SSH 断开应显示断开提示', () => {
      mockActiveSession.value = createMockActiveSession({
        connectionStatus: 'disconnected',
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.error.sshDisconnected');
      expect(wrapper.find('.fa-unlink').exists()).toBe(true);
    });

    it('SSH 错误应显示错误信息', () => {
      mockActiveSession.value = createMockActiveSession({
        connectionStatus: 'error',
        statusMessage: 'Connection refused',
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.error.sshError');
      expect(wrapper.find('.fa-exclamation-circle').exists()).toBe(true);
    });

    it('Docker 加载中应显示加载状态', () => {
      mockActiveSession.value = createMockActiveSession({
        isLoading: true,
        containers: [],
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.loading');
      expect(wrapper.find('.fa-spinner').exists()).toBe(true);
    });

    it('Docker 不可用应显示提示', () => {
      mockActiveSession.value = createMockActiveSession({
        isDockerAvailable: false,
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.notAvailable');
      expect(wrapper.text()).toContain('dockerManager.installHintRemote');
      expect(wrapper.find('.fa-docker').exists()).toBe(true);
    });

    it('获取容器错误应显示错误信息', () => {
      mockActiveSession.value = createMockActiveSession({
        error: 'Permission denied',
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.error.fetchFailed');
      expect(wrapper.text()).toContain('Permission denied');
      expect(wrapper.find('.fa-exclamation-triangle').exists()).toBe(true);
    });

    it('无容器应显示空状态', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [],
        isLoading: false,
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.noContainers');
    });
  });

  describe('容器列表渲染', () => {
    const mockContainerData = [
      {
        id: 'container-1',
        Names: ['/nginx-web'],
        Image: 'nginx:latest',
        State: 'running',
        Status: 'Up 2 hours',
        Ports: [{ IP: '0.0.0.0', PublicPort: 80, PrivatePort: 80, Type: 'tcp' }],
      },
      {
        id: 'container-2',
        Names: ['/mysql-db'],
        Image: 'mysql:8.0',
        State: 'exited',
        Status: 'Exited (0) 1 hour ago',
        Ports: [],
      },
    ];

    it('应正确渲染容器列表', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.find('table').exists()).toBe(true);
      expect(wrapper.text()).toContain('/nginx-web');
      expect(wrapper.text()).toContain('/mysql-db');
    });

    it('应显示容器镜像信息', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('nginx:latest');
      expect(wrapper.text()).toContain('mysql:8.0');
    });

    it('应显示容器状态', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('Up 2 hours');
      expect(wrapper.text()).toContain('Exited (0) 1 hour ago');
    });

    it('运行中的容器应有绿色状态标签', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      const statusBadges = wrapper.findAll('.bg-green-500');
      expect(statusBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('已停止的容器应有红色状态标签', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      const statusBadges = wrapper.findAll('.bg-red-500');
      expect(statusBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('应显示端口映射信息', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('0.0.0.0:80->80/tcp');
    });
  });

  describe('容器操作', () => {
    const mockContainerData = [
      {
        id: 'container-1',
        Names: ['/nginx-web'],
        Image: 'nginx:latest',
        State: 'running',
        Status: 'Up 2 hours',
        Ports: [],
      },
    ];

    it('点击启动按钮应调用 sendDockerCommand', async () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [{ ...mockContainerData[0], State: 'exited' }],
      });

      const wrapper = mount(DockerManager);

      const startButton = wrapper.find('.fa-play').element.closest('button');
      await (startButton as HTMLButtonElement)?.click();

      expect(mockSendDockerCommand).toHaveBeenCalledWith('container-1', 'start');
    });

    it('点击停止按钮应调用 sendDockerCommand', async () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      const stopButton = wrapper.find('.fa-stop').element.closest('button');
      await (stopButton as HTMLButtonElement)?.click();

      expect(mockSendDockerCommand).toHaveBeenCalledWith('container-1', 'stop');
    });

    it('点击重启按钮应调用 sendDockerCommand', async () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      const restartButton = wrapper.find('.fa-sync-alt').element.closest('button');
      await (restartButton as HTMLButtonElement)?.click();

      expect(mockSendDockerCommand).toHaveBeenCalledWith('container-1', 'restart');
    });

    it('点击删除按钮应调用 sendDockerCommand', async () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      const removeButton = wrapper.find('.fa-trash-alt').element.closest('button');
      await (removeButton as HTMLButtonElement)?.click();

      expect(mockSendDockerCommand).toHaveBeenCalledWith('container-1', 'remove');
    });

    it('点击进入按钮应发送 docker exec 命令', async () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      const enterButton = wrapper.find('.fa-terminal').element.closest('button');
      await (enterButton as HTMLButtonElement)?.click();

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('terminal:sendCommand', {
        command: 'docker exec -it container-1 sh\n',
        sessionId: 'session-1',
      });
    });

    it('点击日志按钮应发送 docker logs 命令', async () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      const logsButton = wrapper.find('.fa-file-alt').element.closest('button');
      await (logsButton as HTMLButtonElement)?.click();

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('terminal:sendCommand', {
        command: 'docker logs --tail 1000 -f container-1\n',
        sessionId: 'session-1',
      });
    });
  });

  describe('按钮禁用状态', () => {
    it('运行中的容器启动按钮应禁用', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [
          {
            id: 'container-1',
            Names: ['/test'],
            Image: 'test',
            State: 'running',
            Status: 'Up',
            Ports: [],
          },
        ],
      });

      const wrapper = mount(DockerManager);

      const startButton = wrapper.find('.fa-play').element.closest('button');
      expect(startButton?.hasAttribute('disabled')).toBe(true);
    });

    it('已停止的容器停止按钮应禁用', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [
          {
            id: 'container-1',
            Names: ['/test'],
            Image: 'test',
            State: 'exited',
            Status: 'Exited',
            Ports: [],
          },
        ],
      });

      const wrapper = mount(DockerManager);

      const stopButton = wrapper.find('.fa-stop').element.closest('button');
      expect(stopButton?.hasAttribute('disabled')).toBe(true);
    });

    it('已停止的容器重启按钮应禁用', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [
          {
            id: 'container-1',
            Names: ['/test'],
            Image: 'test',
            State: 'exited',
            Status: 'Exited',
            Ports: [],
          },
        ],
      });

      const wrapper = mount(DockerManager);

      const restartButton = wrapper.find('.fa-sync-alt').element.closest('button');
      expect(restartButton?.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('展开/折叠功能', () => {
    const mockContainerData = [
      {
        id: 'container-1',
        Names: ['/test'],
        Image: 'test',
        State: 'running',
        Status: 'Up',
        Ports: [],
        stats: {
          CPUPerc: '10%',
          MemUsage: '100MB / 1GB',
          MemPerc: '10%',
          NetIO: '1MB / 2MB',
          BlockIO: '10MB / 20MB',
          PIDs: '5',
        },
      },
    ];

    it('点击展开按钮应调用 toggleExpand', async () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
      });

      const wrapper = mount(DockerManager);

      // 找到桌面版展开按钮（有 chevron-right 图标的）
      const expandButton = wrapper.find('.fa-chevron-right').element.closest('button');
      await (expandButton as HTMLButtonElement)?.click();

      expect(mockToggleExpand).toHaveBeenCalledWith('container-1');
    });

    it('展开时应显示 chevron-down 图标', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
        expandedContainerIds: new Set(['container-1']),
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.find('.fa-chevron-down').exists()).toBe(true);
    });

    it('展开时应显示统计信息', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: mockContainerData,
        expandedContainerIds: new Set(['container-1']),
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.stats.cpu');
      expect(wrapper.text()).toContain('10%');
      expect(wrapper.text()).toContain('dockerManager.stats.memory');
      expect(wrapper.text()).toContain('100MB / 1GB');
    });

    it('无统计数据时应显示提示', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [
          {
            id: 'container-1',
            Names: ['/test'],
            Image: 'test',
            State: 'running',
            Status: 'Up',
            Ports: [],
            stats: null,
          },
        ],
        expandedContainerIds: new Set(['container-1']),
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.stats.noData');
    });
  });

  describe('表头显示', () => {
    it('应显示所有表头', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [
          {
            id: 'container-1',
            Names: ['/test'],
            Image: 'test',
            State: 'running',
            Status: 'Up',
            Ports: [],
          },
        ],
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.text()).toContain('dockerManager.header.name');
      expect(wrapper.text()).toContain('dockerManager.header.image');
      expect(wrapper.text()).toContain('dockerManager.header.status');
      expect(wrapper.text()).toContain('dockerManager.header.ports');
      expect(wrapper.text()).toContain('dockerManager.header.actions');
    });
  });

  describe('不同容器状态样式', () => {
    it('paused 状态应有黄色标签', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [
          {
            id: 'container-1',
            Names: ['/test'],
            Image: 'test',
            State: 'paused',
            Status: 'Paused',
            Ports: [],
          },
        ],
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.find('.bg-yellow-500').exists()).toBe(true);
    });

    it('restarting 状态应有蓝色标签', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [
          {
            id: 'container-1',
            Names: ['/test'],
            Image: 'test',
            State: 'restarting',
            Status: 'Restarting',
            Ports: [],
          },
        ],
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.find('.bg-blue-500').exists()).toBe(true);
    });

    it('其他状态应有灰色标签', () => {
      mockActiveSession.value = createMockActiveSession({
        containers: [
          {
            id: 'container-1',
            Names: ['/test'],
            Image: 'test',
            State: 'created',
            Status: 'Created',
            Ports: [],
          },
        ],
      });

      const wrapper = mount(DockerManager);

      expect(wrapper.find('.bg-gray-500').exists()).toBe(true);
    });
  });
});
