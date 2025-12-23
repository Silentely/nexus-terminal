<script setup lang="ts">
import { ref, nextTick, Teleport } from 'vue';
import { useI18n } from 'vue-i18n';

// Define Props. formData is expected to be a reactive object from the parent composable.
const props = defineProps<{
  formData: {
    name: string;
    type: 'SSH' | 'RDP' | 'VNC';
    host: string;
    port: number;
  };
}>();

const { t } = useI18n();

// Tooltip state and refs for the host input
const showHostTooltip = ref(false);
const hostTooltipStyle = ref({});
const hostIconRef = ref<HTMLElement | null>(null);
const hostTooltipContentRef = ref<HTMLElement | null>(null);

const handleHostIconMouseEnter = async () => {
  showHostTooltip.value = true;
  await nextTick(); // Wait for DOM update so tooltipRect can be calculated

  if (hostIconRef.value && hostTooltipContentRef.value) {
    const iconRect = hostIconRef.value.getBoundingClientRect();
    const tooltipRect = hostTooltipContentRef.value.getBoundingClientRect();

    let top = iconRect.top - tooltipRect.height - 8; // 8px offset above the icon
    let left = iconRect.left + iconRect.width / 2 - tooltipRect.width / 2; // Center the tooltip

    // Boundary checks to keep tooltip within viewport
    if (top < 0) {
      // If not enough space on top, show below
      top = iconRect.bottom + 8;
    }
    if (left < 0) {
      left = 0;
    }
    if (left + tooltipRect.width > window.innerWidth) {
      left = window.innerWidth - tooltipRect.width;
    }

    hostTooltipStyle.value = {
      position: 'fixed', // Ensure positioning is relative to viewport
      top: `${top}px`,
      left: `${left}px`,
    };
  }
};

const handleHostIconMouseLeave = () => {
  showHostTooltip.value = false;
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="showHostTooltip"
      ref="hostTooltipContentRef"
      :style="hostTooltipStyle"
      class="fixed w-max max-w-xs p-2 text-xs text-white bg-gray-800 rounded shadow-lg z-[1000] whitespace-pre-wrap pointer-events-none"
      role="tooltip"
    >
      {{
        t(
          'connections.form.hostTooltip',
          '支持 IP 范围, 例如 192.168.1.10~192.168.1.15 (仅限添加模式)'
        )
      }}
    </div>
  </Teleport>
  <!-- Basic Info Section -->
  <div class="space-y-4 p-4 border border-border rounded-md bg-header/30">
    <h4 class="text-base font-semibold mb-3 pb-2 border-b border-border/50">
      {{ t('connections.form.sectionBasic', '基本信息') }}
    </h4>
    <div>
      <label for="conn-name" class="block text-sm font-medium text-text-secondary mb-1"
        >{{ t('connections.form.name') }} ({{ t('connections.form.optional') }})</label
      >
      <input
        type="text"
        id="conn-name"
        v-model="props.formData.name"
        class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
      />
    </div>
    <!-- Connection Type -->
    <div>
      <label class="block text-sm font-medium text-text-secondary mb-1">{{
        t('connections.form.connectionType', '连接类型')
      }}</label>
      <div class="flex rounded-md shadow-sm">
        <button
          type="button"
          @click="props.formData.type = 'SSH'"
          :class="[
            'flex-1 px-3 py-2 border border-border text-sm font-medium focus:outline-none',
            props.formData.type === 'SSH'
              ? 'bg-primary text-white'
              : 'bg-background text-foreground hover:bg-border',
            'rounded-l-md',
          ]"
        >
          {{ t('connections.form.typeSsh', 'SSH') }}
        </button>
        <button
          type="button"
          @click="props.formData.type = 'RDP'"
          :class="[
            'flex-1 px-3 py-2 border-t border-b border-r border-border text-sm font-medium focus:outline-none -ml-px',
            props.formData.type === 'RDP'
              ? 'bg-primary text-white'
              : 'bg-background text-foreground hover:bg-border',
          ]"
        >
          {{ t('connections.form.typeRdp', 'RDP') }}
        </button>
        <button
          type="button"
          @click="props.formData.type = 'VNC'"
          :class="[
            'flex-1 px-3 py-2 border border-border text-sm font-medium focus:outline-none -ml-px',
            props.formData.type === 'VNC'
              ? 'bg-primary text-white'
              : 'bg-background text-foreground hover:bg-border',
            'rounded-r-md',
          ]"
        >
          {{ t('connections.form.typeVnc', 'VNC') }}
        </button>
      </div>
    </div>
    <!-- Host and Port Row -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="md:col-span-2">
        <label for="conn-host" class="block text-sm font-medium text-text-secondary mb-1">
          {{ t('connections.form.host') }}
          <span
            class="relative ml-1"
            @mouseenter="handleHostIconMouseEnter"
            @mouseleave="handleHostIconMouseLeave"
          >
            <i
              ref="hostIconRef"
              class="fas fa-exclamation-circle text-text-secondary cursor-help"
            ></i>
          </span>
        </label>
        <input
          type="text"
          id="conn-host"
          v-model="props.formData.host"
          required
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>
      <div>
        <label for="conn-port" class="block text-sm font-medium text-text-secondary mb-1">{{
          t('connections.form.port')
        }}</label>
        <input
          type="number"
          id="conn-port"
          v-model.number="props.formData.port"
          required
          min="1"
          max="65535"
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>
    </div>
  </div>
</template>
