/**
 * Guacamole Service 单元测试
 * 测试远程桌面令牌生成的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getRemoteDesktopToken } from './guacamole.service';
import type { ConnectionWithTags } from '../types/connection.types';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const { mockAxios } = vi.hoisted(() => ({
  mockAxios: {
    post: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

// Mock axios
vi.mock('axios', () => ({
  default: mockAxios,
  ...mockAxios,
}));

describe('GuacamoleService', () => {
  const mockRdpConnection: ConnectionWithTags = {
    id: 1,
    name: 'Test RDP',
    type: 'RDP',
    host: '192.168.1.100',
    port: 3389,
    username: 'admin',
    auth_method: 'password',
    encrypted_password: null,
    encrypted_private_key: null,
    encrypted_passphrase: null,
    proxy_id: null,
    jump_chain: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    last_connected_at: null,
    ssh_key_id: null,
    tags: [],
  };

  const mockVncConnection: ConnectionWithTags = {
    ...mockRdpConnection,
    id: 2,
    name: 'Test VNC',
    type: 'VNC',
    port: 5900,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios.isAxiosError.mockReturnValue(false);
  });

  describe('getRemoteDesktopToken', () => {
    describe('RDP 连接', () => {
      it('应成功获取 RDP 令牌', async () => {
        mockAxios.post.mockResolvedValue({
          status: 200,
          data: { token: 'rdp-token-123' },
        });

        const token = await getRemoteDesktopToken(
          'rdp',
          mockRdpConnection,
          'password123',
          1920,
          1080,
          '96'
        );

        expect(token).toBe('rdp-token-123');
        expect(mockAxios.post).toHaveBeenCalledTimes(1);
        expect(mockAxios.post).toHaveBeenCalledWith(
          expect.stringContaining('/api/remote-desktop/token'),
          expect.objectContaining({
            protocol: 'rdp',
            connectionConfig: expect.objectContaining({
              hostname: '192.168.1.100',
              port: '3389',
              username: 'admin',
              password: 'password123',
            }),
          }),
          expect.objectContaining({ timeout: 10000 })
        );
      });

      it('RDP 连接缺少密码时应抛出错误', async () => {
        await expect(
          getRemoteDesktopToken('rdp', mockRdpConnection, undefined, 1920, 1080)
        ).rejects.toThrow('RDP 连接使用密码认证，但密码解密失败或未提供密码');
      });

      it('应使用默认分辨率', async () => {
        mockAxios.post.mockResolvedValue({
          status: 200,
          data: { token: 'rdp-token' },
        });

        await getRemoteDesktopToken('rdp', mockRdpConnection, 'password123');

        expect(mockAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            connectionConfig: expect.objectContaining({
              width: '1024',
              height: '768',
            }),
          }),
          expect.any(Object)
        );
      });

      it('应设置 RDP 特定参数', async () => {
        mockAxios.post.mockResolvedValue({
          status: 200,
          data: { token: 'rdp-token' },
        });

        await getRemoteDesktopToken('rdp', mockRdpConnection, 'password123', 1920, 1080, '120');

        expect(mockAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            connectionConfig: expect.objectContaining({
              dpi: '120',
              security: 'any',
              ignoreCert: 'true',
            }),
          }),
          expect.any(Object)
        );
      });
    });

    describe('VNC 连接', () => {
      it('应成功获取 VNC 令牌', async () => {
        mockAxios.post.mockResolvedValue({
          status: 200,
          data: { token: 'vnc-token-456' },
        });

        const token = await getRemoteDesktopToken(
          'vnc',
          mockVncConnection,
          'vnc-password',
          1280,
          720
        );

        expect(token).toBe('vnc-token-456');
        expect(mockAxios.post).toHaveBeenCalledWith(
          expect.stringContaining('/api/remote-desktop/token'),
          expect.objectContaining({
            protocol: 'vnc',
            connectionConfig: expect.objectContaining({
              hostname: '192.168.1.100',
              port: '5900',
              password: 'vnc-password',
            }),
          }),
          expect.any(Object)
        );
      });

      it('VNC 连接缺少密码时应抛出错误', async () => {
        await expect(
          getRemoteDesktopToken('vnc', mockVncConnection, undefined, 1280, 720)
        ).rejects.toThrow('VNC 连接使用密码认证，但密码解密失败或未提供密码');
      });

      it('VNC 应包含可选的用户名', async () => {
        mockAxios.post.mockResolvedValue({
          status: 200,
          data: { token: 'vnc-token' },
        });

        const vncWithUsername: ConnectionWithTags = {
          ...mockVncConnection,
          username: 'vnc-user',
        };

        await getRemoteDesktopToken('vnc', vncWithUsername, 'password');

        expect(mockAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            connectionConfig: expect.objectContaining({
              username: 'vnc-user',
            }),
          }),
          expect.any(Object)
        );
      });
    });

    describe('错误处理', () => {
      it('API 返回非 200 状态码时应抛出错误', async () => {
        mockAxios.post.mockResolvedValue({
          status: 500,
          data: {},
        });

        await expect(getRemoteDesktopToken('rdp', mockRdpConnection, 'password')).rejects.toThrow(
          '从 RDP 后端获取令牌失败'
        );
      });

      it('API 返回无 token 数据时应抛出错误', async () => {
        mockAxios.post.mockResolvedValue({
          status: 200,
          data: {},
        });

        await expect(getRemoteDesktopToken('rdp', mockRdpConnection, 'password')).rejects.toThrow(
          '从 RDP 后端获取令牌失败'
        );
      });

      it('Axios 错误应正确处理', async () => {
        const axiosError = {
          response: {
            status: 403,
            data: { message: 'Forbidden' },
          },
          message: 'Request failed with status code 403',
        };
        mockAxios.post.mockRejectedValue(axiosError);
        mockAxios.isAxiosError.mockReturnValue(true);

        await expect(getRemoteDesktopToken('rdp', mockRdpConnection, 'password')).rejects.toThrow(
          '调用 RDP 后端服务失败 (状态: 403)'
        );
      });

      it('网络错误应正确处理', async () => {
        const networkError = new Error('Network Error');
        mockAxios.post.mockRejectedValue(networkError);
        mockAxios.isAxiosError.mockReturnValue(false);

        await expect(getRemoteDesktopToken('vnc', mockVncConnection, 'password')).rejects.toThrow(
          '调用 VNC 后端服务时发生错误: Network Error'
        );
      });

      it('超时应正确处理', async () => {
        const timeoutError = {
          code: 'ECONNABORTED',
          message: 'timeout of 10000ms exceeded',
        };
        mockAxios.post.mockRejectedValue(timeoutError);
        mockAxios.isAxiosError.mockReturnValue(false);

        await expect(getRemoteDesktopToken('rdp', mockRdpConnection, 'password')).rejects.toThrow(
          'timeout'
        );
      });
    });

    describe('边界条件', () => {
      it('应处理没有用户名的 RDP 连接', async () => {
        mockAxios.post.mockResolvedValue({
          status: 200,
          data: { token: 'rdp-token' },
        });

        const rdpNoUsername: ConnectionWithTags = {
          ...mockRdpConnection,
          username: '',
        };

        await getRemoteDesktopToken('rdp', rdpNoUsername, 'password');

        expect(mockAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            connectionConfig: expect.objectContaining({
              username: '',
            }),
          }),
          expect.any(Object)
        );
      });

      it('应处理空密码', async () => {
        mockAxios.post.mockResolvedValue({
          status: 200,
          data: { token: 'vnc-token' },
        });

        // 使用非密码认证方式的连接
        const vncKeyAuth: ConnectionWithTags = {
          ...mockVncConnection,
          auth_method: 'key',
        };

        await getRemoteDesktopToken('vnc', vncKeyAuth, '');

        expect(mockAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            connectionConfig: expect.objectContaining({
              password: '',
            }),
          }),
          expect.any(Object)
        );
      });
    });
  });
});
