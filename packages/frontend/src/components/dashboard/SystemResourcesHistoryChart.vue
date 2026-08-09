<template>
  <div class="h-48">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Line } from 'vue-chartjs';
import { useAppearanceStore } from '../../stores/appearance.store';
import { useCssVarWithLifecycle, hexToRgba } from '../../composables/useCssVar';
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale,
  type ChartData,
  type ChartOptions,
} from 'chart.js';

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale,
);

const props = defineProps<{
  history: Array<{
    timestamp: number;
    cpuPercent: number;
    memPercent: number;
    diskPercent: number;
  }>;
}>();

const { t } = useI18n();
const appearanceStore = useAppearanceStore();

const textColor = computed(() => appearanceStore.currentUiTheme['--text-color'] || '#333333');
const textColorSecondary = computed(
  () => appearanceStore.currentUiTheme['--text-color-secondary'] || '#666666',
);
const borderColor = computed(() => appearanceStore.currentUiTheme['--border-color'] || '#cccccc');

// Chart.js 无法解析 CSS 变量字符串与 color-mix()，必须读取解析后的实际色值；
// 响应式读取确保浅色/深色主题切换后图表配色同步刷新
const chartPrimaryColor = useCssVarWithLifecycle('--color-primary', '#0ea5e9');
const chartSuccessColor = useCssVarWithLifecycle('--color-success', '#10b981');
const chartWarningColor = useCssVarWithLifecycle('--color-warning', '#f59e0b');

// 半透明填充色：基于主色生成 rgba（Chart.js 需要实际颜色）
const chartPrimaryFill = computed(() => hexToRgba(chartPrimaryColor.value.value, 0.15));
const chartSuccessFill = computed(() => hexToRgba(chartSuccessColor.value.value, 0.15));
const chartWarningFill = computed(() => hexToRgba(chartWarningColor.value.value, 0.15));

const labels = computed(() =>
  props.history.map((p) => {
    const date = new Date(p.timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date
      .getSeconds()
      .toString()
      .padStart(2, '0')}`;
  }),
);

const chartData = computed<ChartData<'line'>>(() => ({
  labels: labels.value,
  datasets: [
    {
      label: 'CPU',
      data: props.history.map((p) => p.cpuPercent),
      borderColor: chartPrimaryColor.value.value,
      backgroundColor: chartPrimaryFill.value,
      tension: 0.3,
      pointRadius: 0,
      fill: true,
    },
    {
      label: t('dashboard.memory'),
      data: props.history.map((p) => p.memPercent),
      borderColor: chartSuccessColor.value.value,
      backgroundColor: chartSuccessFill.value,
      tension: 0.3,
      pointRadius: 0,
      fill: true,
    },
    {
      label: t('dashboard.disk'),
      data: props.history.map((p) => p.diskPercent),
      borderColor: chartWarningColor.value.value,
      backgroundColor: chartWarningFill.value,
      tension: 0.3,
      pointRadius: 0,
      fill: true,
    },
  ],
}));

const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'bottom',
      labels: {
        color: textColor.value,
        usePointStyle: true,
        padding: 15,
        font: { size: 11 },
      },
    },
    tooltip: {
      enabled: true,
      backgroundColor: appearanceStore.currentUiTheme['--header-bg-color'] || 'var(--bg-overlay)',
      titleColor: textColor.value,
      bodyColor: textColor.value,
      borderColor: borderColor.value,
      borderWidth: 1,
      mode: 'index',
      intersect: false,
    },
    title: { display: false },
  },
  interaction: {
    mode: 'nearest',
    axis: 'x',
    intersect: false,
  },
  scales: {
    x: {
      display: true,
      grid: { display: false },
      ticks: {
        color: textColorSecondary.value,
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 6,
        font: { size: 10 },
      },
    },
    y: {
      beginAtZero: true,
      max: 100,
      ticks: {
        stepSize: 25,
        color: textColorSecondary.value,
        font: { size: 10 },
      },
      grid: {
        color: borderColor.value,
        drawTicks: false,
      },
    },
  },
}));
</script>
