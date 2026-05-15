/**
 * OutputProcessor WebWorker
 *
 * 在 Worker 线程中执行终端输出的语法高亮处理，
 * 避免大量终端输出阻塞主线程。
 *
 * 支持的任务类型：
 * - process: 处理终端输出文本，返回高亮后的内容
 */

import type { WorkerRequest, WorkerResponse } from './types';

/** ANSI 转义码常量 */
const ANSI = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  BLACK: '\x1b[30m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  BRIGHT_BLACK: '\x1b[90m',
  BRIGHT_RED: '\x1b[91m',
  BRIGHT_GREEN: '\x1b[92m',
  BRIGHT_YELLOW: '\x1b[93m',
  BRIGHT_BLUE: '\x1b[94m',
  BRIGHT_MAGENTA: '\x1b[95m',
  BRIGHT_CYAN: '\x1b[96m',
  BRIGHT_WHITE: '\x1b[97m',
};

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;
const TABLE_SEPARATOR_REGEX = /^[\s|+\-.]*[-+|]{3,}[\s|+\-.]*$/;

/** 输出类型枚举 */
enum OutputType {
  JSON = 'json',
  YAML = 'yaml',
  TABLE = 'table',
  LOG = 'log',
  TEXT = 'text',
}

/** 处理结果接口 */
interface ProcessedOutput {
  type: OutputType;
  content: string;
  metadata?: {
    isLong?: boolean;
    lineCount?: number;
    shouldFold?: boolean;
    foldThreshold?: number;
  };
}

/** 处理配置 */
interface ProcessConfig {
  foldThreshold?: number;
  enableHighlight?: boolean;
  enableTableFormat?: boolean;
  enableLinkDetection?: boolean;
}

// 默认配置
let config: ProcessConfig = {
  foldThreshold: 500,
  enableHighlight: true,
  enableTableFormat: true,
  enableLinkDetection: true,
};

// ==================== 消息处理 ====================

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;

  try {
    switch (type) {
      case 'process': {
        const { text, options } = payload as { text: string; options?: ProcessConfig };
        if (options) config = { ...config, ...options };
        const result = processOutput(text);
        const response: WorkerResponse = { id, type, payload: result };
        self.postMessage(response);
        break;
      }
      case 'configure': {
        const options = payload as ProcessConfig;
        config = { ...config, ...options };
        const response: WorkerResponse = { id, type, payload: { ok: true } };
        self.postMessage(response);
        break;
      }
      default: {
        const response: WorkerResponse = {
          id,
          type,
          payload: null,
          error: `未知任务类型: ${type}`,
        };
        self.postMessage(response);
      }
    }
  } catch (error) {
    const response: WorkerResponse = {
      id,
      type,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

/**
 * Converts raw terminal text into a structured ProcessedOutput by sanitizing, detecting type, and applying configured highlighting or formatting.
 *
 * Normalizes newlines and strips ANSI escape codes, skips highlighting/formatting for very large inputs, detects JSON/YAML/TABLE/LOG/TEXT, applies type-specific rendering according to the current worker `config`, and optionally highlights links.
 *
 * @param output - Raw terminal text to process
 * @returns The processed output object containing the detected `type`, the resulting `content`, and `metadata` with `lineCount`, `isLong`, `shouldFold`, and `foldThreshold`
 */

function processOutput(output: string): ProcessedOutput {
  const normalized = normalizeNewlines(output);
  const sanitized = stripAnsiCodes(normalized);
  const lineCount = sanitized.length ? sanitized.split('\n').length : 0;

  // 大文件保护：超过 5000 行跳过高亮处理
  if (lineCount > 5000) {
    return {
      type: OutputType.TEXT,
      content: sanitized,
      metadata: {
        lineCount,
        isLong: lineCount > (config.foldThreshold ?? 500),
        shouldFold: lineCount > (config.foldThreshold ?? 500),
        foldThreshold: config.foldThreshold ?? 500,
      },
    };
  }

  const detectedType = detectType(sanitized);
  let content = sanitized;

  switch (detectedType) {
    case OutputType.JSON:
      content = config.enableHighlight ? highlightJSON(sanitized) : sanitized;
      break;
    case OutputType.YAML:
      content = config.enableHighlight ? highlightYAML(sanitized) : sanitized;
      break;
    case OutputType.LOG:
      content = config.enableHighlight ? highlightLog(sanitized) : sanitized;
      break;
    case OutputType.TABLE:
      content = config.enableTableFormat ? formatTable(sanitized) : sanitized;
      break;
  }

  if (config.enableLinkDetection) {
    content = highlightLinks(content);
  }

  return {
    type: detectedType,
    content,
    metadata: {
      lineCount,
      isLong: lineCount > (config.foldThreshold ?? 500),
      shouldFold: lineCount > (config.foldThreshold ?? 500),
      foldThreshold: config.foldThreshold ?? 500,
    },
  };
}

/**
 * Determine the semantic type of a text blob (JSON, YAML, TABLE, LOG, or TEXT).
 *
 * @param output - Raw text to analyze for format detection
 * @returns The detected OutputType value: `JSON`, `YAML`, `TABLE`, `LOG`, or `TEXT`
 */
function detectType(output: string): OutputType {
  const trimmed = output.trim();
  if (!trimmed) return OutputType.TEXT;

  if (/^[\[{]/.test(trimmed) && /[\]}]$/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return OutputType.JSON;
    } catch {
      // 非合法 JSON，继续后续格式检测
    }
  }

  const yamlLines = trimmed.split('\n');
  const yamlMatches = yamlLines.filter((line) => /^(\s*)([\w.-]+):\s+.+$/.test(line));
  if (yamlLines.length > 2 && yamlMatches.length >= 2) {
    return OutputType.YAML;
  }

  if (TABLE_SEPARATOR_REGEX.test(trimmed)) {
    return OutputType.TABLE;
  }

  const candidateLines = yamlLines.filter((line) => line.trim().length);
  if (candidateLines.length > 2) {
    const counts = candidateLines.map((line) => line.split(/\s{2,}/).filter(Boolean).length);
    const first = counts[0];
    if (first >= 3 && counts.every((count) => count === first)) {
      return OutputType.TABLE;
    }
  }

  if (
    /\d{4}[-/]\d{2}[-/]\d{2}|\d{2}:\d{2}:\d{2}|\b(ERROR|WARN|INFO|DEBUG|TRACE|SUCCESS|FAIL)\b/i.test(
      trimmed
    )
  ) {
    return OutputType.LOG;
  }

  return OutputType.TEXT;
}

/**
 * Apply ANSI color styling to a JSON string for terminal syntax highlighting.
 *
 * @param jsonText - The JSON text to highlight; expected to be valid JSON.
 * @returns The input JSON formatted with ANSI color codes applied to keys, strings, numbers, booleans, null, and punctuation. If `jsonText` cannot be parsed as JSON, the original `jsonText` is returned unchanged.
 */
function highlightJSON(jsonText: string): string {
  try {
    const parsed = JSON.parse(jsonText);
    const formatted = JSON.stringify(parsed, null, 2);
    return formatted
      .replace(/"([^"\\]+)":/g, `${ANSI.CYAN}${ANSI.BOLD}"$1"${ANSI.RESET}:`)
      .replace(/:\s*"([^"\\]*)"/g, `: ${ANSI.GREEN}"$1"${ANSI.RESET}`)
      .replace(/:\s*(-?\d+(?:\.\d+)?)/g, `: ${ANSI.YELLOW}$1${ANSI.RESET}`)
      .replace(/:\s*(true|false)/gi, `: ${ANSI.MAGENTA}$1${ANSI.RESET}`)
      .replace(/:\s*null/gi, `: ${ANSI.BRIGHT_BLACK}null${ANSI.RESET}`)
      .replace(/([{}\[\],])/g, `${ANSI.WHITE}$1${ANSI.RESET}`);
  } catch {
    return jsonText;
  }
}

/**
 * Apply ANSI color highlighting to YAML-formatted text.
 *
 * Highlights YAML keys, scalar values, comments, and list markers using ANSI escape codes.
 *
 * @param yamlText - The YAML content to highlight; may be multiline.
 * @returns The input text with keys wrapped in cyan+bold, quoted strings in green, numbers in yellow, booleans (`true|false|yes|no`) in magenta, `null`/`~` in bright black, full-line comments in bright black, and list markers (`- `) in white.
function highlightYAML(yamlText: string): string {
  return yamlText
    .split('\n')
    .map((line) => {
      if (/^(\s*)([\w.-]+):\s*(.*)$/.test(line)) {
        return line.replace(
          /^(\s*)([\w.-]+):\s*(.*)$/,
          (_, indent: string, key: string, value: string) => {
            let highlightedValue = value;
            const trimmedValue = value.trim();
            if (/^".*"$/.test(trimmedValue) || /^'.*'$/.test(trimmedValue)) {
              highlightedValue = `${ANSI.GREEN}${value}${ANSI.RESET}`;
            } else if (/^-?\d+(?:\.\d+)?$/.test(trimmedValue)) {
              highlightedValue = `${ANSI.YELLOW}${value}${ANSI.RESET}`;
            } else if (/^(true|false|yes|no)$/i.test(trimmedValue)) {
              highlightedValue = `${ANSI.MAGENTA}${value}${ANSI.RESET}`;
            } else if (/^(null|~)$/i.test(trimmedValue)) {
              highlightedValue = `${ANSI.BRIGHT_BLACK}${value}${ANSI.RESET}`;
            }
            return `${indent}${ANSI.CYAN}${ANSI.BOLD}${key}${ANSI.RESET}: ${highlightedValue}`;
          }
        );
      }
      if (/^\s*#/.test(line)) {
        return `${ANSI.BRIGHT_BLACK}${line}${ANSI.RESET}`;
      }
      if (/^\s*-\s/.test(line)) {
        return line.replace(/^(\s*-\s)/, `${ANSI.WHITE}$1${ANSI.RESET}`);
      }
      return line;
    })
    .join('\n');
}

/**
 * Apply ANSI color highlighting to log text, emphasizing timestamps, level keywords, IPs, and status codes.
 *
 * @param logText - The raw log text to highlight
 * @returns The input text with ANSI color codes applied: timestamps in bright black; `ERROR/ERR` in bright red bold; `WARN/WARNING` in bright yellow bold; `INFO` in bright cyan bold; `DEBUG` in bright black bold; `SUCCESS/OK` in bright green bold; IPv4 addresses in yellow; HTTP status codes colored by range — 2xx green, 3xx cyan, 4xx yellow, 5xx red
 */
function highlightLog(logText: string): string {
  return logText
    .split('\n')
    .map((line) => {
      let transformed = line.replace(
        /(\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/g,
        `${ANSI.BRIGHT_BLACK}$1${ANSI.RESET}`
      );
      transformed = transformed
        .replace(/\b(ERROR|ERR)\b/gi, `${ANSI.BRIGHT_RED}${ANSI.BOLD}$1${ANSI.RESET}`)
        .replace(/\b(WARN|WARNING)\b/gi, `${ANSI.BRIGHT_YELLOW}${ANSI.BOLD}$1${ANSI.RESET}`)
        .replace(/\b(INFO)\b/gi, `${ANSI.BRIGHT_CYAN}${ANSI.BOLD}$1${ANSI.RESET}`)
        .replace(/\b(DEBUG)\b/gi, `${ANSI.BRIGHT_BLACK}${ANSI.BOLD}$1${ANSI.RESET}`)
        .replace(/\b(SUCCESS|OK)\b/gi, `${ANSI.BRIGHT_GREEN}${ANSI.BOLD}$1${ANSI.RESET}`);
      transformed = transformed.replace(
        /\b(\d{1,3}(?:\.\d{1,3}){3})\b/g,
        `${ANSI.YELLOW}$1${ANSI.RESET}`
      );
      transformed = transformed.replace(/\b([2-5]\d{2})\b/g, (match) => {
        const code = Number(match);
        if (code >= 200 && code < 300) return `${ANSI.GREEN}${match}${ANSI.RESET}`;
        if (code >= 300 && code < 400) return `${ANSI.CYAN}${match}${ANSI.RESET}`;
        if (code >= 400 && code < 500) return `${ANSI.YELLOW}${match}${ANSI.RESET}`;
        if (code >= 500) return `${ANSI.RED}${match}${ANSI.RESET}`;
        return match;
      });
      return transformed;
    })
    .join('\n');
}

/**
 * Format raw table-like text into an aligned, ANSI-colored table.
 *
 * @param tableText - The raw table text to format; rows may use `|` separators or two-or-more spaces between columns.
 * @returns The formatted multi-line table with columns aligned and ANSI color codes applied. If the input contains no parsable table rows, the original `tableText` is returned unchanged.
 */
function formatTable(tableText: string): string {
  const lines = tableText.split('\n').filter((line) => line.trim().length);
  if (!lines.length) return tableText;

  type TableLine = { kind: 'separator'; raw: string } | { kind: 'row'; cells: string[] };

  const parsedLines: TableLine[] = lines.map((line) => {
    if (TABLE_SEPARATOR_REGEX.test(line.trim())) {
      return { kind: 'separator', raw: line };
    }
    return { kind: 'row', cells: parseTableCells(line) };
  });

  const rows = parsedLines.filter(
    (line): line is { kind: 'row'; cells: string[] } => line.kind === 'row' && line.cells.length > 0
  );
  if (!rows.length) return tableText;

  const columnCount = Math.max(...rows.map((row) => row.cells.length));
  if (columnCount === 0) return tableText;

  const columnWidths = Array(columnCount).fill(0);
  rows.forEach((row) => {
    row.cells.forEach((cell, index) => {
      if (cell.length > columnWidths[index]) {
        columnWidths[index] = cell.length;
      }
    });
  });

  let rowIndex = 0;
  const formatted = parsedLines.map((line) => {
    if (line.kind === 'separator') {
      return `${ANSI.BRIGHT_BLACK}${line.raw}${ANSI.RESET}`;
    }
    const paddedCells = columnWidths.map((width, index) => {
      const cell = line.cells[index] ?? '';
      return cell.padEnd(width);
    });
    const joined = paddedCells.join('  ').trimEnd();
    if (rowIndex === 0) {
      rowIndex += 1;
      return `${ANSI.CYAN}${ANSI.BOLD}${joined}${ANSI.RESET}`;
    }
    rowIndex += 1;
    return joined;
  });

  return formatted.join('\n');
}

/**
 * Colorizes full URLs and eligible path-like segments in the input using ANSI escape sequences.
 *
 * @param text - Input string to scan for URLs and path-like paths
 * @returns The original text with full `http://`/`https://` URLs wrapped in blue+bold ANSI codes and eligible leading path-like segments wrapped in cyan ANSI codes
 */
function highlightLinks(text: string): string {
  let result = text.replace(/(https?:\/\/[^\s]+)/g, `${ANSI.BLUE}${ANSI.BOLD}$1${ANSI.RESET}`);
  result = result.replace(
    /(^|[\s"'\(\[])(\/([\w.+-]+\/){0,20}[\w.+-]*)/g,
    (_match: string, prefix: string, path: string) => {
      if (prefix.endsWith(':') || path.startsWith('//')) {
        return `${prefix}${path}`;
      }
      return `${prefix}${ANSI.CYAN}${path}${ANSI.RESET}`;
    }
  );
  return result;
}

/**
 * Parse a single table row into an array of cell strings.
 *
 * Handles two formats: pipe-separated cells (using `|`) and whitespace-separated cells (columns separated by two or more spaces).
 *
 * @param line - The raw table row text to parse.
 * @returns An array of trimmed cell strings. For pipe-separated rows, leading/trailing empty columns produced by leading/trailing `|` are removed. For whitespace-separated rows, empty cells are omitted unless the original line contained two consecutive spaces, in which case empty segments are preserved.
 */
function parseTableCells(line: string): string[] {
  if (line.includes('|')) {
    const raw = line.split('|').map((cell) => cell.trim());
    if (raw.length > 1 && raw[0] === '') raw.shift();
    if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
    return raw.map((cell) => cell.trim());
  }
  return line
    .trim()
    .split(/\s{2,}/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length || line.includes('  '));
}

/**
 * Normalize newline sequences to LF (`\n`).
 *
 * @param value - The input text whose line endings should be normalized
 * @returns The input string with all CRLF (`\r\n`) and CR (`\r`) sequences replaced by LF (`\n`)
 */
function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/**
 * Removes ANSI SGR escape sequences (e.g., `\x1b[...m`) from the input string.
 *
 * @param value - The string that may contain ANSI escape codes
 * @returns The string with all ANSI escape sequences removed
 */
function stripAnsiCodes(value: string): string {
  return value.replace(ANSI_ESCAPE_REGEX, '');
}
