import { describe, it, expect, beforeEach } from 'vitest';
import { TelnetNegotiator } from './telnet-negotiation';
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
} from './telnet.types';

describe('TelnetNegotiator', () => {
  let negotiator: TelnetNegotiator;

  beforeEach(() => {
    negotiator = new TelnetNegotiator();
  });

  describe('parse - 基本数据解析', () => {
    it('应正确解析普通文本数据', () => {
      const buffer = Buffer.from('Hello World');
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('Hello World');
      expect(result.responses).toHaveLength(0);
    });

    it('应正确解析空数据', () => {
      const buffer = Buffer.alloc(0);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(0);
    });

    it('应正确处理单字节数据', () => {
      const buffer = Buffer.from([0x41]); // 'A'
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('A');
      expect(result.responses).toHaveLength(0);
    });
  });

  describe('parse - IAC 序列处理', () => {
    it('应识别 WILL 命令并回复 DO（支持的选项）', () => {
      // IAC WILL ECHO
      const buffer = Buffer.from([TELNET_IAC, TELNET_WILL, TELNET_OPTION_ECHO]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(1);
      expect(result.responses[0]).toEqual(Buffer.from([TELNET_IAC, TELNET_DO, TELNET_OPTION_ECHO]));
    });

    it('应识别 WILL 命令并回复 DONT（不支持的选项）', () => {
      // IAC WILL TERMINAL_TYPE (option 24, 不支持)
      const buffer = Buffer.from([TELNET_IAC, TELNET_WILL, 24]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(1);
      expect(result.responses[0]).toEqual(Buffer.from([TELNET_IAC, TELNET_DONT, 24]));
    });

    it('应识别 DO 命令并回复 WILL（支持的选项）', () => {
      // IAC DO SUPPRESS_GO_AHEAD
      const buffer = Buffer.from([TELNET_IAC, TELNET_DO, TELNET_OPTION_SUPPRESS_GO_AHEAD]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(1);
      expect(result.responses[0]).toEqual(
        Buffer.from([TELNET_IAC, TELNET_WILL, TELNET_OPTION_SUPPRESS_GO_AHEAD]),
      );
    });

    it('应识别 DO 命令并回复 WONT（不支持的选项）', () => {
      // IAC DO TERMINAL_TYPE (option 24, 不支持)
      const buffer = Buffer.from([TELNET_IAC, TELNET_DO, 24]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(1);
      expect(result.responses[0]).toEqual(Buffer.from([TELNET_IAC, TELNET_WONT, 24]));
    });

    it('应识别 WONT 命令并更新服务器选项', () => {
      // 先发送 WILL ECHO，再发送 WONT ECHO
      const buffer1 = Buffer.from([TELNET_IAC, TELNET_WILL, TELNET_OPTION_ECHO]);
      negotiator.parse(buffer1);

      const buffer2 = Buffer.from([TELNET_IAC, TELNET_WONT, TELNET_OPTION_ECHO]);
      const result = negotiator.parse(buffer2);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(0);
      expect(negotiator.getServerOptions()).not.toContain(TELNET_OPTION_ECHO);
    });

    it('应识别 DONT 命令并跳过（无需响应）', () => {
      const buffer = Buffer.from([TELNET_IAC, TELNET_DONT, TELNET_OPTION_ECHO]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(0);
    });
  });

  describe('parse - 混合数据处理', () => {
    it('应正确处理文本和 IAC 序列混合的数据', () => {
      // "A" + IAC WILL ECHO + "B"
      const buffer = Buffer.from([
        0x41, // 'A'
        TELNET_IAC,
        TELNET_WILL,
        TELNET_OPTION_ECHO,
        0x42, // 'B'
      ]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('AB');
      expect(result.responses).toHaveLength(1);
      expect(result.responses[0]).toEqual(Buffer.from([TELNET_IAC, TELNET_DO, TELNET_OPTION_ECHO]));
    });

    it('应正确处理连续多个 IAC 序列', () => {
      // IAC WILL ECHO + IAC DO SUPPRESS_GO_AHEAD
      const buffer = Buffer.from([
        TELNET_IAC,
        TELNET_WILL,
        TELNET_OPTION_ECHO,
        TELNET_IAC,
        TELNET_DO,
        TELNET_OPTION_SUPPRESS_GO_AHEAD,
      ]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(2);
    });

    it('应正确处理子选项序列', () => {
      // IAC SB NAWS <width_high> <width_low> <height_high> <height_low> IAC SE
      const buffer = Buffer.from([
        TELNET_IAC,
        TELNET_SB,
        TELNET_OPTION_NAWS,
        0x00,
        0x50, // width = 80
        0x00,
        0x18, // height = 24
        TELNET_IAC,
        TELNET_SE,
      ]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(0);
    });
  });

  describe('parse - 边界情况', () => {
    it('应处理不完整的 IAC 序列（缺少命令字节）', () => {
      const buffer = Buffer.from([TELNET_IAC]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      expect(result.responses).toHaveLength(0);
    });

    it('应处理不完整的 IAC 序列（缺少选项字节）', () => {
      // IAC WILL (缺少选项字节) - 防御性处理：回复 DONT 0
      const buffer = Buffer.from([TELNET_IAC, TELNET_WILL]);
      const result = negotiator.parse(buffer);

      expect(result.cleanData).toBe('');
      // 防御性回复：对未知选项回复 DONT
      expect(result.responses).toHaveLength(1);
    });

    it('应处理连续的 IAC 字节（255 作为数据）', () => {
      // 两个连续 IAC 表示数据 255（0xFF）
      // 注意：0xFF 不是合法 UTF-8 单字节，Node.js toString('utf-8') 会将其替换为 U+FFFD
      // 但 raw bytes 仍被正确收集到 cleanBytes 数组中
      const buffer = Buffer.from([TELNET_IAC, TELNET_IAC, 0x41]); // IAC IAC 'A'
      const result = negotiator.parse(buffer);

      // 0xFF 经 UTF-8 编码后变为替换字符 U+FFFD
      expect(result.cleanData).toBe('�' + 'A');
      expect(result.responses).toHaveLength(0);
    });
  });

  describe('negotiateNAWS', () => {
    it('应生成正确的 NAWS 协商报文（80x24）', () => {
      const naws = negotiator.negotiateNAWS(80, 24);

      expect(naws).toEqual(
        Buffer.from([
          TELNET_IAC,
          TELNET_SB,
          TELNET_OPTION_NAWS,
          0x00,
          0x50, // width = 80
          0x00,
          0x18, // height = 24
          TELNET_IAC,
          TELNET_SE,
        ]),
      );
    });

    it('应生成正确的 NAWS 协商报文（120x40）', () => {
      const naws = negotiator.negotiateNAWS(120, 40);

      expect(naws).toEqual(
        Buffer.from([
          TELNET_IAC,
          TELNET_SB,
          TELNET_OPTION_NAWS,
          0x00,
          0x78, // width = 120
          0x00,
          0x28, // height = 40
          TELNET_IAC,
          TELNET_SE,
        ]),
      );
    });

    it('应正确处理大窗口尺寸（256x256）', () => {
      const naws = negotiator.negotiateNAWS(256, 256);

      expect(naws).toEqual(
        Buffer.from([
          TELNET_IAC,
          TELNET_SB,
          TELNET_OPTION_NAWS,
          0x01,
          0x00, // width = 256
          0x01,
          0x00, // height = 256
          TELNET_IAC,
          TELNET_SE,
        ]),
      );
    });
  });

  describe('getSupportedOptions', () => {
    it('应返回支持的选项列表', () => {
      const options = negotiator.getSupportedOptions();

      expect(options).toContain(TELNET_OPTION_ECHO);
      expect(options).toContain(TELNET_OPTION_SUPPRESS_GO_AHEAD);
      expect(options).toContain(TELNET_OPTION_NAWS);
    });
  });

  describe('getServerOptions', () => {
    it('应返回空列表（初始状态）', () => {
      expect(negotiator.getServerOptions()).toHaveLength(0);
    });

    it('应跟踪服务器支持的选项', () => {
      // IAC WILL ECHO
      negotiator.parse(Buffer.from([TELNET_IAC, TELNET_WILL, TELNET_OPTION_ECHO]));

      expect(negotiator.getServerOptions()).toContain(TELNET_OPTION_ECHO);
    });

    it('应移除服务器拒绝的选项', () => {
      // 先 WILL，再 WONT
      negotiator.parse(Buffer.from([TELNET_IAC, TELNET_WILL, TELNET_OPTION_ECHO]));
      negotiator.parse(Buffer.from([TELNET_IAC, TELNET_WONT, TELNET_OPTION_ECHO]));

      expect(negotiator.getServerOptions()).not.toContain(TELNET_OPTION_ECHO);
    });
  });
});
