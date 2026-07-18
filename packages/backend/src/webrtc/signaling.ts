/**
 * WebRTC 信令端点
 *
 * 负责浏览器与后端之间的 SDP offer/answer 交换和 ICE candidate 中继。
 * 信令完成后，建立 WebRTC DataChannel 用于传输 Guacamole 协议消息。
 *
 * 信令流程：
 * 1. 浏览器创建 RTCPeerConnection，生成 SDP offer
 * 2. 浏览器通过 WebSocket 发送 offer 到此端点
 * 3. 后端创建 RTCPeerConnection，设置 remote description，生成 SDP answer
 * 4. 后端通过 WebSocket 返回 answer 给浏览器
 * 5. 双方交换 ICE candidate
 * 6. DataChannel 建立后，由 bridge.ts 负责桥接到 remote-gateway
 */

import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { RTCPeerConnection, RTCDataChannel } from 'werift';
import { logger } from '../utils/logger';

/** 信令消息类型 */
interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'error' | 'ready';
  payload?: unknown;
  remoteGatewayUrl?: string;
}

/** WebRTC 连接配置 */
export interface WebRTCConfig {
  /** STUN/TURN 服务器配置 */
  iceServers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
}

/** 活跃的 WebRTC 会话 */
interface ActiveWebRTCSession {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  ws: WebSocket;
  sessionId: string;
  remoteGatewayUrl: string;
  createdAt: number;
  /** remote description 设置前到达的浏览器 ICE 候选 */
  pendingRemoteIceCandidates: RTCIceCandidateInit[];
  remoteDescriptionSet: boolean;
}

type WeriftIceServer = {
  urls: string;
  username?: string;
  credential?: string;
};

/** 活跃会话映射 (sessionId -> session) */
const activeSessions = new Map<string, ActiveWebRTCSession>();

/** 获取 ICE 配置 */
export function getICEConfig(): WebRTCConfig {
  const stunUrls = process.env.WEBRTC_STUN_URLS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) || [
    // 国际 — Google
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    // 国际 — Cloudflare（高可用，支持 TCP/UDP）
    'stun:stun.cloudflare.com:3478',
    // 国内 — Bilibili（阿里云，国内 WebRTC 场景常用）
    'stun:stun.chat.bilibili.com:3478',
    // 国内 — 小米路由器（中国联通北京，NAT 测试工具默认服务器）
    'stun:stun.miwifi.com:3478',
  ];

  const iceServers: WebRTCConfig['iceServers'] = [{ urls: stunUrls }];

  // 可选 TURN 服务器
  const turnUrls = process.env.WEBRTC_TURN_URLS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (turnUrls && turnUrls.length > 0) {
    iceServers.push({
      urls: turnUrls,
      username: process.env.WEBRTC_TURN_USERNAME || '',
      credential: process.env.WEBRTC_TURN_CREDENTIAL || '',
    });
  }

  return { iceServers };
}

export function getWeriftICEConfig(): WeriftIceServer[] {
  return getICEConfig().iceServers.flatMap((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];

    return urls.map((url) => ({
      urls: url,
      username: server.username,
      credential: server.credential,
    }));
  });
}

/**
 * 处理单个信令 WebSocket 连接
 */
function handleSignalingConnection(clientWs: WebSocket): void {
  let session: ActiveWebRTCSession | null = null;
  let sessionId = '';

  clientWs.on('message', async (data: Buffer | string) => {
    try {
      const message: SignalingMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'offer':
          {
            const newSession = await handleOffer(clientWs, message);
            if (newSession) {
              sessionId = newSession.sessionId;
              session = newSession;
            }
          }
          break;
        case 'ice-candidate':
          await handleIceCandidate(clientWs, message);
          break;
        default:
          sendError(clientWs, `未知消息类型: ${message.type}`);
      }
    } catch (error) {
      logger.error('[WebRTC Signaling] 处理消息失败:', error);
      sendError(clientWs, `消息处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  });

  clientWs.on('close', () => {
    // 信令 WebSocket 关闭时，仅在 DataChannel 未建立的情况下清理会话
    // DataChannel 建立后信令通道不再需要，其关闭属于正常行为
    // Nginx 默认 proxy_read_timeout (60s) 会关闭空闲信令连接，不应因此中断正在进行的远程桌面会话
    if (session && !session.dc) {
      cleanupSession(session);
    } else if (session?.dc) {
      logger.debug(`[WebRTC Signaling] 信令通道关闭，DataChannel 保持活跃: ${sessionId}`);
    }
    logger.debug(`[WebRTC Signaling] 客户端断开: ${sessionId}`);
  });

  clientWs.on('error', (error) => {
    logger.error(`[WebRTC Signaling] WebSocket 错误: ${sessionId}`, error);
    // 同上：仅在 DataChannel 未建立时清理
    if (session && !session.dc) {
      cleanupSession(session);
    }
  });
}

/**
 * 处理 SDP offer：创建后端 RTCPeerConnection 并生成 answer
 */
async function handleOffer(
  clientWs: WebSocket,
  message: SignalingMessage,
): Promise<ActiveWebRTCSession | null> {
  const offer = message.payload as RTCSessionDescriptionInit;

  if (!offer || offer.type !== 'offer') {
    sendError(clientWs, '无效的 SDP offer');
    return null;
  }

  // 提取 remoteGatewayUrl（从 offer 消息中获取）
  const remoteGatewayUrl = message.remoteGatewayUrl || '';
  if (!remoteGatewayUrl) {
    logger.error('[WebRTC Signaling] offer 缺少 remoteGatewayUrl');
    sendError(clientWs, 'offer 缺少 remoteGatewayUrl');
    return null;
  }

  const sessionId = `webrtc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const iceServers = getWeriftICEConfig();

  // 创建 RTCPeerConnection
  const pc = new RTCPeerConnection({ iceServers });

  const session: ActiveWebRTCSession = {
    pc,
    dc: null,
    ws: clientWs,
    sessionId,
    remoteGatewayUrl,
    createdAt: Date.now(),
    pendingRemoteIceCandidates: [],
    remoteDescriptionSet: false,
  };

  activeSessions.set(sessionId, session);

  // 设置 ICE candidate 回调
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pc as unknown as any).onicecandidate = (event: Record<string, unknown>) => {
    const candidate = event.candidate as RTCIceCandidateInit | null;
    if (candidate && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: 'ice-candidate',
          payload: candidate,
          sessionId,
        }),
      );
    }
  };

  // 设置 DataChannel 回调（浏览器创建的 DataChannel）
  // 注意：werift 使用全小写属性名 ondatachannel（非标准 WebRTC API 的 onDataChannel）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pc as unknown as any).ondatachannel = (event: Record<string, unknown>) => {
    const dc = event.channel as RTCDataChannel;
    session.dc = dc;
    logger.info(`[WebRTC Signaling] DataChannel 已建立: ${sessionId}`);

    // 导入桥接模块处理 DataChannel ↔ WebSocket 转发
    // 通过 onClosed 回调确保桥接清理时同步清理 session/pc，防止内存泄漏
    import('./bridge.js').then(({ bridgeDataChannelToGateway }) => {
      bridgeDataChannelToGateway(dc, session.remoteGatewayUrl, sessionId, () => {
        logger.debug(`[WebRTC Signaling] 桥接关闭，清理会话: ${sessionId}`);
        try {
          pc.close();
        } catch (err: unknown) {
          logger.debug({ err }, '操作失败，已忽略');
        }
        activeSessions.delete(sessionId);
      });
    });
  };

  // 设置 remote description（浏览器的 offer）
  await pc.setRemoteDescription(offer);
  session.remoteDescriptionSet = true;

  // flush 在 setRemoteDescription 前缓存的浏览器 ICE 候选
  if (session.pendingRemoteIceCandidates.length > 0) {
    const queued = session.pendingRemoteIceCandidates.splice(0);
    logger.debug(`[WebRTC Signaling] flush ${queued.length} 个缓存的远端 ICE 候选: ${sessionId}`);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        logger.warn(`[WebRTC Signaling] flush 缓存 ICE candidate 失败: ${sessionId}`, error);
      }
    }
  }

  // 创建 answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // 发送 answer 给浏览器
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(
      JSON.stringify({
        type: 'answer',
        payload: answer,
        sessionId,
      }),
    );
  }

  logger.debug(`[WebRTC Signaling] SDP answer 已发送: ${sessionId}`);
  return session;
}

/**
 * 处理 ICE candidate：将浏览器的 ICE candidate 添加到后端 PeerConnection
 */
async function handleIceCandidate(clientWs: WebSocket, message: SignalingMessage): Promise<void> {
  const candidate = message.payload as RTCIceCandidateInit;
  const sessionId = (message as unknown as Record<string, string>).sessionId;

  if (!sessionId) {
    sendError(clientWs, '缺少 sessionId');
    return;
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    sendError(clientWs, `会话不存在: ${sessionId}`);
    return;
  }

  // remote description 尚未就绪时先缓存，避免 offer 处理中的竞态丢候选
  if (!session.remoteDescriptionSet) {
    session.pendingRemoteIceCandidates.push(candidate);
    logger.debug(
      `[WebRTC Signaling] ICE candidate 已缓存 (等待 remote description): ${sessionId}, 队列=${session.pendingRemoteIceCandidates.length}`,
    );
    return;
  }

  try {
    await session.pc.addIceCandidate(candidate);
    logger.debug(`[WebRTC Signaling] ICE candidate 已添加: ${sessionId}`);
  } catch (error) {
    logger.warn(`[WebRTC Signaling] 添加 ICE candidate 失败: ${sessionId}`, error);
  }
}

/**
 * 发送错误消息给客户端
 */
function sendError(ws: WebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', payload: message }));
  }
}

/**
 * 清理 WebRTC 会话
 */
function cleanupSession(session: ActiveWebRTCSession): void {
  try {
    session.dc?.close();
    session.pc.close();
    activeSessions.delete(session.sessionId);
    logger.debug(`[WebRTC Signaling] 会话已清理: ${session.sessionId}`);
  } catch (error) {
    logger.debug(`[WebRTC Signaling] 清理会话时出错: ${session.sessionId}`, error);
  }
}

/**
 * 初始化 WebRTC 信令端点
 * @param wss WebSocket 服务器实例
 */
export function initializeWebRTCSignaling(_wss: WebSocketServer): void {
  // 在现有 WebSocket 服务器上注册 /ws/webrtc-signaling 路由
  // 由 upgrade.ts 统一处理路由分发
  logger.info('[WebRTC Signaling] 信令端点已初始化');
}

/**
 * 处理信令 WebSocket 连接（由 upgrade.ts 调用）
 */
export function handleSignalingConnectionRequest(ws: WebSocket): void {
  handleSignalingConnection(ws);
}

/**
 * 获取活跃 WebRTC 会话统计
 */
export function getWebRTCSessionStats(): { count: number; sessionIds: string[] } {
  return {
    count: activeSessions.size,
    sessionIds: Array.from(activeSessions.keys()),
  };
}
