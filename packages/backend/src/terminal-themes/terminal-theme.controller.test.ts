/**
 * terminal-themes/terminal-theme.controller 单元测试
 * 覆盖终端主题 CRUD 控制器的校验、委托与错误处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockService = vi.hoisted(() => ({
  getAllThemes: vi.fn(),
  getThemeById: vi.fn(),
  createNewTheme: vi.fn(),
  updateExistingTheme: vi.fn(),
  deleteExistingTheme: vi.fn(),
  importTheme: vi.fn(),
}));

vi.mock('./terminal-theme.service', () => mockService);

// mock fs 与 multer，避免真实文件系统
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    promises: { ...actual.promises, readFile: vi.fn(), unlink: vi.fn() },
  };
});
vi.mock('multer', () => ({
  default: vi.fn().mockReturnValue({ single: vi.fn() }),
}));

import {
  getAllThemesController,
  getThemeByIdController,
  createThemeController,
  updateThemeController,
  deleteThemeController,
  importThemeController,
  exportThemeController,
} from './terminal-theme.controller';

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

describe('terminal-theme.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    next.mockReset();
  });

  describe('getAllThemesController', () => {
    it('应返回全部主题', async () => {
      mockService.getAllThemes.mockResolvedValue([]);
      const res = createRes();

      await getAllThemesController(createReq(), res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('service 抛错应传给 next', async () => {
      const error = new Error('db down');
      mockService.getAllThemes.mockRejectedValue(error);

      await getAllThemesController(createReq(), createRes(), next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getThemeByIdController', () => {
    it('无效 ID 应返回 400', async () => {
      const req = createReq({ params: { id: 'abc' } });
      const res = createRes();

      await getThemeByIdController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('未找到应返回 404', async () => {
      mockService.getThemeById.mockResolvedValue(null);
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await getThemeByIdController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('找到应返回 200', async () => {
      mockService.getThemeById.mockResolvedValue({ id: 3, name: 'Dark' });
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await getThemeByIdController(req, res, next);
      expect(mockService.getThemeById).toHaveBeenCalledWith(3);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('createThemeController', () => {
    it('应委托 createNewTheme 并返回 201', async () => {
      mockService.createNewTheme.mockResolvedValue({ id: 1, name: 'New' });
      const req = createReq({ body: { name: 'New', themeData: { background: '#000' } } });
      const res = createRes();

      await createThemeController(req, res, next);
      expect(mockService.createNewTheme).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('updateThemeController', () => {
    it('无效 ID 应返回 400', async () => {
      const req = createReq({ params: { id: 'x' }, body: {} });
      const res = createRes();

      await updateThemeController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('合法更新应委托 service', async () => {
      mockService.updateExistingTheme.mockResolvedValue(true);
      const req = createReq({
        params: { id: '3' },
        body: { name: 'Renamed', themeData: { background: '#fff' } },
      });
      const res = createRes();

      await updateThemeController(req, res, next);
      expect(mockService.updateExistingTheme).toHaveBeenCalledWith(3, expect.anything());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deleteThemeController', () => {
    it('应委托 deleteExistingTheme', async () => {
      mockService.deleteExistingTheme.mockResolvedValue(true);
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await deleteThemeController(req, res, next);
      expect(mockService.deleteExistingTheme).toHaveBeenCalledWith(3);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('exportThemeController', () => {
    it('未找到主题应返回 404', async () => {
      mockService.getThemeById.mockResolvedValue(null);
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await exportThemeController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('importThemeController', () => {
    it('无上传文件应返回 400', async () => {
      const req = createReq({ file: undefined });
      const res = createRes();

      await importThemeController(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
