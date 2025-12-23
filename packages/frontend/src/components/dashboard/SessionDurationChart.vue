<template>
  <div class="h-48">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Bar } from 'vue-chartjs';
import { useAppearanceStore } from '../../stores/appearance.store';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const props = defineProps<{
  distribution: Record<string, number>;
}>();

const { t } = useI18n();
const appearanceStore = useAppearanceStore();

const textColor = computed(() => appearanceStore.currentUiTheme['--text-color'] || '#333333');
const textColorSecondary = computed(
  () => appearanceStore.currentUiTheme['--text-color-secondary'] || '#666666'
);
const borderColor = computed(() => appearanceStore.currentUiTheme['--border-color'] || '#cccccc');

const values = computed(() => [
  props.distribution.lt5min ?? 0,
  props.distribution['5min-30min'] ?? 0,
  props.distribution['30min-1hr'] ?? 0,
  props.distribution.gt1hr ?? 0,
]);

const chartData = computed<ChartData<'bar'>>(() => ({
  labels: [
    t('dashboard.durationBuckets.lt5min'),
    t('dashboard.durationBuckets.5minTo30min'),
    t('dashboard.durationBuckets.30minTo1hr'),
    t('dashboard.durationBuckets.gt1hr'),
  ],
  datasets: [
    {
      label: t('dashboard.stats.sessionDuration'),
      data: values.value,
      backgroundColor: ['#67c23a', '#e6a23c', '#f56c6c', '#909399'],
      borderRadius: 6,
    },
  ],
}));

const chartOptions = computed<ChartOptions<'bar'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      enabled: true,
      backgroundColor: appearanceStore.currentUiTheme['--header-bg-color'] || 'rgba(0,0,0,0.8)',
      titleColor: textColor.value,
      bodyColor: textColor.value,
      borderColor: borderColor.value,
      borderWidth: 1,
    },
  },
  scales: {
    x: {
      ticks: {
        maxRotation: 0,
        minRotation: 0,
        color: textColorSecondary.value,
      },
      grid: { display: false },
    },
    y: {
      beginAtZero: true,
      ticks: {
        precision: 0,
        color: textColorSecondary.value,
      },
      grid: {
        color: borderColor.value,
        drawTicks: false,
      },
    },
  },
}));
</script>
