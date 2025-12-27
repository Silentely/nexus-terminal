import axios from 'axios';
import { ConnectionWithTags } from '../types/connection.types';

// 统一远程桌面网关服务的 Base URL
const REMOTE_GATEWAY_API_BASE =
  process.env.DEPLOYMENT_MODE === 'local'
    ? process.env.REMOTE_GATEWAY_API_BASE_LOCAL || 'http://localhost:9090'
    : process.env.REMOTE_GATEWAY_API_BASE_DOCKER || 'http://remote-gateway:9090';

console.log(`[GuacamoleService] DEPLOYMENT_MODE: ${process.env.DEPLOYMENT_MODE}`);
console.log(
  `[GuacamoleService] Using Remote Gateway API Base (Local): ${process.env.REMOTE_GATEWAY_API_BASE_LOCAL}`
);
console.log(
  `[GuacamoleService] Using Remote Gateway API Base (Docker): ${process.env.REMOTE_GATEWAY_API_BASE_DOCKER}`
);
console.log(`[GuacamoleService] Effective Remote Gateway API Base: ${REMOTE_GATEWAY_API_BASE}`);

interface TokenResponse {
  token: string;
}

const REMOTE_GATEWAY_API_TOKEN = (process.env.REMOTE_GATEWAY_API_TOKEN || '').trim();

/**
 * 从统一远程桌面网关服务获取 Guacamole 令牌
 * @param protocol 'rdp' 或 'vnc'
 * @param connection 连接对象
 * @param decryptedPassword 解密后的密码
 * @param width 宽度
 * @param height 高度
 * @param dpi DPI (主要用于 RDP)
 * @returns Guacamole 令牌
 */
export const getRemoteDesktopToken = async (
  protocol: 'rdp' | 'vnc',
  connection: ConnectionWithTags,
  decryptedPassword?: string,
  width?: number,
  height?: number,
  dpi?: string // DPI 主要用于 RDP
): Promise<string> => {
  if (
    (protocol === 'rdp' || protocol === 'vnc') &&
    connection.auth_method === 'password' &&
    !decryptedPassword
  ) {
    console.warn(
      `[GuacamoleService:getRemoteDesktopToken] ${protocol.toUpperCase()} connection ${connection.id} uses password auth but password decryption failed or password not provided.`
    );
    throw new Error(`${protocol.toUpperCase()} 连接使用密码认证，但密码解密失败或未提供密码。`);
  }

  const connectionConfig: any = {
    hostname: connection.host,
    port: connection.port.toString(),
    width: String(width || 1024), // 提供默认值
    height: String(height || 768), // 提供默认值
  };

  if (protocol === 'rdp') {
    if (!connection.username) {
      console.warn(
        `[GuacamoleService:getRemoteDesktopToken] RDP connection ${connection.id} is missing username.`
      );
      // 对于RDP，用户名通常是必需的，但让网关决定是否可以为空
    }
    connectionConfig.username = connection.username || ''; // RDP 通常需要用户名
    connectionConfig.password = decryptedPassword || ''; // RDP 通常需要密码
    connectionConfig.dpi = dpi || '96';
    connectionConfig.security = (connection as any).rdp_security || 'any';
    connectionConfig.ignoreCert = String((connection as any).rdp_ignore_cert ?? true);
  } else if (protocol === 'vnc') {
    connectionConfig.password = decryptedPassword || ''; // VNC 通常需要密码
    if (connection.username) {
      // VNC 用户名是可选的
      connectionConfig.username = connection.username;
    }
    // 其他 VNC 特定参数可以从 connection.extras 获取
    // 例如: if (connection.extras?.enableAudio) connectionConfig.enableAudio = connection.extras.enableAudio;
  }

  const requestBody = {
    protocol,
    connectionConfig,
  };

  const tokenUrl = `${REMOTE_GATEWAY_API_BASE}/api/remote-desktop/token`;
  console.log(
    `[GuacamoleService:getRemoteDesktopToken] Calling Remote Gateway API: ${tokenUrl} for protocol ${protocol}, connection ${connection.id}`
  );

  try {
    const headers = REMOTE_GATEWAY_API_TOKEN
      ? { 'X-Remote-Gateway-Token': REMOTE_GATEWAY_API_TOKEN }
      : undefined;

    const response = await axios.post<TokenResponse>(tokenUrl, requestBody, {
      timeout: 10000, // 10 秒超时
      headers,
    });

    if (response.status !== 200 || !response.data?.token) {
      console.error(
        `[GuacamoleService:getRemoteDesktopToken] ${protocol.toUpperCase()} backend API call failed or returned invalid data. Status: ${response.status}`,
        response.data
      );
      throw new Error(`从 ${protocol.toUpperCase()} 后端获取令牌失败。`);
    }
    console.log(
      `[GuacamoleService:getRemoteDesktopToken] Received Guacamole token from ${protocol.toUpperCase()} backend for connection ${connection.id}`
    );
    return response.data.token;
  } catch (error: any) {
    console.error(
      `[GuacamoleService:getRemoteDesktopToken] Error calling ${protocol.toUpperCase()} backend for connection ${connection.id}:`,
      error.message
    );
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(
        `调用 ${protocol.toUpperCase()} 后端服务失败 (状态: ${error.response.status}): ${error.response.data?.message || error.message}`
      );
    }
    throw new Error(`调用 ${protocol.toUpperCase()} 后端服务时发生错误: ${error.message}`);
  }
};
