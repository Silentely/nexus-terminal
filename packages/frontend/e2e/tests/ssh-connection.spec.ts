import { test, expect } from '../fixtures/auth.fixture';
import { WorkspacePage } from '../pages/workspace.page';
import { SSH_CONNECTION } from '../fixtures/test-data';

test.describe('SSH 连接测试', () => {
  test.describe('连接建立', () => {
    test('双击连接项建立 SSH 连接', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 如果有预配置的连接，尝试连接
      const connectionItem = authenticatedPage.locator(
        `.connection-list [data-testid="connection-item"]:first-child,
         .connection-list .connection-item:first-child`
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
        SSH_CONNECTION.host
      );
      await authenticatedPage.fill(
        'input[name="port"], input[placeholder*="端口"]',
        SSH_CONNECTION.port.toString()
      );
      await authenticatedPage.fill(
        'input[name="username"], input[placeholder*="用户名"]',
        SSH_CONNECTION.username
      );
      await authenticatedPage.fill(
        'input[name="password"], input[type="password"]',
        SSH_CONNECTION.password
      );

      // 点击连接按钮
      await authenticatedPage.click('button:has-text("连接"), button:has-text("Connect")');
    });
  });

  test.describe('终端交互', () => {
    test.skip('在终端中执行命令', async ({ authenticatedPage }) => {
      // 此测试需要有效的 SSH 连接
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 假设已有连接
      await workspace.connectToServer('Test Server');
      await workspace.typeInTerminal('echo "Hello E2E Test"');
      await workspace.expectTerminalOutput('Hello E2E Test');
    });

    test.skip('终端支持快捷键', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      await workspace.connectToServer('Test Server');

      // 测试 Ctrl+C
      await workspace.terminalContainer.click();
      await authenticatedPage.keyboard.press('Control+c');

      // 测试 Ctrl+L (清屏)
      await authenticatedPage.keyboard.press('Control+l');
    });
  });

  test.describe('多标签管理', () => {
    test.skip('可以打开多个 SSH 连接标签', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 打开第一个连接
      await workspace.connectToServer('Server 1');
      const initialTabCount = await workspace.getTabCount();

      // 打开第二个连接
      await workspace.connectToServer('Server 2');
      const newTabCount = await workspace.getTabCount();

      expect(newTabCount).toBe(initialTabCount + 1);
    });

    test.skip('关闭标签页', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      await workspace.connectToServer('Test Server');
      const initialTabCount = await workspace.getTabCount();

      await workspace.closeCurrentTab();
      const newTabCount = await workspace.getTabCount();

      expect(newTabCount).toBe(initialTabCount - 1);
    });
  });

  test.describe('连接状态', () => {
    test.skip('连接断开后显示断开状态', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();
      await workspace.connectToServer('Test Server');

      // 模拟网络断开
      await authenticatedPage.context().setOffline(true);

      // 应该显示断开状态
      await expect(
        authenticatedPage.locator('.connection-status-disconnected, [data-status="disconnected"]')
      ).toBeVisible({
        timeout: 30000,
      });

      // 恢复网络
      await authenticatedPage.context().setOffline(false);
    });
  });
});
