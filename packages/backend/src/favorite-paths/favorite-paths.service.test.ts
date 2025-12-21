import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as FavoritePathsRepository from './favorite-paths.repository';
import {
    addFavoritePath,
    updateFavoritePath,
    deleteFavoritePath,
    getAllFavoritePaths,
    updateFavoritePathLastUsed,
    getFavoritePathById,
} from './favorite-paths.service';

vi.mock('./favorite-paths.repository', () => ({
    addFavoritePath: vi.fn(),
    updateFavoritePath: vi.fn(),
    deleteFavoritePath: vi.fn(),
    getAllFavoritePaths: vi.fn(),
    updateFavoritePathLastUsedAt: vi.fn(),
    findFavoritePathById: vi.fn(),
}));

describe('favorite-paths.service', () => {
    const repo = FavoritePathsRepository as unknown as {
        addFavoritePath: ReturnType<typeof vi.fn>;
        updateFavoritePath: ReturnType<typeof vi.fn>;
        deleteFavoritePath: ReturnType<typeof vi.fn>;
        getAllFavoritePaths: ReturnType<typeof vi.fn>;
        updateFavoritePathLastUsedAt: ReturnType<typeof vi.fn>;
        findFavoritePathById: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('addFavoritePath 应去除空白并调用仓库方法', async () => {
        repo.addFavoritePath.mockResolvedValue(42);
        const id = await addFavoritePath('  name  ', '  /tmp/path  ');
        expect(id).toBe(42);
        expect(repo.addFavoritePath).toHaveBeenCalledWith('name', '/tmp/path');
    });

    it('addFavoritePath 为空路径时抛出错误', async () => {
        await expect(addFavoritePath('name', '   ')).rejects.toThrow('路径内容不能为空');
        expect(repo.addFavoritePath).not.toHaveBeenCalled();
    });

    it('updateFavoritePath 应处理空名称并调用仓库', async () => {
        repo.updateFavoritePath.mockResolvedValue(true);
        const ok = await updateFavoritePath(1, '   ', '/data');
        expect(ok).toBe(true);
        expect(repo.updateFavoritePath).toHaveBeenCalledWith(1, null, '/data');
    });

    it('updateFavoritePath 为空路径时抛出错误', async () => {
        await expect(updateFavoritePath(1, 'abc', '   ')).rejects.toThrow('路径内容不能为空');
        expect(repo.updateFavoritePath).not.toHaveBeenCalled();
    });

    it('deleteFavoritePath 直接返回仓库结果', async () => {
        repo.deleteFavoritePath.mockResolvedValue(true);
        const result = await deleteFavoritePath(2);
        expect(result).toBe(true);
        expect(repo.deleteFavoritePath).toHaveBeenCalledWith(2);
    });

    it('getAllFavoritePaths 默认使用 name 排序', async () => {
        repo.getAllFavoritePaths.mockResolvedValue([]);
        await getAllFavoritePaths();
        expect(repo.getAllFavoritePaths).toHaveBeenCalledWith('name');
    });

    it('updateFavoritePathLastUsed 调用仓库更新时间戳', async () => {
        repo.updateFavoritePathLastUsedAt.mockResolvedValue(true);
        const res = await updateFavoritePathLastUsed(5);
        expect(res).toBe(true);
        expect(repo.updateFavoritePathLastUsedAt).toHaveBeenCalledWith(5);
    });

    it('getFavoritePathById 返回仓库查询结果', async () => {
        const path = { id: 1, name: 'home', path: '/home', created_at: 1, updated_at: 1 };
        repo.findFavoritePathById.mockResolvedValue(path as any);
        const result = await getFavoritePathById(1);
        expect(result).toEqual(path);
        expect(repo.findFavoritePathById).toHaveBeenCalledWith(1);
    });
});
