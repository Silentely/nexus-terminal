/**
 * SFTP 路径安全验证工具
 * 防止通过路径注入 Shell 命令（反引号、$()、管道符等）
 */

/** 不安全的路径模式，可能被用于 Shell 注入 */
const UNSAFE_PATH_PATTERNS = [
  /\.\./, // 路径穿越
  /`/, // 反引号命令替换
  /\$\(/, // $() 命令替换
  /\$\{/, // ${} 变量展开
  /\|/, // 管道符
  /;/, // 命令分隔符
  /&/, // 后台执行 / 逻辑与
  /\n/, // 换行符
  /\r/, // 回车符
  /(^|\/)-/, // 路径段以 - 开头，可能被解释为命令参数
];

/** 允许的路径字符：Unicode 字母/数字、/、.、-、_、空格、(、) 等常见文件名符号 */
const SAFE_PATH_PATTERN = /^[\p{L}\p{N}\/.\-_ ()@#+=,!{}~:]+$/u;

/**
 * 验证路径是否安全，不包含 Shell 注入风险
 * @param path 待验证的路径字符串
 * @returns true 表示安全，false 表示存在风险
 */
export const validateSafePath = (path: string): boolean => {
  if (!path || typeof path !== 'string') {
    return false;
  }

  // 检查是否仅包含允许的字符
  if (!SAFE_PATH_PATTERN.test(path)) {
    return false;
  }

  // 检查是否匹配任一不安全模式
  for (const pattern of UNSAFE_PATH_PATTERNS) {
    if (pattern.test(path)) {
      return false;
    }
  }

  return true;
};
