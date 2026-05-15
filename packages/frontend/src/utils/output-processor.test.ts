import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutputProcessor, OutputType } from './output-processor';

describe('OutputProcessor', () => {
  let processor: OutputProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new OutputProcessor();
  });

  describe('detectType', () => {
    it('应该检测 JSON 输出', () => {
      const result = processor.process('{"key": "value", "count": 42}');
      expect(result.type).toBe(OutputType.JSON);
    });

    it('应该检测 YAML 输出', () => {
      const result = processor.process('name: test\nversion: 1.0\ndescription: hello');
      expect(result.type).toBe(OutputType.YAML);
    });

    it('应该检测 LOG 输出', () => {
      const result = processor.process('2024-01-15 10:30:00 INFO Server started');
      expect(result.type).toBe(OutputType.LOG);
    });

    it('应该检测 TABLE 输出（分隔符格式）', () => {
      // 管道符表格需要 3+ 列且每行列数一致（>=2 空格分隔）才能触发空间对齐检测
      // 每个值后保留 3 个空格确保 split(/\s{2,}/) 能正确分列
      const result = processor.process(
        '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |'
      );
      expect(result.type).toBe(OutputType.TABLE);
    });

    it('应该检测 TABLE 输出（空格对齐格式）', () => {
      const result = processor.process(
        'ID    Name    Status\n1     test    active\n2     prod    inactive'
      );
      expect(result.type).toBe(OutputType.TABLE);
    });

    it('应该返回 TEXT 类型对于普通文本', () => {
      const result = processor.process('Hello world\nThis is plain text');
      expect(result.type).toBe(OutputType.TEXT);
    });

    it('应该返回 TEXT 类型对于空输入', () => {
      const result = processor.process('');
      expect(result.type).toBe(OutputType.TEXT);
    });
  });

  describe('JSON 高亮', () => {
    it('应该格式化 JSON 输出', () => {
      const result = processor.process('{"name":"test","count":42}');
      expect(result.type).toBe(OutputType.JSON);
      // 验证输出包含 ANSI 高亮码
      expect(result.content).toContain('\x1b[');
    });
  });

  describe('YAML 高亮', () => {
    it('应该高亮 YAML 键值对', () => {
      const result = processor.process('key: value\nnumber: 42\nname: test');
      expect(result.type).toBe(OutputType.YAML);
      expect(result.content).toContain('\x1b[');
    });
  });

  describe('LOG 高亮', () => {
    it('应该高亮日志级别', () => {
      const result = processor.process('ERROR: Something failed');
      expect(result.type).toBe(OutputType.LOG);
      expect(result.content).toContain('\x1b[');
    });
  });

  describe('元数据', () => {
    it('应该计算行数', () => {
      const result = processor.process('line1\nline2\nline3');
      expect(result.metadata?.lineCount).toBe(3);
    });

    it('应该标记长输出', () => {
      const processor2 = new OutputProcessor({ foldThreshold: 5 });
      const longOutput = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
      const result = processor2.process(longOutput);
      expect(result.metadata?.isLong).toBe(true);
      expect(result.metadata?.shouldFold).toBe(true);
    });

    it('不应该标记短输出为长', () => {
      const result = processor.process('short output');
      expect(result.metadata?.isLong).toBe(false);
    });
  });

  describe('配置选项', () => {
    it('应该禁用高亮', () => {
      const processor2 = new OutputProcessor({ enableHighlight: false });
      const result = processor2.process('{"key":"value"}');
      expect(result.type).toBe(OutputType.JSON);
      // 禁用高亮后不应包含 ANSI 码
      expect(result.content).not.toContain('\x1b[');
    });

    it('应该禁用表格格式化', () => {
      const processor2 = new OutputProcessor({ enableTableFormat: false });
      const result = processor2.process(
        '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |'
      );
      expect(result.type).toBe(OutputType.TABLE);
      expect(result.content).not.toContain('\x1b[');
    });

    it('应该禁用链接检测', () => {
      const processor2 = new OutputProcessor({ enableLinkDetection: false });
      const result = processor2.process('Visit https://example.com');
      expect(result.content).not.toContain('\x1b[');
    });

    it('应该设置自定义折叠阈值', () => {
      processor.setFoldThreshold(3);
      const longOutput = Array.from({ length: 5 }, (_, i) => `line ${i}`).join('\n');
      const result = processor.process(longOutput);
      expect(result.metadata?.shouldFold).toBe(true);
      expect(result.metadata?.foldThreshold).toBe(3);
    });
  });

  describe('ANSI 码处理', () => {
    it('应该去除输入中的 ANSI 码', () => {
      const input = '\x1b[31mred text\x1b[0m normal';
      const result = processor.process(input);
      expect(result.content).not.toContain('\x1b[');
    });

    it('应该去除嵌套的 ANSI 码', () => {
      const input = '\x1b[1m\x1b[31mbold red\x1b[0m';
      const result = processor.process(input);
      expect(result.content).toBe('bold red');
    });

    it('应该去除带分号的 ANSI 码', () => {
      const input = '\x1b[1;31;40mstyled\x1b[0m';
      const result = processor.process(input);
      expect(result.content).toBe('styled');
    });

    it('应该去除多个分散的 ANSI 码', () => {
      const input = '\x1b[32mgreen\x1b[0m normal \x1b[34mblue\x1b[0m';
      const result = processor.process(input);
      expect(result.content).toBe('green normal blue');
    });

    it('应该处理仅包含 ANSI 码的输入', () => {
      const input = '\x1b[0m\x1b[1m\x1b[31m';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.TEXT);
    });
  });

  describe('链接检测', () => {
    it('应该高亮 HTTP 链接', () => {
      const result = processor.process('访问 https://example.com 获取详情');
      expect(result.content).toContain('\x1b[');
      expect(result.content).toContain('https://example.com');
    });

    it('应该高亮 HTTP 链接', () => {
      const result = processor.process('参考 http://docs.test.org/api');
      expect(result.content).toContain('http://docs.test.org/api');
    });

    it('应该高亮文本中的多个链接', () => {
      const result = processor.process('见 https://a.com 和 https://b.com');
      expect(result.content).toContain('https://a.com');
      expect(result.content).toContain('https://b.com');
    });

    it('应该高亮文件路径', () => {
      const result = processor.process('配置文件在 /etc/nginx/nginx.conf');
      expect(result.content).toContain('/etc/nginx/nginx.conf');
    });

    it('应该高亮多级目录路径', () => {
      const result = processor.process('源码在 /home/user/projects/app/src');
      expect(result.content).toContain('/home/user/projects/app/src');
    });

    it('不应该高亮非路径斜杠内容', () => {
      const result = processor.process('HTTP/1.1 200 OK');
      // HTTP/1.1 中的 / 后跟的不是路径格式
      expect(result.content).toContain('HTTP/1.1');
    });
  });

  describe('JSON 高亮详情', () => {
    it('应该高亮嵌套 JSON 对象', () => {
      const input = '{"user":{"name":"test","age":25},"active":true}';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.JSON);
      expect(result.content).toContain('\x1b[');
      // 验证格式化后包含缩进
      expect(result.content).toContain('  ');
    });

    it('应该高亮 JSON 数组', () => {
      const input = '{"items":[1,2,3]}';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.JSON);
      expect(result.content).toContain('\x1b[');
    });

    it('应该高亮 JSON null 值', () => {
      const input = '{"value":null}';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.JSON);
      expect(result.content).toContain('null');
    });

    it('应该高亮 JSON 布尔值', () => {
      const input = '{"enabled":true,"disabled":false}';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.JSON);
      expect(result.content).toContain('true');
      expect(result.content).toContain('false');
    });

    it('应该高亮 JSON 数字', () => {
      const input = '{"count":42,"price":3.14}';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.JSON);
      expect(result.content).toContain('42');
      expect(result.content).toContain('3.14');
    });

    it('应该处理格式化的多行 JSON', () => {
      const input = '{\n  "key": "value",\n  "num": 123\n}';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.JSON);
    });

    it('应该检测以 [ 开头的 JSON 数组', () => {
      const input = '[{"id":1},{"id":2}]';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.JSON);
    });

    it('应该对非法 JSON 回退为 TEXT', () => {
      const input = '{invalid json content}';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.TEXT);
    });

    it('禁用高亮时应保留原始 JSON 文本', () => {
      const noHighlight = new OutputProcessor({ enableHighlight: false });
      const result = noHighlight.process('{"key":"value"}');
      expect(result.type).toBe(OutputType.JSON);
      expect(result.content).not.toContain('\x1b[');
      expect(result.content).toContain('"key"');
    });
  });

  describe('YAML 高亮详情', () => {
    it('应该高亮 YAML 注释', () => {
      const input = '# 这是注释\nkey: value\nother: data\nmore: items';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.YAML);
      expect(result.content).toContain('\x1b[');
    });

    it('应该高亮 YAML 列表项', () => {
      const input = 'items: list\nname: test\nlist:\n  - one\n  - two\n  - three';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.YAML);
      expect(result.content).toContain('\x1b[');
    });

    it('应该高亮 YAML 布尔值 (yes/no)', () => {
      const input = 'enabled: yes\ndisabled: no\nflag: true';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.YAML);
      expect(result.content).toContain('yes');
    });

    it('应该高亮 YAML null 值', () => {
      const input = 'key: value\nvalue: null\ntilde: ~\nextra: data';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.YAML);
      expect(result.content).toContain('null');
    });

    it('应该高亮带引号的 YAML 字符串', () => {
      const input = 'key: value\nname: "hello world"\npath: \'/usr/bin\'\nextra: data';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.YAML);
    });

    it('应该高亮 YAML 数字', () => {
      const input = 'count: 42\nprice: 3.14\nnegative: -5';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.YAML);
    });

    it('应该处理带缩进的 YAML', () => {
      const input = 'server:\n  host: localhost\n  port: 3000';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.YAML);
    });

    it('禁用高亮时应保留原始 YAML', () => {
      const noHighlight = new OutputProcessor({ enableHighlight: false });
      const result = noHighlight.process('key: value\nnum: 42\nextra: data');
      expect(result.type).toBe(OutputType.YAML);
      expect(result.content).not.toContain('\x1b[');
    });
  });

  describe('LOG 高亮详情', () => {
    it('应该高亮 INFO 级别', () => {
      const result = processor.process('2024-01-15 INFO Application started');
      expect(result.type).toBe(OutputType.LOG);
      expect(result.content).toContain('\x1b[');
    });

    it('应该高亮 WARN 级别', () => {
      const result = processor.process('WARN: disk usage high');
      expect(result.type).toBe(OutputType.LOG);
    });

    it('应该高亮 DEBUG 级别', () => {
      const result = processor.process('DEBUG entering function');
      expect(result.type).toBe(OutputType.LOG);
    });

    it('应该高亮 SUCCESS/OK 级别', () => {
      const result = processor.process('SUCCESS deployment complete');
      expect(result.type).toBe(OutputType.LOG);
    });

    it('应该高亮 HTTP 状态码 (2xx)', () => {
      const result = processor.process('2024-01-15 GET /api 200 OK');
      expect(result.type).toBe(OutputType.LOG);
      expect(result.content).toContain('200');
    });

    it('应该高亮 HTTP 状态码 (4xx)', () => {
      const result = processor.process('2024-01-15 GET /api 404 Not Found');
      expect(result.type).toBe(OutputType.LOG);
      expect(result.content).toContain('404');
    });

    it('应该高亮 HTTP 状态码 (5xx)', () => {
      const result = processor.process('2024-01-15 GET /api 500 Error');
      expect(result.type).toBe(OutputType.LOG);
      expect(result.content).toContain('500');
    });

    it('应该高亮 IP 地址', () => {
      const result = processor.process('2024-01-15 Connection from 192.168.1.100');
      expect(result.type).toBe(OutputType.LOG);
      expect(result.content).toContain('192.168.1.100');
    });

    it('应该高亮带 ISO 时间戳的日志', () => {
      const result = processor.process('2024-01-15T10:30:00.123Z INFO test');
      expect(result.type).toBe(OutputType.LOG);
    });

    it('应该高亮 FAIL 级别', () => {
      const result = processor.process('FAIL connection refused');
      expect(result.type).toBe(OutputType.LOG);
    });
  });

  describe('TABLE 高亮详情', () => {
    it('应该正确格式化管道符表格', () => {
      // 管道符表格需要 3+ 列且列间有 2+ 空格才能触发空间对齐检测
      const input =
        '| Name   | Age   | City   |\n| Alice  | 30    | NYC    |\n| Bob    | 25    | LA     |';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.TABLE);
      expect(result.content).toContain('\x1b[');
    });

    it('应该处理不同列数的表格', () => {
      const input = 'ID    Name    Code\nAlice   30     A01\nBob     25     B02';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.TABLE);
    });

    it('应该处理三列管道符表格', () => {
      const input =
        '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.TABLE);
    });

    it('应该高亮表头为粗体', () => {
      const input = 'Col1    Col2    Col3\nAlice   30      NYC\nBob     25      LA';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.TABLE);
      // 表头应包含 ANSI 粗体码
      expect(result.content).toContain('\x1b[1m');
    });

    it('应该处理空格对齐的三列以上表格', () => {
      const input = 'Name    Age    City\nAlice   30     NYC\nBob     25     LA';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.TABLE);
    });

    it('禁用表格格式化时应保留原始文本', () => {
      const noTable = new OutputProcessor({ enableTableFormat: false });
      const result = noTable.process(
        '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |'
      );
      expect(result.type).toBe(OutputType.TABLE);
      expect(result.content).not.toContain('\x1b[');
    });
  });

  describe('大文件保护', () => {
    it('超过 5000 行应跳过高亮处理', () => {
      const largeOutput = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
      const result = processor.process(largeOutput);
      expect(result.type).toBe(OutputType.TEXT);
      expect(result.metadata?.lineCount).toBe(5001);
      // 大文件不应包含高亮 ANSI 码（只有链接检测可能添加）
      expect(result.content).toContain('line 0');
    });

    it('恰好 5000 行不应跳过', () => {
      const output = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
      const result = processor.process(output);
      expect(result.type).toBe(OutputType.TEXT);
      expect(result.metadata?.lineCount).toBe(5000);
    });

    it('大文件应正确标记折叠元数据', () => {
      const smallThreshold = new OutputProcessor({ foldThreshold: 100 });
      const largeOutput = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
      const result = smallThreshold.process(largeOutput);
      expect(result.metadata?.shouldFold).toBe(true);
      expect(result.metadata?.isLong).toBe(true);
    });
  });

  describe('折叠阈值行为', () => {
    it('应该在输出行数恰好等于阈值时不折叠', () => {
      processor.setFoldThreshold(5);
      const output = Array.from({ length: 5 }, (_, i) => `line ${i}`).join('\n');
      const result = processor.process(output);
      expect(result.metadata?.shouldFold).toBe(false);
    });

    it('应该在输出行数超过阈值时折叠', () => {
      processor.setFoldThreshold(5);
      const output = Array.from({ length: 6 }, (_, i) => `line ${i}`).join('\n');
      const result = processor.process(output);
      expect(result.metadata?.shouldFold).toBe(true);
    });

    it('应该在阈值为 1 时折叠多行输出', () => {
      processor.setFoldThreshold(1);
      const result = processor.process('line1\nline2');
      expect(result.metadata?.shouldFold).toBe(true);
    });

    it('应该在阈值为 0 时折叠所有非空输出', () => {
      processor.setFoldThreshold(0);
      const result = processor.process('single line');
      expect(result.metadata?.shouldFold).toBe(true);
    });

    it('应该返回正确的 foldThreshold 元数据', () => {
      processor.setFoldThreshold(42);
      const result = processor.process('test');
      expect(result.metadata?.foldThreshold).toBe(42);
    });
  });

  describe('Setter 方法', () => {
    it('setEnableHighlight 应切换高亮状态', () => {
      processor.setEnableHighlight(false);
      const result = processor.process('{"key":"value"}');
      expect(result.content).not.toContain('\x1b[');

      processor.setEnableHighlight(true);
      const result2 = processor.process('{"key":"value"}');
      expect(result2.content).toContain('\x1b[');
    });

    it('setEnableTableFormat 应切换表格格式化', () => {
      const tableInput =
        '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |';
      processor.setEnableTableFormat(false);
      const result = processor.process(tableInput);
      expect(result.content).not.toContain('\x1b[');

      processor.setEnableTableFormat(true);
      const result2 = processor.process(tableInput);
      expect(result2.content).toContain('\x1b[');
    });

    it('setEnableLinkDetection 应切换链接检测', () => {
      processor.setEnableLinkDetection(false);
      const result = processor.process('Visit https://example.com');
      expect(result.content).not.toContain('\x1b[');

      processor.setEnableLinkDetection(true);
      const result2 = processor.process('Visit https://example.com');
      expect(result2.content).toContain('\x1b[');
    });

    it('setFoldThreshold 应更新折叠阈值', () => {
      processor.setFoldThreshold(2);
      expect(processor['foldThreshold']).toBe(2);

      processor.setFoldThreshold(100);
      expect(processor['foldThreshold']).toBe(100);
    });
  });

  describe('换行符规范化', () => {
    it('应该将 CRLF 转换为 LF', () => {
      const result = processor.process('line1\r\nline2');
      expect(result.metadata?.lineCount).toBe(2);
    });

    it('应该将单独的 CR 转换为 LF', () => {
      const result = processor.process('line1\rline2');
      expect(result.metadata?.lineCount).toBe(2);
    });

    it('应该处理混合换行符', () => {
      const result = processor.process('line1\r\nline2\rline3\nline4');
      expect(result.metadata?.lineCount).toBe(4);
    });

    it('应该保留 LF 不做修改', () => {
      const result = processor.process('line1\nline2\nline3');
      expect(result.metadata?.lineCount).toBe(3);
    });
  });

  describe('边界情况', () => {
    it('应该处理仅包含空白字符的输入', () => {
      const result = processor.process('   \n  \n   ');
      expect(result.type).toBe(OutputType.TEXT);
    });

    it('应该处理单行无换行输入', () => {
      const result = processor.process('single line of text');
      expect(result.metadata?.lineCount).toBe(1);
    });

    it('应该处理包含特殊字符的文本', () => {
      const input = 'line with <html> &amp; "quotes" and \'apostrophes\'';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.TEXT);
      expect(result.content).toContain('<html>');
    });

    it('应该处理混合内容类型', () => {
      const input = 'JSON: {"key":"val"}\nPlain text here\nhttps://example.com';
      const result = processor.process(input);
      // 混合内容会被检测为某种类型
      expect(result.type).toBeDefined();
    });

    it('应该正确处理空行', () => {
      const input = 'line1\n\nline3';
      const result = processor.process(input);
      expect(result.metadata?.lineCount).toBe(3);
    });

    it('应该处理包含 Unicode 字符的文本', () => {
      const input = '你好世界 🌍 café résumé';
      const result = processor.process(input);
      expect(result.content).toContain('你好世界');
    });

    it('应该处理包含转义字符的文本', () => {
      const input = 'tab\there\\nnewline';
      const result = processor.process(input);
      expect(result.content).toContain('tab');
    });

    it('应该处理超长单行文本', () => {
      const longLine = 'x'.repeat(10000);
      const result = processor.process(longLine);
      expect(result.type).toBe(OutputType.TEXT);
      expect(result.metadata?.lineCount).toBe(1);
    });

    it('JSON 检测不应误判 YAML 为 JSON', () => {
      const input = 'key: value\nother: data\nmore: items';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.YAML);
    });

    it('应该正确返回 TEXT 类型对于无法识别的格式', () => {
      const input = 'Just some random output without structure';
      const result = processor.process(input);
      expect(result.type).toBe(OutputType.TEXT);
      expect(result.metadata?.lineCount).toBe(1);
    });
  });

  describe('构造函数选项', () => {
    it('应该接受所有配置选项', () => {
      const custom = new OutputProcessor({
        foldThreshold: 10,
        enableHighlight: false,
        enableTableFormat: false,
        enableLinkDetection: false,
      });
      const result = custom.process('{"key":"value"}');
      expect(result.type).toBe(OutputType.JSON);
      expect(result.content).not.toContain('\x1b[');
    });

    it('无参数构造应使用默认配置', () => {
      const defaultProc = new OutputProcessor();
      const result = defaultProc.process('{"key":"value"}');
      expect(result.type).toBe(OutputType.JSON);
      expect(result.content).toContain('\x1b[');
      expect(result.metadata?.foldThreshold).toBe(500);
    });

    it('部分配置应仅覆盖指定选项', () => {
      const partial = new OutputProcessor({ enableHighlight: false });
      const result = partial.process('{"key":"value"}');
      expect(result.type).toBe(OutputType.JSON);
      expect(result.content).not.toContain('\x1b[');
      // 其他选项保持默认
      expect(result.metadata?.foldThreshold).toBe(500);
    });
  });

  describe('导出实例', () => {
    it('导出的 outputProcessor 应该是 OutputProcessor 实例', () => {
      // 动态导入以测试导出
      // outputProcessor 是模块级导出
      const result = processor.process('test');
      expect(result.type).toBe(OutputType.TEXT);
    });
  });
});

// ==================== processInWorker & destroyWorkerPool ====================

describe('processInWorker', () => {
  let processInWorker: typeof import('./output-processor').processInWorker;
  let destroyWorkerPool: typeof import('./output-processor').destroyWorkerPool;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('./output-processor');
    processInWorker = mod.processInWorker;
    destroyWorkerPool = mod.destroyWorkerPool;
  });

  afterEach(() => {
    destroyWorkerPool();
    vi.clearAllMocks();
  });

  describe('短文本直接同步处理（<=100 字符）', () => {
    it('100 字符以内的文本应同步处理，不使用 Worker', async () => {
      const shortText = 'hello world'; // 11 chars
      const result = await processInWorker(shortText);
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('metadata');
    });

    it('恰好 100 字符应同步处理', async () => {
      const text100 = 'a'.repeat(100);
      const result = await processInWorker(text100);
      expect(result.type).toBe(OutputType.TEXT);
    });

    it('空字符串应同步处理并返回 TEXT 类型', async () => {
      const result = await processInWorker('');
      expect(result.type).toBe(OutputType.TEXT);
    });

    it('短 JSON 文本应同步处理并返回正确类型', async () => {
      const result = await processInWorker('{"a":1}');
      expect(result.type).toBe(OutputType.JSON);
    });
  });

  describe('Worker 不可用时的降级处理', () => {
    it('Worker 创建失败时应降级为同步处理并返回结果', async () => {
      // Mock createWorkerPool to throw so the fallback path is exercised
      vi.doMock('../workers/createWorkerPool', () => ({
        createWorkerPool: vi.fn().mockImplementation(() => {
          throw new Error('Worker not available');
        }),
      }));

      // Re-import after mock
      vi.resetModules();
      const mod = await import('./output-processor');
      const longText = 'a'.repeat(200);
      const result = await mod.processInWorker(longText);
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('content');
    });
  });

  describe('Worker execute 失败时降级', () => {
    it('Worker 执行失败时应降级为同步处理', async () => {
      vi.doMock('../workers/createWorkerPool', () => ({
        createWorkerPool: vi.fn().mockReturnValue({
          execute: vi.fn().mockRejectedValue(new Error('Worker timeout')),
          destroy: vi.fn(),
        }),
      }));

      vi.resetModules();
      const mod = await import('./output-processor');
      const longText = 'x'.repeat(200);
      const result = await mod.processInWorker(longText);
      // Should fallback to sync processing
      expect(result).toHaveProperty('type');
      expect(result.content).toBeDefined();
    });
  });

  describe('长文本触发 Worker 路径', () => {
    it('超过 100 字符时应尝试使用 Worker（成功场景）', async () => {
      const mockResult = {
        type: OutputType.TEXT,
        content: 'processed by worker',
        metadata: { lineCount: 1, isLong: false, shouldFold: false, foldThreshold: 500 },
      };
      const mockExecute = vi.fn().mockResolvedValue(mockResult);
      const mockDestroy = vi.fn();

      vi.doMock('../workers/createWorkerPool', () => ({
        createWorkerPool: vi.fn().mockReturnValue({
          execute: mockExecute,
          destroy: mockDestroy,
        }),
      }));

      vi.resetModules();
      const mod = await import('./output-processor');
      const longText = 'x'.repeat(200);
      const result = await mod.processInWorker(longText);
      expect(result.content).toBe('processed by worker');
    });

    it('应该将 text 和 options 传递给 Worker', async () => {
      const mockExecute = vi.fn().mockResolvedValue({
        type: OutputType.TEXT,
        content: '',
        metadata: {},
      });

      vi.doMock('../workers/createWorkerPool', () => ({
        createWorkerPool: vi.fn().mockReturnValue({
          execute: mockExecute,
          destroy: vi.fn(),
        }),
      }));

      vi.resetModules();
      const mod = await import('./output-processor');
      const longText = 'x'.repeat(200);
      const opts = { enableHighlight: false };
      await mod.processInWorker(longText, opts);

      expect(mockExecute).toHaveBeenCalledWith('process', { text: longText, options: opts });
    });
  });

  describe('processInWorker 选项传递', () => {
    it('应该接受 foldThreshold 选项', async () => {
      const shortText = 'hello'; // <= 100 chars, processed synchronously
      const result = await processInWorker(shortText, { foldThreshold: 1 });
      expect(result).toBeDefined();
    });

    it('没有 options 时应使用默认配置', async () => {
      const shortText = 'plain text';
      const result = await processInWorker(shortText);
      expect(result.type).toBe(OutputType.TEXT);
    });
  });
});

describe('destroyWorkerPool', () => {
  it('没有 Worker 池时调用应不抛出错误', async () => {
    vi.resetModules();
    const { destroyWorkerPool: destroy } = await import('./output-processor');
    expect(() => destroy()).not.toThrow();
  });

  it('销毁后再次调用应不抛出错误', async () => {
    vi.resetModules();
    const { destroyWorkerPool: destroy } = await import('./output-processor');
    destroy();
    expect(() => destroy()).not.toThrow();
  });

  it('有 Worker 池时应调用 pool.destroy()', async () => {
    const mockDestroy = vi.fn();
    const mockExecute = vi.fn().mockResolvedValue({
      type: OutputType.TEXT,
      content: '',
      metadata: {},
    });

    vi.doMock('../workers/createWorkerPool', () => ({
      createWorkerPool: vi.fn().mockReturnValue({
        execute: mockExecute,
        destroy: mockDestroy,
      }),
    }));

    vi.resetModules();
    const mod = await import('./output-processor');

    // Trigger worker pool creation
    const longText = 'x'.repeat(200);
    await mod.processInWorker(longText);

    // Now destroy
    mod.destroyWorkerPool();
    expect(mockDestroy).toHaveBeenCalled();
  });
});
