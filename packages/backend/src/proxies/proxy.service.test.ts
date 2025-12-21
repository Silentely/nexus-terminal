/**
 * Proxy Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Proxy Repository
vi.mock('./proxy.repository', () => ({
    findAllProxies: vi.fn(),
    findProxyById: vi.fn(),
    createProxy: vi.fn(),
    updateProxy: vi.fn(),
    deleteProxy: vi.fn(),
}));

// Mock crypto utils
vi.mock('../utils/crypto', () => ({
    encrypt: vi.fn((value: string) => `encrypted_${value}`),
    decrypt: vi.fn((value: string) => value.replace('encrypted_', '')),
}));

import * as ProxyRepository from './proxy.repository';
import { encrypt, decrypt } from '../utils/crypto';
import {
    getAllProxies,
    getProxyById,
    createProxy,
    updateProxy,
    deleteProxy,
} from './proxy.service';

describe('Proxy Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getAllProxies', () => {
        it('应返回所有代理列表', async () => {
            const mockProxies = [
                { id: 1, name: 'Proxy 1', type: 'SOCKS5', host: '127.0.0.1', port: 1080 },
                { id: 2, name: 'Proxy 2', type: 'HTTP', host: '192.168.1.1', port: 8080 },
            ];
            (ProxyRepository.findAllProxies as any).mockResolvedValueOnce(mockProxies);

            const result = await getAllProxies();

            expect(result).toEqual(mockProxies);
            expect(ProxyRepository.findAllProxies).toHaveBeenCalled();
        });
    });

    describe('getProxyById', () => {
        it('应返回指定 ID 的代理', async () => {
            const mockProxy = { id: 1, name: 'Test Proxy', type: 'SOCKS5', host: '127.0.0.1', port: 1080 };
            (ProxyRepository.findProxyById as any).mockResolvedValueOnce(mockProxy);

            const result = await getProxyById(1);

            expect(result).toEqual(mockProxy);
            expect(ProxyRepository.findProxyById).toHaveBeenCalledWith(1);
        });

        it('代理不存在时应返回 null', async () => {
            (ProxyRepository.findProxyById as any).mockResolvedValueOnce(null);

            const result = await getProxyById(999);

            expect(result).toBeNull();
        });
    });

    describe('createProxy', () => {
        it('应成功创建无认证的代理', async () => {
            const newProxy = {
                id: 5,
                name: 'New Proxy',
                type: 'SOCKS5',
                host: '127.0.0.1',
                port: 1080,
                auth_method: 'none',
            };
            (ProxyRepository.createProxy as any).mockResolvedValueOnce(5);
            (ProxyRepository.findProxyById as any).mockResolvedValueOnce(newProxy);

            const result = await createProxy({
                name: 'New Proxy',
                type: 'SOCKS5',
                host: '127.0.0.1',
                port: 1080,
            });

            expect(result).toEqual(newProxy);
            expect(ProxyRepository.createProxy).toHaveBeenCalled();
        });

        it('应成功创建密码认证的代理并加密密码', async () => {
            const newProxy = {
                id: 6,
                name: 'Auth Proxy',
                type: 'SOCKS5',
                host: '127.0.0.1',
                port: 1080,
                username: 'user',
                auth_method: 'password',
                encrypted_password: 'encrypted_mypassword',
            };
            (ProxyRepository.createProxy as any).mockResolvedValueOnce(6);
            (ProxyRepository.findProxyById as any).mockResolvedValueOnce(newProxy);

            const result = await createProxy({
                name: 'Auth Proxy',
                type: 'SOCKS5',
                host: '127.0.0.1',
                port: 1080,
                username: 'user',
                auth_method: 'password',
                password: 'mypassword',
            });

            expect(result).toEqual(newProxy);
            expect(encrypt).toHaveBeenCalledWith('mypassword');
        });

        it('应成功创建密钥认证的代理并加密密钥', async () => {
            const newProxy = {
                id: 7,
                name: 'Key Proxy',
                type: 'SOCKS5',
                host: '127.0.0.1',
                port: 1080,
                auth_method: 'key',
                encrypted_private_key: 'encrypted_privatekey',
                encrypted_passphrase: 'encrypted_passphrase',
            };
            (ProxyRepository.createProxy as any).mockResolvedValueOnce(7);
            (ProxyRepository.findProxyById as any).mockResolvedValueOnce(newProxy);

            const result = await createProxy({
                name: 'Key Proxy',
                type: 'SOCKS5',
                host: '127.0.0.1',
                port: 1080,
                auth_method: 'key',
                private_key: 'privatekey',
                passphrase: 'passphrase',
            });

            expect(result).toEqual(newProxy);
            expect(encrypt).toHaveBeenCalledWith('privatekey');
            expect(encrypt).toHaveBeenCalledWith('passphrase');
        });

        it('缺少必要字段应抛出异常', async () => {
            await expect(createProxy({ name: '', type: 'SOCKS5', host: '127.0.0.1', port: 1080 }))
                .rejects.toThrow('缺少必要的代理信息');
            await expect(createProxy({ name: 'Test', type: '' as any, host: '127.0.0.1', port: 1080 }))
                .rejects.toThrow('缺少必要的代理信息');
        });

        it('密码认证方式缺少密码应抛出异常', async () => {
            await expect(
                createProxy({
                    name: 'Test',
                    type: 'SOCKS5',
                    host: '127.0.0.1',
                    port: 1080,
                    auth_method: 'password',
                })
            ).rejects.toThrow('代理密码认证方式需要提供 password');
        });

        it('密钥认证方式缺少私钥应抛出异常', async () => {
            await expect(
                createProxy({
                    name: 'Test',
                    type: 'SOCKS5',
                    host: '127.0.0.1',
                    port: 1080,
                    auth_method: 'key',
                })
            ).rejects.toThrow('代理密钥认证方式需要提供 private_key');
        });

        it('创建后无法检索到代理应抛出异常', async () => {
            (ProxyRepository.createProxy as any).mockResolvedValueOnce(5);
            (ProxyRepository.findProxyById as any).mockResolvedValueOnce(null);

            await expect(
                createProxy({
                    name: 'Test',
                    type: 'SOCKS5',
                    host: '127.0.0.1',
                    port: 1080,
                })
            ).rejects.toThrow('创建代理后无法检索到该代理');
        });
    });

    describe('updateProxy', () => {
        const existingProxy = {
            id: 1,
            name: 'Existing Proxy',
            type: 'SOCKS5' as const,
            host: '127.0.0.1',
            port: 1080,
            username: null,
            auth_method: 'none' as const,
            encrypted_password: null,
            encrypted_private_key: null,
            encrypted_passphrase: null,
            created_at: 1000,
            updated_at: 1000,
        };

        it('应成功更新代理基本信息', async () => {
            const updatedProxy = { ...existingProxy, name: 'Updated Proxy', updated_at: 2000 };
            (ProxyRepository.findProxyById as any)
                .mockResolvedValueOnce(existingProxy)
                .mockResolvedValueOnce(updatedProxy);
            (ProxyRepository.updateProxy as any).mockResolvedValueOnce(true);

            const result = await updateProxy(1, { name: 'Updated Proxy' });

            expect(result).toEqual(updatedProxy);
            expect(ProxyRepository.updateProxy).toHaveBeenCalled();
        });

        it('代理不存在时应返回 null', async () => {
            (ProxyRepository.findProxyById as any).mockResolvedValueOnce(null);

            const result = await updateProxy(999, { name: 'Test' });

            expect(result).toBeNull();
        });

        it('切换到密码认证时应加密新密码并清除密钥信息', async () => {
            (ProxyRepository.findProxyById as any)
                .mockResolvedValueOnce(existingProxy)
                .mockResolvedValueOnce({ ...existingProxy, auth_method: 'password' });
            (ProxyRepository.updateProxy as any).mockResolvedValueOnce(true);

            await updateProxy(1, { auth_method: 'password', password: 'newpass' });

            const updateCall = (ProxyRepository.updateProxy as any).mock.calls[0];
            expect(updateCall[1].encrypted_password).toBe('encrypted_newpass');
            expect(updateCall[1].encrypted_private_key).toBeNull();
            expect(updateCall[1].encrypted_passphrase).toBeNull();
        });

        it('切换到密钥认证时应加密新密钥并清除密码信息', async () => {
            (ProxyRepository.findProxyById as any)
                .mockResolvedValueOnce({ ...existingProxy, auth_method: 'password' })
                .mockResolvedValueOnce({ ...existingProxy, auth_method: 'key' });
            (ProxyRepository.updateProxy as any).mockResolvedValueOnce(true);

            await updateProxy(1, { auth_method: 'key', private_key: 'newkey', passphrase: 'pass' });

            const updateCall = (ProxyRepository.updateProxy as any).mock.calls[0];
            expect(updateCall[1].encrypted_private_key).toBe('encrypted_newkey');
            expect(updateCall[1].encrypted_passphrase).toBe('encrypted_pass');
            expect(updateCall[1].encrypted_password).toBeNull();
        });

        it('切换到密码认证但未提供密码应抛出异常', async () => {
            (ProxyRepository.findProxyById as any).mockResolvedValueOnce(existingProxy);

            await expect(updateProxy(1, { auth_method: 'password' })).rejects.toThrow(
                '切换到密码认证时需要提供 password'
            );
        });

        it('切换到密钥认证但未提供私钥应抛出异常', async () => {
            (ProxyRepository.findProxyById as any).mockResolvedValueOnce(existingProxy);

            await expect(updateProxy(1, { auth_method: 'key' })).rejects.toThrow(
                '切换到密钥认证时需要提供 private_key'
            );
        });

        it('切换到无认证应清除所有凭证', async () => {
            const authProxy = { ...existingProxy, auth_method: 'password' as const, encrypted_password: 'enc' };
            (ProxyRepository.findProxyById as any)
                .mockResolvedValueOnce(authProxy)
                .mockResolvedValueOnce({ ...authProxy, auth_method: 'none' });
            (ProxyRepository.updateProxy as any).mockResolvedValueOnce(true);

            await updateProxy(1, { auth_method: 'none' });

            const updateCall = (ProxyRepository.updateProxy as any).mock.calls[0];
            expect(updateCall[1].encrypted_password).toBeNull();
            expect(updateCall[1].encrypted_private_key).toBeNull();
            expect(updateCall[1].encrypted_passphrase).toBeNull();
        });

        it('仅更新密码（不切换认证方法）应加密新密码', async () => {
            const passwordProxy = { ...existingProxy, auth_method: 'password' as const };
            (ProxyRepository.findProxyById as any)
                .mockResolvedValueOnce(passwordProxy)
                .mockResolvedValueOnce(passwordProxy);
            (ProxyRepository.updateProxy as any).mockResolvedValueOnce(true);

            await updateProxy(1, { password: 'updatedpass' });

            expect(encrypt).toHaveBeenCalledWith('updatedpass');
        });
    });

    describe('deleteProxy', () => {
        it('应成功删除代理', async () => {
            (ProxyRepository.deleteProxy as any).mockResolvedValueOnce(true);

            const result = await deleteProxy(1);

            expect(result).toBe(true);
            expect(ProxyRepository.deleteProxy).toHaveBeenCalledWith(1);
        });

        it('代理不存在时应返回 false', async () => {
            (ProxyRepository.deleteProxy as any).mockResolvedValueOnce(false);

            const result = await deleteProxy(999);

            expect(result).toBe(false);
        });
    });
});
