import WebSocket from 'ws';
import { ClientState, AuthenticatedWebSocket } from './types';
import { SftpService } from '../sftp/sftp.service';
import { StatusMonitorService } from '../services/status-monitor.service';
import { AuditLogService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { DockerService } from '../docker/docker.service';
import { settingsService } from '../settings/settings.service'; // 添加导入

// 存储所有活动客户端的状态 (key: sessionId)
export const clientStates = new Map<string, ClientState>();

// 存储 userId 到 WebSocket 连接集合的映射 (支持一个用户多个连接)
export const userSockets = new Map<number, Set<AuthenticatedWebSocket>>();

/**
 * 注册用户 WebSocket 连接
 * 当新的 WebSocket 连接建立时调用
 * @param userId 用户 ID
 * @param ws WebSocket 连接实例
 */
export function registerUserSocket(userId: number, ws: AuthenticatedWebSocket): void {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId)!.add(ws);
  console.log(
    `[WebSocket 状态] 用户 ${userId} 的连接已注册，当前连接数: ${userSockets.get(userId)!.size}`
  );
}

/**
 * 注销用户 WebSocket 连接
 * 当 WebSocket 连接断开时调用
 * @param userId 用户 ID
 * @param ws WebSocket 连接实例
 */
export function unregisterUserSocket(userId: number, ws: AuthenticatedWebSocket): void {
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) {
      userSockets.delete(userId);
      console.log(`[WebSocket 状态] 用户 ${userId} 的所有连接已断开，已清理映射。`);
    } else {
      console.log(`[WebSocket 状态] 用户 ${userId} 的一个连接已断开，剩余连接数: ${sockets.size}`);
    }
  }
}

/**
 * 向指定用户的所有活动 WebSocket 连接广播消息
 * @param userId 用户 ID
 * @param message 要发送的消息对象（将自动序列化为 JSON）
 * @returns 成功发送的连接数
 */
export function broadcastToUser(userId: number, message: any): number {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) {
    console.warn(`[WebSocket 广播] 用户 ${userId} 没有活动连接，消息未发送。`);
    return 0;
  }

  let successCount = 0;
  const messageStr = JSON.stringify(message);
  const deadSockets: AuthenticatedWebSocket[] = [];

  sockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(messageStr);
        successCount++;
      } catch (error: any) {
        console.error(`[WebSocket 广播] 向用户 ${userId} 的一个连接发送消息失败:`, error.message);
        deadSockets.push(ws);
      }
    } else {
      // 连接未打开（已关闭或正在关闭），标记为死连接
      deadSockets.push(ws);
    }
  });

  // 清理死连接
  if (deadSockets.length > 0) {
    deadSockets.forEach((ws) => sockets.delete(ws));
    console.log(`[WebSocket 广播] 已清理用户 ${userId} 的 ${deadSockets.length} 个死连接。`);

    // 如果所有连接都已死亡，清理整个映射
    if (sockets.size === 0) {
      userSockets.delete(userId);
    }
  }

  console.log(
    `[WebSocket 广播] 已向用户 ${userId} 的 ${successCount}/${sockets.size + deadSockets.length} 个连接发送消息。`
  );
  return successCount;
}

// --- 服务实例化 ---
// 将 clientStates 传递给需要访问共享状态的服务
export const sftpService = new SftpService(clientStates);
export const statusMonitorService = new StatusMonitorService(clientStates);
export const auditLogService = new AuditLogService(); // 实例化 AuditLogService
export const notificationService = new NotificationService(); // 添加实例
export const dockerService = new DockerService(); // 实例化 DockerService (主要用于类型或未来可能的本地调用)
export { settingsService }; // 导出 settingsService
