import { computed, ref, onMounted, onBeforeUnmount } from 'vue';

export function useDeviceDetection() {
  const isMobile = computed(() => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  });

  // 补充 viewport 能力检测：当 UA 无法识别时（如 iPad Safari、DevTools 模拟），用 pointer 类型兜底
  const hasCoarsePointer = computed(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  });

  // 综合判断：UA 命中 或 粗指针设备且触屏
  const isTouchDevice = computed(() => {
    if (typeof window === 'undefined') return false;
    return isMobile.value || (hasCoarsePointer.value && 'ontouchstart' in window);
  });

  // 屏幕方向：portrait / landscape（同步初始化避免横屏设备首次渲染闪烁）
  const orientation = ref<'portrait' | 'landscape'>(
    typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches
      ? 'landscape'
      : 'portrait',
  );

  const updateOrientation = () => {
    if (typeof window === 'undefined') return;
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    orientation.value = isLandscape ? 'landscape' : 'portrait';
  };

  let mql: MediaQueryList | null = null;

  onMounted(() => {
    updateOrientation();
    mql = window.matchMedia('(orientation: landscape)');
    mql.addEventListener('change', updateOrientation);
  });

  onBeforeUnmount(() => {
    mql?.removeEventListener('change', updateOrientation);
  });

  return { isMobile, isTouchDevice, hasCoarsePointer, orientation };
}
