import { Page, Locator, expect } from '@playwright/test';

/**
 * 设置页 Page Object
 */
export class SettingsPage {
  readonly page: Page;
  readonly sidebar: Locator;
  readonly generalSettings: Locator;
  readonly securitySettings: Locator;
  readonly appearanceSettings: Locator;
  readonly saveButton: Locator;
  readonly successMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.locator('.settings-sidebar, [data-testid="settings-sidebar"]');
    this.generalSettings = page.locator('[data-testid="general-settings"], :has-text("常规设置")');
    this.securitySettings = page.locator(
      '[data-testid="security-settings"], :has-text("安全设置")'
    );
    this.appearanceSettings = page.locator(
      '[data-testid="appearance-settings"], :has-text("外观设置")'
    );
    this.saveButton = page.locator('button:has-text("保存"), button[type="submit"]');
    this.successMessage = page.locator('.el-message--success');
  }

  async goto() {
    await this.page.goto('/settings');
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToGeneral() {
    await this.sidebar.locator('text=常规, text=General').click();
    await expect(this.generalSettings).toBeVisible();
  }

  async navigateToSecurity() {
    await this.sidebar.locator('text=安全, text=Security').click();
    await expect(this.securitySettings).toBeVisible();
  }

  async navigateToAppearance() {
    await this.sidebar.locator('text=外观, text=Appearance').click();
    await expect(this.appearanceSettings).toBeVisible();
  }

  async saveSettings() {
    await this.saveButton.click();
    await expect(this.successMessage).toBeVisible({ timeout: 5000 });
  }

  /**
   * 启用 2FA
   */
  async enable2FA() {
    await this.navigateToSecurity();
    const enable2FAButton = this.page.locator(
      'button:has-text("启用两步验证"), button:has-text("Enable 2FA")'
    );
    await enable2FAButton.click();
  }

  /**
   * 更改主题
   */
  async changeTheme(themeName: string) {
    await this.navigateToAppearance();
    const themeSelector = this.page.locator('.theme-selector, [data-testid="theme-selector"]');
    await themeSelector.click();
    await this.page.locator(`text=${themeName}`).click();
  }

  /**
   * 添加 Passkey
   */
  async addPasskey() {
    await this.navigateToSecurity();
    const addPasskeyButton = this.page.locator(
      'button:has-text("添加 Passkey"), button:has-text("Add Passkey")'
    );
    await addPasskeyButton.click();
  }
}
