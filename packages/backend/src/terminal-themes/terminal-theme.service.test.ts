/**
 * Terminal Theme Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Terminal Theme Repository
vi.mock('./terminal-theme.repository', () => ({
    findAllThemes: vi.fn(),
    findThemeById: vi.fn(),
    createTheme: vi.fn(),
    updateTheme: vi.fn(),
    deleteTheme: vi.fn(),
}));

import * as terminalThemeRepository from './terminal-theme.repository';
import {
    getAllThemes,
    getThemeById,
    createNewTheme,
    updateExistingTheme,
    deleteExistingTheme,
    importTheme,
} from './terminal-theme.service';

describe('Terminal Theme Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    const mockTheme = {
        _id: '1',
        name: 'Dark Theme',
        themeData: {
            foreground: '#ffffff',
            background: '#000000',
            cursor: '#00ff00',
        },
        isPreset: false,
        isSystemDefault: false,
        createdAt: 1000,
        updatedAt: 1000,
    };

    describe('getAllThemes', () => {
        it('应返回所有终端主题', async () => {
            (terminalThemeRepository.findAllThemes as any).mockResolvedValueOnce([mockTheme]);

            const result = await getAllThemes();

            expect(result).toEqual([mockTheme]);
            expect(terminalThemeRepository.findAllThemes).toHaveBeenCalled();
        });

        it('无主题时应返回空数组', async () => {
            (terminalThemeRepository.findAllThemes as any).mockResolvedValueOnce([]);

            const result = await getAllThemes();

            expect(result).toHaveLength(0);
        });
    });

    describe('getThemeById', () => {
        it('应返回指定 ID 的主题', async () => {
            (terminalThemeRepository.findThemeById as any).mockResolvedValueOnce(mockTheme);

            const result = await getThemeById(1);

            expect(result).toEqual(mockTheme);
            expect(terminalThemeRepository.findThemeById).toHaveBeenCalledWith(1);
        });

        it('主题不存在时应返回 null', async () => {
            (terminalThemeRepository.findThemeById as any).mockResolvedValueOnce(null);

            const result = await getThemeById(999);

            expect(result).toBeNull();
        });

        it('无效 ID 应抛出异常', async () => {
            await expect(getThemeById(NaN)).rejects.toThrow('无效的主题 ID');
        });
    });

    describe('createNewTheme', () => {
        it('应成功创建新主题', async () => {
            (terminalThemeRepository.createTheme as any).mockResolvedValueOnce(mockTheme);

            const result = await createNewTheme({
                name: 'New Theme',
                themeData: {
                    foreground: '#ffffff',
                    background: '#000000',
                },
            });

            expect(result).toEqual(mockTheme);
            expect(terminalThemeRepository.createTheme).toHaveBeenCalled();
        });

        it('无效的主题数据格式应抛出异常', async () => {
            await expect(
                createNewTheme({
                    name: 'Test',
                    themeData: {} as any,
                })
            ).rejects.toThrow('无效的主题数据格式');

            await expect(
                createNewTheme({
                    name: 'Test',
                    themeData: { foreground: '#fff' } as any,
                })
            ).rejects.toThrow('无效的主题数据格式');
        });
    });

    describe('updateExistingTheme', () => {
        it('应成功更新主题', async () => {
            (terminalThemeRepository.updateTheme as any).mockResolvedValueOnce(true);

            const result = await updateExistingTheme(1, {
                name: 'Updated Theme',
                themeData: {
                    foreground: '#ffffff',
                    background: '#111111',
                },
            });

            expect(result).toBe(true);
            expect(terminalThemeRepository.updateTheme).toHaveBeenCalledWith(1, expect.any(Object));
        });

        it('无效 ID 应抛出异常', async () => {
            await expect(
                updateExistingTheme(NaN, {
                    name: 'Test',
                    themeData: { foreground: '#fff', background: '#000' },
                })
            ).rejects.toThrow('无效的主题 ID');
        });

        it('无效的更新数据应抛出异常', async () => {
            await expect(
                updateExistingTheme(1, {
                    name: '',
                    themeData: { foreground: '#fff', background: '#000' },
                })
            ).rejects.toThrow('无效的主题更新数据');

            await expect(
                updateExistingTheme(1, {
                    name: 'Test',
                    themeData: {} as any,
                })
            ).rejects.toThrow('无效的主题更新数据');
        });

        it('主题不存在时应返回 false', async () => {
            (terminalThemeRepository.updateTheme as any).mockResolvedValueOnce(false);

            const result = await updateExistingTheme(999, {
                name: 'Test',
                themeData: { foreground: '#fff', background: '#000' },
            });

            expect(result).toBe(false);
        });
    });

    describe('deleteExistingTheme', () => {
        it('应成功删除主题', async () => {
            (terminalThemeRepository.deleteTheme as any).mockResolvedValueOnce(true);

            const result = await deleteExistingTheme(1);

            expect(result).toBe(true);
            expect(terminalThemeRepository.deleteTheme).toHaveBeenCalledWith(1);
        });

        it('无效 ID 应抛出异常', async () => {
            await expect(deleteExistingTheme(NaN)).rejects.toThrow('无效的主题 ID');
        });

        it('主题不存在时应返回 false', async () => {
            (terminalThemeRepository.deleteTheme as any).mockResolvedValueOnce(false);

            const result = await deleteExistingTheme(999);

            expect(result).toBe(false);
        });
    });

    describe('importTheme', () => {
        it('应成功导入主题', async () => {
            (terminalThemeRepository.createTheme as any).mockResolvedValueOnce(mockTheme);

            const themeData = {
                foreground: '#ffffff',
                background: '#000000',
            };
            const result = await importTheme(themeData, 'Imported Theme');

            expect(result).toEqual(mockTheme);
            expect(terminalThemeRepository.createTheme).toHaveBeenCalledWith({
                name: 'Imported Theme',
                themeData,
            });
        });

        it('缺少名称应抛出异常', async () => {
            await expect(
                importTheme({ foreground: '#fff', background: '#000' }, '')
            ).rejects.toThrow('导入主题时必须提供名称');
        });

        it('无效的主题数据格式应抛出异常', async () => {
            await expect(
                importTheme({ foreground: '#fff' } as any, 'Test')
            ).rejects.toThrow('导入的主题数据格式无效');

            await expect(
                importTheme({} as any, 'Test')
            ).rejects.toThrow('导入的主题数据格式无效');
        });
    });
});
