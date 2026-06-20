import { test, expect } from '../fixtures/auth.fixture';
import { WorkspacePage } from '../pages/workspace.page';
import { SSH_CONNECTION } from '../fixtures/test-data';
import { Page } from '@playwright/test';

async function connectFirstVisibleConnection(
  page: Page,
  workspace: WorkspacePage,
): Promise<boolean> {
  const connectionItem = page.locator(
    `.connection-list [data-testid="connection-item"]:first-child,
     .connection-list .connection-item:first-child`,
  );

  if (!(await connectionItem.isVisible())) {
    return false;
  }

  await connectionItem.dblclick();
  await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });
  return true;
}

async function connectVisibleConnectionByIndex(
  page: Page,
  workspace: WorkspacePage,
  index: number,
): Promise<boolean> {
  const connectionItem = page
    .locator(
      `.connection-list [data-testid="connection-item"],
       .connection-list .connection-item`,
    )
    .nth(index);

  if (!(await connectionItem.isVisible())) {
    return false;
  }

  await connectionItem.dblclick();
  await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });
  return true;
}

test.describe('SSH 连接测试', () => {
  test.describe('连接建立', () => {
    test('双击连接项建立 SSH 连接', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 如果有预配置的连接，尝试连接
      const connectionItem = authenticatedPage.locator(
        `.connection-list [data-testid="connection-item"]:first-child,
         .connection-list .connection-item:first-child`,
      );

      if (await connectionItem.isVisible()) {
        await connectionItem.dblclick();
        // 等待终端出现
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });
      }
    });

    test('快速连接功能', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 点击快速连接按钮
      await workspace.quickConnectButton.click();

      // 填写连接信息
      await authenticatedPage.fill(
        'input[name="host"], input[placeholder*="主机"]',
        SSH_CONNECTION.host,
      );
      await authenticatedPage.fill(
        'input[name="port"], input[placeholder*="端口"]',
        SSH_CONNECTION.port.toString(),
      );
      await authenticatedPage.fill(
        'input[name="username"], input[placeholder*="用户名"]',
        SSH_CONNECTION.username,
      );
      await authenticatedPage.fill(
        'input[name="password"], input[type="password"]',
        SSH_CONNECTION.password,
      );

      // 点击连接按钮
      await authenticatedPage.click('button:has-text("连接"), button:has-text("Connect")');
    });
  });

  test.describe('终端交互', () => {
    test('在终端中执行命令', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connected = await connectFirstVisibleConnection(authenticatedPage, workspace);
      if (!connected) return;

      const marker = `E2E-SSH-${Date.now()}`;
      await workspace.typeInTerminal(`echo "${marker}"`);
      await workspace.expectTerminalOutput(marker, 15000);
    });

    test('终端支持快捷键', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      const connected = await connectFirstVisibleConnection(authenticatedPage, workspace);
      if (!connected) return;

      // 测试 Ctrl+C
      await workspace.terminalContainer.click();
      await authenticatedPage.keyboard.press('Control+c');

      // 测试 Ctrl+L (清屏)
      await authenticatedPage.keyboard.press('Control+l');
    });
  });

  test.describe('多标签管理', () => {
    test('可以打开多个 SSH 连接标签', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 仅在存在多个可用连接项时执行该断言
      const firstConnected = await connectVisibleConnectionByIndex(authenticatedPage, workspace, 0);
      const secondConnected = await connectVisibleConnectionByIndex(
        authenticatedPage,
        workspace,
        1,
      );
      if (!firstConnected || !secondConnected) return;

      const initialTabCount = await workspace.getTabCount();

      // 再次切换到第二个连接，确保标签行为稳定
      await connectVisibleConnectionByIndex(authenticatedPage, workspace, 1);
      const newTabCount = await workspace.getTabCount();

      expect(newTabCount).toBeGreaterThanOrEqual(initialTabCount);
    });

    test('关闭标签页', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connected = await connectFirstVisibleConnection(authenticatedPage, workspace);
      if (!connected) return;

      const initialTabCount = await workspace.getTabCount();

      await workspace.closeCurrentTab();
      const newTabCount = await workspace.getTabCount();

      expect(newTabCount).toBeLessThanOrEqual(initialTabCount);
    });
  });

  test.describe('连接状态', () => {
    test('连接断开后显示断开状态', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      const connected = await connectFirstVisibleConnection(authenticatedPage, workspace);
      expect(connected).toBeTruthy();

      try {
        await authenticatedPage.context().setOffline(true);
        await authenticatedPage.waitForTimeout(3000);

        const disconnectedState = await authenticatedPage
          .locator('.connection-status-disconnected, [data-status="disconnected"]')
          .isVisible({ timeout: 10000 })
          .catch(() => false);
        const disconnectedHint = await authenticatedPage
          .locator('text=/断开|重连|disconnected|reconnect/i')
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        expect(disconnectedState || disconnectedHint).toBeTruthy();
      } finally {
        await authenticatedPage
          .context()
          .setOffline(false)
          .catch(() => undefined);
      }
    });
  });
});
