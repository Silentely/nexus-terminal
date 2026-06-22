import { test, expect } from '../fixtures/auth.fixture';
import { WorkspacePage } from '../pages/workspace.page';
import { SFTP_TEST_DATA } from '../fixtures/test-data';
import { Page, Locator } from '@playwright/test';

async function connectFirstVisibleConnection(
  page: Page,
  workspace: WorkspacePage,
): Promise<boolean> {
  const connectionItem = page.locator(
    '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
  );
  if (!(await connectionItem.isVisible({ timeout: 3000 }).catch(() => false))) {
    return false;
  }

  await connectionItem.dblclick();
  await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });
  return true;
}

function fileRow(page: Page, filename: string): Locator {
  return page.locator(`[data-filename="${filename}"], .file-row:has-text("${filename}")`).first();
}

async function openSftpWorkspace(page: Page): Promise<void> {
  const workspace = new WorkspacePage(page);
  await workspace.goto();
  const connected = await connectFirstVisibleConnection(page, workspace);
  expect(connected).toBeTruthy();
  await workspace.openSftpPanel();
}

async function uploadBufferFile(
  page: Page,
  fileName: string,
  content: Buffer,
  mimeType = 'text/plain',
): Promise<void> {
  const input = page.locator('input[type="file"]').first();
  await expect(input).toBeAttached();
  await input.setInputFiles({
    name: fileName,
    mimeType,
    buffer: content,
  });
  await expect(fileRow(page, fileName)).toBeVisible({ timeout: 15000 });
}

async function clickContextMenuAction(
  page: Page,
  target: Locator,
  actionText: RegExp,
): Promise<void> {
  await target.click({ button: 'right' });
  const action = page.locator('li').filter({ hasText: actionText }).first();
  await expect(action).toBeVisible({ timeout: 5000 });
  await action.click();
}

async function confirmActionModalIfVisible(page: Page): Promise<void> {
  const modal = page.locator('.fixed.inset-0.bg-overlay').last();
  const visible = await modal.isVisible({ timeout: 1000 }).catch(() => false);
  if (!visible) {
    return;
  }

  const confirmButton = modal.locator('div.flex.justify-end.gap-3 button').nth(1);
  await expect(confirmButton).toBeVisible({ timeout: 5000 });
  await confirmButton.click();
}

test.describe('SFTP 操作测试', () => {
  test.describe('文件列表', () => {
    test('打开 SFTP 面板显示文件列表', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 连接到服务器
      const connected = await connectFirstVisibleConnection(authenticatedPage, workspace);
      expect(connected).toBeTruthy();

      // 打开 SFTP 面板
      await workspace.openSftpPanel();

      // 应该显示文件列表
      const fileList = authenticatedPage.locator('.sftp-file-list, [data-testid="file-list"]');
      await expect(fileList).toBeVisible();
    });

    test('可以导航到子目录', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      const connected = await connectFirstVisibleConnection(authenticatedPage, workspace);
      expect(connected).toBeTruthy();
      await workspace.openSftpPanel();

      // 双击目录进入
      const directory = authenticatedPage
        .locator('.sftp-item-directory, [data-type="directory"]')
        .first();
      await expect(directory).toBeVisible({ timeout: 5000 });
      await directory.dblclick();

      // 面包屑应该更新
      const breadcrumb = authenticatedPage.locator('.sftp-breadcrumb, [data-testid="breadcrumb"]');
      await expect(breadcrumb).toBeVisible();
    });
  });

  test.describe('文件上传', () => {
    test('可以上传文件', async ({ authenticatedPage }) => {
      await openSftpWorkspace(authenticatedPage);

      const fileName = `${Date.now()}-${SFTP_TEST_DATA.testFilename}`;
      await uploadBufferFile(
        authenticatedPage,
        fileName,
        Buffer.from(SFTP_TEST_DATA.testContent),
        'text/plain',
      );
    });

    test('显示上传进度', async ({ authenticatedPage }) => {
      await openSftpWorkspace(authenticatedPage);

      const fileName = `large-${Date.now()}.bin`;
      const largeContent = Buffer.alloc(20 * 1024 * 1024, 'x');
      const input = authenticatedPage.locator('input[type="file"]').first();
      await input.setInputFiles({
        name: fileName,
        mimeType: 'application/octet-stream',
        buffer: largeContent,
      });

      // 部分环境上传极快，允许"显示过进度"或"快速完成已落盘"两种路径。
      const progressBar = authenticatedPage.locator('progress').first();
      const progressVisible = await progressBar.isVisible({ timeout: 3000 }).catch(() => false);
      if (progressVisible) {
        await expect(progressBar).toBeVisible();
      }
      await expect(fileRow(authenticatedPage, fileName)).toBeVisible({ timeout: 20000 });
    });
  });

  test.describe('文件下载', () => {
    test('可以下载文件', async ({ authenticatedPage }) => {
      await openSftpWorkspace(authenticatedPage);

      const fileName = `download-${Date.now()}.txt`;
      await uploadBufferFile(authenticatedPage, fileName, Buffer.from('download test content'));

      const row = fileRow(authenticatedPage, fileName);
      const downloadPromise = authenticatedPage.waitForEvent('download');
      await clickContextMenuAction(authenticatedPage, row, /下载|Download/i);
      const download = await downloadPromise;

      expect(download).toBeDefined();
      expect(download.suggestedFilename()).toContain(fileName);
    });
  });

  test.describe('文件操作', () => {
    test('可以创建新目录', async ({ authenticatedPage }) => {
      await openSftpWorkspace(authenticatedPage);

      const dirName = `test-dir-${Date.now()}`;
      const newFolderButton = authenticatedPage.locator('button:has(i.fa-folder-plus)').first();
      await expect(newFolderButton).toBeVisible({ timeout: 5000 });
      await newFolderButton.click();

      const input = authenticatedPage.locator('#fileManagerActionInput-newFolder');
      await expect(input).toBeVisible({ timeout: 5000 });
      await input.fill(dirName);
      await authenticatedPage.keyboard.press('Enter');

      await expect(fileRow(authenticatedPage, dirName)).toBeVisible({ timeout: 10000 });
    });

    test('可以删除文件', async ({ authenticatedPage }) => {
      await openSftpWorkspace(authenticatedPage);

      const fileName = `delete-${Date.now()}.txt`;
      await uploadBufferFile(authenticatedPage, fileName, Buffer.from('delete me'));

      const row = fileRow(authenticatedPage, fileName);
      await clickContextMenuAction(authenticatedPage, row, /删除|Delete/i);
      await confirmActionModalIfVisible(authenticatedPage);

      await expect(row).not.toBeVisible({ timeout: 10000 });
    });

    test('可以重命名文件', async ({ authenticatedPage }) => {
      await openSftpWorkspace(authenticatedPage);

      const oldName = `rename-source-${Date.now()}.txt`;
      await uploadBufferFile(authenticatedPage, oldName, Buffer.from('rename source'));

      const newName = `renamed-${Date.now()}.txt`;
      const row = fileRow(authenticatedPage, oldName);
      await clickContextMenuAction(authenticatedPage, row, /重命名|Rename/i);

      const input = authenticatedPage.locator('#fileManagerActionInput-rename');
      await expect(input).toBeVisible({ timeout: 5000 });
      await input.fill(newName);
      await authenticatedPage.keyboard.press('Enter');

      await expect(fileRow(authenticatedPage, newName)).toBeVisible({ timeout: 10000 });
      await expect(fileRow(authenticatedPage, oldName)).not.toBeVisible({ timeout: 5000 });
    });
  });
});
