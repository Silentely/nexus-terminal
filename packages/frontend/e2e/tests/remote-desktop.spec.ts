import { test, expect } from '../fixtures/auth.fixture';
import { RDP_CONNECTION, VNC_CONNECTION } from '../fixtures/test-data';

test.describe('远程桌面测试', () => {
  test.describe('RDP 连接', () => {
    test.skip('可以建立 RDP 连接', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      // 查找 RDP 连接
      const rdpConnection = authenticatedPage.locator(
        `.connection-list [data-type="rdp"], .connection-list .rdp-connection`
      );

      if (await rdpConnection.isVisible()) {
        await rdpConnection.dblclick();

        // 等待 Guacamole 画布出现
        const guacCanvas = authenticatedPage.locator(
          'canvas.guac-display, [data-testid="rdp-canvas"]'
        );
        await expect(guacCanvas).toBeVisible({ timeout: 30000 });
      }
    });

    test.skip('快速连接 RDP', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      // 点击新建连接
      await authenticatedPage.click('button:has-text("新建"), button:has-text("添加连接")');

      // 选择 RDP 类型
      await authenticatedPage.click('text=RDP, [data-type="rdp"]');

      // 填写连接信息
      await authenticatedPage.fill('input[name="host"]', RDP_CONNECTION.host);
      await authenticatedPage.fill('input[name="port"]', RDP_CONNECTION.port.toString());
      await authenticatedPage.fill('input[name="username"]', RDP_CONNECTION.username);
      await authenticatedPage.fill('input[type="password"]', RDP_CONNECTION.password);

      // 点击连接
      await authenticatedPage.click('button:has-text("连接"), button:has-text("Connect")');

      // 等待连接建立
      const guacCanvas = authenticatedPage.locator('canvas.guac-display');
      await expect(guacCanvas).toBeVisible({ timeout: 30000 });
    });
  });

  test.describe('VNC 连接', () => {
    test.skip('可以建立 VNC 连接', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      // 查找 VNC 连接
      const vncConnection = authenticatedPage.locator(
        `.connection-list [data-type="vnc"], .connection-list .vnc-connection`
      );

      if (await vncConnection.isVisible()) {
        await vncConnection.dblclick();

        // 等待 Guacamole 画布出现
        const guacCanvas = authenticatedPage.locator(
          'canvas.guac-display, [data-testid="vnc-canvas"]'
        );
        await expect(guacCanvas).toBeVisible({ timeout: 30000 });
      }
    });

    test.skip('快速连接 VNC', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      // 点击新建连接
      await authenticatedPage.click('button:has-text("新建"), button:has-text("添加连接")');

      // 选择 VNC 类型
      await authenticatedPage.click('text=VNC, [data-type="vnc"]');

      // 填写连接信息
      await authenticatedPage.fill('input[name="host"]', VNC_CONNECTION.host);
      await authenticatedPage.fill('input[name="port"]', VNC_CONNECTION.port.toString());
      await authenticatedPage.fill('input[type="password"]', VNC_CONNECTION.password);

      // 点击连接
      await authenticatedPage.click('button:has-text("连接"), button:has-text("Connect")');

      // 等待连接建立
      const guacCanvas = authenticatedPage.locator('canvas.guac-display');
      await expect(guacCanvas).toBeVisible({ timeout: 30000 });
    });
  });

  test.describe('远程桌面交互', () => {
    test.skip('支持鼠标操作', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      // 假设已有 RDP 连接
      const rdpConnection = authenticatedPage.locator('.connection-list [data-type="rdp"]').first();
      await rdpConnection.dblclick();

      const guacCanvas = authenticatedPage.locator('canvas.guac-display');
      await expect(guacCanvas).toBeVisible({ timeout: 30000 });

      // 在画布上点击
      await guacCanvas.click({ position: { x: 100, y: 100 } });

      // 双击
      await guacCanvas.dblclick({ position: { x: 200, y: 200 } });

      // 右键点击
      await guacCanvas.click({ button: 'right', position: { x: 150, y: 150 } });
    });

    test.skip('支持键盘输入', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      const rdpConnection = authenticatedPage.locator('.connection-list [data-type="rdp"]').first();
      await rdpConnection.dblclick();

      const guacCanvas = authenticatedPage.locator('canvas.guac-display');
      await expect(guacCanvas).toBeVisible({ timeout: 30000 });

      // 点击画布获取焦点
      await guacCanvas.click();

      // 输入文本
      await authenticatedPage.keyboard.type('Hello RDP');

      // 测试特殊按键
      await authenticatedPage.keyboard.press('Enter');
      await authenticatedPage.keyboard.press('Escape');
      await authenticatedPage.keyboard.press('Control+Alt+Delete');
    });
  });

  test.describe('全屏模式', () => {
    test.skip('可以进入全屏模式', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      const rdpConnection = authenticatedPage.locator('.connection-list [data-type="rdp"]').first();
      await rdpConnection.dblclick();

      const guacCanvas = authenticatedPage.locator('canvas.guac-display');
      await expect(guacCanvas).toBeVisible({ timeout: 30000 });

      // 点击全屏按钮
      await authenticatedPage.click('button:has-text("全屏"), button[data-testid="fullscreen"]');

      // 验证进入全屏
      const isFullscreen = await authenticatedPage.evaluate(
        () => document.fullscreenElement !== null
      );
      expect(isFullscreen).toBe(true);
    });
  });
});
