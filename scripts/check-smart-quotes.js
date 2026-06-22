#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SMART_QUOTE_PATTERN = /[\u2018\u2019\u201C\u201D]/g;
const SMART_QUOTE_NAMES = {
  '\u2018': 'LEFT SINGLE QUOTATION MARK',
  '\u2019': 'RIGHT SINGLE QUOTATION MARK',
  '\u201C': 'LEFT DOUBLE QUOTATION MARK',
  '\u201D': 'RIGHT DOUBLE QUOTATION MARK',
};

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue']);

function getStagedFiles() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.error) {
    console.error(`读取暂存区文件失败: ${result.error.message}`);
    process.exit(2);
  }

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 2);
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveCandidateFiles() {
  const incomingFiles = process.argv.slice(2).filter(Boolean);
  const source = incomingFiles.length > 0 ? incomingFiles : getStagedFiles();
  const uniqueFiles = Array.from(new Set(source));
  return uniqueFiles.filter((filePath) =>
    CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
  );
}

function collectIssues(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];

  lines.forEach((line, index) => {
    SMART_QUOTE_PATTERN.lastIndex = 0;
    let match = SMART_QUOTE_PATTERN.exec(line);
    while (match) {
      const char = match[0];
      issues.push({
        file: filePath,
        line: index + 1,
        column: match.index + 1,
        char,
        charName: SMART_QUOTE_NAMES[char] || 'SMART QUOTE',
      });
      match = SMART_QUOTE_PATTERN.exec(line);
    }
  });

  return issues;
}

function main() {
  const files = resolveCandidateFiles();
  if (files.length === 0) {
    process.exit(0);
  }

  const issues = files.flatMap((filePath) => collectIssues(filePath));
  if (issues.length === 0) {
    process.exit(0);
  }

  console.error('检测到代码文件包含智能引号，已阻止提交。请改为 ASCII 引号（\\\' 或 "）:');
  issues.slice(0, 50).forEach((issue) => {
    console.error(
      `- ${issue.file}:${issue.line}:${issue.column} ${issue.char} (${issue.charName})`,
    );
  });
  if (issues.length > 50) {
    console.error(`- ... 其余 ${issues.length - 50} 处已省略`);
  }
  process.exit(1);
}

main();
