/**
 * useTerminalRenderer composable
 * 封装终端渲染器管理，包括 WebGL/Canvas/DOM 渲染模式切换、
 * FPS 采样监控与 WebGL 上下文丢失恢复
 */

import { ref, onBeforeUnmount, type Ref } from 'vue';
import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { log } from '@/utils/log';
import { useWebGPURenderer } from './useWebGPURenderer';

// 渲染模式类型
export type RenderMode = 'auto' | 'webgpu' | 'webgl' | 'canvas' | 'dom';

// WebGL 上下文状态
export type ContextState = 'active' | 'lost' | 'unavailable';

// 渲染性能指标
export interface RenderMetrics {
  /** 当前配置的渲染模式 */
  renderMode: RenderMode;
  /** 实际生效的渲染器类型 */
  activeRenderer: 'webgpu' | 'webgl' | 'canvas' | 'dom';
  /** WebGPU 能力检测与设备初始化状态 */
  webgpuState?: string;
  /** 当前 FPS（每 60 帧更新一次） */
  fps: number;
  /** 最近 60 帧的平均帧时间（毫秒） */
  frameTime: number;
  /** WebGL 上下文状态 */
  contextState: ContextState;
  /** 上下文丢失累计次数 */
  contextLossCount: number;
}

// WebGL 模式下最大自动恢复尝试次数
const MAX_WEBGL_RECOVERY_ATTEMPTS = 3;

// FPS 采样窗口大小（帧数）
const FPS_SAMPLE_SIZE = 60;

export function useTerminalRenderer(terminal: Ref<Terminal | null>, sessionId: string) {
  // --- 响应式状态 ---

  /** 当前配置的渲染模式 */
  const renderMode = ref<RenderMode>('auto');

  /** 实际生效的渲染器类型 */
  const activeRenderer = ref<'webgpu' | 'webgl' | 'canvas' | 'dom'>('dom');

  /** WebGL 上下文状态 */
  const contextState = ref<ContextState>('unavailable');

  /** 上下文丢失累计次数 */
  const contextLossCount = ref(0);

  /** 当前 FPS 值 */
  const fps = ref(0);

  /** 最近 60 帧的平均帧时间（毫秒） */
  const frameTime = ref(0);

  const {
    webgpuState,
    isWebGPUSupported,
    initGPUDevice,
    dispose: disposeWebGPU,
  } = useWebGPURenderer();

  // --- 内部状态 ---

  let webglAddonInstance: WebglAddon | null = null;
  let rafId: number | null = null;
  let lastFrameTime = 0;
  let frameCount = 0;
  let frameTimeAccumulator = 0;
  let isMonitoring = false;
  /** WebGL 强制模式下的恢复尝试计数 */
  let recoveryAttempts = 0;

  // --- 渲染器 Addon 生命周期管理 ---

  /**
   * 卸载当前 WebGL addon，清理引用与事件监听
   */
  function disposeWebglAddon(): void {
    if (webglAddonInstance) {
      try {
        webglAddonInstance.dispose();
      } catch {
        // dispose 过程中可能抛出异常，静默忽略
      }
      webglAddonInstance = null;
    }
  }

  /**
   * 加载 WebGL addon 并注册上下文丢失监听
   * @returns 是否加载成功
   */
  function loadWebglAddon(term: Terminal): boolean {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        log.warn(`[Terminal ${sessionId}] WebGL 上下文丢失`);
        contextState.value = 'lost';
        contextLossCount.value++;
        if (webglAddonInstance) {
          try {
            webglAddonInstance.dispose();
          } catch {
            // 忽略 dispose 错误
          }
          webglAddonInstance = null;
        }
        // 根据当前渲染模式决定恢复策略
        handleContextLossRecovery(term);
      });
      term.loadAddon(addon);
      webglAddonInstance = addon;
      contextState.value = 'active';
      log.info(`[Terminal ${sessionId}] WebGL 渲染器已加载`);
      return true;
    } catch (error: unknown) {
      log.warn(`[Terminal ${sessionId}] WebGL addon 加载失败，降级渲染：`, error);
      webglAddonInstance = null;
      contextState.value = 'unavailable';
      return false;
    }
  }

  /**
   * 应用 WebGPU 渲染模式
   * 当前 @xterm/addon-webgpu 尚未接入，因此这里仅完成 WebGPU 能力检测与 GPUDevice 初始化；
   * 实际终端画面仍复用现有 WebGL addon 渲染，方便后续无缝替换真实 WebGPU 渲染器。
   */
  async function applyWebGPURendererMode(term: Terminal): Promise<void> {
    const supported = await isWebGPUSupported();
    if (renderMode.value !== 'webgpu') return;

    if (supported) {
      const device = await initGPUDevice();
      if (renderMode.value !== 'webgpu') return;

      if (device) {
        const success = loadWebglAddon(term);
        if (success) {
          activeRenderer.value = 'webgpu';
          recoveryAttempts = 0;
          log.info(`[Terminal ${sessionId}] WebGPU 设备已就绪，当前实际渲染暂由 WebGL addon 承担`);
        } else {
          activeRenderer.value = 'dom';
          contextState.value = 'unavailable';
        }
        return;
      }
    }

    // WebGPU 不可用或设备初始化失败时，沿用 webgl 强制模式的降级策略
    const success = loadWebglAddon(term);
    if (success) {
      activeRenderer.value = 'webgl';
      recoveryAttempts = 0;
    } else {
      activeRenderer.value = 'dom';
      contextState.value = 'unavailable';
    }
  }

  /**
   * 根据当前渲染模式处理 WebGL 上下文丢失后的恢复逻辑
   * - auto 模式：降级为 DOM 渲染器
   * - webgpu 模式：WebGL 是实际渲染后端，尝试重新加载（最多 MAX_WEBGL_RECOVERY_ATTEMPTS 次）
   * - webgl 模式：尝试重新加载（最多 MAX_WEBGL_RECOVERY_ATTEMPTS 次）
   */
  function handleContextLossRecovery(term: Terminal): void {
    if (renderMode.value === 'auto') {
      // auto 模式：降级为 DOM 渲染器，不再尝试恢复
      activeRenderer.value = 'dom';
      contextState.value = 'unavailable';
      log.info(`[Terminal ${sessionId}] auto 模式：WebGL 上下文丢失后降级为 DOM 渲染器`);
    } else if (renderMode.value === 'webgpu' || renderMode.value === 'webgl') {
      // webgpu/webgl 模式：WebGL 是实际渲染后端，尝试重新加载
      if (recoveryAttempts < MAX_WEBGL_RECOVERY_ATTEMPTS) {
        recoveryAttempts++;
        log.info(
          `[Terminal ${sessionId}] WebGL 恢复尝试 ${recoveryAttempts}/${MAX_WEBGL_RECOVERY_ATTEMPTS}`,
        );
        const success = loadWebglAddon(term);
        if (success) {
          recoveryAttempts = 0;
          // 恢复成功时保持当前渲染模式标识
          activeRenderer.value = renderMode.value === 'webgpu' ? 'webgpu' : 'webgl';
        } else {
          // 恢复失败，降级为 DOM 渲染器
          activeRenderer.value = 'dom';
          contextState.value = 'unavailable';
          if (recoveryAttempts >= MAX_WEBGL_RECOVERY_ATTEMPTS) {
            log.warn(
              `[Terminal ${sessionId}] WebGL 恢复已达最大次数 ${MAX_WEBGL_RECOVERY_ATTEMPTS}，渲染器永久降级为 DOM`,
            );
          }
        }
      }
    }
    // canvas/dom 模式下不涉及 WebGL，无需处理
  }

  /**
   * 根据渲染模式加载对应的 addon
   * 模式切换流程：卸载旧 addon → 加载新 addon
   */
  function applyRendererMode(term: Terminal): void {
    // 先卸载现有 WebGL addon
    disposeWebglAddon();

    switch (renderMode.value) {
      case 'webgpu': {
        void applyWebGPURendererMode(term);
        break;
      }
      case 'webgl': {
        const success = loadWebglAddon(term);
        if (success) {
          activeRenderer.value = 'webgl';
          recoveryAttempts = 0;
        } else {
          // webgl 强制模式但加载失败，降级为 DOM
          activeRenderer.value = 'dom';
          contextState.value = 'unavailable';
        }
        break;
      }
      case 'auto': {
        // auto 模式：优先尝试 WebGL
        const success = loadWebglAddon(term);
        if (success) {
          activeRenderer.value = 'webgl';
        } else {
          // WebGL 不可用，xterm 默认使用 canvas 渲染器
          activeRenderer.value = 'canvas';
          contextState.value = 'unavailable';
        }
        break;
      }
      case 'canvas': {
        // canvas 模式：xterm 默认渲染器，无需额外 addon
        activeRenderer.value = 'canvas';
        contextState.value = 'unavailable';
        log.info(`[Terminal ${sessionId}] 切换为 canvas 渲染器`);
        break;
      }
      case 'dom': {
        // DOM 模式：使用 xterm 内置 DOM 渲染器
        activeRenderer.value = 'dom';
        contextState.value = 'unavailable';
        log.info(`[Terminal ${sessionId}] 切换为 DOM 渲染器`);
        break;
      }
    }
  }

  /**
   * 设置渲染模式并应用
   * @param mode 目标渲染模式
   */
  function setRenderMode(mode: RenderMode): void {
    renderMode.value = mode;
    const term = terminal.value;
    if (!term) return;
    applyRendererMode(term);
  }

  // --- FPS 采样监控（基于 requestAnimationFrame）---

  /**
   * 单帧采样回调
   * 每 60 帧计算一次 FPS 和平均帧时间
   */
  function sampleFrame(timestamp: number): void {
    if (!isMonitoring) return;

    if (lastFrameTime > 0) {
      const delta = timestamp - lastFrameTime;
      frameTimeAccumulator += delta;
      frameCount++;
    }
    lastFrameTime = timestamp;

    // 每 60 帧更新一次 FPS 值
    if (frameCount >= FPS_SAMPLE_SIZE) {
      const avgFrameTime = frameTimeAccumulator / frameCount;
      frameTime.value = Math.round(avgFrameTime * 100) / 100;
      fps.value = avgFrameTime > 0 ? Math.round(1000 / avgFrameTime) : 0;
      // 重置采样窗口
      frameCount = 0;
      frameTimeAccumulator = 0;
    }

    rafId = requestAnimationFrame(sampleFrame);
  }

  /**
   * 启动 FPS 监控
   * 使用 requestAnimationFrame 采样，不创建额外定时器
   */
  function startMonitoring(): void {
    if (isMonitoring) return;
    isMonitoring = true;
    lastFrameTime = 0;
    frameCount = 0;
    frameTimeAccumulator = 0;
    rafId = requestAnimationFrame(sampleFrame);
    log.debug(`[Terminal ${sessionId}] FPS 监控已启动`);
  }

  /**
   * 停止 FPS 监控
   */
  function stopMonitoring(): void {
    isMonitoring = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    log.debug(`[Terminal ${sessionId}] FPS 监控已停止`);
  }

  // --- 性能指标查询 ---

  /**
   * 获取完整的渲染性能指标
   */
  function getMetrics(): RenderMetrics {
    const metrics: RenderMetrics = {
      renderMode: renderMode.value,
      activeRenderer: activeRenderer.value,
      fps: fps.value,
      frameTime: frameTime.value,
      contextState: contextState.value,
      contextLossCount: contextLossCount.value,
    };

    if (renderMode.value === 'webgpu' || webgpuState.value !== 'unsupported') {
      metrics.webgpuState = webgpuState.value;
    }

    return metrics;
  }

  // --- 初始化与清理 ---

  /**
   * 初始化渲染器：在 terminal 打开后调用
   * 根据当前 renderMode 加载对应的渲染 addon
   */
  function initRenderer(): void {
    const term = terminal.value;
    if (!term) return;

    // 加载 Unicode11Addon 支持 CJK 宽字符对齐
    try {
      const unicode11Addon = new Unicode11Addon();
      term.loadAddon(unicode11Addon);
      term.unicode.activeVersion = '11';
      log.info(`[Terminal ${sessionId}] Unicode11Addon 已加载，CJK 宽字符对齐已启用`);
    } catch (error: unknown) {
      log.warn(`[Terminal ${sessionId}] Unicode11Addon 加载失败:`, error);
    }

    applyRendererMode(term);
  }

  /**
   * 清理所有资源
   * 在组件卸载或 terminal 销毁时调用
   */
  function cleanup(): void {
    stopMonitoring();
    disposeWebglAddon();
    disposeWebGPU();
    contextState.value = 'unavailable';
  }

  onBeforeUnmount(() => {
    cleanup();
  });

  return {
    /** 当前配置的渲染模式 */
    renderMode,
    /** 实际生效的渲染器类型 */
    activeRenderer,
    /** WebGL 上下文状态 */
    contextState,
    /** 上下文丢失累计次数 */
    contextLossCount,
    /** 当前 FPS 值 */
    fps,
    /** 最近 60 帧的平均帧时间（毫秒） */
    frameTime,
    /** WebGPU 能力检测与设备初始化状态 */
    webgpuState,

    /** 设置渲染模式并应用 */
    setRenderMode,
    /** 初始化渲染器（terminal 打开后调用） */
    initRenderer,
    /** 启动 FPS 监控 */
    startMonitoring,
    /** 停止 FPS 监控 */
    stopMonitoring,
    /** 获取完整渲染性能指标 */
    getMetrics,
    /** 清理所有资源 */
    cleanup,
  };
}
