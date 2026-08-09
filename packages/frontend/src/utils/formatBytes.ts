/**
 * 字节大小格式化工具
 *
 * 统一前端多处重复实现（fileManagerDisplayUtils.formatSize / dashboard.store.formatBytes），
 * 消除 GB 精度不一致问题。
 *
 * 精度语义（向后兼容）：
 * - B：整数
 * - KB/MB：默认 1 位小数（digitsKbMb）
 * - GB：默认 1 位小数；dashboard 历史语义为 2 位小数（digitsGb=2）
 *
 * 使用方式：
 *   formatBytes(1536)              // '1.5 KB'
 *   formatBytes(1024 ** 3, 1, 2)   // '1.00 GB'（dashboard 语义）
 */

/**
 * 将字节数格式化为人类可读字符串（B/KB/MB/GB）
 * @param bytes 字节数
 * @param digitsKbMb KB/MB 档小数位数，默认 1
 * @param digitsGb GB 档小数位数，默认 1（与文件管理器历史语义一致）
 * @returns 格式化后的字符串
 */
export const formatBytes = (bytes: number, digitsKbMb = 1, digitsGb = 1): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(digitsKbMb)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(digitsKbMb)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(digitsGb)} GB`;
};
