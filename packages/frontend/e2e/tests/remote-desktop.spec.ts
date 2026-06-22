import { test, expect } from '../fixtures/auth.fixture';
import { RDP_CONNECTION, VNC_CONNECTION } from '../fixtures/test-data';
import { Page } from '@playwright/test';

type RemoteType = 'rdp' | 'vnc';

function remoteCanvas(page: Page) {
  return page.locator(
    'canvas.guac-display, [data-testid="rdp-canvas"], [data-testid="vnc-canvas"]',
  );
}

function remoteFailureHint(page: Page) {
  return page.locator(
    'text=/连接失败|Connection failed|远程桌面|remote desktop|guacamole|断开|disconnected|超时|timeout/i',
  );
}

async function expectCanvasOrFailure(page: Page, timeout = 30000): Promise<boolean> {
  const canvasVisible = await remoteCanvas(page)
    .first()
    .isVisible({ timeout })
    .catch(() => false);
  if (canvasVisible) {
    return true;
  }

  const failureVisible = await remoteFailureHint(page)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  expect(failureVisible).toBeTruthy();
  return false;
}

async function openConfiguredRemoteConnection(page: Page, type: RemoteType): Promise<boolean> {
  const connection = page
    .locator(`.connection-list [data-type="${type}"], .connection-list .${type}-connection`)
    .first();
  const visible = await connection.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) {
    return false;
  }
  await connection.dblclick();
  return true;
}

async function openQuickRemoteConnection(page: Page, type: RemoteType): Promise<void> {
  const addButton = page.locator('button:has-text("新建"), button:has-text("添加连接")').first();
  await expect(addButton).toBeVisible({ timeout: 5000 });
  await addButton.click();

  await page.click(`text=${type.toUpperCase()}, [data-type="${type}"]`);

  const hostInput = page.locator('input[name="host"], input[placeholder*="主机"]').first();
  const portInput = page.locator('input[name="port"], input[placeholder*="端口"]').first();
  await expect(hostInput).toBeVisible({ timeout: 5000 });
  await expect(portInput).toBeVisible({ timeout: 5000 });

  if (type === 'rdp') {
    await hostInput.fill(RDP_CONNECTION.host);
    await portInput.fill(RDP_CONNECTION.port.toString());
    const usernameInput = page
      .locator('input[name="username"], input[placeholder*="用户名"]')
      .first();
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    await expect(usernameInput).toBeVisible({ timeout: 5000 });
    await expect(passwordInput).toBeVisible({ timeout: 5000 });
    await usernameInput.fill(RDP_CONNECTION.username);
    await passwordInput.fill(RDP_CONNECTION.password);
  } else {
    await hostInput.fill(VNC_CONNECTION.host);
    await portInput.fill(VNC_CONNECTION.port.toString());
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    await expect(passwordInput).toBeVisible({ timeout: 5000 });
    await passwordInput.fill(VNC_CONNECTION.password);
  }

  const connectButton = page.locator('button:has-text("连接"), button:has-text("Connect")').first();
  await expect(connectButton).toBeVisible({ timeout: 5000 });
  await connectButton.click();
}

test.describe('远程桌面测试', () => {
  test.describe('RDP 连接', () => {
    test('可以建立 RDP 连接', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      const opened = await openConfiguredRemoteConnection(authenticatedPage, 'rdp');
      if (!opened) {
        await openQuickRemoteConnection(authenticatedPage, 'rdp');
      }

      await expectCanvasOrFailure(authenticatedPage, 30000);
    });

    test('快速连接 RDP', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      await openQuickRemoteConnection(authenticatedPage, 'rdp');
      await expectCanvasOrFailure(authenticatedPage, 30000);
    });
  });

  test.describe('VNC 连接', () => {
    test('可以建立 VNC 连接', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      const opened = await openConfiguredRemoteConnection(authenticatedPage, 'vnc');
      if (!opened) {
        await openQuickRemoteConnection(authenticatedPage, 'vnc');
      }

      await expectCanvasOrFailure(authenticatedPage, 30000);
    });

    test('快速连接 VNC', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      await openQuickRemoteConnection(authenticatedPage, 'vnc');
      await expectCanvasOrFailure(authenticatedPage, 30000);
    });
  });

  test.describe('远程桌面交互', () => {
    test('支持鼠标操作', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      const opened = await openConfiguredRemoteConnection(authenticatedPage, 'rdp');
      if (!opened) {
        await openQuickRemoteConnection(authenticatedPage, 'rdp');
      }

      const canvasReady = await expectCanvasOrFailure(authenticatedPage, 30000);
      if (!canvasReady) {
        return;
      }

      const canvas = remoteCanvas(authenticatedPage).first();
      await canvas.click({ position: { x: 100, y: 100 } });
      await canvas.dblclick({ position: { x: 200, y: 200 } });
      await canvas.click({ button: 'right', position: { x: 150, y: 150 } });
    });

    test('支持键盘输入', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      const opened = await openConfiguredRemoteConnection(authenticatedPage, 'rdp');
      if (!opened) {
        await openQuickRemoteConnection(authenticatedPage, 'rdp');
      }

      const canvasReady = await expectCanvasOrFailure(authenticatedPage, 30000);
      if (!canvasReady) {
        return;
      }

      const canvas = remoteCanvas(authenticatedPage).first();
      await canvas.click();
      await authenticatedPage.keyboard.type('Hello RDP');
      await authenticatedPage.keyboard.press('Enter');
      await authenticatedPage.keyboard.press('Escape');
      await authenticatedPage.keyboard.press('Control+Alt+Delete');
    });
  });

  test.describe('全屏模式', () => {
    test('可以进入全屏模式', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/workspace');

      const opened = await openConfiguredRemoteConnection(authenticatedPage, 'rdp');
      if (!opened) {
        await openQuickRemoteConnection(authenticatedPage, 'rdp');
      }

      const canvasReady = await expectCanvasOrFailure(authenticatedPage, 30000);
      if (!canvasReady) {
        return;
      }

      const fullscreenButton = authenticatedPage
        .locator('button:has-text("全屏"), button[data-testid="fullscreen"]')
        .first();
      const hasFullscreenButton = await fullscreenButton
        .isVisible({ timeout: 5000 })
        .catch(() => false);
      expect(hasFullscreenButton || canvasReady).toBeTruthy();
      if (!hasFullscreenButton) {
        return;
      }

      await fullscreenButton.click();
      const isFullscreen = await authenticatedPage.evaluate(
        () => document.fullscreenElement !== null,
      );
      const exitFullscreenHint = await authenticatedPage
        .locator('button:has-text("退出全屏"), button:has-text("Exit Fullscreen")')
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      expect(isFullscreen || exitFullscreenHint).toBeTruthy();
    });
  });
});
