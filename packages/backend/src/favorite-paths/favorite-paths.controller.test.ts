/**
 * favorite-paths/favorite-paths.controller 单元测试
 * 覆盖收藏路径 CRUD 控制器的校验、委托与错误处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockService = vi.hoisted(() => ({
  addFavoritePath: vi.fn(),
  getAllFavoritePaths: vi.fn(),
  getFavoritePathById: vi.fn(),
  updateFavoritePath: vi.fn(),
  deleteFavoritePath: vi.fn(),
  updateFavoritePathLastUsed: vi.fn(),
}));

vi.mock('./favorite-paths.service', () => mockService);

import {
  createFavoritePath,
  getAllFavoritePaths,
  getFavoritePathById,
  updateFavoritePath,
  deleteFavoritePath,
  incrementUsage,
  updateLastUsedTimestamp,
} from './favorite-paths.controller';

function createReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, params: {}, query: {}, ...overrides } as Request;
}

function createRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

const next = vi.fn();

describe('favorite-paths.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    next.mockReset();
  });

  describe('createFavoritePath', () => {
    it('空路径应返回 400', async () => {
      const req = createReq({ body: { path: '   ' } });
      const res = createRes();

      await createFavoritePath(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('合法路径应创建并返回 201', async () => {
      mockService.addFavoritePath.mockResolvedValue(5);
      mockService.getFavoritePathById.mockResolvedValue({ id: 5, path: '/home' });
      const req = createReq({ body: { name: '家目录', path: '/home' } });
      const res = createRes();

      await createFavoritePath(req, res, next);

      expect(mockService.addFavoritePath).toHaveBeenCalledWith('家目录', '/home');
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('service 抛错应传给 next', async () => {
      const error = new Error('db down');
      mockService.addFavoritePath.mockRejectedValue(error);
      const req = createReq({ body: { name: null, path: '/home' } });
      const res = createRes();

      await createFavoritePath(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getAllFavoritePaths', () => {
    it('默认排序为 name', async () => {
      mockService.getAllFavoritePaths.mockResolvedValue([]);
      const req = createReq({ query: {} });
      const res = createRes();

      await getAllFavoritePaths(req, res, next);

      expect(mockService.getAllFavoritePaths).toHaveBeenCalledWith('name');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('合法 sortBy 应透传', async () => {
      mockService.getAllFavoritePaths.mockResolvedValue([]);
      const req = createReq({ query: { sortBy: 'last_used_at' } });
      const res = createRes();

      await getAllFavoritePaths(req, res, next);
      expect(mockService.getAllFavoritePaths).toHaveBeenCalledWith('last_used_at');
    });

    it('非法 sortBy 应回退到 name', async () => {
      mockService.getAllFavoritePaths.mockResolvedValue([]);
      const req = createReq({ query: { sortBy: 'hack' } });
      const res = createRes();

      await getAllFavoritePaths(req, res, next);
      expect(mockService.getAllFavoritePaths).toHaveBeenCalledWith('name');
    });
  });

  describe('getFavoritePathById', () => {
    it('应返回单个收藏路径', async () => {
      mockService.getFavoritePathById.mockResolvedValue({ id: 3, path: '/tmp' });
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await getFavoritePathById(req, res, next);

      expect(mockService.getFavoritePathById).toHaveBeenCalledWith(3);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('未找到应返回 404', async () => {
      mockService.getFavoritePathById.mockResolvedValue(null);
      const req = createReq({ params: { id: '999' } });
      const res = createRes();

      await getFavoritePathById(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('updateFavoritePath', () => {
    it('应委托 service 更新', async () => {
      mockService.updateFavoritePath.mockResolvedValue(true);
      mockService.getFavoritePathById.mockResolvedValue({ id: 3, path: '/new' });
      const req = createReq({ params: { id: '3' }, body: { name: null, path: '/new' } });
      const res = createRes();

      await updateFavoritePath(req, res, next);

      expect(mockService.updateFavoritePath).toHaveBeenCalledWith(3, null, '/new');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deleteFavoritePath', () => {
    it('应委托 service 删除', async () => {
      mockService.deleteFavoritePath.mockResolvedValue(true);
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await deleteFavoritePath(req, res, next);
      expect(mockService.deleteFavoritePath).toHaveBeenCalledWith(3);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('incrementUsage / updateLastUsedTimestamp', () => {
    it('incrementUsage 应委托 updateFavoritePathLastUsed', async () => {
      mockService.updateFavoritePathLastUsed.mockResolvedValue(true);
      mockService.getFavoritePathById.mockResolvedValue({ id: 3, path: '/tmp' });
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await incrementUsage(req, res, next);
      expect(mockService.updateFavoritePathLastUsed).toHaveBeenCalledWith(3);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('incrementUsage 无效 ID 应返回 400', async () => {
      const req = createReq({ params: { id: 'abc' } });
      const res = createRes();

      await incrementUsage(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('updateLastUsedTimestamp 应委托 updateFavoritePathLastUsed', async () => {
      mockService.updateFavoritePathLastUsed.mockResolvedValue(true);
      mockService.getFavoritePathById.mockResolvedValue({ id: 3, path: '/tmp' });
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await updateLastUsedTimestamp(req, res, next);
      expect(mockService.updateFavoritePathLastUsed).toHaveBeenCalledWith(3);
    });
  });
});
