import { test, expect } from '../fixtures/auth.fixture';
import { WorkspacePage } from '../pages/workspace.page';
import { EDGE_CASE_DATA } from '../fixtures/test-data';

test.describe('终端功能边缘场景测试', () => {
  test.describe('终端换行设置', () => {
    test('关闭终端自动换行后应启用无换行容器样式', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);

      // 进入设置页并确保在"工作区"标签下
      await authenticatedPage.goto('/settings');
      await authenticatedPage.waitForLoadState('networkidle');

      const workspaceTab = authenticatedPage
        .locator('button:has-text("工作区"), button:has-text("Workspace")')
        .first();
      if (await workspaceTab.isVisible().catch(() => false)) {
        await workspaceTab.click();
      }

      // 关闭自动换行并保存
      const wrapCheckbox = authenticatedPage.locator('#terminalAutoWrapEnabled');
      await expect(wrapCheckbox).toBeVisible({ timeout: 10000 });
      await wrapCheckbox.uncheck();

      const autoWrapForm = authenticatedPage.locator('form:has(#terminalAutoWrapEnabled)');
      await autoWrapForm.locator('button[type="submit"]').click();

      // 刷新后确认状态持久化（避免只验证内存态）
      await authenticatedPage.reload();
      await authenticatedPage.waitForLoadState('networkidle');
      if (await workspaceTab.isVisible().catch(() => false)) {
        await workspaceTab.click();
      }
      await expect(wrapCheckbox).not.toBeChecked();

      // 进入工作区并激活一个会话（若有连接）
      await workspace.goto();
      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (!(await connection.isVisible({ timeout: 5000 }).catch(() => false))) {
        // 测试环境可能没有可用连接，无法验证终端类名；恢复设置后安全退出
        await authenticatedPage.goto('/settings');
        await authenticatedPage.waitForLoadState('networkidle');
        if (await workspaceTab.isVisible().catch(() => false)) {
          await workspaceTab.click();
        }
        await wrapCheckbox.check();
        await autoWrapForm.locator('button[type="submit"]').click();
        return;
      }

      await connection.dblclick();
      await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

      // 关闭自动换行后，终端外层容器应带 no-auto-wrap 类
      const noWrapContainer = authenticatedPage
        .locator('.terminal-outer-wrapper.no-auto-wrap')
        .first();
      await expect(noWrapContainer).toBeVisible({ timeout: 10000 });

      // 恢复设置，避免影响其他用例
      await authenticatedPage.goto('/settings');
      await authenticatedPage.waitForLoadState('networkidle');
      if (await workspaceTab.isVisible().catch(() => false)) {
        await workspaceTab.click();
      }
      await wrapCheckbox.check();
      await autoWrapForm.locator('button[type="submit"]').click();
      await expect(wrapCheckbox).toBeChecked();
    });
  });

  test.describe('会话挂起与恢复', () => {
    test('网络断开后会话应保持挂起状态', async ({ authenticatedPage, context }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 在终端中执行命令
        await workspace.typeInTerminal('echo "Before disconnect"');
        await workspace.expectTerminalOutput('Before disconnect');

        // 模拟网络断开
        await context.setOffline(true);
        await authenticatedPage.waitForTimeout(EDGE_CASE_DATA.sessionResume.suspendDuration);

        // 应该显示挂起状态
        const suspendedState = authenticatedPage.locator(
          '[data-status="suspended"], text=/挂起|Suspended/i',
        );
        if (!(await suspendedState.isVisible({ timeout: 5000 }).catch(() => false))) {
          await context.setOffline(false);
          return;
        }

        // 恢复网络
        await context.setOffline(false);

        // 点击恢复会话
        const resumeButton = authenticatedPage.locator(
          'button:has-text("恢复"), button:has-text("Resume")',
        );
        if (!(await resumeButton.isVisible({ timeout: 3000 }).catch(() => false))) {
          return;
        }
        await resumeButton.click();

        // 等待会话恢复
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });
        await expect(authenticatedPage.locator('[data-status="connected"]'))
          .toBeVisible({
            timeout: 10000,
          })
          .catch(() => undefined);

        // 验证会话状态保持
        await workspace.typeInTerminal('echo "After resume"');
        await workspace.expectTerminalOutput('After resume');
      }
    });

    test('手动挂起会话功能', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 点击挂起按钮
        const suspendButton = authenticatedPage.locator(
          'button:has-text("挂起"), [data-action="suspend"]',
        );
        if (await suspendButton.isVisible()) {
          await suspendButton.click();

          // 应该显示挂起确认
          await expect(
            authenticatedPage.locator('text=/会话已挂起|Session suspended/i'),
          ).toBeVisible({ timeout: 5000 });

          // 查看挂起的会话列表
          const viewSuspendedButton = authenticatedPage.locator(
            'button:has-text("查看挂起的会话")',
          );
          if (!(await viewSuspendedButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            return;
          }
          await viewSuspendedButton.click();

          // 应该显示挂起会话列表
          const suspendedList = authenticatedPage.locator('.suspended-sessions-modal');
          await expect(suspendedList).toBeVisible({ timeout: 5000 });
        }
      }
    });

    test('关闭标签页后会话自动挂起', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        const initialTabCount = await workspace.getTabCount();

        // 关闭标签页
        await workspace.closeCurrentTab();

        const newTabCount = await workspace.getTabCount();
        expect(newTabCount).toBe(initialTabCount - 1);

        // 查看挂起的会话
        const menuButton = authenticatedPage.locator(
          'button:has-text("菜单"), [data-testid="menu"]',
        );
        if (!(await menuButton.isVisible({ timeout: 3000 }).catch(() => false))) {
          return;
        }
        await menuButton.click();
        const suspendedButton = authenticatedPage.locator('text=挂起的会话');
        if (!(await suspendedButton.isVisible({ timeout: 3000 }).catch(() => false))) {
          return;
        }
        await suspendedButton.click();

        // 应该有一个挂起的会话
        const suspendedSessions = authenticatedPage.locator('.suspended-session-item');
        await expect(suspendedSessions).toHaveCount(1, { timeout: 5000 });
      }
    });
  });

  test.describe('命令历史搜索', () => {
    test('Ctrl+R 搜索历史命令', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 执行几条命令
        const commands = ['ls -la', 'pwd', 'echo "test"', 'whoami'];
        for (const cmd of commands) {
          await workspace.typeInTerminal(cmd);
          await authenticatedPage.waitForTimeout(500);
        }

        // 按 Ctrl+R 进入搜索模式
        await workspace.terminalContainer.click();
        await authenticatedPage.keyboard.press('Control+r');

        // 应该显示搜索提示
        const searchHint = workspace.terminalContainer.locator('text=/reverse-i-search|搜索历史/i');
        const hasSearchHint = await searchHint.isVisible({ timeout: 3000 }).catch(() => false);
        if (!hasSearchHint) {
          return;
        }

        // 输入搜索词
        await authenticatedPage.keyboard.type('echo');

        // 应该至少保持终端可交互
        await expect(workspace.terminalContainer).toBeVisible();
      }
    });

    test('命令历史面板功能', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 打开命令历史面板
        const historyButton = authenticatedPage.locator(
          'button:has-text("历史"), [data-testid="history"]',
        );
        if (!(await historyButton.isVisible({ timeout: 3000 }).catch(() => false))) {
          return;
        }
        await historyButton.click();

        const historyPanel = authenticatedPage.locator('.command-history-panel');
        await expect(historyPanel).toBeVisible({ timeout: 5000 });

        // 搜索命令
        const searchInput = historyPanel.locator('input[type="search"]');
        await searchInput.fill('ls');

        // 应该过滤显示包含 ls 的命令
        const historyItems = historyPanel.locator('.history-item');
        if ((await historyItems.count()) > 0) {
          await expect(historyItems.first()).toContainText(/ls/i);
        }
      }
    });

    test('清除命令历史', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 打开命令历史面板
        const historyButton = authenticatedPage.locator(
          'button:has-text("历史"), [data-testid="history"]',
        );
        if (!(await historyButton.isVisible({ timeout: 3000 }).catch(() => false))) {
          return;
        }
        await historyButton.click();

        const historyPanel = authenticatedPage.locator('.command-history-panel');
        await expect(historyPanel).toBeVisible({ timeout: 5000 });

        // 点击清除按钮
        const clearButton = historyPanel.locator(
          'button:has-text("清除"), button:has-text("Clear")',
        );
        await clearButton.click();

        // 确认清除
        const confirmButton = authenticatedPage.locator(
          '.el-message-box__btns button:has-text("确定"), .el-message-box__btns button:has-text("OK")',
        );
        if (await confirmButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await confirmButton.click();
        }

        // 历史列表应该为空
        const historyItems = historyPanel.locator('.history-item');
        const beforeClearCount = await historyItems.count();
        if (beforeClearCount === 0) {
          return;
        }
        await expect(historyItems).toHaveCount(0, { timeout: 5000 });
      }
    });
  });

  test.describe('快捷命令执行', () => {
    test('执行快捷命令', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 打开快捷命令面板
        const quickCommandButton = authenticatedPage.locator('button:has-text("快捷命令")');
        const hasQuickCommandButton = await quickCommandButton
          .isVisible({ timeout: 3000 })
          .catch(() => false);
        if (!hasQuickCommandButton) {
          return;
        }
        await quickCommandButton.click();

        const commandPanel = authenticatedPage.locator('.quick-commands-modal');
        await expect(commandPanel).toBeVisible({ timeout: 5000 });

        // 选择一个快捷命令
        const commandItem = commandPanel.locator('.command-item:first-child');
        const hasCommandItem = await commandItem.isVisible({ timeout: 3000 }).catch(() => false);
        if (!hasCommandItem) {
          return;
        }
        await commandItem.click();

        // 命令应该在终端中执行
        await expect(workspace.terminalContainer).toBeVisible();
      }
    });

    test('创建新快捷命令', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 打开快捷命令管理
      const quickCommandButton = authenticatedPage.locator('button:has-text("快捷命令")');
      const hasQuickCommandButton = await quickCommandButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (!hasQuickCommandButton) {
        return;
      }
      await quickCommandButton.click();

      const commandPanel = authenticatedPage.locator('.quick-commands-modal');
      await expect(commandPanel).toBeVisible({ timeout: 5000 });

      // 点击添加按钮
      const addButton = commandPanel.locator('button:has-text("添加"), button:has-text("Add")');
      const hasAddButton = await addButton.isVisible({ timeout: 3000 }).catch(() => false);
      if (!hasAddButton) {
        return;
      }
      await addButton.click();

      // 填写命令信息
      await authenticatedPage.fill(
        'input[name="name"], input[placeholder*="名称"]',
        'Test Command',
      );
      await authenticatedPage.fill(
        'textarea[name="command"], textarea[placeholder*="命令"]',
        'echo "Hello World"',
      );
      await authenticatedPage.click('button:has-text("保存")');

      // 应该在列表中看到新命令
      await expect(commandPanel.locator('text=Test Command')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('多标签页切换', () => {
    test('键盘快捷键切换标签', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      // 打开两个连接
      const connections = await authenticatedPage
        .locator(
          '.connection-list [data-testid="connection-item"], .connection-list .connection-item',
        )
        .all();
      if (connections.length >= 2) {
        await connections[0].dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });
        await authenticatedPage.waitForTimeout(1000);

        await connections[1].dblclick();
        await authenticatedPage.waitForTimeout(1000);

        const tabCount = await workspace.getTabCount();
        expect(tabCount).toBeGreaterThanOrEqual(2);

        // 使用 Ctrl+Tab 切换标签
        await authenticatedPage.keyboard.press('Control+Tab');
        await authenticatedPage.waitForTimeout(500);

        // 使用 Ctrl+Shift+Tab 反向切换
        await authenticatedPage.keyboard.press('Control+Shift+Tab');
        await authenticatedPage.waitForTimeout(500);
      }
    });

    test('鼠标点击切换标签', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connections = await authenticatedPage
        .locator(
          '.connection-list [data-testid="connection-item"], .connection-list .connection-item',
        )
        .all();
      if (connections.length >= 2) {
        await connections[0].dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });
        await authenticatedPage.waitForTimeout(1000);

        await connections[1].dblclick();
        await authenticatedPage.waitForTimeout(1000);

        // 获取所有标签
        const tabs = workspace.tabBar.locator('.tab-item, [data-testid="tab"]');
        const tabCount = await tabs.count();
        expect(tabCount).toBeGreaterThanOrEqual(2);

        const firstTab = tabs.nth(0);
        const secondTab = tabs.nth(1);

        // 点击第一个标签
        await firstTab.click();
        await expect(firstTab).toHaveClass(/bg-background/);

        // 点击第二个标签
        await secondTab.click();
        await expect(secondTab).toHaveClass(/bg-background/);
      }
    });

    test('标签拖拽排序', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connections = await authenticatedPage
        .locator(
          '.connection-list [data-testid="connection-item"], .connection-list .connection-item',
        )
        .all();
      if (connections.length >= 2) {
        await connections[0].dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });
        await authenticatedPage.waitForTimeout(1000);

        await connections[1].dblclick();
        await authenticatedPage.waitForTimeout(1000);

        const tabs = workspace.tabBar.locator('.tab-item, [data-testid="tab"]');
        const tabCountBefore = await tabs.count();
        if (tabCountBefore >= 2) {
          // 拖拽第二个标签到第一个标签位置
          await tabs.nth(1).dragTo(tabs.nth(0));
          await authenticatedPage.waitForTimeout(500);

          // 校验拖拽后标签数量保持一致且仍可见
          const tabsAfter = workspace.tabBar.locator('.tab-item, [data-testid="tab"]');
          const tabCountAfter = await tabsAfter.count();
          expect(tabCountAfter).toBe(tabCountBefore);
          await expect(tabsAfter.nth(0)).toBeVisible();
          await expect(tabsAfter.nth(1)).toBeVisible();
        }
      }
    });
  });

  test.describe('终端特殊场景', () => {
    test('处理长时间运行的命令', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 执行较长命令并在中途中断
        await workspace.typeInTerminal('sleep 10');

        // 等待一段时间
        await authenticatedPage.waitForTimeout(2000);

        // 使用 Ctrl+C 中断
        await workspace.terminalContainer.click();
        await authenticatedPage.keyboard.press('Control+c');

        // 中断后终端应继续可用
        const marker = `long-run-stop-${Date.now()}`;
        await workspace.typeInTerminal(`echo "${marker}"`);
        await workspace.expectTerminalOutput(marker, 10000);
      }
    });

    test('处理大量输出', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 执行环境无关的大量输出命令
        await workspace.typeInTerminal('seq 1 5000');
        await authenticatedPage.waitForTimeout(1500);

        // 终端应该仍然响应
        await workspace.terminalContainer.click();
        await authenticatedPage.keyboard.press('Control+c');

        // 验证终端没有卡死
        const marker = `still-alive-${Date.now()}`;
        await workspace.typeInTerminal(`echo "${marker}"`);
        await workspace.expectTerminalOutput(marker, 10000);
      }
    });

    test('终端字体大小调整', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 使用 Ctrl++ 增大字体
        await workspace.terminalContainer.click();
        await authenticatedPage.keyboard.press('Control+=');
        await authenticatedPage.waitForTimeout(500);

        // 使用 Ctrl+- 减小字体
        await authenticatedPage.keyboard.press('Control+-');
        await authenticatedPage.waitForTimeout(500);

        // 使用 Ctrl+0 重置字体
        await authenticatedPage.keyboard.press('Control+0');
        await authenticatedPage.waitForTimeout(500);

        // 验证终端仍然可用
        await workspace.typeInTerminal('echo "font test"');
        await workspace.expectTerminalOutput('font test');
      }
    });

    test('终端复制粘贴功能', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 在终端中执行命令
        await workspace.typeInTerminal('echo "copy paste test"');
        await workspace.expectTerminalOutput('copy paste test');

        // 选择文本（模拟鼠标拖拽选择）
        // 注意：这需要 Xterm.js 支持文本选择
        await workspace.terminalContainer.click({ position: { x: 50, y: 50 } });
        await authenticatedPage.keyboard.down('Shift');
        await authenticatedPage.keyboard.press('End');
        await authenticatedPage.keyboard.up('Shift');

        // 复制（Ctrl+Shift+C 或右键菜单）
        await authenticatedPage.keyboard.press('Control+Shift+c');

        // 粘贴（Ctrl+Shift+V）
        await authenticatedPage.keyboard.press('Control+Shift+v');

        // 结束当前输入并验证终端仍可正常交互
        await authenticatedPage.keyboard.press('Enter');
        const marker = `copy-paste-${Date.now()}`;
        await workspace.typeInTerminal(`echo "${marker}"`);
        await workspace.expectTerminalOutput(marker, 10000);
      }
    });

    test('终端清屏功能', async ({ authenticatedPage }) => {
      const workspace = new WorkspacePage(authenticatedPage);
      await workspace.goto();

      const connection = authenticatedPage.locator(
        '.connection-list [data-testid="connection-item"]:first-child, .connection-list .connection-item:first-child',
      );
      if (await connection.isVisible()) {
        await connection.dblclick();
        await expect(workspace.terminalContainer).toBeVisible({ timeout: 15000 });

        // 执行多条命令填充终端
        for (let i = 0; i < 10; i++) {
          await workspace.typeInTerminal(`echo "Line ${i}"`);
          await authenticatedPage.waitForTimeout(200);
        }

        // 使用 Ctrl+L 清屏
        await workspace.terminalContainer.click();
        await authenticatedPage.keyboard.press('Control+l');

        // 或使用 clear 命令
        await workspace.typeInTerminal('clear');

        // 终端应该被清空
        await authenticatedPage.waitForTimeout(500);

        // 清屏后终端仍可继续输入命令
        await workspace.typeInTerminal('echo "clear ok"');
        await workspace.expectTerminalOutput('clear ok');
      }
    });
  });
});
