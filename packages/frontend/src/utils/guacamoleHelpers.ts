/**
 * Guacamole / 远程桌面共用工具
 * 供 RDP 与 VNC 模态框复用，避免状态映射、按键与隧道创建逻辑分叉。
 */

import Guacamole from 'guacamole-common-js';
import type { Tunnel as GuacamoleTunnel } from 'guacamole-common-js';
import { log } from '@/utils/log';
import { useWebRTCTunnel } from '@/composables/useWebRTCTunnel';

/** Guacamole 状态码 → 连接状态与 i18n 键片段 */
export type RemoteDesktopConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface GuacamoleStatusPayload {
  code?: number | string;
  message?: string;
}

export interface GuacamoleStateMapping {
  /** 连接状态机状态 */
  connectionStatus: RemoteDesktopConnectionStatus;
  /** remoteDesktopModal.status.* 的 key 片段 */
  i18nKeyPart: string;
}

/** 特殊字符 → X11 keysym */
export const SPECIAL_KEYSYMS: Record<string, number> = {
  '\n': 0xff0d, // Enter (XK_Return)
  '\r': 0xff0d, // Enter (XK_Return)
  '\t': 0xff09, // Tab (XK_Tab)
  '\b': 0xff08, // Backspace (XK_BackSpace)
  '\x1b': 0xff1b, // Escape (XK_Escape)
  '\x7f': 0xffff, // Delete (XK_Delete)
};

/**
 * 规范化 Guacamole 错误/状态对象
 */
export function normalizeGuacamoleStatus(status: unknown): GuacamoleStatusPayload {
  if (status && typeof status === 'object') {
    return status as GuacamoleStatusPayload;
  }
  return {};
}

/**
 * 将字符转换为 X11 keysym（用于模拟键盘输入）
 * 空字符串返回 0，避免 NaN 传入 Guacamole
 */
export function charToKeysym(char: string): number {
  if (!char) return 0;
  if (char in SPECIAL_KEYSYMS) return SPECIAL_KEYSYMS[char];
  // 可打印 ASCII 与 BMP Unicode 码点与 X11 keysym 一致（多字节取首码点）
  return char.codePointAt(0) ?? 0;
}

/**
 * 将 Guacamole Client 状态码映射为 UI 状态
 * @param state Guacamole.Client 状态（0–5）
 * @param connectingKey 连接中阶段的 i18n 键片段（RDP: connectingRdp，VNC: connectingVnc）
 */
export function mapGuacamoleClientState(
  state: number,
  connectingKey: 'connectingRdp' | 'connectingVnc' = 'connectingRdp',
): GuacamoleStateMapping {
  switch (state) {
    case 0: // IDLE
      return { connectionStatus: 'disconnected', i18nKeyPart: 'idle' };
    case 1: // CONNECTING
      return { connectionStatus: 'connecting', i18nKeyPart: connectingKey };
    case 2: // WAITING
      return { connectionStatus: 'connecting', i18nKeyPart: 'waiting' };
    case 3: // CONNECTED
      return { connectionStatus: 'connected', i18nKeyPart: 'connected' };
    case 4: // DISCONNECTING
      return { connectionStatus: 'disconnected', i18nKeyPart: 'disconnecting' };
    case 5: // DISCONNECTED
      return { connectionStatus: 'disconnected', i18nKeyPart: 'disconnected' };
    default:
      return { connectionStatus: 'disconnected', i18nKeyPart: 'unknownState' };
  }
}

/**
 * 基于当前页面 origin 构建 WebSocket 基础地址
 */
export function buildRemoteDesktopWsBase(): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/ws`;
}

/**
 * 构建 rdp-proxy 隧道 URL
 * 使用 encodeURIComponent 与历史行为对齐（避免 URLSearchParams 将空格编码为 + 的差异）
 */
export function buildRdpProxyTunnelUrl(
  token: string,
  width: number,
  height: number,
  dpi?: number,
): string {
  const base = buildRemoteDesktopWsBase();
  const normalizeDim = (value: number, fallback: number): number => {
    if (!Number.isFinite(value)) return fallback;
    const floored = Math.floor(value);
    return floored >= 1 ? floored : fallback;
  };
  const safeWidth = normalizeDim(width, 800);
  const safeHeight = normalizeDim(height, 600);
  let url = `${base}/rdp-proxy?token=${encodeURIComponent(token)}&width=${safeWidth}&height=${safeHeight}`;
  if (dpi !== undefined && Number.isFinite(dpi) && dpi >= 1) {
    url += `&dpi=${Math.floor(dpi)}`;
  }
  return url;
}

/**
 * 清空显示容器子节点
 */
export function clearDisplayElement(el: HTMLElement | null | undefined): void {
  if (!el) return;
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

export interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

/**
 * 保守判断是否为低端设备（用于可选 WebCodecs 初始化）
 */
export function isLowEndDevice(
  nav: NavigatorWithDeviceMemory = navigator as NavigatorWithDeviceMemory,
): boolean {
  const hardwareConcurrency = nav.hardwareConcurrency || 0;
  const deviceMemory = nav.deviceMemory || 0;
  return (
    (hardwareConcurrency > 0 && hardwareConcurrency <= 4) || (deviceMemory > 0 && deviceMemory <= 4)
  );
}

export interface CreateTunnelResult {
  tunnel: GuacamoleTunnel;
  transportType: 'webrtc' | 'websocket';
}

/**
 * 优先 WebRTC 建隧道，失败时降级 WebSocket
 * @param tunnelUrl Guacamole WebSocket 隧道 URL
 * @param logPrefix 日志前缀，如 RDP / VNC
 */
export async function createGuacamoleTunnelWithFallback(
  tunnelUrl: string,
  logPrefix = 'RemoteDesktop',
): Promise<CreateTunnelResult> {
  const { createTunnel, isWebRTCSupported } = useWebRTCTunnel();
  const signalingUrl = `${buildRemoteDesktopWsBase()}/webrtc-signaling`;

  try {
    if (isWebRTCSupported()) {
      const result = await createTunnel(tunnelUrl, signalingUrl, true);
      log.debug(`[${logPrefix}] 使用 ${result.transport} 传输`);
      return {
        tunnel: result.tunnel,
        transportType: result.transport === 'webrtc' ? 'webrtc' : 'websocket',
      };
    }
    return {
      tunnel: new Guacamole.WebSocketTunnel(tunnelUrl),
      transportType: 'websocket',
    };
  } catch {
    log.warn(`[${logPrefix}] WebRTC 连接失败，降级到 WebSocket`);
    return {
      tunnel: new Guacamole.WebSocketTunnel(tunnelUrl),
      transportType: 'websocket',
    };
  }
}

/**
 * 将剪贴板文本写入 Guacamole 流
 */
export function sendClipboardTextToGuacamole(
  client: InstanceType<typeof Guacamole.Client>,
  text: string,
): void {
  const stream = client.createClipboardStream('text/plain');
  const writer = new Guacamole.StringWriter(stream);
  writer.sendText(text);
  writer.sendEnd();
}

/**
 * 模拟键盘输入字符串（VNC 粘贴等场景）
 * 空文本直接返回；按 Unicode 码点迭代（避免代理对拆成半字符）
 */
export async function simulateKeyboardInput(
  client: InstanceType<typeof Guacamole.Client>,
  text: string,
  options?: { pressDelayMs?: number; releaseDelayMs?: number },
): Promise<void> {
  if (!text) return;

  const pressDelayMs = options?.pressDelayMs ?? 20;
  const releaseDelayMs = options?.releaseDelayMs ?? 30;

  for (const char of text) {
    const keysym = charToKeysym(char);
    if (!keysym) continue;
    client.sendKeyEvent(1, keysym);
    await new Promise((resolve) => setTimeout(resolve, pressDelayMs));
    client.sendKeyEvent(0, keysym);
    await new Promise((resolve) => setTimeout(resolve, releaseDelayMs));
  }
}
