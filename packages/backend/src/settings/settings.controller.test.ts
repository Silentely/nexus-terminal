import { describe, it, expect, vi, beforeEach } from 'vitest';

import { settingsController } from './settings.controller';
import { settingsService } from './settings.service';

vi.mock('../audit/audit.service', () => ({
  AuditLogService: class {
    logAction = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('./settings.service', () => ({
  settingsService: {
    setMultipleSettings: vi.fn().mockResolvedValue(undefined),
    getAllSettings: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    deleteSetting: vi.fn(),
  },
}));

function createMockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('settingsController.updateSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('允许保存 terminalOutputEnhancerEnabled=false 并过滤未知键', async () => {
    const req: any = {
      body: {
        ipWhitelist: '127.0.0.1',
        terminalOutputEnhancerEnabled: 'false',
        notAllowedKey: 'should-be-filtered',
      },
    };
    const res = createMockRes();
    const next = vi.fn();

    await settingsController.updateSettings(req, res, next);

    expect(settingsService.setMultipleSettings as any).toHaveBeenCalledWith({
      ipWhitelist: '127.0.0.1',
      terminalOutputEnhancerEnabled: 'false',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: '设置已成功更新' });
    expect(next).not.toHaveBeenCalled();
  });
});
