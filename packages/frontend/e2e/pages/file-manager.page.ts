// eslint-disable-next-line import/no-extraneous-dependencies
import { Page, Locator, expect } from '@playwright/test';

/**
 * 文件管理器 Page Object
 */
export class FileManagerPage {
  readonly page: Page;
  readonly fileList: Locator;
  readonly uploadButton: Locator;
  readonly downloadButton: Locator;
  readonly deleteButton: Locator;
  readonly newFolderButton: Locator;
  readonly pathInput: Locator;
  readonly searchInput: Locator;
  readonly fileItem: (filename: string) => Locator;
  readonly contextMenu: Locator;
  readonly uploadProgressBar: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.fileList = page.locator('.file-list, [data-testid="file-list"]');
    this.uploadButton = page.locator('button:has-text("上传"), button:has-text("Upload")');
    this.downloadButton = page.locator('button:has-text("下载"), button:has-text("Download")');
    this.deleteButton = page.locator('button:has-text("删除"), button:has-text("Delete")');
    this.newFolderButton = page.locator(
      'button:has-text("新建文件夹"), button:has-text("New Folder")',
    );
    this.pathInput = page.locator('input[name="path"], .path-input');
    this.searchInput = page.locator('input[placeholder*="搜索"], input[type="search"]');
    this.fileItem = (filename: string) => page.locator(`.file-item:has-text("${filename}")`);
    this.contextMenu = page.locator('.context-menu, [role="menu"]');
    this.uploadProgressBar = page.locator('.upload-progress, .el-progress');
    this.errorMessage = page.locator('.el-message--error, [role="alert"]');
  }

  /**
   * 打开文件管理器
   */
  async open() {
    const sftpButton = this.page.locator('button:has-text("SFTP"), [data-testid="sftp-button"]');
    await sftpButton.click();
    await expect(this.fileList).toBeVisible({ timeout: 10000 });
  }

  /**
   * 导航到指定路径
   */
  async navigateToPath(path: string) {
    await this.pathInput.fill(path);
    await this.page.keyboard.press('Enter');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * 上传文件
   */
  async uploadFile(filePath: string) {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.uploadButton.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);
  }

  /**
   * 下载文件
   */
  async downloadFile(filename: string) {
    await this.selectFile(filename);
    const downloadPromise = this.page.waitForEvent('download');
    await this.downloadButton.click();
    return downloadPromise;
  }

  /**
   * 删除文件
   */
  async deleteFile(filename: string) {
    await this.selectFile(filename);
    await this.deleteButton.click();

    // 确认删除
    const confirmButton = this.page.locator(
      '.el-message-box__btns button:has-text("确定"), button:has-text("OK")',
    );
    await confirmButton.click();
  }

  /**
   * 创建新文件夹
   */
  async createFolder(folderName: string) {
    await this.newFolderButton.click();
    const input = this.page.locator('input[placeholder*="文件夹名"], input[name="folderName"]');
    await input.fill(folderName);
    await this.page.keyboard.press('Enter');
  }

  /**
   * 选择文件
   */
  async selectFile(filename: string) {
    await this.fileItem(filename).click();
  }

  /**
   * 右键点击文件
   */
  async rightClickFile(filename: string) {
    await this.fileItem(filename).click({ button: 'right' });
    await expect(this.contextMenu).toBeVisible({ timeout: 2000 });
  }

  /**
   * 重命名文件
   */
  async renameFile(oldName: string, newName: string) {
    await this.rightClickFile(oldName);
    await this.contextMenu.locator('text=重命名, text=Rename').click();

    const input = this.page.locator('input[name="newName"]');
    await input.fill(newName);
    await this.page.keyboard.press('Enter');
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(filename: string): Promise<boolean> {
    return this.fileItem(filename)
      .isVisible({ timeout: 3000 })
      .catch(() => false);
  }

  /**
   * 等待上传完成
   */
  async waitForUploadComplete(timeout = 30000) {
    await expect(this.uploadProgressBar).toBeVisible({ timeout: 5000 });
    await expect(this.uploadProgressBar).not.toBeVisible({ timeout });
  }

  /**
   * 等待文件列表更新
   */
  async waitForFileListUpdate() {
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(500);
  }

  /**
   * 获取文件列表项数量
   */
  async getFileCount(): Promise<number> {
    const items = this.fileList.locator('.file-item, [data-testid="file-item"]');
    return items.count();
  }

  /**
   * 搜索文件
   */
  async searchFile(searchTerm: string) {
    await this.searchInput.fill(searchTerm);
    await this.page.waitForTimeout(500); // 等待防抖
  }

  /**
   * 清除搜索
   */
  async clearSearch() {
    await this.searchInput.clear();
    await this.page.waitForTimeout(500);
  }

  /**
   * 期望显示错误消息
   */
  async expectError(errorText?: string) {
    await expect(this.errorMessage).toBeVisible({ timeout: 5000 });
    if (errorText) {
      await expect(this.errorMessage).toContainText(errorText);
    }
  }

  /**
   * 选择多个文件
   */
  async selectMultipleFiles(filenames: string[]) {
    for (let i = 0; i < filenames.length; i++) {
      const modifier = i === 0 ? [] : ['Control']; // 第一个文件不需要 Ctrl，后续需要
      await this.fileItem(filenames[i]).click({ modifiers: modifier });
    }
  }

  /**
   * 拖拽文件到文件夹
   */
  async dragFileToFolder(filename: string, folderName: string) {
    const sourceFile = this.fileItem(filename);
    const targetFolder = this.fileItem(folderName);

    await sourceFile.dragTo(targetFolder);
  }
}
