import { Page, Locator, expect } from '@playwright/test';

/**
 * 登录页 Page Object
 */
export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly twoFactorInput: Locator;
  readonly passkeyButton: Locator;
  readonly errorMessage: Locator;
  readonly rememberMeCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.locator('input[name="username"], input[placeholder*="用户名"]');
    this.passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    this.loginButton = page.locator('button[type="submit"], button:has-text("登录")');
    this.twoFactorInput = page.locator('input[placeholder*="验证码"], input[name="token"]');
    this.passkeyButton = page.locator('button:has-text("Passkey"), button:has-text("通行密钥")');
    this.errorMessage = page.locator('.el-message--error, [role="alert"]');
    this.rememberMeCheckbox = page.locator('input[type="checkbox"], .el-checkbox');
  }

  async goto() {
    await this.page.goto('/login');
    await this.page.waitForLoadState('networkidle');
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async loginWithRememberMe(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.rememberMeCheckbox.click();
    await this.loginButton.click();
  }

  async submit2FACode(code: string) {
    await this.twoFactorInput.fill(code);
    await this.page.click('button[type="submit"]:has-text("验证"), button:has-text("确认")');
  }

  async clickPasskeyLogin() {
    await this.passkeyButton.click();
  }

  async expectLoginSuccess() {
    await expect(this.page).toHaveURL(/\/(workspace|dashboard)/, { timeout: 10000 });
  }

  async expectLoginFailure() {
    await expect(this.errorMessage).toBeVisible({ timeout: 5000 });
  }

  async expect2FARequired() {
    await expect(this.twoFactorInput).toBeVisible({ timeout: 5000 });
  }
}
