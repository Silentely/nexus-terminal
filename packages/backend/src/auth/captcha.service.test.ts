/**
 * Captcha Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { CaptchaService, captchaService } from './captcha.service';

// Mock axios
vi.mock('axios', () => ({
    default: {
        post: vi.fn(),
    },
}));

// Mock settings service
vi.mock('../settings/settings.service', () => ({
    settingsService: {
        getCaptchaConfig: vi.fn(),
    },
}));

import { settingsService } from '../settings/settings.service';

describe('CaptchaService', () => {
    let service: CaptchaService;

    beforeEach(() => {
        service = new CaptchaService();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('verifyToken', () => {
        it('无令牌时应返回 false', async () => {
            const result = await service.verifyToken('');

            expect(result).toBe(false);
        });

        it('CAPTCHA 未启用时应返回 true', async () => {
            (settingsService.getCaptchaConfig as any).mockResolvedValueOnce({
                enabled: false,
            });

            const result = await service.verifyToken('test-token');

            expect(result).toBe(true);
        });

        it('提供商为 none 时应返回 true', async () => {
            (settingsService.getCaptchaConfig as any).mockResolvedValueOnce({
                enabled: true,
                provider: 'none',
            });

            const result = await service.verifyToken('test-token');

            expect(result).toBe(true);
        });

        describe('hCaptcha', () => {
            it('应成功验证有效的 hCaptcha 令牌', async () => {
                (settingsService.getCaptchaConfig as any).mockResolvedValueOnce({
                    enabled: true,
                    provider: 'hcaptcha',
                    hcaptchaSecretKey: 'test-secret',
                });

                (axios.post as any).mockResolvedValueOnce({
                    data: { success: true },
                });

                const result = await service.verifyToken('valid-token');

                expect(result).toBe(true);
                expect(axios.post).toHaveBeenCalledWith(
                    'https://api.hcaptcha.com/siteverify',
                    expect.any(URLSearchParams),
                    expect.any(Object)
                );
            });

            it('应拒绝无效的 hCaptcha 令牌', async () => {
                (settingsService.getCaptchaConfig as any).mockResolvedValueOnce({
                    enabled: true,
                    provider: 'hcaptcha',
                    hcaptchaSecretKey: 'test-secret',
                });

                (axios.post as any).mockResolvedValueOnce({
                    data: { success: false, 'error-codes': ['invalid-input-response'] },
                });

                const result = await service.verifyToken('invalid-token');

                expect(result).toBe(false);
            });

            it('缺少 Secret Key 时应抛出错误', async () => {
                (settingsService.getCaptchaConfig as any).mockResolvedValueOnce({
                    enabled: true,
                    provider: 'hcaptcha',
                    hcaptchaSecretKey: '',
                });

                await expect(service.verifyToken('test-token')).rejects.toThrow(
                    'hCaptcha 配置无效：缺少 Secret Key'
                );
            });
        });

        describe('reCAPTCHA', () => {
            it('应成功验证有效的 reCAPTCHA 令牌', async () => {
                (settingsService.getCaptchaConfig as any).mockResolvedValueOnce({
                    enabled: true,
                    provider: 'recaptcha',
                    recaptchaSecretKey: 'test-secret',
                });

                (axios.post as any).mockResolvedValueOnce({
                    data: { success: true },
                });

                const result = await service.verifyToken('valid-token');

                expect(result).toBe(true);
                expect(axios.post).toHaveBeenCalledWith(
                    'https://www.google.com/recaptcha/api/siteverify',
                    expect.any(URLSearchParams),
                    expect.any(Object)
                );
            });

            it('应拒绝无效的 reCAPTCHA 令牌', async () => {
                (settingsService.getCaptchaConfig as any).mockResolvedValueOnce({
                    enabled: true,
                    provider: 'recaptcha',
                    recaptchaSecretKey: 'test-secret',
                });

                (axios.post as any).mockResolvedValueOnce({
                    data: { success: false, 'error-codes': ['invalid-input-response'] },
                });

                const result = await service.verifyToken('invalid-token');

                expect(result).toBe(false);
            });

            it('缺少 Secret Key 时应抛出错误', async () => {
                (settingsService.getCaptchaConfig as any).mockResolvedValueOnce({
                    enabled: true,
                    provider: 'recaptcha',
                    recaptchaSecretKey: '',
                });

                await expect(service.verifyToken('test-token')).rejects.toThrow(
                    'Google reCAPTCHA 配置无效：缺少 Secret Key'
                );
            });
        });

        it('未知提供商应抛出错误', async () => {
            (settingsService.getCaptchaConfig as any).mockResolvedValueOnce({
                enabled: true,
                provider: 'unknown',
            });

            await expect(service.verifyToken('test-token')).rejects.toThrow(
                '未知的 CAPTCHA 提供商配置: unknown'
            );
        });
    });

    describe('verifyCredentials', () => {
        it('缺少 Site Key 时应返回 false', async () => {
            const result = await service.verifyCredentials('hcaptcha', '', 'secret');

            expect(result).toBe(false);
        });

        it('缺少 Secret Key 时应返回 false', async () => {
            const result = await service.verifyCredentials('hcaptcha', 'sitekey', '');

            expect(result).toBe(false);
        });

        it('hCaptcha 凭据验证成功时应返回 true', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { success: true },
            });

            const result = await service.verifyCredentials(
                'hcaptcha',
                'valid-site-key',
                'valid-secret-key'
            );

            expect(result).toBe(true);
        });

        it('hCaptcha 凭据无效时应返回 false', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { success: false, 'error-codes': ['invalid-input-secret'] },
            });

            const result = await service.verifyCredentials(
                'hcaptcha',
                'invalid-site-key',
                'invalid-secret-key'
            );

            expect(result).toBe(false);
        });

        it('reCAPTCHA 凭据验证成功时应返回 true', async () => {
            (axios.post as any).mockResolvedValueOnce({
                data: { success: true },
            });

            const result = await service.verifyCredentials(
                'recaptcha',
                'valid-site-key',
                'valid-secret-key'
            );

            expect(result).toBe(true);
        });

        it('不支持的提供商应返回 false', async () => {
            const result = await service.verifyCredentials(
                'unknown' as any,
                'sitekey',
                'secret'
            );

            expect(result).toBe(false);
        });

        it('网络错误时应返回 false', async () => {
            (axios.post as any).mockRejectedValueOnce(new Error('Network error'));

            const result = await service.verifyCredentials(
                'hcaptcha',
                'sitekey',
                'secret'
            );

            expect(result).toBe(false);
        });
    });

    describe('captchaService 单例', () => {
        it('应导出一个 CaptchaService 实例', () => {
            expect(captchaService).toBeInstanceOf(CaptchaService);
        });
    });
});
