import { Page, Locator, expect } from '@playwright/test';

/**
 * 工作区页 Page Object
 */
export class WorkspacePage {
  readonly page: Page;
  readonly connectionList: Locator;
  readonly terminalContainer: Locator;
  readonly sftpPanel: Locator;
  readonly tabBar: Locator;
  readonly newConnectionButton: Locator;
  readonly quickConnectButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.connectionList = page.locator('.connection-list, [data-testid="connection-list"]');
    this.terminalContainer = page.locator('.xterm, .terminal-container, [data-testid="terminal"]');
    this.sftpPanel = page.locator('.sftp-panel, [data-testid="sftp-panel"]');
    this.tabBar = page.locator('.tab-bar, [data-testid="tab-bar"]');
    this.newConnectionButton = page.locator('button:has-text("新建"), button:has-text("添加连接")');
    this.quickConnectButton = page.locator('button:has-text("快速连接")');
  }

  async goto() {
    await this.page.goto('/workspace');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * 连接到指定的服务器
   */
  async connectToServer(serverName: string) {
    const serverItem = this.connectionList.locator(`text=${serverName}`);
    await serverItem.dblclick();
    // 等待终端容器出现
    await expect(this.terminalContainer).toBeVisible({ timeout: 15000 });
  }

  /**
   * 在终端中输入命令
   */
  async typeInTerminal(command: string) {
    await this.terminalContainer.click();
    await this.page.keyboard.type(command);
    await this.page.keyboard.press('Enter');
  }

  /**
   * 等待终端输出包含指定文本
   */
  async expectTerminalOutput(text: string, timeout = 10000) {
    await expect(this.terminalContainer).toContainText(text, { timeout });
  }

  /**
   * 打开 SFTP 面板
   */
  async openSftpPanel() {
    const sftpButton = this.page.locator('button:has-text("SFTP"), [data-testid="sftp-button"]');
    await sftpButton.click();
    await expect(this.sftpPanel).toBeVisible({ timeout: 5000 });
  }

  /**
   * 关闭当前标签页
   */
  async closeCurrentTab() {
    const closeButton = this.tabBar.locator('.tab-close, [data-testid="tab-close"]').first();
    await closeButton.click();
  }

  /**
   * 获取当前打开的标签页数量
   */
  async getTabCount(): Promise<number> {
    const tabs = this.tabBar.locator('.tab-item, [data-testid="tab"]');
    return tabs.count();
  }

  /**
   * 检查是否有活跃连接
   */
  async hasActiveConnection(): Promise<boolean> {
    const activeIndicator = this.page.locator('.connection-active, [data-status="connected"]');
    return activeIndicator.isVisible();
  }
}
