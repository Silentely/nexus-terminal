/**
 * Telnet IAC 协议协商器
 * 处理 WILL/WONT/DO/DONT 选项协商和 NAWS 窗口大小协商
 */

import {
  TELNET_IAC,
  TELNET_WILL,
  TELNET_WONT,
  TELNET_DO,
  TELNET_DONT,
  TELNET_SB,
  TELNET_SE,
  TELNET_OPTION_ECHO,
  TELNET_OPTION_SUPPRESS_GO_AHEAD,
  TELNET_OPTION_NAWS,
  type TelnetParseResult,
  type ITelnetNegotiator,
} from './telnet.types';

export class TelnetNegotiator implements ITelnetNegotiator {
  // 服务器支持的选项（通过 WILL/DONT 通知）
  private serverOptions: Set<number> = new Set();

  // 我们支持的选项
  private readonly supportedOptions: Set<number> = new Set([
    TELNET_OPTION_ECHO,
    TELNET_OPTION_SUPPRESS_GO_AHEAD,
    TELNET_OPTION_NAWS,
  ]);

  /**
   * 解析 Telnet 数据流，分离控制序列和用户数据
   */
  parse(buffer: Buffer): TelnetParseResult {
    const responses: Buffer[] = [];
    let cleanData = '';
    let i = 0;

    const cleanBytes: number[] = [];

    while (i < buffer.length) {
      const byte = buffer[i];

      if (byte === TELNET_IAC) {
        // 处理 IAC 序列
        const result = this.handleIACSequence(buffer, i);
        i = result.nextIndex;

        if (result.response) {
          responses.push(result.response);
        }
        if (result.updateServerOptions) {
          this.serverOptions = result.updateServerOptions;
        }
        // IAC IAC 表示数据字节 0xFF
        if (result.cleanByte !== undefined) {
          cleanBytes.push(result.cleanByte);
        }
      } else {
        // 普通数据字节，累积到数组
        cleanBytes.push(byte);
        i++;
      }
    }

    // 使用 Buffer 正确处理 UTF-8 多字节字符
    if (cleanBytes.length > 0) {
      cleanData = Buffer.from(cleanBytes).toString('utf-8');
    }

    return { cleanData, responses };
  }

  /**
   * 处理 IAC 序列
   */
  private handleIACSequence(
    buffer: Buffer,
    startIndex: number,
  ): {
    nextIndex: number;
    response: Buffer | null;
    updateServerOptions?: Set<number>;
    cleanByte?: number; // 用于返回 IAC IAC 作为数据字节
  } {
    const command = buffer[startIndex + 1];
    const option = buffer[startIndex + 2];

    // IAC IAC - 表示数据字节 0xFF
    if (command === TELNET_IAC) {
      return { nextIndex: startIndex + 2, response: null, cleanByte: 0xff };
    }

    if (command === undefined) {
      return { nextIndex: startIndex + 2, response: null };
    }

    // WILL - 服务器愿意执行某个选项
    if (command === TELNET_WILL) {
      return this.handleWILL(option, startIndex);
    }

    // WONT - 服务器拒绝执行某个选项
    if (command === TELNET_WONT) {
      return this.handleWONT(option, startIndex);
    }

    // DO - 服务器请求客户端执行某个选项
    if (command === TELNET_DO) {
      return this.handleDO(option, startIndex);
    }

    // DONT - 服务器请求客户端停止执行某个选项
    if (command === TELNET_DONT) {
      return this.handleDONT(option, startIndex);
    }

    // SB - 子选项（如 NAWS）
    if (command === TELNET_SB) {
      return this.handleSubOption(buffer, startIndex);
    }

    // 其他 IAC 命令（如 NOP、GA 等），跳过 2 字节
    return { nextIndex: startIndex + 2, response: null };
  }

  /**
   * 处理 WILL 命令（服务器愿意执行）
   */
  private handleWILL(
    option: number,
    startIndex: number,
  ): { nextIndex: number; response: Buffer | null; updateServerOptions?: Set<number> } {
    const newOptions = new Set(this.serverOptions);
    newOptions.add(option);

    // 如果我们支持该选项，回复 DO；否则回复 DONT
    if (this.supportedOptions.has(option)) {
      return {
        nextIndex: startIndex + 3,
        response: Buffer.from([TELNET_IAC, TELNET_DO, option]),
        updateServerOptions: newOptions,
      };
    }

    return {
      nextIndex: startIndex + 3,
      response: Buffer.from([TELNET_IAC, TELNET_DONT, option]),
      updateServerOptions: newOptions,
    };
  }

  /**
   * 处理 WONT 命令（服务器拒绝执行）
   */
  private handleWONT(
    option: number,
    startIndex: number,
  ): { nextIndex: number; response: Buffer | null; updateServerOptions?: Set<number> } {
    const newOptions = new Set(this.serverOptions);
    newOptions.delete(option);

    return {
      nextIndex: startIndex + 3,
      response: null, // 无需响应
      updateServerOptions: newOptions,
    };
  }

  /**
   * 处理 DO 命令（服务器请求客户端执行）
   */
  private handleDO(
    option: number,
    startIndex: number,
  ): { nextIndex: number; response: Buffer | null } {
    // 如果我们支持该选项，回复 WILL；否则回复 WONT
    if (this.supportedOptions.has(option)) {
      return {
        nextIndex: startIndex + 3,
        response: Buffer.from([TELNET_IAC, TELNET_WILL, option]),
      };
    }

    return {
      nextIndex: startIndex + 3,
      response: Buffer.from([TELNET_IAC, TELNET_WONT, option]),
    };
  }

  /**
   * 处理 DONT 命令（服务器请求客户端停止）
   */
  private handleDONT(
    _option: number,
    startIndex: number,
  ): { nextIndex: number; response: Buffer | null } {
    // 无需响应，直接跳过
    return { nextIndex: startIndex + 3, response: null };
  }

  /**
   * 处理子选项（如 NAWS 窗口大小）
   */
  private handleSubOption(
    buffer: Buffer,
    startIndex: number,
  ): { nextIndex: number; response: Buffer | null } {
    // 查找 SE（子选项结束）标记
    let endIndex = startIndex + 2;
    while (endIndex < buffer.length - 1) {
      if (buffer[endIndex] === TELNET_IAC && buffer[endIndex + 1] === TELNET_SE) {
        break;
      }
      endIndex++;
    }

    const subOptionData = buffer.slice(startIndex + 2, endIndex);
    const optionType = subOptionData[0];

    // NAWS 子选项：服务器发送窗口大小
    if (optionType === TELNET_OPTION_NAWS && subOptionData.length >= 5) {
      // NAWS 数据格式：2 字节宽度 + 2 字节高度（网络字节序）
      // 这里只是确认接收，无需特殊处理
    }

    return { nextIndex: endIndex + 2, response: null };
  }

  /**
   * 生成 NAWS 窗口大小协商报文
   */
  negotiateNAWS(cols: number, rows: number): Buffer {
    // NAWS 数据：宽度(2字节) + 高度(2字节)，网络字节序
    const widthHigh = (cols >> 8) & 0xff;
    const widthLow = cols & 0xff;
    const heightHigh = (rows >> 8) & 0xff;
    const heightLow = rows & 0xff;

    return Buffer.from([
      TELNET_IAC,
      TELNET_SB,
      TELNET_OPTION_NAWS,
      widthHigh,
      widthLow,
      heightHigh,
      heightLow,
      TELNET_IAC,
      TELNET_SE,
    ]);
  }

  /**
   * 获取支持的选项列表
   */
  getSupportedOptions(): number[] {
    return Array.from(this.supportedOptions);
  }

  /**
   * 获取服务器支持的选项列表
   */
  getServerOptions(): number[] {
    return Array.from(this.serverOptions);
  }
}
