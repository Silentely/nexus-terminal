/**
 * WebRTC 低延迟 Tunnel — 继承 Guacamole.Tunnel 接口
 *
 * 通过 WebRTC DataChannel 传输 Guacamole 协议消息，
 * 比 WebSocket 更低延迟且无 TCP 队头阻塞。
 *
 * 信令通过 WebSocket 与后端交换 SDP offer/answer 和 ICE candidate。
 * DataChannel 建立后，Guacamole 消息通过 DataChannel 传输。
 *
 * 使用方式：
 *   const tunnel = new WebRTCTunnel(signalingUrl, rtcConfig);
 *   tunnel.connect(); // 启动信令 + 连接
 *   // 当 DataChannel 建立后，可配合 Guacamole.Client 使用
 */

import Guacamole from 'guacamole-common-js';
import type { Tunnel as GuacamoleTunnel } from 'guacamole-common-js';
import { log } from '@/utils/log';

/** 信令消息类型 */
interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'error' | 'ready';
  payload?: unknown;
  sessionId?: string;
  remoteGatewayUrl?: string;
}

/** WebRTC Tunnel 配置 */
export interface WebRTCTunnelConfig {
  /** 信令 WebSocket URL */
  signalingUrl: string;
  /** 远程网关 WebSocket URL（用于后端桥接） */
  tunnelUrl: string;
  /** ICE 服务器配置 */
  iceServers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  /** 连接超时（毫秒） */
  connectTimeout?: number;
}

// 前端超时不应短于后端 bridge.ts 中 remote-gateway 的 15s 连接窗口。
// 否则 RDP/guacd 握手稍慢时，前端会先行超时并过早回退到 WebSocket。
export const DEFAULT_WEBRTC_CONNECT_TIMEOUT_MS = 20_000;

/** 连接状态 */
type TunnelState = 'idle' | 'signaling' | 'connected' | 'failed' | 'disconnected';

/**
 * WebRTCTunnel — 基于 WebRTC DataChannel 的 Guacamole Tunnel
 *
 * 实现 Guacamole.Tunnel 接口的关键方法：
 * - connect(data)：启动信令流程并建立 DataChannel
 * - sendMessage(elements)：通过 DataChannel 发送 Guacamole 帧
 * - disconnect()：断开所有连接
 */
export class WebRTCTunnel {
  /** 错误回调（兼容 Guacamole.Tunnel 接口） */
  onerror?: (status: { code?: number; message?: string }) => void;
  /** 状态变更回调 */
  onstatechange?: (state: number) => void;

  /** 信令 WebSocket */
  private signalingWs: WebSocket | null = null;
  /** WebRTC PeerConnection */
  private pc: RTCPeerConnection | null = null;
  /** WebRTC DataChannel */
  private dc: RTCDataChannel | null = null;
  /** 当前状态 */
  private state: TunnelState = 'idle';
  /** 会话 ID（由信令服务器分配） */
  private sessionId: string | null = null;
  /** 配置 */
  private config: Required<WebRTCTunnelConfig>;
  /** 连接超时定时器 */
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 已发送/接收消息计数 */
  private msgsSent = 0;
  private msgsReceived = 0;
  /** 待处理的远端 ICE 候选队列（answer 到达前缓存） */
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  /** 待发送的本地 ICE 候选队列（sessionId 到达前缓存） */
  private pendingLocalIceCandidates: RTCIceCandidateInit[] = [];

  constructor(config: WebRTCTunnelConfig) {
    this.config = {
      signalingUrl: config.signalingUrl,
      tunnelUrl: config.tunnelUrl,
      iceServers: config.iceServers || [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.chat.bilibili.com:3478' },
        { urls: 'stun:stun.miwifi.com:3478' },
      ],
      connectTimeout: config.connectTimeout ?? DEFAULT_WEBRTC_CONNECT_TIMEOUT_MS,
    };
  }

  /**
   * 启动 WebRTC 连接（信令 + DataChannel 建立）
   * @param data 连接数据（Guacamole 的初始指令，通常为空字符串）
   */
  connect(data?: string): void {
    // 已连接状态：DataChannel 已 open，Guacamole.Client 调用 connect('') 时直接发送
    if (this.state === 'connected') {
      if (data && this.dc?.readyState === 'open') {
        this.dc.send(data);
      }
      return;
    }

    if (this.state !== 'idle') {
      this.handleError('连接已存在或正在连接中');
      return;
    }

    this.setState('signaling');

    try {
      // 1. 创建 RTCPeerConnection
      this.pc = new RTCPeerConnection({
        iceServers: this.config.iceServers,
      });

      // 2. 设置 DataChannel（浏览器创建，后端通过 onDataChannel 接收）
      this.dc = this.pc.createDataChannel('guacamole', {
        ordered: true,
      });
      this.dc.binaryType = 'arraybuffer';

      this.setupDataChannel();

      // 3. 设置 ICE candidate 回调
      this.pc.onicecandidate = (event) => {
        if (!event.candidate || this.signalingWs?.readyState !== WebSocket.OPEN) return;

        const candidate = event.candidate.toJSON();

        // answer 到达前还没有 sessionId，缓存本地候选
        if (!this.sessionId) {
          this.pendingLocalIceCandidates.push(candidate);
          log.debug(
            `[WebRTCTunnel] 本地 ICE 候选已缓存 (等待 sessionId), 队列长度=${this.pendingLocalIceCandidates.length}`,
          );
          return;
        }

        this.sendSignaling({
          type: 'ice-candidate',
          payload: candidate,
          sessionId: this.sessionId,
        });
      };

      // 4. 监控连接状态
      this.pc.onconnectionstatechange = () => {
        const connectionState = this.pc?.connectionState;
        if (connectionState === 'failed' || connectionState === 'disconnected') {
          this.clearConnectTimer();
          this.handleError(`WebRTC 连接 ${connectionState}`);
          this.onstatechange?.(2); // 2 = Guacamole.Tunnel.State.CLOSED
        }
        // 'connected' 状态不在这里处理，改由 dc.onopen 触发
        // 确保 DataChannel 真正可用后才通知 tunnel OPEN
      };

      // 5. 打开信令 WebSocket
      this.openSignalingWebSocket(data || '');
    } catch (error) {
      this.handleError(`WebRTC 初始化失败: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * 启动 WebRTC 连接并等待连接结果
   * 返回 Promise：连接成功 resolve，失败/超时 reject
   * 用于实现 WebRTC → WebSocket 的异步降级
   */
  connectWithResult(data?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const originalOnError = this.onerror;
      const originalOnStateChange = this.onstatechange;

      // 连接成功：PeerConnection connected → tunnel OPEN
      this.onstatechange = (state: number) => {
        originalOnStateChange?.(state);
        if (state === 1) {
          // OPEN
          this.onerror = originalOnError;
          this.onstatechange = originalOnStateChange;
          resolve();
        }
      };

      // 连接失败：信令错误、超时等
      this.onerror = (status) => {
        originalOnError?.(status);
        this.onerror = originalOnError;
        this.onstatechange = originalOnStateChange;
        reject(new Error(status.message || 'WebRTC 连接失败'));
      };

      this.connect(data);
    });
  }

  /**
   * 通过 DataChannel 发送 Guacamole 消息
   * Guacamole 协议格式: len.value,len.value,...;
   */
  sendMessage(...elements: string[]): void {
    // 与上游 Guacamole.WebSocketTunnel 行为一致：未就绪时静默忽略
    // Guacamole.Client.connect() 后会立即调度 keepalive (nop)，
    // 此时 DataChannel 可能尚未 open，这是正常时序而非错误
    if (!this.dc || this.dc.readyState !== 'open') {
      return;
    }

    // 编码为 Guacamole 指令帧：len.value,len.value,...;（len 为 UTF-8 字节数）
    const enc = new TextEncoder();
    const message = elements.map((el) => `${enc.encode(el).length}.${el}`).join(',') + ';';
    this.dc.send(message);
    this.msgsSent++;

    if (this.msgsSent % 100 === 0) {
      log.debug(`[WebRTCTunnel] 已发送 ${this.msgsSent} 条消息, sessionId=${this.sessionId}`);
    }
  }

  /**
   * 断开所有连接
   */
  disconnect(): void {
    this.clearConnectTimer();
    this.setState('disconnected');

    try {
      this.dc?.close();
      this.pc?.close();
      this.signalingWs?.close();
    } catch (error) {
      log.warn('[WebRTCTunnel] 断开连接时出错:', error);
    }

    this.dc = null;
    this.pc = null;
    this.signalingWs = null;
    this.sessionId = null;
    this.pendingIceCandidates = [];
    this.pendingLocalIceCandidates = [];
    this.onstatechange?.(2); // 2 = Guacamole.Tunnel.State.CLOSED
  }

  /**
   * 获取连接统计信息
   */
  getStats(): {
    state: TunnelState;
    sessionId: string | null;
    msgsSent: number;
    msgsReceived: number;
  } {
    return {
      state: this.state,
      sessionId: this.sessionId,
      msgsSent: this.msgsSent,
      msgsReceived: this.msgsReceived,
    };
  }

  /**
   * 设置 DataChannel 事件处理
   */
  private setupDataChannel(): void {
    if (!this.dc) return;

    this.dc.onopen = () => {
      log.info(`[WebRTCTunnel] DataChannel 已打开, sessionId=${this.sessionId}`);
      // DataChannel 真正可用后才通知 tunnel OPEN
      this.clearConnectTimer();
      this.setState('connected');
      this.onstatechange?.(1); // 1 = Guacamole.Tunnel.State.OPEN
    };

    this.dc.onmessage = (event) => {
      this.msgsReceived++;
      // 二进制数据解码：后端可能发送 ArrayBuffer（如 WebSocket 库的二进制帧）
      let data: string;
      if (event.data instanceof ArrayBuffer) {
        data = new TextDecoder().decode(event.data);
      } else if (event.data instanceof Blob) {
        // Blob 需异步读取，此处降级为 ArrayBuffer 处理
        event.data
          .arrayBuffer()
          .then((buf) => {
            const decoded = new TextDecoder().decode(buf);
            this.handleDataChannelMessage(decoded);
          })
          .catch((err) => {
            log.error(`[WebRTCTunnel] Blob 解码失败, sessionId=${this.sessionId}:`, err);
          });
        return;
      } else {
        data = event.data as string;
      }
      this.handleDataChannelMessage(data);
    };

    this.dc.onclose = () => {
      console.debug(`[WebRTCTunnel] DataChannel 已关闭, sessionId=${this.sessionId}`);
      if (this.state === 'connected') {
        this.handleError('DataChannel 意外关闭');
      }
    };

    this.dc.onerror = (event) => {
      log.error(`[WebRTCTunnel] DataChannel 错误, sessionId=${this.sessionId}:`, event);
      this.handleError('DataChannel 错误');
    };
  }

  /**
   * 处理 DataChannel 上接收到的 Guacamole 消息
   * Guacamole 帧格式: len.value,len.value,...;
   * len 是 UTF-8 字节数，value 是原始 UTF-8 字节序列
   *
   * 由于 len 以字节计，解析必须在字节级别进行：
   * 先将字符串编码回 Uint8Array，按字节偏移读取长度和值，
   * 再对每个值片段做 TextDecoder 解码为字符串。
   */
  private handleDataChannelMessage(data: string): void {
    const bytes = new TextEncoder().encode(data);
    let offset = 0;

    while (offset < bytes.length) {
      // 查找 '.' 定位长度字段结束
      const dotByte = bytes.indexOf(0x2e /* '.' */, offset);
      if (dotByte === -1) break;

      // 解析元素字节长度
      const lenBytes = bytes.slice(offset, dotByte);
      const elementLen = parseInt(new TextDecoder().decode(lenBytes), 10);
      if (isNaN(elementLen)) break;

      // 提取元素值（UTF-8 字节数精确匹配）
      const valueStart = dotByte + 1;
      const valueBytes = bytes.slice(valueStart, valueStart + elementLen);
      const value = new TextDecoder().decode(valueBytes);
      offset = valueStart + elementLen;

      // 读取后续逗号分隔的元素
      const args: string[] = [value];
      while (offset < bytes.length && bytes[offset] === 0x2c /* ',' */) {
        offset++; // 跳过逗号
        const nextDot = bytes.indexOf(0x2e, offset);
        if (nextDot === -1) break;

        const nextLen = parseInt(new TextDecoder().decode(bytes.slice(offset, nextDot)), 10);
        if (isNaN(nextLen)) break;

        const nextValueStart = nextDot + 1;
        args.push(new TextDecoder().decode(bytes.slice(nextValueStart, nextValueStart + nextLen)));
        offset = nextValueStart + nextLen;
      }

      // 跳过指令终止符 ';'
      if (offset < bytes.length && bytes[offset] === 0x3b /* ';' */) {
        offset++;
      }

      // oninstruction(opcode, args) — 第一个元素是 opcode，其余是参数
      if (args.length > 0) {
        this.oninstruction?.(args[0], args.slice(1));
      }
    }
  }

  /**
   * 指令接收回调（由 Guacamole.Client 设置）
   * @param opcode 指令操作码
   * @param args 指令参数列表
   */
  oninstruction?: (opcode: string, args: string[]) => void;

  /**
   * 打开信令 WebSocket
   */
  private openSignalingWebSocket(data: string): void {
    try {
      this.signalingWs = new WebSocket(this.config.signalingUrl);

      this.signalingWs.onopen = () => {
        console.debug('[WebRTCTunnel] 信令 WebSocket 已连接');

        // 生成 SDP offer 并发送
        this.createAndSendOffer(data);
      };

      this.signalingWs.onmessage = (event) => {
        try {
          const message: SignalingMessage = JSON.parse(event.data as string);
          this.handleSignalingMessage(message, data);
        } catch (error) {
          log.error('[WebRTCTunnel] 解析信令消息失败:', error);
        }
      };

      this.signalingWs.onerror = (error) => {
        log.error('[WebRTCTunnel] 信令 WebSocket 错误:', error);
        this.handleError('信令连接失败');
      };

      this.signalingWs.onclose = () => {
        if (this.state === 'signaling') {
          this.handleError('信令连接关闭');
        }
      };

      // 启动连接超时
      this.startConnectTimer();
    } catch (error) {
      this.handleError(`创建信令 WebSocket 失败: ${error}`);
    }
  }

  /**
   * 创建 SDP Offer 并发送给信令服务器
   */
  private async createAndSendOffer(_data: string): Promise<void> {
    if (!this.pc) return;

    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.sendSignaling({
        type: 'offer',
        payload: this.pc.localDescription,
        remoteGatewayUrl: this.config.tunnelUrl,
      });
    } catch (error) {
      this.handleError(`创建 SDP Offer 失败: ${error}`);
    }
  }

  /**
   * 处理信令消息
   */
  private async handleSignalingMessage(message: SignalingMessage, _data: string): Promise<void> {
    switch (message.type) {
      case 'answer':
        await this.handleAnswer(message);
        break;
      case 'ice-candidate':
        await this.handleRemoteIceCandidate(message);
        break;
      case 'error':
        this.handleError(message.payload as string);
        break;
      default:
        log.warn(`[WebRTCTunnel] 未知信令消息类型: ${message.type}`);
    }
  }

  /**
   * 处理 SDP Answer
   * 设置 remote description 后，flush 缓存的本地和远端 ICE candidates
   */
  private async handleAnswer(message: SignalingMessage): Promise<void> {
    if (!this.pc || !message.payload) return;

    try {
      this.sessionId = message.sessionId || null;
      await this.pc.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
      console.debug(`[WebRTCTunnel] SDP Answer 已设置, sessionId=${this.sessionId}`);

      // flush 缓存的本地 ICE 候选（answer 前 onicecandidate 产生的）
      this.flushPendingLocalIceCandidates();
      // flush 缓存的远端 ICE 候选（answer 前后端转发的）
      await this.flushPendingRemoteIceCandidates();
    } catch (error) {
      this.handleError(`设置 SDP Answer 失败: ${error}`);
    }
  }

  /**
   * flush 缓存的本地 ICE 候选（answer 前 onicecandidate 产生的）
   * 此时 sessionId 已可用，可安全发送给后端
   */
  private flushPendingLocalIceCandidates(): void {
    if (!this.sessionId || this.pendingLocalIceCandidates.length === 0) return;

    const candidates = this.pendingLocalIceCandidates.splice(0);
    log.debug(`[WebRTCTunnel] flush ${candidates.length} 个缓存的本地 ICE 候选`);
    for (const candidate of candidates) {
      this.sendSignaling({
        type: 'ice-candidate',
        payload: candidate,
        sessionId: this.sessionId,
      });
    }
  }

  /**
   * flush 缓存的远端 ICE 候选（answer 前后端转发的）
   * 此时 remote description 已设置，可安全添加到 PeerConnection
   */
  private async flushPendingRemoteIceCandidates(): Promise<void> {
    if (!this.pc || this.pendingIceCandidates.length === 0) return;

    const candidates = this.pendingIceCandidates.splice(0);
    log.debug(`[WebRTCTunnel] flush ${candidates.length} 个缓存的远端 ICE 候选`);
    for (const candidate of candidates) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (err) {
        log.warn('[WebRTCTunnel] flush 缓存远端 ICE 候选失败:', err);
      }
    }
  }

  /**
   * 处理远程 ICE Candidate
   * ICE candidates 可能在 SDP answer 之前到达（WebRTC 信令竞态），
   * 此时缓存到队列，待 answer 设置 remote description 后统一 flush
   */
  private async handleRemoteIceCandidate(message: SignalingMessage): Promise<void> {
    if (!this.pc || !message.payload) return;

    const candidate = message.payload as RTCIceCandidateInit;

    // remote description 未设置时缓存候选
    if (!this.pc.remoteDescription) {
      this.pendingIceCandidates.push(candidate);
      log.debug(
        `[WebRTCTunnel] ICE 候选已缓存 (等待 answer), 队列长度=${this.pendingIceCandidates.length}`,
      );
      return;
    }

    try {
      await this.pc.addIceCandidate(candidate);
    } catch (error) {
      log.warn('[WebRTCTunnel] 添加远程 ICE Candidate 失败:', error);
    }
  }

  /**
   * 发送信令消息
   */
  private sendSignaling(message: SignalingMessage): void {
    if (this.signalingWs?.readyState === WebSocket.OPEN) {
      this.signalingWs.send(JSON.stringify(message));
    }
  }

  /**
   * 设置连接超时
   */
  private startConnectTimer(): void {
    if (this.config.connectTimeout <= 0) {
      return;
    }

    this.connectTimer = setTimeout(() => {
      if (this.state === 'signaling') {
        this.handleError('WebRTC 连接超时');
      }
    }, this.config.connectTimeout);
  }

  /**
   * 清除连接超时
   */
  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  /**
   * 设置状态
   */
  private setState(state: TunnelState): void {
    this.state = state;
  }

  /**
   * 处理错误
   */
  private handleError(message: string): void {
    log.error(`[WebRTCTunnel] ${message}`);
    this.setState('failed');
    this.onerror?.({
      code: 0x0100, // Guacamole status code for connection error
      message,
    });
  }
}

/**
 * WebRTC 连接 composable
 * 提供 WebRTC 优先 + WebSocket 降级的连接策略
 */
export function useWebRTCTunnel() {
  /**
   * 创建 Tunnel：优先 WebRTC，失败降级到 WebSocket
   * @param tunnelUrl WebSocket Tunnel URL（降级时使用）
   * @param signalingUrl 信令 WebSocket URL（WebRTC 使用）
   * @param preferWebRTC 是否优先使用 WebRTC
   * @param rtcConfig 可选 ICE 配置
   * @returns Guacamole.Tunnel 实例
   */
  async function createTunnel(
    tunnelUrl: string,
    signalingUrl: string,
    preferWebRTC: boolean = true,
    rtcConfig?: { iceServers?: WebRTCTunnelConfig['iceServers'] },
  ): Promise<{ tunnel: GuacamoleTunnel; transport: 'webrtc' | 'websocket' }> {
    // WebRTC 优先
    if (preferWebRTC && typeof window !== 'undefined' && 'RTCPeerConnection' in window) {
      const webrtcTunnel = new WebRTCTunnel({
        signalingUrl,
        tunnelUrl,
        iceServers: rtcConfig?.iceServers,
        connectTimeout: DEFAULT_WEBRTC_CONNECT_TIMEOUT_MS,
      });

      try {
        log.info('[useWebRTCTunnel] 尝试 WebRTC 连接...');

        // 等待 WebRTC 连接实际建立（信令 + DataChannel open）
        await webrtcTunnel.connectWithResult();

        log.info('[useWebRTCTunnel] WebRTC 连接成功');
        return {
          tunnel: webrtcTunnel as unknown as GuacamoleTunnel,
          transport: 'webrtc',
        };
      } catch (error) {
        // 释放失败的 WebRTC 资源（RTCPeerConnection、DataChannel、signaling WebSocket）
        webrtcTunnel.disconnect();
        log.warn('[useWebRTCTunnel] WebRTC 连接失败，降级到 WebSocket:', error);
      }
    }

    // 降级到 WebSocket
    log.info('[useWebRTCTunnel] 使用 WebSocket 连接');
    const wsTunnel = new Guacamole.WebSocketTunnel(tunnelUrl);
    return {
      tunnel: wsTunnel,
      transport: 'websocket',
    };
  }

  /**
   * 检查 WebRTC 是否可用
   */
  function isWebRTCSupported(): boolean {
    return typeof window !== 'undefined' && 'RTCPeerConnection' in window;
  }

  /**
   * 获取 ICE 配置（从后端环境变量读取）
   */
  function getDefaultICEConfig(): WebRTCTunnelConfig['iceServers'] {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.chat.bilibili.com:3478' },
      { urls: 'stun:stun.miwifi.com:3478' },
    ];
  }

  return {
    createTunnel,
    isWebRTCSupported,
    getDefaultICEConfig,
  };
}
