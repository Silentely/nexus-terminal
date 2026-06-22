import { test, expect, TEST_USER } from '../fixtures/auth.fixture';
import { LoginPage } from '../pages/login.page';
import { TWO_FACTOR_AUTH } from '../fixtures/test-data';
import { generateTOTP } from '../utils/totp';

test.describe('认证边缘场景测试', () => {
  test.describe('登录失败场景', () => {
    test('连续登录失败不应导致应用崩溃', async ({ loginPage }) => {
      const login = new LoginPage(loginPage);

      // 连续3次失败登录
      for (let i = 0; i < 3; i++) {
        await login.login(TEST_USER.username, `wrong-password-${i}`);
        await login.expectLoginFailure();
      }

      // 验证表单仍然可用
      await expect(login.usernameInput).toBeEnabled();
      await expect(login.passwordInput).toBeEnabled();
      await expect(login.loginButton).toBeEnabled();
    });

    test('使用特殊字符的密码正常工作', async ({ loginPage }) => {
      const login = new LoginPage(loginPage);
      const specialPassword = '!@#$%^&*()_+-=[]{}|;:,.<>?~`';

      await login.login(TEST_USER.username, specialPassword);
      // 预期失败但不应崩溃
      await login.expectLoginFailure();
    });

    test('用户名大小写敏感检查', async ({ loginPage }) => {
      const login = new LoginPage(loginPage);

      // 使用大写用户名
      await login.login(TEST_USER.username.toUpperCase(), TEST_USER.password);

      // 根据系统配置，可能成功或失败，但不应崩溃
      const success = await loginPage
        .waitForURL(/\/(workspace|dashboard)/, { timeout: 3000 })
        .catch(() => false);
      if (!success) {
        await login.expectLoginFailure();
      }
    });

    test('SQL 注入尝试应被安全处理', async ({ loginPage }) => {
      const login = new LoginPage(loginPage);
      const sqlInjection = "admin' OR '1'='1";

      await login.login(sqlInjection, 'password');
      await login.expectLoginFailure();
    });

    test('XSS 尝试应被过滤', async ({ loginPage }) => {
      const login = new LoginPage(loginPage);
      const xssPayload = '<script>alert("XSS")</script>';

      await login.login(xssPayload, 'password');
      await login.expectLoginFailure();

      // 验证没有执行脚本
      const alerts = await loginPage.evaluate(() => {
        return window.document.querySelectorAll('script').length;
      });
      expect(alerts).toBe(0);
    });
  });

  test.describe('2FA 边缘场景', () => {
    test('2FA 验证码过期处理', async ({ loginPage }) => {
      // 通过 mock 2FA 登录流程，稳定验证过期验证码行为
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
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            message: '验证码无效或已过期。',
          }),
        });
      });

      const login = new LoginPage(loginPage);
      await login.login('2fa-enabled-user', 'password');
      await login.expect2FARequired();

      // 使用过期的验证码（60秒前的）
      const expiredCode = '000000';
      await login.submit2FACode(expiredCode);

      // 应该显示错误
      await login.expectLoginFailure();
    });

    test('2FA 验证码格式验证', async ({ loginPage }) => {
      // 通过 mock 2FA 登录流程，稳定验证非法格式提交后的错误提示
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
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            message: '验证码格式不正确。',
          }),
        });
      });

      const login = new LoginPage(loginPage);
      await login.login('2fa-enabled-user', 'password');
      await login.expect2FARequired();

      // 尝试无效格式
      await login.submit2FACode('abc123');

      // 应显示错误并保留在 2FA 输入状态
      await login.expectLoginFailure();
      await expect(login.twoFactorInput).toBeVisible();
    });

    test('2FA 连续失败尝试', async ({ loginPage }) => {
      // 通过 mock 2FA 验证接口返回序列，稳定验证锁定提示
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

      let verifyAttempts = 0;
      await loginPage.route('**/api/v1/auth/login/2fa', async (route) => {
        verifyAttempts += 1;
        const isLocked = verifyAttempts >= 5;
        await route.fulfill({
          status: isLocked ? 429 : 401,
          contentType: 'application/json',
          body: JSON.stringify({
            message: isLocked ? '账户已锁定，请稍后再试。' : '验证码错误。',
          }),
        });
      });

      const login = new LoginPage(loginPage);
      await login.login('2fa-enabled-user', 'password');
      await login.expect2FARequired();

      // 连续5次错误验证码
      for (let i = 0; i < 5; i++) {
        await login.submit2FACode('123456');
        if (i < 4) {
          await expect(login.errorMessage).toBeVisible();
        }
      }

      // 可能触发账户锁定或冷却时间
      await expect(loginPage.locator('text=/锁定|冷却|暂时禁用/i')).toBeVisible({ timeout: 5000 });
    });

    test('2FA 正确验证码但会话已过期', async ({ loginPage, context }) => {
      // 通过 mock 2FA 登录流程，稳定验证会话过期处理
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
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            message: '会话已过期，请重新登录。',
          }),
        });
      });

      const login = new LoginPage(loginPage);
      await login.login('2fa-enabled-user', 'password');
      await login.expect2FARequired();

      // 清除会话 cookie
      await context.clearCookies();

      // 生成有效的 TOTP
      const validCode = generateTOTP(TWO_FACTOR_AUTH.secret);
      await login.submit2FACode(validCode);

      // 应该返回登录页或显示错误
      await expect(loginPage).toHaveURL(/\/login/, { timeout: 5000 });
      await login.expectLoginFailure();
    });
  });

  test.describe('会话管理边缘场景', () => {
    test('会话过期后访问受保护资源重定向到登录页', async ({ authenticatedPage, context }) => {
      // 清除会话
      await context.clearCookies();

      // 尝试访问工作区
      await authenticatedPage.goto('/workspace');

      // 应该重定向到登录页
      await expect(authenticatedPage).toHaveURL(/\/login/, { timeout: 5000 });
    });

    test('同时打开多个标签页时会话同步', async ({ authenticatedPage, context }) => {
      // 打开第二个标签页
      const secondPage = await context.newPage();
      await secondPage.goto('/workspace');

      // 验证两个页面都已认证
      await expect(authenticatedPage).toHaveURL(/\/(workspace|dashboard)/);
      await expect(secondPage).toHaveURL(/\/(workspace|dashboard)/);

      // 在第一个页面登出
      await authenticatedPage.locator('button:has-text("登出")').click();
      const confirmButton = authenticatedPage.locator(
        '.el-message-box__btns button:has-text("确定")',
      );
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // 等待登出完成
      await expect(authenticatedPage).toHaveURL(/\/login/, { timeout: 5000 });

      // 刷新第二个页面，应该也被登出
      await secondPage.reload();
      await expect(secondPage).toHaveURL(/\/login/, { timeout: 5000 });

      await secondPage.close();
    });

    test('网络断开后恢复时会话仍然有效', async ({ authenticatedPage, context }) => {
      // 验证已登录
      await expect(authenticatedPage).toHaveURL(/\/(workspace|dashboard)/);

      // 模拟网络断开
      await context.setOffline(true);
      await authenticatedPage.waitForTimeout(2000);

      // 恢复网络
      await context.setOffline(false);

      // 刷新页面
      await authenticatedPage.reload();

      // 会话应该仍然有效
      await expect(authenticatedPage).toHaveURL(/\/(workspace|dashboard)/, { timeout: 10000 });
    });

    test('"记住我" 功能在浏览器重启后仍有效', async ({ page, context }) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.loginWithRememberMe(TEST_USER.username, TEST_USER.password);
      await login.expectLoginSuccess();

      // 获取当前 cookies
      const cookies = await context.cookies();

      // 关闭浏览器上下文并创建新的
      const newContext = await page
        .context()
        .browser()
        ?.newContext({
          storageState: {
            cookies,
            origins: [],
          },
        });

      if (newContext) {
        const newPage = await newContext.newPage();
        await newPage.goto('/workspace');

        // 应该仍然保持登录状态
        await expect(newPage).toHaveURL(/\/(workspace|dashboard)/, { timeout: 5000 });

        await newPage.close();
        await newContext.close();
      }
    });
  });

  test.describe('Passkey 边缘场景', () => {
    test('Passkey 不可用时的降级处理', async ({ loginPage, context }) => {
      const login = new LoginPage(loginPage);

      // 模拟后端声明 Passkey 可用
      await loginPage.route('**/api/v1/auth/passkey/has-configured**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ hasPasskeys: true }),
        });
      });
      await loginPage.route('**/api/v1/auth/passkey/authentication-options', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ challenge: 'e2e-mock-challenge' }),
        });
      });

      // 模拟浏览器 WebAuthn API 不可用
      await context.addInitScript(() => {
        Object.defineProperty(window.navigator, 'credentials', {
          configurable: true,
          value: undefined,
        });
      });

      await loginPage.reload();
      await loginPage.waitForLoadState('networkidle');

      // 降级策略：出现 Passkey 错误后仍可使用密码表单继续登录
      await expect(login.passkeyButton).toBeVisible();
      await login.clickPasskeyLogin();
      await login.expectLoginFailure();
      await expect(login.usernameInput).toBeVisible();
      await expect(login.passwordInput).toBeVisible();
    });

    test('Passkey 验证超时处理', async ({ loginPage }) => {
      const login = new LoginPage(loginPage);

      await loginPage.route('**/api/v1/auth/passkey/has-configured**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ hasPasskeys: true }),
        });
      });
      await loginPage.route('**/api/v1/auth/passkey/authentication-options', async (route) => {
        await route.fulfill({
          status: 504,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Passkey 验证超时' }),
        });
      });

      await loginPage.goto('/login');
      await loginPage.waitForLoadState('networkidle');
      await expect(login.passkeyButton).toBeVisible();
      await login.clickPasskeyLogin();

      await login.expectLoginFailure();
      await expect(login.errorMessage).toContainText(/超时|timeout|Passkey/i);
    });

    test('Passkey 验证失败后切换到密码登录', async ({ loginPage, context }) => {
      const login = new LoginPage(loginPage);

      await loginPage.route('**/api/v1/auth/passkey/has-configured**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ hasPasskeys: true }),
        });
      });
      // 返回最小化选项，触发前端进入 WebAuthn 流程
      await loginPage.route('**/api/v1/auth/passkey/authentication-options', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ challenge: 'e2e-mock-challenge' }),
        });
      });
      // 模拟 WebAuthn 拒绝（例如用户取消）
      await context.addInitScript(() => {
        const nav = window.navigator as Navigator & { credentials?: CredentialsContainer };
        const original = nav.credentials ?? {};
        const mocked = {
          ...original,
          get: async () => {
            throw new DOMException(
              'The operation either timed out or was not allowed.',
              'NotAllowedError',
            );
          },
        };
        Object.defineProperty(window.navigator, 'credentials', {
          configurable: true,
          writable: true,
          value: mocked,
        });
      });

      await loginPage.goto('/login');
      await loginPage.waitForLoadState('networkidle');
      await expect(login.passkeyButton).toBeVisible();
      await login.clickPasskeyLogin();
      await login.expectLoginFailure();

      // 应该能够切换回密码登录
      await expect(login.usernameInput).toBeVisible();
      await login.login(TEST_USER.username, TEST_USER.password);
      await login.expectLoginSuccess();
    });
  });

  test.describe('CSRF 保护', () => {
    test('缺少 CSRF token 的请求应被拒绝', async ({ loginPage, context }) => {
      const login = new LoginPage(loginPage);

      // 拦截登录请求并移除 CSRF token
      await context.route('**/api/v1/auth/login', (route) => {
        const request = route.request();
        const headers = request.headers();
        delete headers['x-csrf-token'];
        delete headers['csrf-token'];

        route.continue({ headers });
      });

      await login.login(TEST_USER.username, TEST_USER.password);

      // 应该失败
      await login.expectLoginFailure();
    });
  });

  test.describe('速率限制', () => {
    test('短时间内多次登录尝试应触发速率限制', async ({ loginPage }) => {
      // 通过 mock 登录接口返回序列，稳定验证前端限流提示
      let loginAttempts = 0;
      await loginPage.route('**/api/v1/auth/login', async (route) => {
        loginAttempts += 1;
        const rateLimited = loginAttempts >= 10;
        await route.fulfill({
          status: rateLimited ? 429 : 401,
          contentType: 'application/json',
          body: JSON.stringify({
            message: rateLimited ? 'Too many attempts' : 'Invalid credentials',
          }),
        });
      });

      const login = new LoginPage(loginPage);

      // 快速连续10次登录尝试
      for (let i = 0; i < 10; i++) {
        await login.login(TEST_USER.username, 'wrong-password');
        await loginPage.waitForTimeout(200);
      }

      // 应该显示速率限制错误
      await expect(
        loginPage.locator('text=/请稍后再试|Too many attempts|Rate limit/i'),
      ).toBeVisible({
        timeout: 5000,
      });
    });
  });
});
