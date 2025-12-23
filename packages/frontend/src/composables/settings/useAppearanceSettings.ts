import { useAppearanceStore } from '../../stores/appearance.store';
// import { useI18n } from 'vue-i18n'; // t function might be needed if there were messages

export function useAppearanceSettings() {
  const appearanceStore = useAppearanceStore();
  // const { t } = useI18n(); // Not strictly needed for just opening a modal yet

  const openStyleCustomizer = () => {
    appearanceStore.toggleStyleCustomizer(true);
  };

  // No specific loading, message, or success states are typically needed for just opening a UI element.
  // These would be managed within the StyleCustomizer component itself or its own composable if it gets complex.

  return {
    openStyleCustomizer,
  };
}
