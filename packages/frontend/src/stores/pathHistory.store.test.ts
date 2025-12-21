import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { uiNotificationsStoreMock } = vi.hoisted(() => {
    return {
        uiNotificationsStoreMock: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
            addNotification: vi.fn(),
        },
    };
});

vi.mock('../utils/apiClient', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('./uiNotifications.store', () => ({
    useUiNotificationsStore: () => uiNotificationsStoreMock,
}));

import apiClient from '../utils/apiClient';
import { usePathHistoryStore } from './pathHistory.store';

describe('pathHistory.store', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('filteredHistory 应按 searchTerm 过滤（不区分大小写）', () => {
        const store = usePathHistoryStore();
        store.historyList = [
            { id: 1, path: '/Home', timestamp: 1 },
            { id: 2, path: '/var', timestamp: 2 },
        ] as any;
        store.setSearchTerm('home');
        expect(store.filteredHistory).toHaveLength(1);
        expect(store.filteredHistory[0].id).toBe(1);
        expect(store.selectedIndex).toBe(-1);
    });

    it('selectNextPath / selectPreviousPath 在空列表时应重置 selectedIndex', () => {
        const store = usePathHistoryStore();
        store.selectNextPath();
        expect(store.selectedIndex).toBe(-1);
        store.selectPreviousPath();
        expect(store.selectedIndex).toBe(-1);
    });

    it('fetchHistory 应将后端数据按 timestamp 降序排序', async () => {
        const store = usePathHistoryStore();
        (apiClient.get as any).mockResolvedValueOnce({
            data: [
                { id: 1, path: '/a', timestamp: 1 },
                { id: 2, path: '/b', timestamp: 10 },
            ],
        });

        await store.fetchHistory();
        expect(store.historyList.map((e: any) => e.id)).toEqual([2, 1]);
        expect(store.isLoading).toBe(false);
        expect(store.error).toBeNull();
    });

    it('addPath 传入空字符串时应直接返回且不调用接口', async () => {
        const store = usePathHistoryStore();
        await store.addPath('   ');
        expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('deletePath 成功时应从列表移除并提示成功', async () => {
        const store = usePathHistoryStore();
        store.historyList = [
            { id: 1, path: '/a', timestamp: 1 },
            { id: 2, path: '/b', timestamp: 2 },
        ] as any;

        (apiClient.delete as any).mockResolvedValueOnce(undefined);
        await store.deletePath(1);
        expect(store.historyList.map((e: any) => e.id)).toEqual([2]);
        expect(uiNotificationsStoreMock.showSuccess).toHaveBeenCalled();
    });

    it('clearAllHistory 成功时应清空列表并提示成功', async () => {
        const store = usePathHistoryStore();
        store.historyList = [{ id: 1, path: '/a', timestamp: 1 }] as any;

        (apiClient.delete as any).mockResolvedValueOnce(undefined);
        await store.clearAllHistory();
        expect(store.historyList).toEqual([]);
        expect(uiNotificationsStoreMock.showSuccess).toHaveBeenCalled();
    });
});

