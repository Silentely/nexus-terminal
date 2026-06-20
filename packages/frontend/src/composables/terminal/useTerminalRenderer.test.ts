import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

vi.mock('@/utils/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// --- WebglAddon Mock ---

let contextLossHandler: (() => void) | null = null;

const mockDisposeWebgl = vi.fn();

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose = mockDisposeWebgl;
    onContextLoss(cb: () => void) {
      contextLossHandler = cb;
    }
  },
}));

// --- requestAnimationFrame / cancelAnimationFrame Mock ---

let rafCallback: ((ts: number) => void) | null = null;
const mockRequestAnimationFrame = vi.fn((cb: (ts: number) => void) => {
  rafCallback = cb;
  return 1;
});
const mockCancelAnimationFrame = vi.fn();

// --- performance.now Mock ---

const mockPerformanceNow = vi.fn(() => 0);

// --- Terminal Mock ---

function makeTerminal(overrides: Record<string, unknown> = {}) {
  return {
    loadAddon: vi.fn(),
    write: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    ...overrides,
  };
}

describe('useTerminalRenderer 渲染器管理', () => {
  beforeAll(() => {
    vi.stubGlobal('requestAnimationFrame', mockRequestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', mockCancelAnimationFrame);
    vi.stubGlobal('performance', { now: mockPerformanceNow });
  });

  beforeEach(() => {
    contextLossHandler = null;
    rafCallback = null;
    mockRequestAnimationFrame.mockClear();
    mockCancelAnimationFrame.mockClear();
    mockDisposeWebgl.mockClear();
  });

  // ========== 渲染模式管理 ==========

  describe('渲染模式管理', () => {
    it('默认模式为 auto', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { renderMode } = useTerminalRenderer(terminal, 's1');

      expect(renderMode.value).toBe('auto');
    });

    it('默认活动渲染器为 dom', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { activeRenderer } = useTerminalRenderer(terminal, 's1');

      expect(activeRenderer.value).toBe('dom');
    });

    it('setRenderMode 切换模式', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { renderMode, setRenderMode } = useTerminalRenderer(terminal, 's1');

      setRenderMode('canvas');
      expect(renderMode.value).toBe('canvas');
    });

    it('auto 模式优先加载 WebGL addon', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { setRenderMode, activeRenderer } = useTerminalRenderer(terminal, 's1');

      setRenderMode('auto');

      expect(term.loadAddon).toHaveBeenCalled();
      expect(activeRenderer.value).toBe('webgl');
    });

    it('auto 模式 WebGL 加载失败时降级为 canvas', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal({
        loadAddon: vi.fn().mockImplementation(() => {
          throw new Error('WebGL not supported');
        }),
      });
      const terminal = ref(term as any);
      const { initRenderer, activeRenderer, contextState } = useTerminalRenderer(terminal, 's1');

      initRenderer();

      expect(activeRenderer.value).toBe('canvas');
      expect(contextState.value).toBe('unavailable');
    });

    it('canvas 模式不加载额外 addon', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { setRenderMode, activeRenderer, contextState } = useTerminalRenderer(terminal, 's1');

      setRenderMode('canvas');

      expect(activeRenderer.value).toBe('canvas');
      expect(contextState.value).toBe('unavailable');
    });

    it('dom 模式设置活动渲染器为 dom', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { setRenderMode, activeRenderer, contextState } = useTerminalRenderer(terminal, 's1');

      setRenderMode('dom');

      expect(activeRenderer.value).toBe('dom');
      expect(contextState.value).toBe('unavailable');
    });

    it('webgl 模式加载成功时设置活动渲染器为 webgl', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { setRenderMode, activeRenderer, contextState } = useTerminalRenderer(terminal, 's1');

      setRenderMode('webgl');

      expect(activeRenderer.value).toBe('webgl');
      expect(contextState.value).toBe('active');
    });

    it('webgl 模式加载失败时降级为 dom', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal({
        loadAddon: vi.fn().mockImplementation(() => {
          throw new Error('WebGL not supported');
        }),
      });
      const terminal = ref(term as any);
      const { setRenderMode, activeRenderer, contextState } = useTerminalRenderer(terminal, 's1');

      setRenderMode('webgl');

      expect(activeRenderer.value).toBe('dom');
      expect(contextState.value).toBe('unavailable');
    });

    it('terminal 为 null 时 setRenderMode 不应报错', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(null);
      const { setRenderMode, renderMode } = useTerminalRenderer(terminal, 's1');

      setRenderMode('canvas');
      expect(renderMode.value).toBe('canvas');
    });

    it('切换模式时先卸载旧 addon', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { setRenderMode } = useTerminalRenderer(terminal, 's1');

      // 先加载 WebGL addon
      setRenderMode('webgl');
      mockDisposeWebgl.mockClear();

      // 切换到 canvas 模式，应先卸载 WebGL addon
      setRenderMode('canvas');
      expect(mockDisposeWebgl).toHaveBeenCalled();
    });
  });

  // ========== FPS 采样 ==========

  describe('FPS 采样', () => {
    it('startMonitoring 启动 RAF 采样', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { startMonitoring } = useTerminalRenderer(terminal, 's1');

      startMonitoring();

      expect(mockRequestAnimationFrame).toHaveBeenCalled();
    });

    it('stopMonitoring 停止采样', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { startMonitoring, stopMonitoring } = useTerminalRenderer(terminal, 's1');

      startMonitoring();
      stopMonitoring();

      expect(mockCancelAnimationFrame).toHaveBeenCalled();
    });

    it('FPS 值在合理范围内', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { startMonitoring, stopMonitoring, fps, getMetrics } = useTerminalRenderer(
        terminal,
        's1',
      );

      // 验证初始 FPS 为 0
      expect(fps.value).toBe(0);

      // 启动监控后 FPS 仍为 0（需等待采样窗口）
      startMonitoring();
      expect(fps.value).toBe(0);

      // 停止监控
      stopMonitoring();
      expect(mockCancelAnimationFrame).toHaveBeenCalled();

      // 验证 getMetrics 返回的 fps 字段类型正确
      const metrics = getMetrics();
      expect(typeof metrics.fps).toBe('number');
      expect(metrics.fps).toBeGreaterThanOrEqual(0);
    });

    it('重复调用 startMonitoring 不应重复启动', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { startMonitoring } = useTerminalRenderer(terminal, 's1');

      startMonitoring();
      mockRequestAnimationFrame.mockClear();
      startMonitoring();

      expect(mockRequestAnimationFrame).not.toHaveBeenCalled();
    });

    it('未启动监控时 sampleFrame 不应执行', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { fps } = useTerminalRenderer(terminal, 's1');

      // 直接调用 raf 回调（未启动监控）
      rafCallback?.(100);

      expect(fps.value).toBe(0);
    });
  });

  // ========== Context Loss ==========

  describe('上下文丢失处理', () => {
    it('context loss 后记录次数', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { setRenderMode, contextLossCount } = useTerminalRenderer(terminal, 's1');

      setRenderMode('webgl');
      expect(contextLossCount.value).toBe(0);

      // 触发 context loss
      contextLossHandler?.();

      expect(contextLossCount.value).toBe(1);
    });

    it('auto 模式 context loss 后降级为 dom', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { setRenderMode, activeRenderer, contextState } = useTerminalRenderer(terminal, 's1');

      setRenderMode('auto');
      expect(activeRenderer.value).toBe('webgl');
      expect(contextState.value).toBe('active');

      // 触发 context loss
      contextLossHandler?.();

      // auto 模式降级后 contextState 应为 unavailable（而非遗留 lost）
      expect(contextState.value).toBe('unavailable');
      expect(activeRenderer.value).toBe('dom');
    });

    it('webgl 模式 context loss 后尝试恢复', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { setRenderMode, activeRenderer, contextState } = useTerminalRenderer(terminal, 's1');

      setRenderMode('webgl');
      expect(activeRenderer.value).toBe('webgl');

      // 触发 context loss
      contextLossHandler?.();

      // 恢复成功，重新加载了 addon
      expect(activeRenderer.value).toBe('webgl');
      expect(contextState.value).toBe('active');
    });

    it('webgl 模式 context loss 后恢复失败时降级为 dom', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      // 首次加载成功，恢复时失败
      const loadAddon = vi
        .fn()
        .mockImplementationOnce(() => {
          // 初次加载成功
        })
        .mockImplementationOnce(() => {
          // context loss 后恢复失败
          throw new Error('fail');
        });
      const term = makeTerminal({ loadAddon });
      const terminal = ref(term as any);
      const { setRenderMode, activeRenderer, contextState } = useTerminalRenderer(terminal, 's1');

      setRenderMode('webgl');
      expect(activeRenderer.value).toBe('webgl');

      // 触发 context loss（恢复时 loadAddon 会抛异常）
      contextLossHandler?.();

      expect(loadAddon).toHaveBeenCalledTimes(2);
      expect(activeRenderer.value).toBe('dom');
      expect(contextState.value).toBe('unavailable');
    });
  });

  // ========== getMetrics ==========

  describe('性能指标获取', () => {
    it('返回完整的 RenderMetrics 对象', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const {
        getMetrics,
        renderMode,
        activeRenderer,
        fps,
        frameTime,
        contextState,
        contextLossCount,
      } = useTerminalRenderer(terminal, 's1');

      const metrics = getMetrics();

      expect(metrics).toEqual({
        renderMode: renderMode.value,
        activeRenderer: activeRenderer.value,
        fps: fps.value,
        frameTime: frameTime.value,
        contextState: contextState.value,
        contextLossCount: contextLossCount.value,
      });
    });

    it('渲染模式切换后 getMetrics 反映最新状态', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { setRenderMode, getMetrics } = useTerminalRenderer(terminal, 's1');

      setRenderMode('canvas');
      const metrics = getMetrics();

      expect(metrics.renderMode).toBe('canvas');
      expect(metrics.activeRenderer).toBe('canvas');
    });
  });

  // ========== cleanup ==========

  describe('清理与资源释放', () => {
    it('cleanup 应停止监控并卸载 addon', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { setRenderMode, startMonitoring, cleanup } = useTerminalRenderer(terminal, 's1');

      // 先加载 WebGL addon
      setRenderMode('webgl');
      mockDisposeWebgl.mockClear();
      startMonitoring();

      cleanup();

      expect(mockCancelAnimationFrame).toHaveBeenCalled();
      expect(mockDisposeWebgl).toHaveBeenCalled();
    });

    it('cleanup 后 contextState 为 unavailable', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(makeTerminal() as any);
      const { cleanup, contextState } = useTerminalRenderer(terminal, 's1');

      cleanup();

      expect(contextState.value).toBe('unavailable');
    });
  });

  // ========== initRenderer ==========

  describe('渲染器初始化', () => {
    it('terminal 为 null 时 initRenderer 不应报错', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const terminal = ref(null);
      const { initRenderer } = useTerminalRenderer(terminal, 's1');

      initRenderer();
    });

    it('initRenderer 应根据当前模式加载渲染器', async () => {
      const { useTerminalRenderer } = await import('./useTerminalRenderer');
      const term = makeTerminal();
      const terminal = ref(term as any);
      const { initRenderer } = useTerminalRenderer(terminal, 's1');

      initRenderer();

      // 默认 auto 模式，应尝试加载 WebGL
      expect(term.loadAddon).toHaveBeenCalled();
    });
  });
});
