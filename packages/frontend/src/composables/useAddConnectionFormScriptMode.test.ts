/**
 * composables/useAddConnectionFormScriptMode 单元测试
 * 覆盖脚本模式提交的解析错误处理、校验分支与成功路径
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, type Ref } from 'vue';
import { createScriptModeSubmit, type ScriptModeDeps } from './useAddConnectionFormScriptMode';
import type { TranslateFn } from '../types/i18n.types';

const t: TranslateFn = ((key: string, params?: Record<string, unknown>) => {
  // 简单支持 {var} 替换
  if (params) {
    return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), key);
  }
  return key;
}) as TranslateFn;

function makeDeps(partial: Partial<ScriptModeDeps> = {}): ScriptModeDeps {
  const scriptInputText = { value: '' };
  const deps: ScriptModeDeps = {
    scriptInputText,
    emit: vi.fn(),
    connectionsStore: { addConnection: vi.fn() } as unknown as ScriptModeDeps['connectionsStore'],
    proxiesStore: {} as unknown as ScriptModeDeps['proxiesStore'],
    tagsStore: { addTag: vi.fn() } as unknown as ScriptModeDeps['tagsStore'],
    sshKeysStore: {} as unknown as ScriptModeDeps['sshKeysStore'],
    uiNotificationsStore: {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      showInfo: vi.fn(),
      showWarning: vi.fn(),
    } as unknown as ScriptModeDeps['uiNotificationsStore'],
    proxies: ref([]) as Ref<
      Array<{ id: number; name: string; host: string; port: number; type: string }>
    >,
    tags: ref([]) as Ref<Array<{ id: number; name: string }>>,
    sshKeys: ref([]) as Ref<Array<{ id: number; name: string }>>,
    t,
  };
  return { ...deps, ...partial };
}

describe('createScriptModeSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('空脚本应提示错误', async () => {
    const deps = makeDeps();
    deps.scriptInputText.value = '   \n  ';
    const handler = createScriptModeSubmit(deps);

    await handler();
    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith(
      'connections.form.scriptModeEmpty',
    );
  });

  it('解析错误行应提示并停止', async () => {
    const deps = makeDeps();
    deps.scriptInputText.value = 'invalid-line-without-format';
    const handler = createScriptModeSubmit(deps);

    await handler();
    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith(
      expect.stringContaining('connections.form.scriptErrorInLine'),
    );
    expect(deps.connectionsStore.addConnection).not.toHaveBeenCalled();
  });

  it('缺用户名/主机时应提示', async () => {
    const deps = makeDeps();
    deps.scriptInputText.value = 'root@'; // 缺主机，parseScriptLine 返回错误
    const handler = createScriptModeSubmit(deps);

    await handler();
    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith(
      expect.stringContaining('connections.form.scriptErrorInLine'),
    );
  });

  it('非法端口应提示', async () => {
    const deps = makeDeps();
    deps.scriptInputText.value = 'root@10.0.0.1:99999'; // 端口越界，parseScriptLine 返回错误
    const handler = createScriptModeSubmit(deps);

    await handler();
    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith(
      expect.stringContaining('connections.form.scriptErrorInLine'),
    );
  });

  it('SSH 密码认证缺密码应提示', async () => {
    const deps = makeDeps();
    deps.scriptInputText.value = 'root@10.0.0.1 ssh'; // 无密码的 SSH，parseScriptLine 返回错误
    const handler = createScriptModeSubmit(deps);

    await handler();
    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith(
      expect.stringContaining('connections.form.scriptErrorInLine'),
    );
  });

  it('合法 SSH 行应创建连接并 emit', async () => {
    const deps = makeDeps();
    deps.scriptInputText.value = 'root@10.0.0.1:22 -p secret-pass';
    (deps.connectionsStore.addConnection as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const handler = createScriptModeSubmit(deps);

    await handler();

    expect(deps.connectionsStore.addConnection).toHaveBeenCalledTimes(1);
    const callArgs = (deps.connectionsStore.addConnection as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(callArgs.host).toBe('10.0.0.1');
    expect(callArgs.port).toBe(22);
    expect(callArgs.username).toBe('root');
    expect(callArgs.password).toBe('secret-pass');
    expect(deps.emit).toHaveBeenCalledWith('connection-added');
  });

  it('多行脚本应逐个创建', async () => {
    const deps = makeDeps();
    deps.scriptInputText.value = 'root@10.0.0.1 -p p1\nadmin@10.0.0.2 -p p2';
    (deps.connectionsStore.addConnection as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const handler = createScriptModeSubmit(deps);

    await handler();

    expect(deps.connectionsStore.addConnection).toHaveBeenCalledTimes(2);
  });

  it('RDP 类型应使用默认端口 3389', async () => {
    const deps = makeDeps();
    deps.scriptInputText.value = 'admin@10.0.0.3 -type RDP -p rdp-pass';
    (deps.connectionsStore.addConnection as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const handler = createScriptModeSubmit(deps);

    await handler();

    const callArgs = (deps.connectionsStore.addConnection as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(callArgs.port).toBe(3389);
    expect(callArgs.type).toBe('RDP');
  });
});
