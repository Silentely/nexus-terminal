/**
 * 版本号规范化与语义化比较
 * 支持 X.Y.Z / vX.Y.Z，可选 pre-release 后缀（如 1.2.3-beta.1）
 */

/** 去掉首尾空白与可选 v/V 前缀 */
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

/**
 * 判断字符串是否可作为版本比较
 * 排除 dev / unknown / 空值等非发布版本
 */
export function isComparableVersion(version: string | null | undefined): boolean {
  if (!version) return false;
  const normalized = normalizeVersion(version);
  if (!normalized) return false;
  // 至少一段数字；允许可选 pre-release
  return /^\d+(?:\.\d+)*(?:-[\w.]+)?$/i.test(normalized);
}

/**
 * 将版本拆为 [major, minor, patch, ...] 与 pre-release 段
 */
function parseVersionParts(version: string): { nums: number[]; pre: string | null } {
  const normalized = normalizeVersion(version);
  const [core, ...preParts] = normalized.split('-');
  const nums = core.split('.').map((part) => {
    const n = parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  const pre = preParts.length > 0 ? preParts.join('-') : null;
  return { nums, pre };
}

/**
 * 比较两个版本号
 * @returns 负数表示 a < b，0 表示相等，正数表示 a > b
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  const len = Math.max(left.nums.length, right.nums.length);

  for (let i = 0; i < len; i++) {
    const lv = left.nums[i] ?? 0;
    const rv = right.nums[i] ?? 0;
    if (lv !== rv) return lv - rv;
  }

  // 无 pre-release 的正式版 > 带 pre-release 的版本（semver 规则）
  if (left.pre === null && right.pre !== null) return 1;
  if (left.pre !== null && right.pre === null) return -1;
  if (left.pre !== null && right.pre !== null) {
    if (left.pre < right.pre) return -1;
    if (left.pre > right.pre) return 1;
  }

  return 0;
}

/**
 * 判断 latest 是否比 current 更新
 * 任一版本不可比较时返回 false（避免 dev 等误报更新）
 */
export function isNewerVersion(
  latest: string | null | undefined,
  current: string | null | undefined,
): boolean {
  if (
    latest == null ||
    current == null ||
    !isComparableVersion(latest) ||
    !isComparableVersion(current)
  ) {
    return false;
  }
  return compareVersions(latest, current) > 0;
}

/**
 * 构造 GitHub Release 标签 URL
 * 统一补全 v 前缀，与常见 tag 命名对齐
 */
export function buildReleaseTagUrl(repoUrl: string, version: string): string {
  const normalized = normalizeVersion(version);
  const tag = normalized.startsWith('v') ? normalized : `v${normalized}`;
  return `${repoUrl.replace(/\/$/, '')}/releases/tag/${tag}`;
}
