import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

vi.mock('../composables/useDeviceDetection', () => ({
    useDeviceDetection: () => ({ isMobile: { value: false } }),
}));

vi.mock('../utils/apiClient', () => ({
    default: {
        get: vi.fn(),
        put: vi.fn(),
    },
}));

import apiClient from '../utils/apiClient';
import { useAppearanceStore, safeJsonParse } from './appearance.store';

const flushNextTick = async () => {
    await nextTick();
    await nextTick();
};

describe('appearance.store', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        document.documentElement.style.cssText = '';
        document.body.style.cssText = '';
    });

    it('safeJsonParse JSON 无效时应返回默认值', () => {
        const result = safeJsonParse('not-json', { a: 1 });
        expect(result).toEqual({ a: 1 });
    });

    it('loadInitialAppearanceData 成功时应加载设置与主题并应用 UI 变量与背景', async () => {
        const store = useAppearanceStore();

        (apiClient.get as any).mockImplementation((url: string) => {
            if (url === '/appearance') {
                return Promise.resolve({
                    data: {
                        customUiTheme: JSON.stringify({ '--test-color': 'red' }),
                        pageBackgroundImage: 'uploads/bg.png',
                        terminalBackgroundOverlayOpacity: 0.5,
                        activeTerminalThemeId: null,
                    },
                });
            }
            if (url === '/terminal-themes') {
                return Promise.resolve({
                    data: [
                        {
                            _id: '1',
                            name: '默认',
                            themeData: { foreground: '#fff', background: '#000' },
                        },
                    ],
                });
            }
            throw new Error(`unexpected url: ${url}`);
        });

        await store.loadInitialAppearanceData();
        await flushNextTick();

        expect(store.initialAppearanceDataLoaded).toBe(true);
        expect(store.allTerminalThemes).toHaveLength(1);
        expect(store.currentUiTheme['--test-color']).toBe('red');
        expect(document.documentElement.style.getPropertyValue('--test-color')).toBe('red');
        expect(document.body.style.backgroundImage).toContain('/uploads/bg.png');
    });

    it('loadInitialAppearanceData 失败时应回退到默认主题并标记加载失败', async () => {
        const store = useAppearanceStore();
        (apiClient.get as any).mockRejectedValueOnce(new Error('boom'));

        await store.loadInitialAppearanceData();

        expect(store.initialAppearanceDataLoaded).toBe(false);
        expect(store.error).toBeTruthy();
    });

    it('updateAppearanceSettings 应发送合并后的 payload 并更新本地设置', async () => {
        const store = useAppearanceStore();
        store.appearanceSettings = { terminalFontSize: 14 } as any;

        (apiClient.put as any).mockResolvedValueOnce({
            data: { terminalFontSize: 18, terminalBackgroundOverlayOpacity: 0.5 },
        });

        await store.updateAppearanceSettings({ terminalFontSize: 18 } as any);
        expect(apiClient.put).toHaveBeenCalledWith('/appearance', expect.objectContaining({ terminalFontSize: 18 }));
        expect((store.appearanceSettings as any).terminalFontSize).toBe(18);
    });

    it('setActiveTerminalTheme 后端更新失败时应回滚本地 activeTerminalThemeId', async () => {
        const store = useAppearanceStore();
        store.appearanceSettings = { activeTerminalThemeId: null } as any;
        store.allTerminalThemes = [{ _id: '2', name: 'T', themeData: { foreground: '#fff' } }] as any;

        (apiClient.put as any).mockRejectedValueOnce(new Error('fail'));

        await expect(store.setActiveTerminalTheme('2')).rejects.toThrow('应用主题失败');
        expect((store.appearanceSettings as any).activeTerminalThemeId).toBeNull();
    });

    it('loadTerminalThemeData themeData 已存在时应直接返回且不访问后端', async () => {
        const store = useAppearanceStore();
        store.allTerminalThemes = [{ _id: '1', name: 'T', themeData: { foreground: '#fff' } }] as any;

        const theme = await store.loadTerminalThemeData('1');
        expect(theme).toEqual({ foreground: '#fff' });
        expect(apiClient.get).not.toHaveBeenCalled();
    });
});

