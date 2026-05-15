/**
 * Worker 消息协议类型 (types.ts) 结构验证测试
 *
 * 由于 types.ts 仅包含 TypeScript 类型定义，
 * 这些测试通过构造符合接口的对象并验证其结构来确认协议契约。
 */
import { describe, it, expect } from 'vitest';
import type { WorkerRequest, WorkerResponse } from './types';

describe('WorkerRequest 接口', () => {
  it('应该包含 id、type 和 payload 字段', () => {
    const request: WorkerRequest = {
      id: 'test-id-123',
      type: 'process',
      payload: { text: 'hello' },
    };
    expect(request.id).toBe('test-id-123');
    expect(request.type).toBe('process');
    expect(request.payload).toEqual({ text: 'hello' });
  });

  it('payload 应支持任意类型', () => {
    const requestWithString: WorkerRequest = {
      id: '1',
      type: 'test',
      payload: 'string payload',
    };
    const requestWithNumber: WorkerRequest = {
      id: '2',
      type: 'test',
      payload: 42,
    };
    const requestWithNull: WorkerRequest = {
      id: '3',
      type: 'test',
      payload: null,
    };
    const requestWithArray: WorkerRequest = {
      id: '4',
      type: 'test',
      payload: [1, 2, 3],
    };

    expect(requestWithString.payload).toBe('string payload');
    expect(requestWithNumber.payload).toBe(42);
    expect(requestWithNull.payload).toBeNull();
    expect(requestWithArray.payload).toEqual([1, 2, 3]);
  });

  it('id 应为字符串', () => {
    const request: WorkerRequest = { id: 'uuid-test', type: 'run', payload: {} };
    expect(typeof request.id).toBe('string');
  });

  it('type 应为字符串', () => {
    const request: WorkerRequest = { id: '1', type: 'configure', payload: {} };
    expect(typeof request.type).toBe('string');
  });
});

describe('WorkerResponse 接口', () => {
  it('应该包含 id、type 和 payload 字段', () => {
    const response: WorkerResponse = {
      id: 'resp-id-456',
      type: 'process',
      payload: { result: 'done' },
    };
    expect(response.id).toBe('resp-id-456');
    expect(response.type).toBe('process');
    expect(response.payload).toEqual({ result: 'done' });
  });

  it('error 字段应为可选', () => {
    const successResponse: WorkerResponse = {
      id: '1',
      type: 'process',
      payload: 'success',
    };
    // error is undefined when not provided
    expect(successResponse.error).toBeUndefined();
  });

  it('error 字段存在时应为字符串', () => {
    const errorResponse: WorkerResponse = {
      id: '1',
      type: 'process',
      payload: null,
      error: 'Something went wrong',
    };
    expect(errorResponse.error).toBe('Something went wrong');
    expect(typeof errorResponse.error).toBe('string');
  });

  it('payload 应支持 null（错误响应场景）', () => {
    const response: WorkerResponse = {
      id: '1',
      type: 'process',
      payload: null,
      error: 'Task failed',
    };
    expect(response.payload).toBeNull();
    expect(response.error).toBe('Task failed');
  });

  it('成功响应中 id 应与请求 id 对应', () => {
    const requestId = 'matching-id';
    const request: WorkerRequest = { id: requestId, type: 'test', payload: {} };
    const response: WorkerResponse = { id: requestId, type: 'test', payload: 'done' };

    expect(response.id).toBe(request.id);
  });

  it('type 应与请求 type 对应', () => {
    const request: WorkerRequest = { id: '1', type: 'process', payload: {} };
    const response: WorkerResponse = { id: '1', type: 'process', payload: {} };

    expect(response.type).toBe(request.type);
  });
});

describe('WorkerRequest / WorkerResponse 协议完整性', () => {
  it('WorkerRequest payload 支持深度嵌套对象', () => {
    const nested = { level1: { level2: { level3: { value: 42, flag: true } } } };
    const request: WorkerRequest = { id: 'deep-1', type: 'process', payload: nested };
    expect((request.payload as typeof nested).level1.level2.level3.value).toBe(42);
    expect((request.payload as typeof nested).level1.level2.level3.flag).toBe(true);
  });

  it('WorkerRequest payload 支持数组嵌套对象', () => {
    const payload = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const request: WorkerRequest = { id: 'arr-1', type: 'batch', payload };
    expect((request.payload as typeof payload).items).toHaveLength(3);
  });

  it('WorkerResponse error 字段存在时 payload 应为 null', () => {
    const errorResponse: WorkerResponse = {
      id: 'err-1',
      type: 'process',
      payload: null,
      error: 'Processing failed: unexpected token',
    };
    expect(errorResponse.payload).toBeNull();
    expect(errorResponse.error).toBe('Processing failed: unexpected token');
  });

  it('WorkerResponse payload 支持数值类型', () => {
    const response: WorkerResponse = { id: '1', type: 'count', payload: 999 };
    expect(response.payload).toBe(999);
  });

  it('WorkerResponse payload 支持布尔类型', () => {
    const response: WorkerResponse = { id: '1', type: 'check', payload: true };
    expect(response.payload).toBe(true);
  });

  it('WorkerRequest 与 WorkerResponse 应具有相同的 id 和 type（请求-响应对）', () => {
    const requestId = crypto.randomUUID();
    const taskType = 'transform';
    const request: WorkerRequest = { id: requestId, type: taskType, payload: { data: 'input' } };
    const response: WorkerResponse = { id: requestId, type: taskType, payload: { data: 'output' } };

    expect(response.id).toBe(request.id);
    expect(response.type).toBe(request.type);
  });

  it('configure 任务类型应能正确表示为 WorkerRequest', () => {
    const request: WorkerRequest = {
      id: 'cfg-1',
      type: 'configure',
      payload: { foldThreshold: 200, enableHighlight: false },
    };
    expect(request.type).toBe('configure');
    expect((request.payload as { foldThreshold: number }).foldThreshold).toBe(200);
  });

  it('WorkerResponse 中 ok 响应格式应能正确表示', () => {
    const response: WorkerResponse = {
      id: 'cfg-1',
      type: 'configure',
      payload: { ok: true },
    };
    expect((response.payload as { ok: boolean }).ok).toBe(true);
    expect(response.error).toBeUndefined();
  });
});
