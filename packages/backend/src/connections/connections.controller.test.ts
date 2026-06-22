import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import * as connectionsController from './connections.controller';
import * as ConnectionService from './connection.service';

// Mock dependencies
vi.mock('./connection.service', () => ({
  createConnection: vi.fn(),
  getAllConnections: vi.fn(),
  getConnectionById: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock('../services/ssh.service', () => ({
  testSshConnection: vi.fn(),
}));

vi.mock('../services/guacamole.service', () => ({
  testGuacamoleConnection: vi.fn(),
}));

vi.mock('../utils/AppError', () => ({
  getErrorMessage: vi.fn((err) => (err instanceof Error ? err.message : String(err))),
}));

describe('Connections Controller', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      body: {},
      params: {},
      query: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe('createConnection', () => {
    it('应成功创建连接并返回201', async () => {
      const mockConnection = {
        id: 1,
        name: 'Test Server',
        host: '192.168.1.100',
        port: 22,
      };

      mockReq.body = {
        name: 'Test Server',
        host: '192.168.1.100',
        port: 22,
      };

      (ConnectionService.createConnection as any).mockResolvedValue(mockConnection);

      await connectionsController.createConnection(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(ConnectionService.createConnection).toHaveBeenCalledWith(mockReq.body);
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: '连接创建成功。',
        connection: mockConnection,
      });
    });

    it('应在缺少必要字段时返回400', async () => {
      mockReq.body = {
        name: 'Test Server',
      };

      (ConnectionService.createConnection as any).mockRejectedValue(new Error('缺少必要字段'));

      await connectionsController.createConnection(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: '缺少必要字段',
        code: 'VALIDATION_ERROR',
      });
    });

    it('应在发生其他错误时调用next', async () => {
      const error = new Error('数据库错误');
      mockReq.body = {
        name: 'Test Server',
        host: '192.168.1.100',
      };

      (ConnectionService.createConnection as any).mockRejectedValue(error);

      await connectionsController.createConnection(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('getConnections', () => {
    it('应成功获取所有连接并返回200', async () => {
      const mockConnections = [
        { id: 1, name: 'Server 1', host: '192.168.1.100' },
        { id: 2, name: 'Server 2', host: '192.168.1.101' },
      ];

      (ConnectionService.getAllConnections as any).mockResolvedValue(mockConnections);

      await connectionsController.getConnections(mockReq as Request, mockRes as Response, mockNext);

      expect(ConnectionService.getAllConnections).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(mockConnections);
    });

    it('应在发生错误时调用next', async () => {
      const error = new Error('数据库查询失败');
      (ConnectionService.getAllConnections as any).mockRejectedValue(error);

      await connectionsController.getConnections(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('getConnectionById', () => {
    it('应成功获取指定ID的连接', async () => {
      const mockConnection = {
        id: 1,
        name: 'Test Server',
        host: '192.168.1.100',
      };

      mockReq.params = { id: '1' };
      (ConnectionService.getConnectionById as any).mockResolvedValue(mockConnection);

      await connectionsController.getConnectionById(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(ConnectionService.getConnectionById).toHaveBeenCalledWith(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(mockConnection);
    });

    it('应在ID无效时返回400', async () => {
      mockReq.params = { id: 'invalid' };

      await connectionsController.getConnectionById(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: '无效的连接 ID。',
        code: 'INVALID_PARAMETER',
      });
    });

    it('应在连接不存在时返回404', async () => {
      mockReq.params = { id: '999' };
      (ConnectionService.getConnectionById as any).mockResolvedValue(null);

      await connectionsController.getConnectionById(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: '连接未找到。',
        code: 'NOT_FOUND',
      });
    });
  });

  describe('updateConnection', () => {
    it('应成功更新连接', async () => {
      const mockUpdatedConnection = {
        id: 1,
        name: 'Updated Server',
        host: '192.168.1.100',
      };

      mockReq.params = { id: '1' };
      mockReq.body = { name: 'Updated Server' };

      (ConnectionService.updateConnection as any).mockResolvedValue(mockUpdatedConnection);

      await connectionsController.updateConnection(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(ConnectionService.updateConnection).toHaveBeenCalledWith(1, mockReq.body);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: '连接更新成功。',
        connection: mockUpdatedConnection,
      });
    });

    it('应在ID无效时返回400', async () => {
      mockReq.params = { id: 'invalid' };
      mockReq.body = { name: 'Updated Server' };

      await connectionsController.updateConnection(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: '无效的连接 ID。',
        code: 'INVALID_PARAMETER',
      });
    });

    it('应在连接不存在时返回404', async () => {
      mockReq.params = { id: '999' };
      mockReq.body = { name: 'Updated Server' };

      (ConnectionService.updateConnection as any).mockResolvedValue(null);

      await connectionsController.updateConnection(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: '连接未找到。',
        code: 'NOT_FOUND',
      });
    });
  });

  describe('deleteConnection', () => {
    it('应成功删除连接', async () => {
      mockReq.params = { id: '1' };
      (ConnectionService.deleteConnection as any).mockResolvedValue(true);

      await connectionsController.deleteConnection(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(ConnectionService.deleteConnection).toHaveBeenCalledWith(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ message: '连接删除成功。' });
    });

    it('应在ID无效时返回400', async () => {
      mockReq.params = { id: 'invalid' };

      await connectionsController.deleteConnection(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: '无效的连接 ID。',
        code: 'INVALID_PARAMETER',
      });
    });

    it('应在连接不存在时返回404', async () => {
      mockReq.params = { id: '999' };
      (ConnectionService.deleteConnection as any).mockResolvedValue(false);

      await connectionsController.deleteConnection(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: '连接未找到。',
        code: 'NOT_FOUND',
      });
    });
  });
});
