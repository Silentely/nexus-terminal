#!/usr/bin/env node

/**
 * auto-changelog.js
 *
 * post-commit 钩子调用：当最近一次提交包含 VERSION 文件且版本号发生变更时，
 * 自动收集版本范围内的所有 commits，调用 AI 生成高质量 changelog 条目，
 * 写入 docs/changelog.md 并 amend 回提交。
 *
 * AI 调用优先级链：
 *   1. 本地 Claude CLI（无需 API Key）
 *   2. OpenAI 兼容 API（需配置 OPENAI_API_KEY）
 *   3. 静默跳过，不修改 changelog（由 CI 工作流保底）
 *
 * 环境变量：
 *   SKIP_AUTO_CHANGELOG         - 设置为 1 跳过执行
 *   DRY_RUN                      - 设置为 1 仅输出生成内容，不写入文件
 *   AUTO_CHANGELOG_FORCE_VERSION - 强制重新生成指定版本（如 1.5.4）
 *   CHANGELOG_AI_TIMEOUT         - AI 调用超时时间（毫秒，默认 90000）
 *   OPENAI_BASE_URL              - OpenAI 兼容 API 地址（默认 https://api.openai.com/v1）
 *   OPENAI_API_KEY               - API Key
 *   OPENAI_MODEL                 - 模型名称（默认 gpt-4o）
 *   CLAUDE_CLI_PATH              - Claude CLI 路径（默认 claude）
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CHANGELOG_FILE = path.join(ROOT, 'docs', 'changelog.md');

// =====================================================================
// 工具函数
// =====================================================================

/**
 * 安全执行 git 命令（参数数组形式，避免 shell 注入）
 * @param {string[]} args - git 子命令和参数
 * @returns {string} stdout（去除首尾空白）
 */
function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/**
 * 安全执行命令，失败时返回 null
 * @param {string} file - 可执行文件
 * @param {string[]} args - 参数数组
 * @param {object} opts - 额外选项
 */
function tryExec(file, args, opts = {}) {
  try {
    return execFileSync(file, args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 1024 * 1024, // 1MB
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

/** 获取最近一个版本 tag（v 开头，排除当前版本） */
function getPreviousTag(currentVersion) {
  const tags = tryExec('git', ['tag', '--sort=-version:refname']) || '';
  for (const tag of tags.split('\n')) {
    const t = tag.trim();
    if (t.startsWith('v') && t !== `v${currentVersion}`) {
      return t;
    }
  }
  return null;
}

/** 转义正则表达式特殊字符 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =====================================================================
// 数据收集
// =====================================================================

/** 收集版本范围内的所有 commits（排除 merge commit） */
function collectCommits(fromRef) {
  const range = fromRef ? `${fromRef}..HEAD` : 'HEAD';
  // 使用 %x00 (NUL) 分隔 hash 和 subject，每行一个 commit
  const log = tryExec('git', ['log', range, '--format=%h%x00%s', '--no-merges']);
  if (!log) return [];

  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split('\x00');
      return {
        hash: hash?.trim() || '',
        subject: subject?.trim() || '',
      };
    });
}

/** 收集 diff 统计信息 */
function collectDiffStat(fromRef) {
  if (!fromRef) return '';
  return tryExec('git', ['diff', '--stat', `${fromRef}..HEAD`]) || '';
}

/** 收集关键文件变更内容（截取前 8000 字符避免超限） */
function collectKeyDiff(fromRef) {
  if (!fromRef) return '';
  const diff = tryExec('git', [
    'diff',
    `${fromRef}..HEAD`,
    '--',
    '*.ts',
    '*.vue',
    '*.yml',
    '*.json',
    '*.md',
  ]);
  return diff ? diff.slice(0, 8000) : '';
}

// =====================================================================
// AI 提示词构建
// =====================================================================

/** 构建 changelog 生成提示词 */
function buildPrompt(version, commits, diffStat, keyDiff, today) {
  const commitList = commits.map((c) => `- ${c.hash} ${c.subject}`).join('\n');

  // 从 docs/changelog.md 提取最近 5 个版本作为格式参考
  let formatRef = '';
  try {
    const existing = fs.readFileSync(CHANGELOG_FILE, 'utf8');
    const versions = existing
      .split(/\n(?=## v)/)
      .slice(0, 6)
      .join('\n');
    if (versions) formatRef = `\n## 历史格式参考（请严格遵循此风格）\n\n${versions}`;
  } catch {
    // 文件不存在时不提供参考
  }

  return `你是 Nexus Terminal 项目的技术文档工程师。
请根据以下 git commits 和代码变更，生成 v${version} 的更新日志条目。

## 输出格式要求

- 版本头：## v${version}（${today}）
- 分类标题（按需使用）：### 新增 | 修复 | 改进 | 安全 | 测试 | 文档 | 杂项
- 每个条目格式：- <emoji> <中文描述>（PR/Issue #N，如有）
- Emoji 映射规则：
  - 新增功能 → ✨
  - 修复问题 → 🐛
  - 改进/重构 → ♻️
  - 安全相关 → 🔒
  - 测试相关 → ✅
  - 文档更新 → 📝
  - 杂项/构建 → 🔧
  - 性能优化 → ⚡
  - 监控/指标 → 📊
  - 移动端相关 → 📱
  - UI/样式 → 🎨

## 处理规则

1. 合并同一功能的多个 commit 为一个条目
2. 描述要准确反映技术变更，不要夸大或虚构
3. 安全相关变更必须归入「安全」分类
4. 仅输出 Markdown 格式的更新日志内容，不要添加其他说明

## Commits

${commitList}

## 变更统计

${diffStat}

${keyDiff ? `## 关键文件变更（摘要）\n\n${keyDiff}` : ''}
${formatRef}

请直接输出 Markdown 格式的更新日志：`;
}

// =====================================================================
// AI 调用链（多级降级）
// =====================================================================

/** 尝试通过 Claude CLI 生成 changelog（参数数组形式，避免 shell 注入） */
function tryClaudeCli(prompt) {
  const cliPath = process.env.CLAUDE_CLI_PATH || 'claude';
  const timeout = parseInt(process.env.CHANGELOG_AI_TIMEOUT || '90000', 10);
  console.log('[auto-changelog] 尝试 Claude CLI...');

  // 校验 cliPath 只允许命令名或绝对路径，不允许 shell 片段
  if (/[;&|`$(){}[\]<>!#]/.test(cliPath)) {
    console.warn('[auto-changelog] CLAUDE_CLI_PATH 包含非法字符，跳过');
    return null;
  }

  const result = tryExec(cliPath, ['-p', prompt], { timeout });

  if (result && result.trim().length > 0) {
    console.log('[auto-changelog] Claude CLI 调用成功');
    return result.trim();
  }
  return null;
}

/** 尝试通过 OpenAI 兼容 API 生成 changelog */
async function tryOpenAiApi(prompt) {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  if (!apiKey) {
    console.log('[auto-changelog] 未配置 OPENAI_API_KEY，跳过 OpenAI API');
    return null;
  }

  console.log(`[auto-changelog] 尝试 OpenAI 兼容 API (${model})...`);

  const timeout = parseInt(process.env.CHANGELOG_AI_TIMEOUT || '90000', 10);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[auto-changelog] OpenAI API 响应异常: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    if (content) {
      console.log('[auto-changelog] OpenAI API 调用成功');
      return content;
    }
  } catch (err) {
    console.warn(`[auto-changelog] OpenAI API 调用失败: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

/**
 * 多级 AI 调用链：Claude CLI → OpenAI API → 静默跳过
 * @returns {{ source: string, content: string|null }}
 */
async function generateWithAI(prompt) {
  // 1. 尝试 Claude CLI
  const cliResult = tryClaudeCli(prompt);
  if (cliResult) {
    return { source: 'claude-cli', content: cliResult };
  }

  // 2. 尝试 OpenAI 兼容 API
  const apiResult = await tryOpenAiApi(prompt);
  if (apiResult) {
    return { source: 'openai-api', content: apiResult };
  }

  // 3. 所有 AI 调用失败，静默跳过
  console.warn('[auto-changelog] 所有 AI 调用均失败，跳过 changelog 自动生成');
  console.warn('[auto-changelog] CI 工作流将在发布时保底生成');
  return { source: 'none', content: null };
}

// =====================================================================
// Changelog 写入
// =====================================================================

/**
 * 从 AI 输出中提取 changelog 正文
 * AI 可能会包裹在 markdown 代码块中，需要提取
 * @param {string} aiOutput - AI 原始输出
 * @param {string} expectedVersion - 期望的版本号
 * @returns {string|null} 提取的 changelog 正文，校验失败返回 null
 */
function extractChangelogBody(aiOutput, expectedVersion) {
  let body = aiOutput.trim();

  // 移除可能的 markdown 代码块包裹
  const codeBlockMatch = body.match(/```(?:markdown)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    body = codeBlockMatch[1].trim();
  }

  // 确保以 ## v 开头
  if (!body.startsWith('## v')) {
    const versionMatch = body.match(/(^|\n)(## v[\s\S]*)/);
    if (versionMatch) {
      body = versionMatch[2].trim();
    }
  }

  // 校验：提取的内容必须以当前版本号开头
  const escaped = escapeRegExp(expectedVersion);
  const versionPattern = new RegExp(`^## v${escaped}(?:\\s|（|\\()`);
  if (!versionPattern.test(body)) {
    console.warn(
      `[auto-changelog] AI 输出版本号不匹配：期望 v${expectedVersion}，实际开头为 "${body.slice(0, 50)}..."`,
    );
    return null;
  }

  return body;
}

/**
 * 将 changelog 条目写入 docs/changelog.md
 * 按第一个版本标题定位插入点，而非假设第一行是标题
 */
function writeChangelog(version, changelogBody) {
  let changelog = '';
  if (fs.existsSync(CHANGELOG_FILE)) {
    changelog = fs.readFileSync(CHANGELOG_FILE, 'utf8');
  }

  // 精确匹配版本标题（避免 v1.5 匹配 v1.5.4）
  const escaped = escapeRegExp(version);
  const versionPattern = new RegExp(`^## v${escaped}(?:\\s|（|\\()`, 'm');
  if (versionPattern.test(changelog)) {
    console.log(`[auto-changelog] docs/changelog.md 已包含 v${version}，跳过写入`);
    return false;
  }

  // DRY_RUN 模式：仅输出生成内容，不写入文件
  if (process.env.DRY_RUN === '1') {
    console.log('\n' + '='.repeat(60));
    console.log('[auto-changelog] DRY_RUN 模式：生成的 changelog 内容');
    console.log('='.repeat(60));
    console.log(changelogBody);
    console.log('='.repeat(60) + '\n');
    console.log('[auto-changelog] DRY_RUN=1，跳过文件写入和提交');
    return false;
  }

  // 按第一个版本标题定位插入点
  const firstVersionIdx = changelog.search(/\n## v/);
  if (firstVersionIdx !== -1) {
    // 在第一个版本标题前插入新版本
    const insertPos = firstVersionIdx + 1; // +1 跳过开头的 \n
    const newContent =
      changelog.slice(0, insertPos) + changelogBody + '\n\n' + changelog.slice(insertPos);

    fs.writeFileSync(CHANGELOG_FILE, newContent, 'utf8');
  } else {
    // 没有现有版本标题，追加到文件末尾
    const header = changelog.trimEnd() + '\n';
    const newContent = header + '\n' + changelogBody + '\n';
    fs.writeFileSync(CHANGELOG_FILE, newContent, 'utf8');
  }

  console.log(`[auto-changelog] 已将 v${version} 更新日志写入 docs/changelog.md`);
  return true;
}

// =====================================================================
// 主流程
// =====================================================================

async function main() {
  // 支持通过环境变量跳过执行
  if (process.env.SKIP_AUTO_CHANGELOG === '1') {
    console.log('[auto-changelog] SKIP_AUTO_CHANGELOG=1，跳过执行');
    process.exit(0);
  }

  // 防重入：git commit --amend 会再次触发 post-commit 钩子
  if (process.env.AUTO_CHANGELOG_RUNNING === '1') {
    process.exit(0);
  }

  // 支持强制重新生成指定版本（用于修复历史版本）
  const forceVersion = process.env.AUTO_CHANGELOG_FORCE_VERSION;
  if (forceVersion) {
    console.log(`[auto-changelog] 强制重新生成 v${forceVersion} 的 changelog`);
    const prevTag = getPreviousTag(forceVersion);
    if (!prevTag) {
      console.error(`[auto-changelog] 无法找到 v${forceVersion} 的前一个版本标签`);
      process.exit(1);
    }
    await generateAndWriteChangelog(forceVersion, prevTag, true);
    process.exit(0);
  }

  // 1. 检查最近一次提交是否包含 VERSION 文件
  const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD');
  if (!files.split('\n').includes('VERSION')) {
    process.exit(0);
  }

  // 2. 对比版本号
  let newVersion;
  try {
    newVersion = git('show', 'HEAD:VERSION');
  } catch {
    process.exit(0);
  }

  let oldVersion;
  try {
    oldVersion = git('show', 'HEAD~1:VERSION');
  } catch {
    oldVersion = '';
  }

  if (newVersion === oldVersion) {
    process.exit(0);
  }

  console.log(`[auto-changelog] 检测到版本变更: ${oldVersion || '(无)'} → ${newVersion}`);

  // 3. 生成并写入 changelog
  await generateAndWriteChangelog(newVersion, getPreviousTag(newVersion), false);
}

/**
 * 生成并写入 changelog（可复用的核心逻辑）
 * @param {string} version - 版本号
 * @param {string|null} prevTag - 前一个版本 tag
 * @param {boolean} force - 是否强制覆盖现有版本
 */
async function generateAndWriteChangelog(version, prevTag, force) {
  console.log(`[auto-changelog] 上一个版本 tag: ${prevTag || '(无)'}`);

  const commits = collectCommits(prevTag);
  console.log(`[auto-changelog] 收集到 ${commits.length} 个 commits`);

  if (commits.length === 0) {
    console.log('[auto-changelog] 无 commits，跳过');
    process.exit(0);
  }

  const diffStat = collectDiffStat(prevTag);
  const keyDiff = collectKeyDiff(prevTag);

  // 构建提示词并调用 AI
  const today = new Date().toISOString().slice(0, 10);
  const prompt = buildPrompt(version, commits, diffStat, keyDiff, today);

  const { source, content } = await generateWithAI(prompt);

  if (!content) {
    // AI 调用全部失败，静默退出，不修改 changelog
    process.exit(0);
  }

  // 提取并写入 changelog（含版本号校验）
  const changelogBody = extractChangelogBody(content, version);
  if (!changelogBody) {
    console.warn('[auto-changelog] AI 输出校验失败，跳过写入');
    process.exit(0);
  }

  // 强制模式：先删除现有版本
  if (force) {
    const changelog = fs.readFileSync(CHANGELOG_FILE, 'utf8');
    const escaped = escapeRegExp(version);
    const versionPattern = new RegExp(
      `^## v${escaped}(?:\\s|（|\\()[\\s\\S]*?(?=\\n## v|\\n*$)`,
      'm',
    );
    const newChangelog = changelog.replace(versionPattern, '').replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(CHANGELOG_FILE, newChangelog, 'utf8');
    console.log(`[auto-changelog] 已删除现有 v${version} 条目`);
  }

  const written = writeChangelog(version, changelogBody);

  if (!written) {
    process.exit(0);
  }

  // amend 提交，包含 changelog 变更（仅在非强制模式下）
  if (!force) {
    process.env.AUTO_CHANGELOG_RUNNING = '1';
    git('add', 'docs/changelog.md');
    git('commit', '--amend', '--no-edit');
    console.log(`[auto-changelog] 已将 changelog 变更 amend 到当前提交（来源: ${source}）`);
  } else {
    console.log(`[auto-changelog] 强制模式：已更新 changelog，请手动提交（来源: ${source}）`);
  }
}

main().catch((err) => {
  console.error(`[auto-changelog] 执行异常: ${err.message}`);
  process.exit(0); // 异常时不阻止提交
});
