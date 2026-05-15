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

// ==================== 额外增强测试 ====================

describe('WorkerRequest 额外验证', () => {
  it('payload 支持嵌套对象', () => {
    const request: WorkerRequest = {
      id: 'nested-test',
      type: 'process',
      payload: {
        text: 'hello',
        options: {
          foldThreshold: 100,
          enableHighlight: true,
        },
      },
    };
    const payload = request.payload as { text: string; options: { foldThreshold: number } };
    expect(payload.text).toBe('hello');
    expect(payload.options.foldThreshold).toBe(100);
  });

  it('id 字段支持 UUID 格式', () => {
    const uuidId = '550e8400-e29b-41d4-a716-446655440000';
    const request: WorkerRequest = { id: uuidId, type: 'task', payload: {} };
    expect(request.id).toBe(uuidId);
    expect(request.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('payload 支持 undefined 值字段', () => {
    const request: WorkerRequest = {
      id: '1',
      type: 'configure',
      payload: { foldThreshold: undefined },
    };
    const payload = request.payload as { foldThreshold: number | undefined };
    expect(payload.foldThreshold).toBeUndefined();
  });
});

describe('WorkerResponse 额外验证', () => {
  it('payload 支持复杂对象结果', () => {
    const response: WorkerResponse = {
      id: 'complex-result',
      type: 'process',
      payload: {
        type: 'json',
        content: '{"key": "value"}',
        metadata: {
          lineCount: 1,
          isLong: false,
          shouldFold: false,
          foldThreshold: 500,
        },
      },
    };
    const payload = response.payload as {
      type: string;
      metadata: { lineCount: number };
    };
    expect(payload.type).toBe('json');
    expect(payload.metadata.lineCount).toBe(1);
  });

  it('成功响应应没有 error 字段（不存在 vs undefined）', () => {
    const response: WorkerResponse = {
      id: '1',
      type: 'process',
      payload: 'success',
    };
    expect('error' in response).toBe(false);
  });

  it('空字符串 error 字段被视为有 error', () => {
    const response: WorkerResponse = {
      id: '1',
      type: 'process',
      payload: null,
      error: '',
    };
    expect(response.error).toBe('');
    // Empty string is still falsy — caller should check for existence
    expect('error' in response).toBe(true);
  });

  it('WorkerRequest 和 WorkerResponse 可以 JSON 序列化和反序列化', () => {
    const request: WorkerRequest = { id: 'json-test', type: 'process', payload: { text: 'hi' } };
    const serialized = JSON.stringify(request);
    const deserialized = JSON.parse(serialized) as WorkerRequest;
    expect(deserialized.id).toBe(request.id);
    expect(deserialized.type).toBe(request.type);

    const response: WorkerResponse = { id: 'json-test', type: 'process', payload: { result: 'ok' } };
    const serializedResp = JSON.stringify(response);
    const deserializedResp = JSON.parse(serializedResp) as WorkerResponse;
    expect(deserializedResp.id).toBe(response.id);
    expect(deserializedResp.payload).toEqual(response.payload);
  });
});
