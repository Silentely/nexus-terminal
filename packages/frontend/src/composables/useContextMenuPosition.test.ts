/**
 * composables/useContextMenuPosition 单元测试
 * 覆盖右键菜单的边界检测与位置修正逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { useContextMenuPosition } from './useContextMenuPosition';

function createMockMenuElement(rect: Partial<DOMRect>) {
  return {
    getBoundingClientRect: () =>
      ({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        ...rect,
      }) as DOMRect,
  } as unknown as HTMLElement;
}

describe('useContextMenuPosition', () => {
  beforeEach(() => {
    // 默认视口 1024x768
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('菜单位置初始为 (0,0) 且不可见', () => {
    const { position, visible } = useContextMenuPosition();
    expect(position.value).toEqual({ x: 0, y: 0 });
    expect(visible.value).toBe(false);
  });

  it('鼠标在视口内时应保持原始坐标', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(
      createMockMenuElement({ width: 200, height: 150 }),
    );
    const { calculateMenuPosition, position, visible } = useContextMenuPosition();

    calculateMenuPosition({ clientX: 100, clientY: 100 } as MouseEvent, '.menu');
    await nextTick();
    await nextTick();

    expect(visible.value).toBe(true);
    expect(position.value).toEqual({ x: 100, y: 100 });
  });

  it('菜单超出右边界时应向左修正', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(
      createMockMenuElement({ width: 300, height: 150 }),
    );
    const { calculateMenuPosition, position } = useContextMenuPosition();

    // 鼠标在 x=1000，菜单宽 300 → 1000+300 > 1024，应修正到 1024-300-5
    calculateMenuPosition({ clientX: 1000, clientY: 100 } as MouseEvent, '.menu');
    await nextTick();
    await nextTick();

    expect(position.value.x).toBe(1024 - 300 - 5);
    expect(position.value.y).toBe(100);
  });

  it('菜单超出底部时应向上修正', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(
      createMockMenuElement({ width: 200, height: 400 }),
    );
    const { calculateMenuPosition, position } = useContextMenuPosition();

    // 鼠标在 y=700，菜单高 400 → 700+400 > 768，应修正到 768-400-5
    calculateMenuPosition({ clientX: 100, clientY: 700 } as MouseEvent, '.menu');
    await nextTick();
    await nextTick();

    expect(position.value.y).toBe(768 - 400 - 5);
    expect(position.value.x).toBe(100);
  });

  it('负坐标（左上越界）应限制在边距内', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(
      createMockMenuElement({ width: 200, height: 150 }),
    );
    const { calculateMenuPosition, position } = useContextMenuPosition();

    calculateMenuPosition({ clientX: -50, clientY: -50 } as MouseEvent, '.menu');
    await nextTick();
    await nextTick();

    expect(position.value.x).toBe(5);
    expect(position.value.y).toBe(5);
  });

  it('菜单元素不存在时应保持原始坐标', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    const { calculateMenuPosition, position } = useContextMenuPosition();

    calculateMenuPosition({ clientX: 300, clientY: 300 } as MouseEvent, '.missing');
    await nextTick();
    await nextTick();

    expect(position.value).toEqual({ x: 300, y: 300 });
  });

  it('closeMenu 应隐藏菜单', () => {
    const { visible, closeMenu } = useContextMenuPosition();
    visible.value = true;

    closeMenu();
    expect(visible.value).toBe(false);
  });
});
