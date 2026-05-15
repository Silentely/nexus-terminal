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
 * Process raw terminal output into a typed, optionally highlighted or formatted result with folding metadata.
 *
 * Normalizes newlines, strips ANSI escape codes, detects the output type (json, yaml, table, log, or text), and applies highlighting or table formatting based on the current configuration. For very large outputs (more than 5000 lines) highlighting/formatting is skipped and the sanitized text is returned directly.
 *
 * @param output - The raw terminal output text to process.
 * @returns The processed output object containing:
 *  - `type`: the detected `OutputType`;
 *  - `content`: the processed string (may include ANSI color codes when highlighting is applied);
 *  - `metadata`: an object with `lineCount`, `isLong`, `shouldFold`, and `foldThreshold`.
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
 * Detects the output's format (JSON, YAML, table, log, or plain text) based on its content.
 *
 * The function examines the trimmed, ANSI-stripped text to determine its most likely type:
 * it attempts a JSON parse for bracketed content, looks for YAML-style key/value lines,
 * recognizes table-like separators or consistent multi-column rows, and detects common log
 * patterns (timestamps or level keywords). Empty or whitespace-only input is treated as plain text.
 *
 * @param output - The ANSI-free text to analyze.
 * @returns The detected `OutputType`: `JSON`, `YAML`, `TABLE`, `LOG`, or `TEXT`.
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
 * Format JSON text with two-space indentation and apply ANSI color highlighting.
 *
 * Parses the provided JSON, pretty-prints it with two-space indentation, and
 * applies ANSI color codes to keys, string values, numeric values, booleans,
 * `null`, and JSON punctuation. If the input is not valid JSON, the original
 * `jsonText` is returned unchanged.
 *
 * @param jsonText - The JSON text to format and highlight
 * @returns The colorized, pretty-printed JSON string, or the original input if parsing fails
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
 * @param yamlText - The YAML input to process
 * @returns The input text with ANSI color codes applied: keys rendered in cyan bold; string values in green; numeric values in yellow; boolean-like values in magenta; `null`/`~` in bright black; comment lines in bright black; and list item markers (`- `) in white. Lines that do not match YAML key/value, comment, or list-item patterns are returned unchanged.
 */
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
 * Apply ANSI color highlighting to log text for timestamps, severity levels, IP addresses, and HTTP status codes.
 *
 * @param logText - The raw log text to highlight
 * @returns The input log text with ANSI color codes inserted for matched timestamps, level keywords (e.g., ERROR, WARN, INFO, DEBUG, SUCCESS), IP addresses, and HTTP status codes (2xx–5xx)
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
 * Format a plain-text table into aligned columns and apply ANSI styling for separators and header.
 *
 * The function parses the input into separator lines and data rows, calculates column widths,
 * pads each cell to align columns, wraps separator lines with dim coloring, and highlights the
 * first data row as a cyan bold header. If the input cannot be parsed into a table, the original
 * text is returned unchanged.
 *
 * @param tableText - Raw table-like text (rows separated by newlines; cells separated by `|` or by two or more spaces)
 * @returns The table text with columns aligned and ANSI styles applied, or the original `tableText` if formatting is not applicable
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
 * Highlights URLs and path-like segments in the given text with ANSI color codes.
 *
 * Wraps `http`/`https` URLs in blue bold ANSI codes. Also highlights leading path-like segments
 * (strings beginning with `/` and composed of path characters) in cyan unless the prefix ends
 * with `:` or the path starts with `//`, in which case the segment is left unchanged.
 *
 * @param text - The input text to scan for URLs and path-like segments
 * @returns The input string with matched URLs and eligible paths wrapped in ANSI color codes
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
 * Split a single table line into its constituent cell strings.
 *
 * Supports two formats: pipe-separated cells (e.g., "| a | b |") and cells separated by two or more spaces. Each returned cell is trimmed of surrounding whitespace. For pipe-separated lines, leading or trailing empty segments produced by outer pipes are removed. For space-separated lines, empty cells are preserved only if the original line contained two consecutive spaces.
 *
 * @param line - A single input line from a table.
 * @returns An array of trimmed cell strings parsed from the line.
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
 * Normalize newline sequences in a string to LF (`\n`).
 *
 * @param value - Input text that may contain CRLF (`\r\n`) or CR (`\r`) newlines
 * @returns The input with all `\r\n` and `\r` sequences replaced by `\n`
 */
function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/**
 * Remove ANSI escape sequences from a string.
 *
 * @param value - The input string that may contain ANSI escape codes (e.g. color or style sequences)
 * @returns The input string with all ANSI escape sequences removed
 */
function stripAnsiCodes(value: string): string {
  return value.replace(ANSI_ESCAPE_REGEX, '');
}
