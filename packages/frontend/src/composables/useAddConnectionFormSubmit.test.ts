/**
 * composables/useAddConnectionFormSubmit 单元测试
 * 覆盖连接表单提交的校验分支、批量 IP 创建、单条 CRUD 与删除
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed } from 'vue';
import {
  createSubmitHandler,
  createDeleteHandler,
  type SubmitDeps,
  type DeleteDeps,
} from './useAddConnectionFormSubmit';
import type { ConnectionInfo } from '../stores/connections.store';
import type { TranslateFn } from '../types/i18n.types';

const t: TranslateFn = ((key: string, ...args: unknown[]) => {
  const fallback = typeof args[0] === 'string' ? args[0] : undefined;
  return fallback || key;
}) as TranslateFn;

function makeBaseDeps(): Partial<SubmitDeps> & {
  connectionsStore: SubmitDeps['connectionsStore'];
  proxiesStore: SubmitDeps['proxiesStore'];
  uiNotificationsStore: SubmitDeps['uiNotificationsStore'];
} {
  return {
    formData: {
      type: 'SSH',
      name: 'web',
      host: '10.0.0.1',
      port: 22,
      username: 'root',
      auth_method: 'password',
      password: 'secret',
      selected_ssh_key_id: null,
      proxy_id: null,
      jump_chain: null,
      proxy_type: null,
      tag_ids: [],
      notes: '',
      vncPassword: '',
      force_keyboard_interactive: false,
    },
    isEditMode: computed(() => false),
    connectionToEdit: ref<ConnectionInfo | null>(null),
    isScriptModeActive: ref(false),
    handleScriptModeSubmit: vi.fn(),
    parseIpRange: vi.fn(),
    formError: ref<string | null>(null),
    connectionsStore: {
      error: null as string | null,
      addConnection: vi.fn(),
      updateConnection: vi.fn(),
      deleteConnection: vi.fn(),
    } as unknown as SubmitDeps['connectionsStore'],
    proxiesStore: { error: null as string | null } as unknown as SubmitDeps['proxiesStore'],
    uiNotificationsStore: {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      showWarning: vi.fn(),
      showInfo: vi.fn(),
    } as unknown as SubmitDeps['uiNotificationsStore'],
    tags: ref<Array<{ id: number }>>([]),
    emit: vi.fn() as unknown as SubmitDeps['emit'],
    t,
  };
}

function buildSubmitDeps(partial: Partial<SubmitDeps> = {}): SubmitDeps {
  const base = makeBaseDeps() as SubmitDeps;
  return { ...base, ...partial };
}

describe('createSubmitHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('脚本模式应委托给 handleScriptModeSubmit', async () => {
    const handleScriptModeSubmit = vi.fn();
    const deps = buildSubmitDeps({
      isScriptModeActive: computed(() => true),
      handleScriptModeSubmit,
    });
    const handler = createSubmitHandler(deps);

    await handler();
    expect(handleScriptModeSubmit).toHaveBeenCalledTimes(1);
  });

  it('缺少 host 或 username 时提示错误', async () => {
    const deps = buildSubmitDeps();
    deps.formData.host = '';
    const handler = createSubmitHandler(deps);

    await handler();
    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith(
      'connections.form.errorRequiredFields',
    );
  });

  it('端口越界时提示错误', async () => {
    const deps = buildSubmitDeps();
    deps.formData.port = 70000;
    const handler = createSubmitHandler(deps);

    await handler();
    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith('connections.form.errorPort');
  });

  it('新增 SSH 密码认证缺密码时提示（非 ~ 主机）', async () => {
    const deps = buildSubmitDeps();
    deps.formData.host = '10.0.0.1'; // 非 ~ 范围
    deps.formData.password = '';
    const handler = createSubmitHandler(deps);

    await handler();
    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith(
      'connections.form.errorPasswordRequired',
    );
  });

  it('新增 SSH 密钥认证缺密钥时提示', async () => {
    const deps = buildSubmitDeps();
    deps.formData.auth_method = 'key';
    deps.formData.selected_ssh_key_id = null;
    const handler = createSubmitHandler(deps);

    await handler();
    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith(
      'connections.form.errorSshKeyRequired',
    );
  });

  it('批量 IP（~ 范围）应逐个创建并发出 connection-added', async () => {
    const deps = buildSubmitDeps();
    deps.formData.host = '10.0.0.1~10.0.0.2';
    (deps.parseIpRange as ReturnType<typeof vi.fn>).mockReturnValue(['10.0.0.1', '10.0.0.2']);
    (deps.connectionsStore.addConnection as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const handler = createSubmitHandler(deps);

    await handler();

    expect(deps.connectionsStore.addConnection).toHaveBeenCalledTimes(2);
    expect(deps.uiNotificationsStore.showSuccess).toHaveBeenCalled();
    expect(deps.emit).toHaveBeenCalledWith('connection-added');
  });

  it('批量 IP 部分失败时显示警告并保留成功计数', async () => {
    const deps = buildSubmitDeps();
    deps.formData.host = '10.0.0.1~10.0.0.2';
    (deps.parseIpRange as ReturnType<typeof vi.fn>).mockReturnValue(['10.0.0.1', '10.0.0.2']);
    (deps.connectionsStore.addConnection as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const handler = createSubmitHandler(deps);

    await handler();

    expect(deps.uiNotificationsStore.showWarning).toHaveBeenCalled();
    expect(deps.emit).not.toHaveBeenCalledWith('connection-added');
  });

  it('单条新增成功应调用 addConnection 并 emit', async () => {
    const deps = buildSubmitDeps();
    (deps.connectionsStore.addConnection as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const handler = createSubmitHandler(deps);

    await handler();

    expect(deps.connectionsStore.addConnection).toHaveBeenCalledWith(
      expect.objectContaining({ host: '10.0.0.1', port: 22, username: 'root' }),
    );
    // 单条路径成功仅 emit，不显示成功通知
    expect(deps.uiNotificationsStore.showSuccess).not.toHaveBeenCalled();
    expect(deps.emit).toHaveBeenCalledWith('connection-added');
  });

  it('编辑模式更新成功应调用 updateConnection 并 emit', async () => {
    const deps = buildSubmitDeps({
      isEditMode: computed(() => true),
      connectionToEdit: ref<ConnectionInfo | null>({ id: 1 } as ConnectionInfo),
    });
    (deps.connectionsStore.updateConnection as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const handler = createSubmitHandler(deps);

    await handler();

    expect(deps.connectionsStore.updateConnection).toHaveBeenCalled();
    expect(deps.emit).toHaveBeenCalledWith('connection-updated');
  });

  it('编辑模式下 host 含 ~ 范围时提示不支持', async () => {
    const deps = buildSubmitDeps({
      isEditMode: computed(() => true),
      connectionToEdit: ref<ConnectionInfo | null>({ id: 1 } as ConnectionInfo),
    });
    deps.formData.host = '10.0.0.1~10.0.0.2';
    const handler = createSubmitHandler(deps);

    await handler();

    expect(deps.uiNotificationsStore.showError).toHaveBeenCalledWith(
      '编辑模式下不支持 IP 范围。请使用单个 IP 地址。',
    );
  });
});

describe('createDeleteHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeDeleteDeps = (partial: Partial<DeleteDeps> = {}): DeleteDeps => {
    const base: DeleteDeps = {
      isEditMode: computed(() => true),
      connectionToEdit: ref<ConnectionInfo | null>({ id: 1 } as ConnectionInfo),
      showConfirmDialog: vi.fn().mockResolvedValue(true),
      formError: ref<string | null>(null),
      connectionsStore: {
        deleteConnection: vi.fn().mockResolvedValue(true),
      } as unknown as DeleteDeps['connectionsStore'],
      uiNotificationsStore: {
        showError: vi.fn(),
        showSuccess: vi.fn(),
      } as unknown as DeleteDeps['uiNotificationsStore'],
      emit: vi.fn() as unknown as DeleteDeps['emit'],
      t,
    };
    return { ...base, ...partial };
  };

  it('确认后应删除连接并 emit connection-deleted', async () => {
    const deps = makeDeleteDeps();
    const handler = createDeleteHandler(deps);

    await handler();

    expect(deps.connectionsStore.deleteConnection).toHaveBeenCalledWith(1);
    expect(deps.emit).toHaveBeenCalledWith('connection-deleted');
    expect(deps.emit).toHaveBeenCalledWith('close');
  });

  it('取消确认时不应删除', async () => {
    const deps = makeDeleteDeps({ showConfirmDialog: vi.fn().mockResolvedValue(false) });
    const handler = createDeleteHandler(deps);

    await handler();

    expect(deps.connectionsStore.deleteConnection).not.toHaveBeenCalled();
  });

  it('非编辑模式无 connectionToEdit 时直接返回', async () => {
    const deps = makeDeleteDeps({
      isEditMode: computed(() => false),
      connectionToEdit: ref<ConnectionInfo | null>(null),
    });
    const handler = createDeleteHandler(deps);

    await handler();

    expect(deps.connectionsStore.deleteConnection).not.toHaveBeenCalled();
  });

  it('删除失败时显示错误', async () => {
    const deps = makeDeleteDeps({
      connectionsStore: {
        deleteConnection: vi.fn().mockResolvedValue(false),
      } as unknown as DeleteDeps['connectionsStore'],
    });
    const handler = createDeleteHandler(deps);

    await handler();

    expect(deps.uiNotificationsStore.showError).toHaveBeenCalled();
  });
});
