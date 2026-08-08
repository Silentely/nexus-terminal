import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest } from './types';

interface TestWorker {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

describe('output-processor.worker', () => {
  let worker: TestWorker;

  beforeEach(async () => {
    vi.resetModules();
    worker = {
      onmessage: null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', worker);
    await import('./output-processor.worker');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('单次 process 配置不应污染后续默认配置请求', () => {
    const input = 'Visit https://example.com';

    worker.onmessage?.({
      data: {
        id: 'request-1',
        type: 'process',
        payload: { text: input, options: { enableLinkDetection: false } },
      },
    } as MessageEvent<WorkerRequest>);
    worker.onmessage?.({
      data: {
        id: 'request-2',
        type: 'process',
        payload: { text: input },
      },
    } as MessageEvent<WorkerRequest>);

    const firstResponse = worker.postMessage.mock.calls[0]?.[0];
    const secondResponse = worker.postMessage.mock.calls[1]?.[0];

    expect(firstResponse.payload.content).not.toContain('\x1b[');
    expect(secondResponse.payload.content).toContain('\x1b[');
  });
});
