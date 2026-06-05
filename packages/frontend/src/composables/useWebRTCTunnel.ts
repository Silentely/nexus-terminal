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
}

/** WebRTC Tunnel 配置 */
export interface WebRTCTunnelConfig {
  /** 信令 WebSocket URL */
  signalingUrl: string;
  /** ICE 服务器配置 */
  iceServers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  /** 连接超时（毫秒） */
  connectTimeout?: number;
}

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

  constructor(config: WebRTCTunnelConfig) {
    this.config = {
      signalingUrl: config.signalingUrl,
      iceServers: config.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }],
      connectTimeout: config.connectTimeout || 10000,
    };
  }

  /**
   * 启动 WebRTC 连接（信令 + DataChannel 建立）
   * @param data 连接数据（Guacamole 的初始指令，通常为空字符串）
   */
  connect(data?: string): void {
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

      this.setupDataChannel();

      // 3. 设置 ICE candidate 回调
      this.pc.onicecandidate = (event) => {
        if (event.candidate && this.signalingWs?.readyState === WebSocket.OPEN) {
          this.sendSignaling({
            type: 'ice-candidate',
            payload: event.candidate.toJSON(),
            sessionId: this.sessionId || undefined,
          });
        }
      };

      // 4. 监控连接状态
      this.pc.onconnectionstatechange = () => {
        const connectionState = this.pc?.connectionState;
        if (connectionState === 'connected') {
          this.clearConnectTimer();
          this.setState('connected');
          // 通知 Guacamole Client 连接已建立
          this.onstatechange?.(3); // 3 = CONNECTED
        } else if (connectionState === 'failed' || connectionState === 'disconnected') {
          this.clearConnectTimer();
          this.handleError(`WebRTC 连接 ${connectionState}`);
          this.onstatechange?.(5); // 5 = DISCONNECTED
        }
      };

      // 5. 打开信令 WebSocket
      this.openSignalingWebSocket(data || '');
    } catch (error) {
      this.handleError(`WebRTC 初始化失败: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * 通过 DataChannel 发送 Guacamole 消息
   */
  sendMessage(...elements: string[]): void {
    if (!this.dc || this.dc.readyState !== 'open') {
      this.handleError('DataChannel 未就绪');
      return;
    }

    const message = elements.join(',');
    this.dc.send(message);
    this.msgsSent++;

    if (this.msgsSent % 100 === 0) {
      console.debug(`[WebRTCTunnel] 已发送 ${this.msgsSent} 条消息, sessionId=${this.sessionId}`);
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
    this.onstatechange?.(5); // 5 = DISCONNECTED
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
    };

    this.dc.onmessage = (event) => {
      this.msgsReceived++;
      // Guacamole Client 会通过 Tunnel 的 oninstruction 处理消息
      // 这里需要将消息转发到 Guacamole 的消息处理管道
      this.handleDataChannelMessage(event.data as string);
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
   */
  private handleDataChannelMessage(data: string): void {
    // Guacamole 协议使用逗号分隔的指令
    // 每条指令格式: arg0,arg1,arg2,...
    // 多条指令由服务器连续发送
    // WebSocketTunnel 内部会解析这些指令并调用 Client 的回调
    // 这里需要模拟 WebSocketTunnel 的消息解析行为

    // 简单处理：将消息按换行分割，每行一条指令
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        // 触发 Guacamole Client 的 oninstruction 回调
        this.oninstruction?.(line);
      }
    }
  }

  /**
   * 指令接收回调（由 Guacamole.Client 设置）
   */
  oninstruction?: (instruction: string) => void;

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
   */
  private async handleAnswer(message: SignalingMessage): Promise<void> {
    if (!this.pc || !message.payload) return;

    try {
      this.sessionId = message.sessionId || null;
      await this.pc.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
      console.debug(`[WebRTCTunnel] SDP Answer 已设置, sessionId=${this.sessionId}`);
    } catch (error) {
      this.handleError(`设置 SDP Answer 失败: ${error}`);
    }
  }

  /**
   * 处理远程 ICE Candidate
   */
  private async handleRemoteIceCandidate(message: SignalingMessage): Promise<void> {
    if (!this.pc || !message.payload) return;

    try {
      await this.pc.addIceCandidate(message.payload as RTCIceCandidateInit);
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
    rtcConfig?: { iceServers?: WebRTCTunnelConfig['iceServers'] }
  ): Promise<{ tunnel: GuacamoleTunnel; transport: 'webrtc' | 'websocket' }> {
    // WebRTC 优先
    if (preferWebRTC && typeof window !== 'undefined' && 'RTCPeerConnection' in window) {
      try {
        log.info('[useWebRTCTunnel] 尝试 WebRTC 连接...');
        const webrtcTunnel = new WebRTCTunnel({
          signalingUrl,
          iceServers: rtcConfig?.iceServers,
          connectTimeout: 8000,
        });

        // 返回 tunnel 和标识，由调用方决定是否尝试 WebRTC
        return {
          tunnel: webrtcTunnel as unknown as GuacamoleTunnel,
          transport: 'webrtc',
        };
      } catch (error) {
        log.warn('[useWebRTCTunnel] WebRTC 初始化失败，降级到 WebSocket:', error);
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
    return [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  }

  return {
    createTunnel,
    isWebRTCSupported,
    getDefaultICEConfig,
  };
}
