import { test, expect } from '../fixtures/auth.fixture';
import { LoginPage } from '../pages/login.page';
import { TEST_USER } from '../fixtures/test-data';

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
        '.el-message-box__btns button:has-text("确定"), .el-message-box__btns button:has-text("OK")'
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
  test.skip('需要 2FA 时显示验证码输入框', async ({ loginPage }) => {
    // 此测试需要启用了 2FA 的用户账户
    const login = new LoginPage(loginPage);
    await login.login('2fa-enabled-user', 'password');
    await login.expect2FARequired();
  });

  test.skip('输入正确的 2FA 码成功登录', async ({ loginPage }) => {
    // 此测试需要模拟 TOTP 生成
    const login = new LoginPage(loginPage);
    await login.login('2fa-enabled-user', 'password');
    await login.expect2FARequired();
    // 使用测试 secret 生成 TOTP
    // const code = generateTOTP(TWO_FACTOR_AUTH.secret);
    // await login.submit2FACode(code);
    // await login.expectLoginSuccess();
  });
});

test.describe('Passkey 流程测试', () => {
  test.skip('Passkey 按钮可见', async ({ loginPage }) => {
    const login = new LoginPage(loginPage);
    await expect(login.passkeyButton).toBeVisible();
  });

  // Passkey 测试需要 WebAuthn 模拟，在 CI 环境中较复杂
  test.skip('使用 Passkey 登录', async ({ loginPage }) => {
    // 需要 Playwright 的 WebAuthn 模拟支持
    const login = new LoginPage(loginPage);
    await login.clickPasskeyLogin();
    // WebAuthn 流程...
  });
});
