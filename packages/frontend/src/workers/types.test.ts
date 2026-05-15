/**
 * Unit tests for Worker message protocol types (WorkerRequest, WorkerResponse)
 *
 * These tests verify the TypeScript interfaces compile correctly and that objects
 * conforming to each interface behave as expected at runtime.
 */
import { describe, it, expect } from 'vitest';
import type { WorkerRequest, WorkerResponse } from './types';

// ==================== WorkerRequest ====================

describe('WorkerRequest', () => {
  it('应包含 id、type 和 payload 字段', () => {
    const request: WorkerRequest = { id: 'req-1', type: 'process', payload: { text: 'hello' } };
    expect(request.id).toBe('req-1');
    expect(request.type).toBe('process');
    expect(request.payload).toEqual({ text: 'hello' });
  });

  it('id 应为字符串', () => {
    const request: WorkerRequest = { id: 'abc-123', type: 'process', payload: null };
    expect(typeof request.id).toBe('string');
  });

  it('type 应为字符串', () => {
    const request: WorkerRequest = { id: '1', type: 'configure', payload: {} };
    expect(typeof request.type).toBe('string');
  });

  it('payload 可以为 null', () => {
    const request: WorkerRequest = { id: '1', type: 'process', payload: null };
    expect(request.payload).toBeNull();
  });

  it('payload 可以为对象', () => {
    const payload = { text: 'output', options: { enableHighlight: true } };
    const request: WorkerRequest = { id: '1', type: 'process', payload };
    expect(request.payload).toEqual(payload);
  });
});

// ==================== WorkerResponse ====================

describe('WorkerResponse', () => {
  it('应包含 id、type 和 payload 字段', () => {
    const response: WorkerResponse = { id: 'res-1', type: 'process', payload: { type: 'json', content: '{}' } };
    expect(response.id).toBe('res-1');
    expect(response.type).toBe('process');
    expect(response.payload).toEqual({ type: 'json', content: '{}' });
  });

  it('error 字段应为可选', () => {
    const successResponse: WorkerResponse = { id: '1', type: 'process', payload: 'ok' };
    expect(successResponse.error).toBeUndefined();

    const errorResponse: WorkerResponse = {
      id: '2',
      type: 'process',
      payload: null,
      error: '处理失败',
    };
    expect(errorResponse.error).toBe('处理失败');
  });

  it('payload 可以为 null（错误响应时）', () => {
    const response: WorkerResponse = { id: '1', type: 'process', payload: null, error: 'fail' };
    expect(response.payload).toBeNull();
  });

  it('id 应与对应请求的 id 一致', () => {
    const request: WorkerRequest = { id: 'correlation-id-42', type: 'process', payload: {} };
    const response: WorkerResponse = { id: request.id, type: request.type, payload: 'result' };
    expect(response.id).toBe(request.id);
    expect(response.type).toBe(request.type);
  });
});

// ==================== 边界情况与健壮性测试 ====================

describe('WorkerRequest 边界情况', () => {
  it('id 应支持 UUID 格式', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const request: WorkerRequest = { id: uuid, type: 'process', payload: {} };
    expect(request.id).toBe(uuid);
    expect(request.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('id 应支持空字符串（接口不强制非空）', () => {
    const request: WorkerRequest = { id: '', type: 'process', payload: {} };
    expect(request.id).toBe('');
  });

  it('type 应支持所有任务类型名称', () => {
    const taskTypes = ['process', 'configure', 'execute', 'terminate'];
    for (const taskType of taskTypes) {
      const request: WorkerRequest = { id: '1', type: taskType, payload: {} };
      expect(request.type).toBe(taskType);
    }
  });

  it('payload 应支持嵌套对象', () => {
    const nested = { level1: { level2: { data: [1, 2, 3] } } };
    const request: WorkerRequest = { id: '1', type: 'process', payload: nested };
    expect(request.payload).toEqual(nested);
  });

  it('payload 应支持 undefined', () => {
    const request: WorkerRequest = { id: '1', type: 'process', payload: undefined };
    expect(request.payload).toBeUndefined();
  });

  it('payload 应支持 boolean', () => {
    const request: WorkerRequest = { id: '1', type: 'configure', payload: true };
    expect(request.payload).toBe(true);
  });
});

describe('WorkerResponse 边界情况', () => {
  it('error 字段应支持空字符串', () => {
    const response: WorkerResponse = {
      id: '1',
      type: 'process',
      payload: null,
      error: '',
    };
    expect(response.error).toBe('');
  });

  it('error 字段应支持多行错误消息', () => {
    const multilineError = 'Line 1: TypeError\nLine 2: at function foo\nLine 3: at bar';
    const response: WorkerResponse = {
      id: '1',
      type: 'process',
      payload: null,
      error: multilineError,
    };
    expect(response.error).toBe(multilineError);
    expect(response.error!.split('\n')).toHaveLength(3);
  });

  it('payload 应支持数组结果', () => {
    const results = [{ type: 'json', content: '{}' }, { type: 'text', content: 'hello' }];
    const response: WorkerResponse = { id: '1', type: 'process', payload: results };
    expect(Array.isArray(response.payload)).toBe(true);
    expect((response.payload as typeof results).length).toBe(2);
  });

  it('payload 应支持数字结果', () => {
    const response: WorkerResponse = { id: '1', type: 'count', payload: 42 };
    expect(response.payload).toBe(42);
  });

  it('payload 应支持 boolean 结果', () => {
    const response: WorkerResponse = { id: '1', type: 'configure', payload: { ok: true } };
    expect((response.payload as { ok: boolean }).ok).toBe(true);
  });

  it('同一请求多次响应应通过 id 区分', () => {
    const id1 = 'request-001';
    const id2 = 'request-002';
    const resp1: WorkerResponse = { id: id1, type: 'process', payload: 'result-1' };
    const resp2: WorkerResponse = { id: id2, type: 'process', payload: 'result-2' };

    expect(resp1.id).not.toBe(resp2.id);
    expect(resp1.payload).not.toBe(resp2.payload);
  });
});
