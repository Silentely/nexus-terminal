import WebSocket, { WebSocketServer } from 'ws';
import { AuthenticatedWebSocket, ClientType } from './types';
import { cleanupClientConnection } from './utils';

// 心跳配置接口
interface HeartbeatConfig {
    desktopInterval: number;      // 桌面端心跳间隔（毫秒）
    mobileInterval: number;       // 移动端心跳间隔（毫秒）
    desktopMaxMissed: number;     // 桌面端最大容忍丢包次数
    mobileMaxMissed: number;      // 移动端最大容忍丢包次数
}

// 默认配置（可以从环境变量或数据库读取）
const DEFAULT_CONFIG: HeartbeatConfig = {
    desktopInterval: parseInt(process.env.HEARTBEAT_INTERVAL_DESKTOP || '30000', 10),
    mobileInterval: parseInt(process.env.HEARTBEAT_INTERVAL_MOBILE || '12000', 10),
    desktopMaxMissed: parseInt(process.env.MAX_MISSED_PONGS_DESKTOP || '1', 10),
    mobileMaxMissed: parseInt(process.env.MAX_MISSED_PONGS_MOBILE || '3', 10),
};

/**
 * 初始化 WebSocket 心跳机制
 * 支持桌面端和移动端不同的心跳参数
 * @param wss WebSocket 服务器实例
 * @param config 心跳配置（可选，默认使用环境变量或内置默认值）
 * @returns 心跳定时器 ID
 */
// 存储每个连接的最后一次 ping 时间（需要在模块外暴露以便清理）
const lastPingTime = new Map<AuthenticatedWebSocket, number>();

/**
 * 清理指定连接的心跳状态（连接关闭时调用）
 * @param ws 要清理的 WebSocket 连接
 */
export function cleanupHeartbeat(ws: AuthenticatedWebSocket): void {
    lastPingTime.delete(ws);
}

/**
 * 初始化 WebSocket 心跳机制
 * 支持桌面端和移动端不同的心跳参数
 * @param wss WebSocket 服务器实例
 * @param config 心跳配置（可选，默认使用环境变量或内置默认值）
 * @returns 心跳定时器 ID
 */
export function initializeHeartbeat(
    wss: WebSocketServer,
    config: HeartbeatConfig = DEFAULT_CONFIG
): NodeJS.Timeout {
    // 使用桌面端和移动端中较小的间隔作为检查间隔
    // 这样可以确保移动端连接得到及时检查
    const checkInterval = Math.min(config.desktopInterval, config.mobileInterval);

    console.log(`WebSocket 心跳配置:
  桌面端: 间隔 ${config.desktopInterval}ms, 容忍丢包 ${config.desktopMaxMissed} 次
  移动端: 间隔 ${config.mobileInterval}ms, 容忍丢包 ${config.mobileMaxMissed} 次
  检查间隔: ${checkInterval}ms`);

    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws: WebSocket) => {
            const extWs = ws as AuthenticatedWebSocket;
            const now = Date.now();

            // 检测客户端类型（默认为桌面端）
            const clientType: ClientType = extWs.clientType || 'desktop';
            const maxMissed = clientType === 'mobile'
                ? config.mobileMaxMissed
                : config.desktopMaxMissed;
            const interval = clientType === 'mobile'
                ? config.mobileInterval
                : config.desktopInterval;

            // 初始化 missedPongCount
            if (extWs.missedPongCount === undefined) {
                extWs.missedPongCount = 0;
            }

            // 检查是否需要发送 ping（基于时间间隔）
            const lastPing = lastPingTime.get(extWs) || 0;
            const timeSinceLastPing = now - lastPing;

            // 只有当距离上次 ping 超过配置的间隔时才发送新的 ping
            if (timeSinceLastPing >= interval) {
                // 检查连接状态，非 OPEN 状态跳过并清理
                if (extWs.readyState !== WebSocket.OPEN) {
                    lastPingTime.delete(extWs);
                    return; // 跳过非活动连接
                }

                // 增加丢包计数
                extWs.missedPongCount++;

                // 检查是否超过容忍度（递增后检查）
                if (extWs.missedPongCount > maxMissed) {
                    console.log(
                        `WebSocket 心跳检测：${clientType} 客户端 ${extWs.username} (会话: ${extWs.sessionId}) ` +
                        `连续 ${extWs.missedPongCount} 次无响应（阈值: ${maxMissed}），正在终止...`
                    );
                    cleanupClientConnection(extWs.sessionId);
                    lastPingTime.delete(extWs);
                    return extWs.terminate();
                }

                // 发送 ping 并更新时间戳（带错误保护）
                try {
                    extWs.ping(() => {});
                    lastPingTime.set(extWs, now);
                } catch (error: any) {
                    console.warn(`[WebSocket 心跳] ping 发送失败 (${extWs.username}):`, error.message);
                    lastPingTime.delete(extWs);
                    return;
                }

                // 向后兼容：同时更新 isAlive 标志
                extWs.isAlive = false;
            }
        });
    }, checkInterval);

    // 当 WebSocket 服务器关闭时，清除心跳定时器
    wss.on('close', () => {
        console.log('WebSocket 服务器正在关闭，清理心跳定时器...');
        clearInterval(heartbeatInterval);
        lastPingTime.clear();
    });

    return heartbeatInterval;
}

/**
 * 重置客户端的心跳状态（当收到 pong 响应时调用）
 * @param ws WebSocket 连接
 */
export function resetHeartbeat(ws: AuthenticatedWebSocket): void {
    ws.missedPongCount = 0;
    // 向后兼容：同时更新 isAlive 标志
    ws.isAlive = true;
}