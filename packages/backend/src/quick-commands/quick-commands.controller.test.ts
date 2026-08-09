/**
 * quick-commands/quick-commands.controller 单元测试
 * 覆盖快捷指令 CRUD 控制器的校验、委托与错误处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockService = vi.hoisted(() => ({
  addQuickCommand: vi.fn(),
  getAllQuickCommands: vi.fn(),
  getQuickCommandById: vi.fn(),
  updateQuickCommand: vi.fn(),
  deleteQuickCommand: vi.fn(),
  incrementUsageCount: vi.fn(),
  assignTagToCommands: vi.fn(),
}));

vi.mock('./quick-commands.service', () => mockService);

import {
  addQuickCommand,
  getAllQuickCommands,
  updateQuickCommand,
  deleteQuickCommand,
  incrementUsage,
  assignTagToCommands,
} from './quick-commands.controller';

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

describe('quick-commands.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    next.mockReset();
  });

  describe('addQuickCommand', () => {
    it('空指令应返回 400', async () => {
      const req = createReq({ body: { command: '  ' } });
      const res = createRes();

      await addQuickCommand(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('非法 tagIds 应返回 400', async () => {
      const req = createReq({ body: { command: 'ls', tagIds: ['x'] } });
      const res = createRes();

      await addQuickCommand(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('合法指令应创建并返回 201', async () => {
      mockService.addQuickCommand.mockResolvedValue(7);
      mockService.getQuickCommandById.mockResolvedValue({ id: 7, command: 'ls' });
      const req = createReq({ body: { name: '列表', command: 'ls -la' } });
      const res = createRes();

      await addQuickCommand(req, res, next);

      expect(mockService.addQuickCommand).toHaveBeenCalledWith(
        '列表',
        'ls -la',
        undefined,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('service 抛错应传给 next', async () => {
      const error = new Error('db down');
      mockService.addQuickCommand.mockRejectedValue(error);
      const req = createReq({ body: { name: null, command: 'ls' } });
      const res = createRes();

      await addQuickCommand(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getAllQuickCommands', () => {
    it('应委托 service 并返回列表', async () => {
      mockService.getAllQuickCommands.mockResolvedValue([]);
      const req = createReq({ query: {} });
      const res = createRes();

      await getAllQuickCommands(req, res, next);
      expect(mockService.getAllQuickCommands).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('updateQuickCommand', () => {
    it('无效 ID 应返回 400', async () => {
      const req = createReq({ params: { id: 'abc' }, body: { command: 'ls' } });
      const res = createRes();

      await updateQuickCommand(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('合法更新应委托 service', async () => {
      mockService.updateQuickCommand.mockResolvedValue(true);
      mockService.getQuickCommandById.mockResolvedValue({ id: 3, command: 'pwd' });
      const req = createReq({ params: { id: '3' }, body: { name: null, command: 'pwd' } });
      const res = createRes();

      await updateQuickCommand(req, res, next);

      expect(mockService.updateQuickCommand).toHaveBeenCalledWith(
        3,
        null,
        'pwd',
        undefined,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deleteQuickCommand', () => {
    it('应委托 service 删除', async () => {
      mockService.deleteQuickCommand.mockResolvedValue(true);
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await deleteQuickCommand(req, res, next);
      expect(mockService.deleteQuickCommand).toHaveBeenCalledWith(3);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('incrementUsage / assignTagToCommands', () => {
    it('incrementUsage 应委托 incrementUsageCount', async () => {
      mockService.incrementUsageCount.mockResolvedValue(true);
      mockService.getQuickCommandById.mockResolvedValue({ id: 3, command: 'ls' });
      const req = createReq({ params: { id: '3' } });
      const res = createRes();

      await incrementUsage(req, res, next);
      expect(mockService.incrementUsageCount).toHaveBeenCalledWith(3);
    });

    it('assignTagToCommands 应委托 service', async () => {
      mockService.assignTagToCommands.mockResolvedValue(undefined);
      const req = createReq({ body: { commandIds: [1, 2], tagId: 5 } });
      const res = createRes();

      await assignTagToCommands(req, res, next);
      expect(mockService.assignTagToCommands).toHaveBeenCalledWith([1, 2], 5);
    });
  });
});
