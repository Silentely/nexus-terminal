import { test, expect } from '../fixtures/auth.fixture';
import { WorkspacePage } from '../pages/workspace.page';
import { SFTP_TEST_DATA } from '../fixtures/test-data';

test.describe('SFTP 操作测试', () => {
  test.describe('文件列表', () => {
    test.skip('打开 SFTP 面板显示文件列表', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 连接到服务器
      await workspace.connectToServer('Test Server');

      // 打开 SFTP 面板
      await workspace.openSftpPanel();

      // 应该显示文件列表
      const fileList = authenticatedPage.locator('.sftp-file-list, [data-testid="file-list"]');
      await expect(fileList).toBeVisible();
    });

    test.skip('可以导航到子目录', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      await workspace.connectToServer('Test Server');
      await workspace.openSftpPanel();

      // 双击目录进入
      const directory = authenticatedPage
        .locator('.sftp-item-directory, [data-type="directory"]')
        .first();
      await directory.dblclick();

      // 面包屑应该更新
      const breadcrumb = authenticatedPage.locator('.sftp-breadcrumb, [data-testid="breadcrumb"]');
      await expect(breadcrumb).toBeVisible();
    });
  });

  test.describe('文件上传', () => {
    test.skip('可以上传文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      await workspace.connectToServer('Test Server');
      await workspace.openSftpPanel();

      // 使用文件选择器上传
      const fileInput = authenticatedPage.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: SFTP_TEST_DATA.testFilename,
        mimeType: 'text/plain',
        buffer: Buffer.from(SFTP_TEST_DATA.testContent),
      });

      // 等待上传完成
      await expect(
        authenticatedPage.locator('.upload-progress, [data-testid="upload-complete"]')
      ).toBeVisible({
        timeout: 10000,
      });

      // 刷新文件列表，验证文件存在
      await authenticatedPage.click('button:has-text("刷新"), button[data-testid="refresh"]');
      await expect(authenticatedPage.locator(`text=${SFTP_TEST_DATA.testFilename}`)).toBeVisible();
    });

    test.skip('显示上传进度', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      await workspace.connectToServer('Test Server');
      await workspace.openSftpPanel();

      // 创建较大的测试文件
      const largeContent = Buffer.alloc(1024 * 1024, 'x'); // 1MB

      const fileInput = authenticatedPage.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: 'large-test-file.bin',
        mimeType: 'application/octet-stream',
        buffer: largeContent,
      });

      // 应该显示进度条
      const progressBar = authenticatedPage.locator(
        '.upload-progress-bar, [data-testid="progress-bar"]'
      );
      await expect(progressBar).toBeVisible();
    });
  });

  test.describe('文件下载', () => {
    test.skip('可以下载文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      await workspace.connectToServer('Test Server');
      await workspace.openSftpPanel();

      // 右键点击文件
      const fileItem = authenticatedPage.locator('.sftp-item-file, [data-type="file"]').first();
      await fileItem.click({ button: 'right' });

      // 点击下载选项
      await authenticatedPage.click('text=下载, text=Download');

      // 等待下载开始
      const downloadPromise = authenticatedPage.waitForEvent('download');
      const download = await downloadPromise;
      expect(download).toBeDefined();
    });
  });

  test.describe('文件操作', () => {
    test.skip('可以创建新目录', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      await workspace.connectToServer('Test Server');
      await workspace.openSftpPanel();

      // 点击新建目录按钮
      await authenticatedPage.click(
        'button:has-text("新建目录"), button[data-testid="new-folder"]'
      );

      // 输入目录名
      const dirName = `test-dir-${Date.now()}`;
      await authenticatedPage.fill(
        'input[placeholder*="目录名"], input[name="folderName"]',
        dirName
      );
      await authenticatedPage.click('button:has-text("确定"), button:has-text("OK")');

      // 验证目录创建成功
      await expect(authenticatedPage.locator(`text=${dirName}`)).toBeVisible();
    });

    test.skip('可以删除文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      await workspace.connectToServer('Test Server');
      await workspace.openSftpPanel();

      // 选择文件
      const fileItem = authenticatedPage.locator('.sftp-item-file, [data-type="file"]').first();
      const fileName = await fileItem.textContent();
      await fileItem.click({ button: 'right' });

      // 点击删除
      await authenticatedPage.click('text=删除, text=Delete');

      // 确认删除
      await authenticatedPage.click('.el-message-box__btns button:has-text("确定")');

      // 验证文件已删除
      await expect(authenticatedPage.locator(`text=${fileName}`)).not.toBeVisible();
    });

    test.skip('可以重命名文件', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      await workspace.connectToServer('Test Server');
      await workspace.openSftpPanel();

      // 选择文件
      const fileItem = authenticatedPage.locator('.sftp-item-file, [data-type="file"]').first();
      await fileItem.click({ button: 'right' });

      // 点击重命名
      await authenticatedPage.click('text=重命名, text=Rename');

      // 输入新名称
      const newName = `renamed-${Date.now()}.txt`;
      await authenticatedPage.fill('input[placeholder*="新名称"], input[name="newName"]', newName);
      await authenticatedPage.click('button:has-text("确定"), button:has-text("OK")');

      // 验证重命名成功
      await expect(authenticatedPage.locator(`text=${newName}`)).toBeVisible();
    });
  });
});
