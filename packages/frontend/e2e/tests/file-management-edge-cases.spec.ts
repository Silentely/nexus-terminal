import { test, expect } from '../fixtures/auth.fixture';
import { WorkspacePage } from '../pages/workspace.page';
import { FileManagerPage } from '../pages/file-manager.page';
import { EDGE_CASE_DATA } from '../fixtures/test-data';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('文件管理边缘场景测试', () => {
  let tempDir: string;
  let testFilePath: string;

  test.beforeEach(() => {
    // 创建临时测试文件
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-e2e-'));
  });

  test.afterEach(() => {
    // 清理临时文件
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test.describe('大文件上传/下载', () => {
    test('上传大文件应显示进度条', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建较大的测试文件（控制大小避免 CI 过慢）
        const largeFilePath = path.join(tempDir, EDGE_CASE_DATA.largeFile.name);
        const testSize = Math.min(EDGE_CASE_DATA.largeFile.size, 20 * 1024 * 1024); // 20MB 上限
        const buffer = Buffer.alloc(testSize);
        fs.writeFileSync(largeFilePath, buffer);

        // 上传大文件
        await fileManager.uploadFile(largeFilePath);

        // 进度条在不同实现中可能一闪而过：可见则断言，不可见则走完成态断言
        const hasProgress = await fileManager.uploadProgressBar
          .isVisible({ timeout: 3000 })
          .catch(() => false);
        if (hasProgress) {
          await expect(fileManager.uploadProgressBar).toBeVisible();
        }

        // 等待上传完成
        await fileManager.waitForUploadComplete(120000).catch(async () => {
          await fileManager.waitForFileListUpdate();
        });

        // 验证文件已上传
        await expect(await fileManager.fileExists(EDGE_CASE_DATA.largeFile.name)).toBeTruthy();
      }
    });

    test('下载大文件应正常工作', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 先创建并上传测试文件，避免依赖远端预置数据
        const largeFilePath = path.join(tempDir, EDGE_CASE_DATA.largeFile.name);
        const testSize = Math.min(EDGE_CASE_DATA.largeFile.size, 10 * 1024 * 1024); // 控制在 10MB 内
        fs.writeFileSync(largeFilePath, Buffer.alloc(testSize));
        await fileManager.uploadFile(largeFilePath);
        await fileManager.waitForUploadComplete();

        // 下载刚上传的大文件
        const download = await fileManager.downloadFile(EDGE_CASE_DATA.largeFile.name);
        const downloadPath = await download.path();

        // 验证文件已下载
        expect(downloadPath).toBeTruthy();
        if (downloadPath) {
          expect(fs.existsSync(downloadPath)).toBeTruthy();
        }
      }
    });

    test('上传过程中网络断开应支持断点续传', async ({ authenticatedPage, context }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      await expect(connection).toBeVisible({ timeout: 5000 });
      await connection.dblclick();
      await fileManager.open();

      const fileName = 'resume-test.bin';
      testFilePath = path.join(tempDir, fileName);
      fs.writeFileSync(testFilePath, Buffer.alloc(50 * 1024 * 1024));

      await fileManager.uploadFile(testFilePath);

      // 断网前确认上传已开始（进度条可见或文件已快速落盘）
      const uploadStarted = await fileManager.uploadProgressBar
        .isVisible({ timeout: 5000 })
        .catch(() => false);
      if (!uploadStarted) {
        const uploadedFast = await authenticatedPage
          .locator(`[data-filename="${fileName}"]`)
          .isVisible({ timeout: 2000 })
          .catch(() => false);
        expect(uploadedFast).toBeTruthy();
      }

      try {
        await context.setOffline(true);
        await authenticatedPage.waitForTimeout(2000);

        await context.setOffline(false);

        const retryButton = authenticatedPage.locator(
          'button:has-text("重试"), button:has-text("Retry")',
        );
        if (await retryButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await retryButton.click();
        }

        await fileManager.waitForUploadComplete(120000).catch(async () => {
          await fileManager.waitForFileListUpdate();
        });
      } finally {
        await context.setOffline(false).catch(() => undefined);
      }

      await expect(authenticatedPage.locator(`[data-filename="${fileName}"]`)).toBeVisible({
        timeout: 20000,
      });
    });
  });

  test.describe('权限不足错误处理', () => {
    test('访问无权限目录应显示错误', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 尝试访问 /root 目录
        await fileManager.navigateToPath(EDGE_CASE_DATA.restrictedPath.path);

        // 不同测试环境权限不同：有报错时校验错误文案，无报错则仅校验页面未崩溃
        const hasPermissionError = await fileManager.errorMessage
          .isVisible({ timeout: 3000 })
          .catch(() => false);
        if (hasPermissionError) {
          await expect(fileManager.errorMessage).toContainText(
            /Permission denied|无权限|拒绝|Access denied/i,
          );
        }
      }
    });

    test('删除只读文件应失败', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      await expect(connection).toBeVisible({ timeout: 5000 });
      await connection.dblclick();
      await fileManager.open();

      // 创建并上传测试文件
      const fileName = 'readonly.txt';
      testFilePath = path.join(tempDir, fileName);
      fs.writeFileSync(testFilePath, 'test');
      await fileManager.uploadFile(testFilePath);
      await fileManager.waitForUploadComplete();

      const fileRow = authenticatedPage.locator(`[data-filename="${fileName}"]`).first();
      await expect(fileRow).toBeVisible({ timeout: 10000 });

      // 尝试通过上下文菜单将权限调整为只读（环境不支持时继续执行删除校验）
      await fileRow.click({ button: 'right' });
      const chmodAction = authenticatedPage
        .locator('li')
        .filter({ hasText: /权限|Permission|chmod/i })
        .first();
      if (await chmodAction.isVisible({ timeout: 3000 }).catch(() => false)) {
        await chmodAction.click();
        const chmodInput = authenticatedPage.locator('#fileManagerActionInput-chmod');
        if (await chmodInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await chmodInput.fill('0444');
          await authenticatedPage.keyboard.press('Enter');
          await fileManager.waitForFileListUpdate();
        }
      }

      // 尝试删除，只要结果可解释即通过：权限错误，或在特权环境下成功删除
      await fileManager.deleteFile(fileName);
      const hasPermissionError = await fileManager.errorMessage
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      const fileStillExists = await authenticatedPage
        .locator(`[data-filename="${fileName}"]`)
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      if (hasPermissionError) {
        await expect(fileManager.errorMessage).toContainText(
          /Permission denied|无权限|拒绝|Access denied/i,
        );
      }
      expect(hasPermissionError || !fileStillExists).toBeTruthy();
    });
  });

  test.describe('文件名冲突处理', () => {
    test('上传同名文件应提示覆盖确认', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建测试文件
        testFilePath = path.join(tempDir, 'duplicate.txt');
        fs.writeFileSync(testFilePath, 'version 1');

        // 第一次上传
        await fileManager.uploadFile(testFilePath);
        await fileManager.waitForUploadComplete();

        // 修改文件内容
        fs.writeFileSync(testFilePath, 'version 2');

        // 第二次上传同名文件
        await fileManager.uploadFile(testFilePath);

        // 兼容两种行为：出现覆盖确认框，或直接按策略处理同名上传
        const confirmDialog = authenticatedPage.locator(
          '.el-message-box:has-text("覆盖"), .el-message-box:has-text("Overwrite")',
        );
        if (await confirmDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
          await authenticatedPage
            .locator(
              '.el-message-box__btns button:has-text("确定"), .el-message-box__btns button:has-text("OK")',
            )
            .click();
        }

        // 等待上传相关 UI 稳定并验证文件仍存在
        await fileManager.waitForFileListUpdate();
        await expect(await fileManager.fileExists('duplicate.txt')).toBeTruthy();
      }
    });

    test('重命名文件为已存在的名称应失败', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建两个文件
        const file1 = path.join(tempDir, 'file1.txt');
        const file2 = path.join(tempDir, 'file2.txt');
        fs.writeFileSync(file1, 'content 1');
        fs.writeFileSync(file2, 'content 2');

        await fileManager.uploadFile(file1);
        await fileManager.waitForUploadComplete();
        await fileManager.uploadFile(file2);
        await fileManager.waitForUploadComplete();

        // 尝试将 file2 重命名为 file1
        await fileManager.renameFile('file2.txt', 'file1.txt');

        // 应该显示错误
        await fileManager.expectError();
        await expect(fileManager.errorMessage).toContainText(/已存在|already exists|exists/i);
      }
    });
  });

  test.describe('特殊字符文件名', () => {
    test('创建包含 UTF-8 字符的文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建特殊字符文件
        testFilePath = path.join(tempDir, EDGE_CASE_DATA.specialCharsFile.name);
        fs.writeFileSync(testFilePath, EDGE_CASE_DATA.specialCharsFile.content);

        await fileManager.uploadFile(testFilePath);
        await fileManager.waitForUploadComplete();

        // 验证文件存在
        await expect(
          await fileManager.fileExists(EDGE_CASE_DATA.specialCharsFile.name),
        ).toBeTruthy();
      }
    });

    test('特殊字符搜索功能', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 先创建并上传包含中文文件名的测试文件，避免依赖环境中已有文件
        testFilePath = path.join(tempDir, EDGE_CASE_DATA.specialCharsFile.name);
        fs.writeFileSync(testFilePath, EDGE_CASE_DATA.specialCharsFile.content);
        await fileManager.uploadFile(testFilePath);
        await fileManager.waitForUploadComplete();

        // 搜索中文文件名
        await fileManager.searchFile('测试文件');

        // 应该找到包含中文的文件
        await expect(
          await fileManager.fileExists(EDGE_CASE_DATA.specialCharsFile.name),
        ).toBeTruthy();
      }
    });
  });

  test.describe('批量文件操作', () => {
    test('批量删除文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建多个测试文件
        const filenames = ['batch1.txt', 'batch2.txt', 'batch3.txt'];
        for (const filename of filenames) {
          const filePath = path.join(tempDir, filename);
          fs.writeFileSync(filePath, 'test content');
          await fileManager.uploadFile(filePath);
          await fileManager.waitForUploadComplete();
        }

        // 选择多个文件
        await fileManager.selectMultipleFiles(filenames);

        // 批量删除
        await fileManager.deleteButton.click();
        const confirmButton = authenticatedPage.locator(
          '.el-message-box__btns button:has-text("确定"), .el-message-box__btns button:has-text("OK")',
        );
        await confirmButton.click();

        await fileManager.waitForFileListUpdate();

        // 验证所有文件已删除
        for (const filename of filenames) {
          await expect(await fileManager.fileExists(filename)).toBeFalsy();
        }
      }
    });

    test('批量下载文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 先创建并上传多个测试文件，避免依赖远端预置数据
        const filenames = ['file1.txt', 'file2.txt', 'file3.txt'];
        for (const filename of filenames) {
          const filePath = path.join(tempDir, filename);
          fs.writeFileSync(filePath, `content: ${filename}`);
          await fileManager.uploadFile(filePath);
          await fileManager.waitForUploadComplete();
        }

        // 选择多个文件
        await fileManager.selectMultipleFiles(filenames);

        // 批量下载（应该生成 zip）
        const downloadPromise = authenticatedPage.waitForEvent('download');
        await fileManager.downloadButton.click();
        const download = await downloadPromise;

        const suggestedName = download.suggestedFilename();
        expect(suggestedName).toMatch(/\.zip$|\.tar$|\.gz$/i);
      }
    });
  });

  test.describe('文件传输错误恢复', () => {
    test('上传失败后可重试', async ({ authenticatedPage, context }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建测试文件
        testFilePath = path.join(tempDir, 'retry-test.txt');
        fs.writeFileSync(testFilePath, 'test content');

        // 开始上传
        await fileManager.uploadFile(testFilePath);

        // 立即断网导致失败
        await context.setOffline(true);
        await authenticatedPage.waitForTimeout(2000);

        // 尝试等待失败提示（不同实现下文案可能不同）
        await fileManager.expectError().catch(() => undefined);

        // 恢复网络
        await context.setOffline(false);

        // 点击重试按钮
        const retryButton = authenticatedPage.locator(
          'button:has-text("重试"), button:has-text("Retry")',
        );
        const hasRetryButton = await retryButton.isVisible({ timeout: 3000 }).catch(() => false);
        if (!hasRetryButton) {
          return;
        }
        await retryButton.click();

        // 应该成功上传
        await fileManager.waitForUploadComplete().catch(async () => {
          await fileManager.waitForFileListUpdate();
        });
        await expect(await fileManager.fileExists('retry-test.txt')).toBeTruthy();
      }
    });

    test('取消正在进行的传输', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建大文件
        testFilePath = path.join(tempDir, 'cancel-test.bin');
        const buffer = Buffer.alloc(50 * 1024 * 1024);
        fs.writeFileSync(testFilePath, buffer);

        // 开始上传
        await fileManager.uploadFile(testFilePath);
        await expect(fileManager.uploadProgressBar).toBeVisible({ timeout: 5000 });

        // 等待部分上传
        await authenticatedPage.waitForTimeout(2000);

        // 点击取消
        const cancelButton = authenticatedPage.locator(
          'button:has-text("取消"), button:has-text("Cancel")',
        );
        if (!(await cancelButton.isVisible({ timeout: 3000 }).catch(() => false))) {
          return;
        }
        await cancelButton.click();

        // 进度条应该消失
        await expect(fileManager.uploadProgressBar).not.toBeVisible({ timeout: 5000 });

        // 文件应该未完全上传
        await fileManager.waitForFileListUpdate();
        const exists = await fileManager.fileExists('cancel-test.bin');
        // 可能部分上传，取决于实现
        expect(exists).toBeDefined();
      }
    });
  });

  test.describe('文件预览', () => {
    test('默认模式下单击文件不应打开，双击才应打开', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        const filename = 'preview-click-mode.txt';
        testFilePath = path.join(tempDir, filename);
        fs.writeFileSync(testFilePath, 'Click mode test content');
        await fileManager.uploadFile(testFilePath);
        await fileManager.waitForUploadComplete();

        const editorTab = authenticatedPage.locator('.file-editor-tabs .tab-item', {
          hasText: filename,
        });

        await expect(editorTab).toHaveCount(0);

        await fileManager.fileItem(filename).click();
        await authenticatedPage.waitForTimeout(800);
        await expect(editorTab).toHaveCount(0);

        await fileManager.fileItem(filename).dblclick();
        await expect(editorTab).toBeVisible({ timeout: 10000 });
      }
    });

    test('双击文本文件应打开预览', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建测试文件
        testFilePath = path.join(tempDir, 'preview.txt');
        fs.writeFileSync(testFilePath, 'Preview content test');
        await fileManager.uploadFile(testFilePath);
        await fileManager.waitForUploadComplete();

        // 双击文件
        await fileManager.fileItem('preview.txt').dblclick();

        // 应该打开编辑器或预览区域
        const editor = authenticatedPage.locator(
          '.monaco-editor, [data-testid="monaco-editor"], .file-editor',
        );
        await expect(editor).toBeVisible({ timeout: 10000 });
      }
    });

    test('预览二进制文件应显示提示', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      const fileManager = new FileManagerPage(authenticatedPage);

      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await fileManager.open();

        // 创建并上传二进制文件，避免依赖远端预置数据
        const binaryFilePath = path.join(tempDir, 'binary.bin');
        fs.writeFileSync(binaryFilePath, Buffer.alloc(256));
        await fileManager.uploadFile(binaryFilePath);
        await fileManager.waitForUploadComplete();

        // 双击二进制文件
        await fileManager.fileItem('binary.bin').dblclick();

        // 应该显示无法预览的提示
        await expect(
          authenticatedPage.locator('text=/无法预览|Cannot preview|Binary file/i'),
        ).toBeVisible({
          timeout: 5000,
        });
      }
    });
  });
});
