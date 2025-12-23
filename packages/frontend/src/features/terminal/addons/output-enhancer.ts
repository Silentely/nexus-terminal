/**
 * Xterm 输出增强插件
 * - 语法高亮 / 表格格式化 / 链接检测
 * - 长输出折叠 & 快捷键展开
 */

import type { ITerminalAddon, Terminal } from 'xterm';
import {
  OutputProcessor,
  type OutputType,
  type ProcessedOutput,
} from '../../../utils/output-processor';

const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_BOLD = '\x1b[1m';

export interface OutputEnhancerOptions {
  enabled?: boolean;
  foldThreshold?: number;
  foldPreviewLines?: number;
  enableHighlight?: boolean;
  enableTableFormat?: boolean;
  enableLinkDetection?: boolean;
}

interface FoldedBlock {
  id: string;
  type: OutputType;
  totalLines: number;
  previewLines: number;
  hiddenLines: number;
  hiddenContent: string;
}

export class OutputEnhancerAddon implements ITerminalAddon {
  private terminal?: Terminal;
  private originalWrite?: Terminal['write'];
  private enabled: boolean;
  private processor: OutputProcessor;
  private options: Required<
    Pick<
      OutputEnhancerOptions,
      | 'foldThreshold'
      | 'foldPreviewLines'
      | 'enableHighlight'
      | 'enableTableFormat'
      | 'enableLinkDetection'
    >
  >;
  private foldedBlocks: FoldedBlock[] = [];
  private foldCounter = 0;
  private readonly maxFoldedBlocks = 24;
  private readonly maxFoldBlockSize = 1024 * 1024; // 单个折叠块最大 1MB
  private readonly throttleMs = 16; // 约 60fps，避免高频输出卡顿
  private lastProcessTime = 0;

  constructor(options: OutputEnhancerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.options = {
      foldThreshold: options.foldThreshold ?? 500,
      foldPreviewLines: options.foldPreviewLines ?? 200,
      enableHighlight: options.enableHighlight ?? true,
      enableTableFormat: options.enableTableFormat ?? true,
      enableLinkDetection: options.enableLinkDetection ?? true,
    };

    this.processor = new OutputProcessor({
      foldThreshold: this.options.foldThreshold,
      enableHighlight: this.options.enableHighlight,
      enableTableFormat: this.options.enableTableFormat,
      enableLinkDetection: this.options.enableLinkDetection,
    });
  }

  activate(terminal: Terminal): void {
    this.terminal = terminal;
    this.originalWrite = terminal.write.bind(terminal);

    const enhancedWrite = (data: string | Uint8Array, callback?: () => void) => {
      if (!this.originalWrite) return;

      if (!this.enabled || typeof data !== 'string' || this.shouldBypass(data)) {
        this.originalWrite(data, callback);
        return;
      }

      // 节流机制：高频输出时跳过处理，避免 CPU 飙升
      const now =
        typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      if (now - this.lastProcessTime < this.throttleMs) {
        this.originalWrite(data, callback);
        return;
      }
      this.lastProcessTime = now;

      const processed = this.processor.process(data);
      const content = this.applyFolding(processed);
      this.originalWrite(content, callback);
    };

    terminal.write = enhancedWrite as Terminal['write'];
  }

  dispose(): void {
    if (this.terminal && this.originalWrite) {
      this.terminal.write = this.originalWrite;
    }
    this.terminal = undefined;
    this.foldedBlocks = [];
  }

  processOutput(data: string): string {
    if (!this.enabled || this.shouldBypass(data)) {
      return data;
    }
    const processed = this.processor.process(data);
    return this.applyFolding(processed);
  }

  expandLastFold(): boolean {
    const block = this.foldedBlocks.pop();
    if (!block || !this.originalWrite) return false;
    this.writeExpandedBlock(block);
    return true;
  }

  expandFold(id: string): boolean {
    const index = this.foldedBlocks.findIndex((block) => block.id === id);
    if (index === -1 || !this.originalWrite) return false;
    const [block] = this.foldedBlocks.splice(index, 1);
    this.writeExpandedBlock(block);
    return true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  updateOptions(options: OutputEnhancerOptions): void {
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
    if (options.foldThreshold !== undefined) {
      this.options.foldThreshold = options.foldThreshold;
      this.processor.setFoldThreshold(options.foldThreshold);
    }
    if (options.foldPreviewLines !== undefined) {
      this.options.foldPreviewLines = options.foldPreviewLines;
    }
    if (options.enableHighlight !== undefined) {
      this.options.enableHighlight = options.enableHighlight;
      this.processor.setEnableHighlight(options.enableHighlight);
    }
    if (options.enableTableFormat !== undefined) {
      this.options.enableTableFormat = options.enableTableFormat;
      this.processor.setEnableTableFormat(options.enableTableFormat);
    }
    if (options.enableLinkDetection !== undefined) {
      this.options.enableLinkDetection = options.enableLinkDetection;
      this.processor.setEnableLinkDetection(options.enableLinkDetection);
    }
  }

  private applyFolding(result: ProcessedOutput): string {
    const { metadata } = result;
    if (!metadata?.shouldFold || !metadata.lineCount) {
      return result.content;
    }

    const lines = result.content.split('\n');
    const previewCount = Math.min(this.options.foldPreviewLines, lines.length);
    const preview = lines.slice(0, previewCount).join('\n');
    let remaining = lines.slice(previewCount).join('\n');
    const hiddenLines = Math.max(0, lines.length - previewCount);

    if (hiddenLines === 0 || !remaining.trim()) {
      return result.content;
    }

    // 内存保护：限制单个折叠块最大 1MB，避免内存耗尽
    const remainingBytes = new TextEncoder().encode(remaining).length;
    if (remainingBytes > this.maxFoldBlockSize) {
      // 按字节安全截断：逐步减少字符数直到字节大小符合要求
      let truncated = remaining;
      let targetLength = Math.floor((remaining.length * this.maxFoldBlockSize) / remainingBytes);

      while (
        new TextEncoder().encode(truncated).length > this.maxFoldBlockSize &&
        targetLength > 0
      ) {
        truncated = remaining.slice(0, targetLength);
        targetLength = Math.floor(targetLength * 0.9); // 每次减少10%
      }

      const truncatedLines = truncated.split('\n').length;
      const actualBytes = new TextEncoder().encode(truncated).length;
      remaining = `${
        truncated
      }\n${ANSI_DIM}[... 内容过长已截断，已隐藏 ${hiddenLines - truncatedLines} 行]${ANSI_RESET}`;
      console.warn(
        `[OutputEnhancerAddon] 折叠块内容过大（${(remainingBytes / 1024 / 1024).toFixed(2)}MB），已截断到 ${(actualBytes / 1024 / 1024).toFixed(2)}MB`
      );
    }

    const foldId = this.generateFoldId();

    this.foldedBlocks.push({
      id: foldId,
      type: result.type,
      totalLines: lines.length,
      previewLines: previewCount,
      hiddenLines,
      hiddenContent: remaining,
    });

    if (this.foldedBlocks.length > this.maxFoldedBlocks) {
      this.foldedBlocks.shift();
    }

    const notice = `\n${ANSI_DIM}[输出已折叠 #${foldId} · 展示 ${previewCount} 行 | 隐藏 ${hiddenLines} 行 · Ctrl+Shift+O 展开]${ANSI_RESET}\n`;
    return `${preview}${notice}`;
  }

  private writeExpandedBlock(block: FoldedBlock): void {
    if (!this.originalWrite) return;
    const header = `${ANSI_DIM}${ANSI_BOLD}[展开输出 #${block.id}]${ANSI_RESET}\n`;
    const footer = `\n${ANSI_DIM}${ANSI_CYAN}[#${block.id} 展开完毕]${ANSI_RESET}\n`;
    this.originalWrite(`\n${header}${block.hiddenContent}${footer}`);
  }

  private generateFoldId(): string {
    this.foldCounter += 1;
    return `F${Date.now().toString(36)}-${this.foldCounter}`;
  }

  private shouldBypass(data: string): boolean {
    if (!data.trim()) return true;

    // OSC 序列 (如设置标题)
    if (/\x1b\][^\x07]*\x07/.test(data)) {
      return true;
    }

    // 除颜色以外的控制序列（如光标移动、清屏）
    const stripped = data.replace(/\x1b\[[0-9;]*m/g, '');
    if (/\x1b\[[0-9;]*[A-Za-z]/.test(stripped)) {
      return true;
    }

    // 进度条 / 回车覆盖
    if (/\r(?!\n)/.test(data)) {
      return true;
    }

    return false;
  }
}
