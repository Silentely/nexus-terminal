import { test as base, expect, Page } from '@playwright/test';

/**
 * 认证测试数据
 */
export const TEST_USER = {
  username: process.env.E2E_TEST_USERNAME || 'admin',
  password: process.env.E2E_TEST_PASSWORD || 'admin123',
};

/**
 * 认证状态 Fixture
 */
export type AuthFixtures = {
  authenticatedPage: Page;
  loginPage: Page;
};

/**
 * 扩展 Playwright test，添加认证相关 fixture
 */
export const test = base.extend<AuthFixtures>({
  /**
   * 已认证的页面 - 自动完成登录
   */
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // 填写登录表单
    await page.fill('input[name="username"], input[placeholder*="用户名"]', TEST_USER.username);
    await page.fill('input[name="password"], input[type="password"]', TEST_USER.password);

    // 点击登录按钮
    await page.click('button[type="submit"], button:has-text("登录")');

    // 等待登录成功跳转
    await page.waitForURL(/\/(workspace|dashboard)/, { timeout: 10000 });

    await use(page);
  },

  /**
   * 未认证的登录页面
   */
  loginPage: async ({ page }, use) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await use(page);
  },
});

export { expect };
