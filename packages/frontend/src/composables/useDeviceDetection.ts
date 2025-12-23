import { computed } from 'vue';

export function useDeviceDetection() {
  const isMobile = computed(() => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  });

  return { isMobile };
}
