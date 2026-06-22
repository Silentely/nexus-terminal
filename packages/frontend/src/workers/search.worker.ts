/**
 * 终端异步搜索 Web Worker
 * 在独立线程中执行搜索操作，避免阻塞主线程 UI 渲染
 * 支持正则表达式搜索和分块索引
 *
 * 消息协议遵循 workers/types.ts 定义的 WorkerRequest/WorkerResponse 格式：
 * - 请求：{ id, type, payload }
 * - 响应：{ id, type, payload, error? }
 */

/** 搜索请求 payload */
interface SearchPayload {
  /** 终端缓冲区文本内容（按行分割） */
  lines: string[];
  /** 搜索关键词或正则表达式 */
  query: string;
  /** 是否使用正则表达式 */
  useRegex: boolean;
  /** 是否区分大小写 */
  caseSensitive: boolean;
}

/** 索引构建请求 payload */
interface IndexPayload {
  /** 终端缓冲区文本内容 */
  lines: string[];
}

/** 搜索结果 */
interface SearchResult {
  lineIndex: number;
  charIndex: number;
  length: number;
  lineText: string;
}

// 行索引缓存
let indexedLines: string[] = [];

/**
 * 在文本中搜索匹配项
 */
function searchInLines(
  lines: string[],
  query: string,
  useRegex: boolean,
  caseSensitive: boolean,
): SearchResult[] {
  if (!query) return [];

  const results: SearchResult[] = [];
  let regex: RegExp;

  try {
    const flags = caseSensitive ? 'g' : 'gi';
    regex = useRegex ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);
  } catch {
    // 正则表达式语法错误，返回空结果
    return [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 防御性检查：跳过 undefined/非字符串元素（稀疏数组或未初始化缓冲区）
    if (typeof line !== 'string') continue;
    let match: RegExpExecArray | null;

    // 重置 lastIndex 以确保全局搜索正确
    regex.lastIndex = 0;

    while ((match = regex.exec(line)) !== null) {
      results.push({
        lineIndex: i,
        charIndex: match.index,
        length: match[0].length,
        lineText: line,
      });

      // 防止零长度匹配导致无限循环
      if (match[0].length === 0) {
        regex.lastIndex++;
      }

      // 限制结果数量，避免内存溢出
      if (results.length >= 10000) {
        return results;
      }
    }
  }

  return results;
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 构建行索引（将大文本分块处理）
 */
function buildIndex(lines: string[]): void {
  indexedLines = lines;
}

// 消息处理（遵循 workers/types.ts 协议：{id, type, payload}）
self.onmessage = (event: MessageEvent<{ id: string; type: string; payload: unknown }>) => {
  const { id, type, payload } = event.data;

  if (type === 'index') {
    const data = payload as IndexPayload;
    buildIndex(data.lines);
    self.postMessage({
      id,
      type: 'index-ready',
      payload: { totalLines: data.lines.length },
    });
    return;
  }

  if (type === 'search') {
    const data = payload as SearchPayload;
    const { lines, query, useRegex, caseSensitive } = data;
    const searchLines = lines.length > 0 ? lines : indexedLines;

    try {
      const results = searchInLines(searchLines, query, useRegex, caseSensitive);
      self.postMessage({
        id,
        type: 'search-result',
        payload: { results },
      });
    } catch (error: unknown) {
      self.postMessage({
        id,
        type: 'search-result',
        payload: { results: [] },
        error: error instanceof Error ? error.message : '搜索失败',
      });
    }
  }
};
