import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useTerminalFit } from './useTerminalFit';

vi.mock('../workspaceEvents', () => ({
  useWorkspaceEventEmitter: () => vi.fn(),
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock ResizeObserver
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();
let resizeCallback: ((entries: ResizeObserverEntry[]) => void) | null = null;

function MockResizeObserver(
  this: Record<string, unknown>,
  cb: (entries: ResizeObserverEntry[]) => void,
) {
  resizeCallback = cb;
  this.observe = mockObserve;
  this.unobserve = mockUnobserve;
  this.disconnect = mockDisconnect;
}

// Mock FitAddon
const mockFit = vi.fn();
const mockProposeDimensions = vi.fn();

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = mockFit;
    proposeDimensions = mockProposeDimensions;
  },
}));

function makeTerminal(overrides: Record<string, any> = {}) {
  return {
    cols: 80,
    rows: 24,
    write: vi.fn(),
    refresh: vi.fn(),
    focus: vi.fn(),
    resize: vi.fn(),
    scrollToBottom: vi.fn(),
    ...overrides,
  };
}

function makeElement(overrides: Record<string, any> = {}) {
  return {
    offsetHeight: 500,
    offsetWidth: 800,
    ...overrides,
  };
}

describe('useTerminalFit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    mockProposeDimensions.mockReturnValue({ cols: 80, rows: 30 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('应返回 fitAddon、fitAndEmitResizeNow 和 setupResizeObserver', () => {
    const terminal = ref(makeTerminal() as any);
    const el = ref(makeElement() as any);
    const isActive = ref(true);
    const shouldFitByWidth = ref(true);

    const result = useTerminalFit(terminal, el, 's1', isActive, shouldFitByWidth);

    expect(result.fitAddon).toBeDefined();
    expect(typeof result.fitAndEmitResizeNow).toBe('function');
    expect(typeof result.setupResizeObserver).toBe('function');
  });

  describe('fitAndEmitResizeNow', () => {
    it('terminal 或 element 为 null 时应直接返回', () => {
      const terminal = ref(null);
      const el = ref(null);
      const isActive = ref(true);
      const shouldFitByWidth = ref(true);

      const { fitAndEmitResizeNow } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      // 不应抛出错误
      fitAndEmitResizeNow();
      expect(mockFit).not.toHaveBeenCalled();
    });

    it('element 尺寸为 0 时不应执行 fit', () => {
      const terminal = ref(makeTerminal() as any);
      const el = ref(makeElement({ offsetHeight: 0, offsetWidth: 0 }) as any);
      const isActive = ref(true);
      const shouldFitByWidth = ref(true);

      const { fitAndEmitResizeNow } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      fitAndEmitResizeNow();
      expect(mockFit).not.toHaveBeenCalled();
    });

    it('shouldFitByWidth=true 时应调用 fitAddon.fit()', () => {
      const term = makeTerminal();
      const terminal = ref(term as any);
      const el = ref(makeElement() as any);
      const isActive = ref(true);
      const shouldFitByWidth = ref(true);

      const { fitAndEmitResizeNow } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      fitAndEmitResizeNow();
      expect(mockFit).toHaveBeenCalled();
    });

    it('shouldFitByWidth=false 时应仅调整行数', () => {
      const term = makeTerminal({ rows: 24 });
      const terminal = ref(term as any);
      const el = ref(makeElement() as any);
      const isActive = ref(true);
      const shouldFitByWidth = ref(false);
      mockProposeDimensions.mockReturnValue({ cols: 80, rows: 30 });

      const { fitAndEmitResizeNow } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      fitAndEmitResizeNow();
      expect(term.resize).toHaveBeenCalledWith(80, 30);
      expect(mockFit).not.toHaveBeenCalled();
    });

    it('shouldFitByWidth=false 且行数相同时不应 resize', () => {
      const term = makeTerminal({ rows: 30 });
      const terminal = ref(term as any);
      const el = ref(makeElement() as any);
      const isActive = ref(true);
      const shouldFitByWidth = ref(false);
      mockProposeDimensions.mockReturnValue({ cols: 80, rows: 30 });

      const { fitAndEmitResizeNow } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      fitAndEmitResizeNow();
      expect(term.resize).not.toHaveBeenCalled();
    });
  });

  describe('setupResizeObserver', () => {
    it('应创建 ResizeObserver 并观察 element', () => {
      const terminal = ref(makeTerminal() as any);
      const el = ref(makeElement() as any);
      const isActive = ref(true);
      const shouldFitByWidth = ref(true);

      const { setupResizeObserver } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      setupResizeObserver();
      expect(mockObserve).toHaveBeenCalledWith(el.value);
    });

    it('element 为 null 时不应 observe', () => {
      const terminal = ref(makeTerminal() as any);
      const el = ref(null);
      const isActive = ref(true);
      const shouldFitByWidth = ref(true);

      const { setupResizeObserver } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      setupResizeObserver();
      expect(mockObserve).not.toHaveBeenCalled();
    });

    it('isActive=false 时不应 observe', () => {
      const terminal = ref(makeTerminal() as any);
      const el = ref(makeElement() as any);
      const isActive = ref(false);
      const shouldFitByWidth = ref(true);

      const { setupResizeObserver } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      setupResizeObserver();
      expect(mockObserve).not.toHaveBeenCalled();
    });

    it('ResizeObserver 回调应在尺寸变化时触发 fit', () => {
      const term = makeTerminal();
      const terminal = ref(term as any);
      const el = ref(makeElement() as any);
      const isActive = ref(true);
      const shouldFitByWidth = ref(true);

      const { setupResizeObserver } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      setupResizeObserver();

      // 模拟 ResizeObserver 回调
      resizeCallback?.([{ contentRect: { width: 900, height: 600 } as DOMRectReadOnly } as any]);

      expect(mockFit).toHaveBeenCalled();
    });

    it('尺寸变化低于阈值时不应触发 fit', () => {
      const term = makeTerminal();
      const terminal = ref(term as any);
      const el = ref(makeElement() as any);
      const isActive = ref(true);
      const shouldFitByWidth = ref(true);

      const { setupResizeObserver } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      setupResizeObserver();

      // 第一次设置初始尺寸
      resizeCallback?.([{ contentRect: { width: 800, height: 500 } as DOMRectReadOnly } as any]);
      mockFit.mockClear();

      // 微小变化（< 0.5px 阈值）
      resizeCallback?.([
        { contentRect: { width: 800.2, height: 500.2 } as DOMRectReadOnly } as any,
      ]);
      expect(mockFit).not.toHaveBeenCalled();
    });

    it('非活跃状态时 ResizeObserver 回调应忽略', () => {
      const term = makeTerminal();
      const terminal = ref(term as any);
      const el = ref(makeElement() as any);
      const isActive = ref(false);
      const shouldFitByWidth = ref(true);

      const { setupResizeObserver } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );

      setupResizeObserver();

      resizeCallback?.([{ contentRect: { width: 900, height: 600 } } as any]);

      expect(mockFit).not.toHaveBeenCalled();
    });
  });

  describe('isActive watch', () => {
    it('isActive 变为 true 时应 observe 并延迟 fit', async () => {
      const term = makeTerminal();
      const terminal = ref(term as any);
      const el = ref(makeElement() as any);
      const isActive = ref(false);
      const shouldFitByWidth = ref(true);

      const { setupResizeObserver } = useTerminalFit(
        terminal,
        el,
        's1',
        isActive,
        shouldFitByWidth,
      );
      setupResizeObserver();
      mockObserve.mockClear();

      isActive.value = true;
      await nextTick();

      expect(mockObserve).toHaveBeenCalledWith(el.value);
    });
  });
});
