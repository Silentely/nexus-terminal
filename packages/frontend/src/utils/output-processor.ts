/**
 * 命令输出增强处理器
 * - 语法高亮：JSON / YAML / LOG
 * - 表格自动格式化
 * - 链接检测
 * - 长输出折叠元数据
 */

export enum OutputType {
  JSON = 'json',
  YAML = 'yaml',
  TABLE = 'table',
  LOG = 'log',
  TEXT = 'text',
}

export interface ProcessedOutput {
  type: OutputType;
  content: string;
  metadata?: {
    isLong?: boolean;
    lineCount?: number;
    shouldFold?: boolean;
    foldThreshold?: number;
  };
}

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

export class OutputProcessor {
  private foldThreshold = 500;
  private enableHighlight = true;
  private enableTableFormat = true;
  private enableLinkDetection = true;

  constructor(options?: {
    foldThreshold?: number;
    enableHighlight?: boolean;
    enableTableFormat?: boolean;
    enableLinkDetection?: boolean;
  }) {
    if (options?.foldThreshold !== undefined) this.foldThreshold = options.foldThreshold;
    if (options?.enableHighlight !== undefined) this.enableHighlight = options.enableHighlight;
    if (options?.enableTableFormat !== undefined) this.enableTableFormat = options.enableTableFormat;
    if (options?.enableLinkDetection !== undefined) this.enableLinkDetection = options.enableLinkDetection;
  }

  process(output: string): ProcessedOutput {
    const normalized = this.normalizeNewlines(output);
    const sanitized = this.stripAnsiCodes(normalized);
    const lineCount = sanitized.length ? sanitized.split('\n').length : 0;
    const detectedType = this.detectType(sanitized);

    let content = sanitized;

    switch (detectedType) {
      case OutputType.JSON:
        content = this.enableHighlight ? this.highlightJSON(sanitized) : sanitized;
        break;
      case OutputType.YAML:
        content = this.enableHighlight ? this.highlightYAML(sanitized) : sanitized;
        break;
      case OutputType.LOG:
        content = this.enableHighlight ? this.highlightLog(sanitized) : sanitized;
        break;
      case OutputType.TABLE:
        content = this.enableTableFormat ? this.formatTable(sanitized) : sanitized;
        break;
      default:
        break;
    }

    if (this.enableLinkDetection) {
      content = this.highlightLinks(content);
    }

    return {
      type: detectedType,
      content,
      metadata: {
        lineCount,
        isLong: lineCount > this.foldThreshold,
        shouldFold: lineCount > this.foldThreshold,
        foldThreshold: this.foldThreshold,
      },
    };
  }

  private detectType(output: string): OutputType {
    const trimmed = output.trim();
    if (!trimmed) return OutputType.TEXT;

    if (/^[\[{]/.test(trimmed) && /[\]}]$/.test(trimmed)) {
      try {
        JSON.parse(trimmed);
        return OutputType.JSON;
      } catch {
        // fallthrough
      }
    }

    const yamlLines = trimmed.split('\n');
    const yamlMatches = yamlLines.filter(line => /^(\s*)([\w.-]+):\s+.+$/.test(line));
    if (yamlLines.length > 2 && yamlMatches.length >= 2) {
      return OutputType.YAML;
    }

    if (TABLE_SEPARATOR_REGEX.test(trimmed)) {
      return OutputType.TABLE;
    }

    const candidateLines = yamlLines.filter(line => line.trim().length);
    if (candidateLines.length > 2) {
      const counts = candidateLines.map(line => line.split(/\s{2,}/).filter(Boolean).length);
      const first = counts[0];
      if (first >= 3 && counts.every(count => count === first)) {
        return OutputType.TABLE;
      }
    }

    if (/\d{4}[-/]\d{2}[-/]\d{2}|\d{2}:\d{2}:\d{2}|\b(ERROR|WARN|INFO|DEBUG|TRACE|SUCCESS|FAIL)\b/i.test(trimmed)) {
      return OutputType.LOG;
    }

    return OutputType.TEXT;
  }

  private highlightJSON(jsonText: string): string {
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

  private highlightYAML(yamlText: string): string {
    return yamlText
      .split('\n')
      .map(line => {
        if (/^(\s*)([\w.-]+):\s*(.*)$/.test(line)) {
          return line.replace(/^(\s*)([\w.-]+):\s*(.*)$/, (_, indent, key, value) => {
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
          });
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

  private highlightLog(logText: string): string {
    return logText
      .split('\n')
      .map(line => {
        let transformed = line.replace(/(\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/g, `${ANSI.BRIGHT_BLACK}$1${ANSI.RESET}`);
        transformed = transformed.replace(/\b(ERROR|ERR)\b/gi, `${ANSI.BRIGHT_RED}${ANSI.BOLD}$1${ANSI.RESET}`)
          .replace(/\b(WARN|WARNING)\b/gi, `${ANSI.BRIGHT_YELLOW}${ANSI.BOLD}$1${ANSI.RESET}`)
          .replace(/\b(INFO)\b/gi, `${ANSI.BRIGHT_CYAN}${ANSI.BOLD}$1${ANSI.RESET}`)
          .replace(/\b(DEBUG)\b/gi, `${ANSI.BRIGHT_BLACK}${ANSI.BOLD}$1${ANSI.RESET}`)
          .replace(/\b(SUCCESS|OK)\b/gi, `${ANSI.BRIGHT_GREEN}${ANSI.BOLD}$1${ANSI.RESET}`);
        transformed = transformed.replace(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g, `${ANSI.YELLOW}$1${ANSI.RESET}`);
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

  private formatTable(tableText: string): string {
    const lines = tableText.split('\n').filter(line => line.trim().length);
    if (!lines.length) return tableText;

    type TableLine =
      | { kind: 'separator'; raw: string }
      | { kind: 'row'; cells: string[] };

    const parsedLines: TableLine[] = lines.map((line) => {
      if (this.isTableSeparator(line)) {
        return { kind: 'separator', raw: line };
      }
      return { kind: 'row', cells: this.parseTableCells(line) };
    });

    const rows = parsedLines.filter((line): line is { kind: 'row'; cells: string[] } => line.kind === 'row' && line.cells.length > 0);
    if (!rows.length) return tableText;

    const columnCount = Math.max(...rows.map(row => row.cells.length));
    if (columnCount === 0) return tableText;

    const columnWidths = Array(columnCount).fill(0);
    rows.forEach(row => {
      row.cells.forEach((cell, index) => {
        const length = cell.length;
        if (length > columnWidths[index]) {
          columnWidths[index] = length;
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

  private highlightLinks(text: string): string {
    let result = text.replace(/(https?:\/\/[^\s]+)/g, `${ANSI.BLUE}${ANSI.BOLD}$1${ANSI.RESET}`);
    result = result.replace(/(^|[\s"'\(\[])((?:\/[\w.+-]+)+\/?)/g, (_match, prefix: string, path: string) => {
      if (prefix.endsWith(':') || path.startsWith('//')) {
        return `${prefix}${path}`;
      }
      return `${prefix}${ANSI.CYAN}${path}${ANSI.RESET}`;
    });
    return result;
  }

  private isTableSeparator(line: string): boolean {
    return TABLE_SEPARATOR_REGEX.test(line.trim());
  }

  private parseTableCells(line: string): string[] {
    if (line.includes('|')) {
      const raw = line.split('|').map(cell => cell.trim());
      if (raw.length > 1 && raw[0] === '') raw.shift();
      if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
      return raw.map(cell => cell.trim());
    }
    return line.trim().split(/\s{2,}/).map(cell => cell.trim()).filter(cell => cell.length || line.includes('  '));
  }

  private normalizeNewlines(value: string): string {
    return value.replace(/\r\n?/g, '\n');
  }

  private stripAnsiCodes(value: string): string {
    return value.replace(ANSI_ESCAPE_REGEX, '');
  }

  setFoldThreshold(threshold: number): void {
    this.foldThreshold = threshold;
  }

  setEnableHighlight(enabled: boolean): void {
    this.enableHighlight = enabled;
  }

  setEnableTableFormat(enabled: boolean): void {
    this.enableTableFormat = enabled;
  }

  setEnableLinkDetection(enabled: boolean): void {
    this.enableLinkDetection = enabled;
  }
}

export const outputProcessor = new OutputProcessor();
