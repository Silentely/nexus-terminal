/**
 * WebCodecs 视频解码器
 * 用于硬件加速视频帧解码，并在可用时使用高效的 bitmaprenderer 渲染路径。
 */

import { ref, type Ref } from 'vue';
import { log } from '@/utils/log';

export interface UseVideoDecoderOptions {
  /** 用于承载解码帧的画布 */
  canvas: Ref<HTMLCanvasElement | null> | HTMLCanvasElement | null;
  /** 视频编码格式，默认使用 H.264 */
  codec?: string;
  /** 是否优先降低延迟 */
  optimizeForLatency?: boolean;
}

export interface VideoDecoderController {
  /** 当前浏览器是否支持 WebCodecs 解码能力 */
  isSupported: Ref<boolean>;
  /** 当前是否使用 OffscreenCanvas 渲染路径 */
  isUsingOffscreen: Ref<boolean>;
  /** 初始化 VideoDecoder */
  init: () => Promise<boolean>;
  /** 解码单个编码视频帧 */
  decodeFrame: (data: BufferSource, timestamp: number, isKeyFrame: boolean) => void;
  /** 释放解码器与渲染引用 */
  dispose: () => void;
}

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;
type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const DEFAULT_CODEC = 'avc1.42001E';

function isCanvasRef(
  canvas: Ref<HTMLCanvasElement | null> | HTMLCanvasElement | null,
): canvas is Ref<HTMLCanvasElement | null> {
  return Boolean(canvas && typeof canvas === 'object' && 'value' in canvas);
}

export function useVideoDecoder(options: UseVideoDecoderOptions): VideoDecoderController {
  const isSupported = ref(false);
  const isUsingOffscreen = ref(false);

  let videoDecoder: VideoDecoder | null = null;
  let renderCanvas: RenderCanvas | null = null;
  let bitmapContext: ImageBitmapRenderingContext | null = null;
  let canvas2dContext: Canvas2DContext | null = null;

  /**
   * 获取当前目标画布
   */
  function getCanvas(): HTMLCanvasElement | null {
    return isCanvasRef(options.canvas) ? options.canvas.value : options.canvas;
  }

  /**
   * 检测 WebCodecs 基础能力
   */
  function hasWebCodecsSupport(): boolean {
    return (
      typeof window !== 'undefined' && 'VideoDecoder' in window && 'EncodedVideoChunk' in window
    );
  }

  /**
   * 准备渲染画布和上下文
   * 优先使用 OffscreenCanvas 和 bitmaprenderer，失败时降级为主线程 2D Canvas。
   */
  function setupRenderSurface(): boolean {
    if (bitmapContext || canvas2dContext) {
      return true;
    }

    const canvas = getCanvas();
    if (!canvas) {
      log.warn('[VideoDecoder] 未找到可用 canvas，跳过视频帧渲染');
      return false;
    }

    if (!renderCanvas) {
      const canTransferOffscreen =
        typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in canvas;

      if (canTransferOffscreen) {
        try {
          // 缓存已转换的 OffscreenCanvas 到 canvas 元素上，防止重复调用 transferControlToOffscreen
          const customCanvas = canvas as HTMLCanvasElement & { _offscreenCanvas?: OffscreenCanvas };
          if (!customCanvas._offscreenCanvas) {
            customCanvas._offscreenCanvas = canvas.transferControlToOffscreen();
          }
          renderCanvas = customCanvas._offscreenCanvas;
          isUsingOffscreen.value = true;
        } catch (error: unknown) {
          renderCanvas = canvas;
          isUsingOffscreen.value = false;
          log.warn('[VideoDecoder] OffscreenCanvas 初始化失败，降级为主线程 Canvas:', error);
        }
      } else {
        renderCanvas = canvas;
        isUsingOffscreen.value = false;
      }
    }

    try {
      bitmapContext = renderCanvas.getContext(
        'bitmaprenderer',
      ) as ImageBitmapRenderingContext | null;
    } catch (error: unknown) {
      bitmapContext = null;
      log.warn('[VideoDecoder] bitmaprenderer 上下文不可用，尝试 2D Canvas:', error);
    }

    if (!bitmapContext) {
      try {
        canvas2dContext = renderCanvas.getContext('2d') as Canvas2DContext | null;
      } catch (error: unknown) {
        canvas2dContext = null;
        log.warn('[VideoDecoder] 2D Canvas 上下文不可用:', error);
      }
    }

    return Boolean(bitmapContext || canvas2dContext);
  }

  /**
   * 渲染已解码的视频帧
   * VideoFrame 必须在使用后 close，避免长期远程桌面会话泄漏内存。
   */
  async function handleDecodedFrame(frame: VideoFrame): Promise<void> {
    try {
      if (!setupRenderSurface()) {
        return;
      }

      if (bitmapContext && typeof createImageBitmap !== 'undefined') {
        const bitmap = await createImageBitmap(frame);
        try {
          bitmapContext.transferFromImageBitmap(bitmap);
        } finally {
          bitmap.close();
        }
        return;
      }

      if (canvas2dContext) {
        const width = frame.displayWidth || frame.codedWidth;
        const height = frame.displayHeight || frame.codedHeight;
        canvas2dContext.drawImage(frame, 0, 0, width, height);
      }
    } catch (error: unknown) {
      log.warn('[VideoDecoder] 渲染视频帧失败:', error);
    } finally {
      frame.close();
    }
  }

  /**
   * 初始化 WebCodecs VideoDecoder
   */
  async function init(): Promise<boolean> {
    dispose();

    if (!hasWebCodecsSupport()) {
      isSupported.value = false;
      log.info('[VideoDecoder] 当前浏览器不支持 WebCodecs，使用现有渲染路径');
      return false;
    }

    const canvas = getCanvas();
    if (!canvas) {
      isSupported.value = false;
      log.warn('[VideoDecoder] 初始化失败：缺少目标 canvas');
      return false;
    }

    try {
      const decoderConfig: VideoDecoderConfig = {
        codec: options.codec || DEFAULT_CODEC,
        optimizeForLatency: options.optimizeForLatency ?? true,
      };

      const support = await VideoDecoder.isConfigSupported(decoderConfig);
      if (!support.supported) {
        isSupported.value = false;
        log.info(`[VideoDecoder] 当前 codec 不受支持: ${decoderConfig.codec}`);
        return false;
      }

      if (!setupRenderSurface()) {
        isSupported.value = false;
        return false;
      }

      videoDecoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          void handleDecodedFrame(frame);
        },
        error: (error: DOMException) => {
          isSupported.value = false;
          log.warn('[VideoDecoder] 解码器运行错误:', error);
        },
      });
      videoDecoder.configure(decoderConfig);
      isSupported.value = true;
      log.info(`[VideoDecoder] WebCodecs 解码器已初始化，codec=${decoderConfig.codec}`);
      return true;
    } catch (error: unknown) {
      isSupported.value = false;
      videoDecoder = null;
      log.warn('[VideoDecoder] 初始化 WebCodecs 解码器失败:', error);
      return false;
    }
  }

  /**
   * 解码一个编码视频帧
   */
  function decodeFrame(data: BufferSource, timestamp: number, isKeyFrame: boolean): void {
    if (!videoDecoder || videoDecoder.state !== 'configured') {
      log.warn('[VideoDecoder] 解码器尚未就绪，丢弃视频帧');
      return;
    }

    try {
      const chunk = new EncodedVideoChunk({
        type: isKeyFrame ? 'key' : 'delta',
        timestamp,
        data,
      });
      videoDecoder.decode(chunk);
    } catch (error: unknown) {
      log.warn('[VideoDecoder] 提交视频帧解码失败:', error);
    }
  }

  /**
   * 释放解码器与渲染引用
   */
  function dispose(): void {
    if (videoDecoder) {
      try {
        if (videoDecoder.state !== 'closed') {
          videoDecoder.close();
        }
      } catch (error: unknown) {
        log.warn('[VideoDecoder] 关闭解码器时发生异常:', error);
      }
      videoDecoder = null;
    }

    renderCanvas = null;
    bitmapContext = null;
    canvas2dContext = null;
    isUsingOffscreen.value = false;
  }

  return {
    isSupported,
    isUsingOffscreen,
    init,
    decodeFrame,
    dispose,
  };
}
