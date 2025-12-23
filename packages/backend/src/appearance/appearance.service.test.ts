import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

vi.mock('./appearance.repository', () => ({
  getAppearanceSettings: vi.fn(),
  updateAppearanceSettings: vi.fn(),
}));

vi.mock('../terminal-themes/terminal-theme.repository', () => ({
  findThemeById: vi.fn(),
}));

const loadService = async () => {
  vi.resetModules();

  const service = await import('./appearance.service');
  const fs = (await import('fs/promises')).default as any;
  const axios = (await import('axios')).default as any;
  const appearanceRepository = await import('./appearance.repository');
  const terminalThemeRepository = await import('../terminal-themes/terminal-theme.repository');

  return { service, fs, axios, appearanceRepository, terminalThemeRepository };
};

describe('appearance.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it('getSettings 在蒙版透明度缺失时应提供默认值 0.5', async () => {
    const { service, appearanceRepository } = await loadService();
    (appearanceRepository.getAppearanceSettings as any).mockResolvedValueOnce({
      _id: 'global_appearance',
      terminalBackgroundOverlayOpacity: undefined,
    });

    const settings = await service.getSettings();
    expect(settings.terminalBackgroundOverlayOpacity).toBe(0.5);
  });

  it('updateSettings activeTerminalThemeId 类型非法时应抛错', async () => {
    const { service, appearanceRepository, terminalThemeRepository } = await loadService();

    await expect(service.updateSettings({ activeTerminalThemeId: '1' as any })).rejects.toThrow(
      '无效的终端主题 ID 类型'
    );
    expect(terminalThemeRepository.findThemeById).not.toHaveBeenCalled();
    expect(appearanceRepository.updateAppearanceSettings).not.toHaveBeenCalled();
  });

  it('updateSettings 指定不存在的终端主题时应抛错', async () => {
    const { service, appearanceRepository, terminalThemeRepository } = await loadService();
    (terminalThemeRepository.findThemeById as any).mockResolvedValueOnce(null);

    await expect(service.updateSettings({ activeTerminalThemeId: 123 })).rejects.toThrow(
      '验证终端主题 ID 时出错'
    );
    expect(appearanceRepository.updateAppearanceSettings).not.toHaveBeenCalled();
  });

  it('updateSettings 终端背景蒙版透明度超出范围应抛错', async () => {
    const { service, appearanceRepository } = await loadService();
    await expect(
      service.updateSettings({ terminalBackgroundOverlayOpacity: 2 as any })
    ).rejects.toThrow('无效的终端背景蒙版透明度');
    expect(appearanceRepository.updateAppearanceSettings).not.toHaveBeenCalled();
  });

  it('updateSettings remoteHtmlPresetsUrl 为空字符串时应归一化为 null', async () => {
    const { service, appearanceRepository } = await loadService();
    (appearanceRepository.updateAppearanceSettings as any).mockResolvedValueOnce(true);

    const ok = await service.updateSettings({ remoteHtmlPresetsUrl: '   ' } as any);
    expect(ok).toBe(true);
    expect(appearanceRepository.updateAppearanceSettings).toHaveBeenCalledWith({
      remoteHtmlPresetsUrl: null,
    });
  });

  it('removeTerminalBackground 在无文件路径时不应删除文件但应清空数据库字段', async () => {
    const { service, fs, appearanceRepository } = await loadService();
    (appearanceRepository.getAppearanceSettings as any).mockResolvedValueOnce({
      _id: 'global_appearance',
      terminalBackgroundImage: undefined,
      terminalBackgroundOverlayOpacity: 0.5,
    });
    (appearanceRepository.updateAppearanceSettings as any).mockResolvedValueOnce(true);

    const ok = await service.removeTerminalBackground();
    expect(ok).toBe(true);
    expect(fs.unlink).not.toHaveBeenCalled();
    expect(appearanceRepository.updateAppearanceSettings).toHaveBeenCalledWith({
      terminalBackgroundImage: '',
    });
  });

  it('removeTerminalBackground 删除文件 ENOENT 时仍应清空数据库字段', async () => {
    const { service, fs, appearanceRepository } = await loadService();
    (appearanceRepository.getAppearanceSettings as any).mockResolvedValueOnce({
      _id: 'global_appearance',
      terminalBackgroundImage: 'uploads/bg.png',
      terminalBackgroundOverlayOpacity: 0.5,
    });
    (fs.unlink as any).mockRejectedValueOnce({ code: 'ENOENT' });
    (appearanceRepository.updateAppearanceSettings as any).mockResolvedValueOnce(true);

    const ok = await service.removeTerminalBackground();
    expect(ok).toBe(true);
    expect(fs.unlink).toHaveBeenCalled();
    expect(appearanceRepository.updateAppearanceSettings).toHaveBeenCalledWith({
      terminalBackgroundImage: '',
    });
  });

  it('listPresetHtmlThemes 仅返回 .html 文件', async () => {
    const { service, fs } = await loadService();
    (fs.readdir as any).mockResolvedValueOnce(['a.html', 'b.txt', 'c.HTML']);
    const list = await service.listPresetHtmlThemes();
    expect(list).toEqual([{ name: 'a.html', type: 'preset' }]);
  });

  it('getPresetHtmlThemeContent 文件不存在时应抛出未找到错误', async () => {
    const { service, fs } = await loadService();
    (fs.readFile as any).mockRejectedValueOnce({ code: 'ENOENT' });
    await expect(service.getPresetHtmlThemeContent('missing.html')).rejects.toThrow('未找到');
  });

  it('listRemoteHtmlPresets 未提供 URL 且未保存时应抛错', async () => {
    const { service, appearanceRepository } = await loadService();
    (appearanceRepository.getAppearanceSettings as any).mockResolvedValueOnce({
      _id: 'global_appearance',
      remoteHtmlPresetsUrl: null,
      terminalBackgroundOverlayOpacity: 0.5,
    });
    await expect(service.listRemoteHtmlPresets()).rejects.toThrow('未提供远程仓库链接');
  });

  it('listRemoteHtmlPresets 成功时应仅返回远程 .html 文件', async () => {
    const { service, axios } = await loadService();
    (axios.get as any).mockResolvedValueOnce({
      status: 200,
      data: [
        { type: 'file', name: 'a.html', download_url: 'https://example.com/a.html' },
        { type: 'file', name: 'b.txt', download_url: 'https://example.com/b.txt' },
        { type: 'dir', name: 'sub' },
      ],
    });

    const list = await service.listRemoteHtmlPresets(
      'https://github.com/user/repo/tree/main/themes'
    );
    expect(list).toEqual([{ name: 'a.html', downloadUrl: 'https://example.com/a.html' }]);
    expect(axios.get).toHaveBeenCalled();
  });

  it('getRemoteHtmlPresetContent fileUrl 非 http/https 时应抛错', async () => {
    const { service } = await loadService();
    await expect(service.getRemoteHtmlPresetContent('file:///etc/passwd')).rejects.toThrow(
      'HTTP/HTTPS'
    );
  });

  it('createUserCustomHtmlTheme 主题已存在时应抛错', async () => {
    const { service, fs } = await loadService();
    (fs.access as any).mockResolvedValue(undefined);
    await expect(service.createUserCustomHtmlTheme('a.html', '<html />')).rejects.toThrow('已存在');
  });
});
