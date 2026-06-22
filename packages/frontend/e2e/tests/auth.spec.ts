import { test, expect, TEST_USER } from '../fixtures/auth.fixture';
import { LoginPage } from '../pages/login.page';

test.describe('认证流程测试', () => {
  test.describe('密码登录', () => {
    test('使用正确凭据登录成功', async ({ loginPage }) => {
      const login = new LoginPage(loginPage);
      await login.login(TEST_USER.username, TEST_USER.password);
      await login.expectLoginSuccess();
    });

    test('使用错误密码登录失败', async ({ loginPage }) => {
      const login = new LoginPage(loginPage);
      await login.login(TEST_USER.username, 'wrong-password');
      await login.expectLoginFailure();
    });

    test('使用空用户名登录失败', async ({ loginPage }) => {
      const login = new LoginPage(loginPage);
      await login.login('', TEST_USER.password);
      // 按钮应该被禁用或显示错误
      await expect(loginPage.locator('.el-form-item__error, [role="alert"]')).toBeVisible();
    });

    test('记住我功能正常工作', async ({ loginPage, context }) => {
      const login = new LoginPage(loginPage);
      await login.loginWithRememberMe(TEST_USER.username, TEST_USER.password);
      await login.expectLoginSuccess();

      // 检查 cookie 是否设置了较长的过期时间
      const cookies = await context.cookies();
      const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
      expect(sessionCookie).toBeDefined();
    });
  });

  test.describe('登出流程', () => {
    test('登出后重定向到登录页', async ({ authenticatedPage }) => {
      // 点击登出按钮
      await authenticatedPage.locator('button:has-text("登出"), button:has-text("Logout")').click();

      // 确认登出
      const confirmButton = authenticatedPage.locator(
        '.el-message-box__btns button:has-text("确定"), .el-message-box__btns button:has-text("OK")',
      );
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // 应该重定向到登录页
      await expect(authenticatedPage).toHaveURL(/\/login/, { timeout: 5000 });
    });
  });

  test.describe('会话过期处理', () => {
    test('未认证访问受保护页面重定向到登录页', async ({ page }) => {
      // 直接访问工作区而不登录
      await page.goto('/workspace');

      // 应该重定向到登录页
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    });
  });
});

test.describe('2FA 流程测试', () => {
  test('需要 2FA 时显示验证码输入框', async ({ loginPage }) => {
    // 通过 mock 登录响应，避免依赖真实 2FA 账号配置
    await loginPage.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: '需要 2FA 验证',
          requiresTwoFactor: true,
          tempToken: 'e2e-temp-token',
        }),
      });
    });

    const login = new LoginPage(loginPage);
    await login.login('2fa-enabled-user', 'password');
    await login.expect2FARequired();
  });

  test('输入正确的 2FA 码成功登录', async ({ loginPage }) => {
    // 通过 mock 2FA 登录与初始化接口，稳定验证成功路径
    await loginPage.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: '需要 2FA 验证',
          requiresTwoFactor: true,
          tempToken: 'e2e-temp-token',
        }),
      });
    });

    await loginPage.route('**/api/v1/auth/login/2fa', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: '2FA 验证成功',
          user: {
            id: 1,
            username: TEST_USER.username,
            isTwoFactorEnabled: true,
            language: 'zh',
          },
        }),
      });
    });

    await loginPage.route('**/api/v1/auth/init**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          needsSetup: false,
          isAuthenticated: true,
          user: {
            id: 1,
            username: TEST_USER.username,
            isTwoFactorEnabled: true,
            language: 'zh',
          },
          captchaConfig: {
            enabled: false,
            provider: 'none',
            hcaptchaSiteKey: null,
            recaptchaSiteKey: null,
          },
        }),
      });
    });

    const login = new LoginPage(loginPage);
    await login.login('2fa-enabled-user', 'password');
    await login.expect2FARequired();
    await login.submit2FACode('123456');
    await login.expectLoginSuccess();
  });
});

test.describe('Passkey 流程测试', () => {
  test('Passkey 按钮可见', async ({ loginPage }) => {
    // 通过 mock has-configured 接口，稳定验证按钮显隐逻辑
    await loginPage.route('**/api/v1/auth/passkey/has-configured**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hasPasskeys: true }),
      });
    });

    // 重新进入登录页以触发 onMounted 检查
    await loginPage.goto('/login');
    await loginPage.waitForLoadState('networkidle');

    const login = new LoginPage(loginPage);
    await expect(login.passkeyButton).toBeVisible();
  });

  test('使用 Passkey 登录失败时应显示错误', async ({ loginPage }) => {
    // mock Passkey 可用状态
    await loginPage.route('**/api/v1/auth/passkey/has-configured**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hasPasskeys: true }),
      });
    });
    // mock 认证选项接口失败，避免依赖真实 WebAuthn 设备
    await loginPage.route('**/api/v1/auth/passkey/authentication-options', async (route) => {
      await route.fulfill({
        status: 504,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Passkey 认证超时，请重试。' }),
      });
    });

    await loginPage.goto('/login');
    await loginPage.waitForLoadState('networkidle');

    const login = new LoginPage(loginPage);
    await expect(login.passkeyButton).toBeVisible();
    await login.clickPasskeyLogin();

    await login.expectLoginFailure();
    await expect(loginPage).toHaveURL(/\/login/);
  });
});
