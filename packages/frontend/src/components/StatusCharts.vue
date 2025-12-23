<template>
  <div class="status-charts grid grid-cols-1 gap-4 mt-4">
    <div class="chart-container bg-header rounded p-3">
      <div class="flex justify-between items-center mb-2">
        <h5 class="text-sm font-medium text-text-secondary">
          {{ $t('statusMonitor.cpuUsageTitle') }}
        </h5>
        <span class="text-xs text-text-tertiary ml-2">
          {{
            $t('statusMonitor.latestCpuValue', {
              value: cpuChartData.datasets[0].data[MAX_DATA_POINTS - 1]?.toFixed(1),
            })
          }}
        </span>
      </div>
      <div class="chart-wrapper h-40">
        <Line :data="cpuChartData" :options="percentageChartOptions" :key="cpuChartKey" />
      </div>
    </div>
    <!-- 内存使用图表已注释掉 -->
    <!--
    <div class="chart-container bg-header rounded p-3">
      <div class="flex justify-between items-center mb-2">
        <h5 class="text-sm font-medium text-text-secondary">{{ $t('statusMonitor.memoryUsageTitleUnit', { unit: memoryUnitIsGB ? 'GB' : 'MB' }) }}</h5>
        <span class="text-xs text-text-tertiary ml-2">
           {{ $t('statusMonitor.latestMemoryValue', { value: memoryChartData.datasets[0].data[MAX_DATA_POINTS - 1]?.toFixed(1), unit: memoryUnitIsGB ? 'GB' : 'MB' }) }}
        </span>
      </div>
      <div class="chart-wrapper h-40">
        <Line :data="memoryChartData" :options="memoryChartOptions" :key="memoryChartKey" />
      </div>
    </div>
    -->
    <div class="chart-container bg-header rounded p-3">
      <div class="flex justify-between items-center mb-2">
        <h5 class="text-sm font-medium text-text-secondary">
          {{
            $t('statusMonitor.networkSpeedTitleUnit', {
              unit: networkRateUnitIsMB ? 'MB/s' : 'KB/s',
            })
          }}
        </h5>
        <span class="text-xs text-text-tertiary ml-2">
          {{
            $t('statusMonitor.latestNetworkValue', {
              download: networkChartData.datasets[0].data[MAX_DATA_POINTS - 1]?.toFixed(1),
              upload: networkChartData.datasets[1].data[MAX_DATA_POINTS - 1]?.toFixed(1),
              unit: networkRateUnitIsMB ? 'MB/s' : 'KB/s',
            })
          }}
        </span>
      </div>
      <div class="chart-wrapper h-40">
        <Line :data="networkChartData" :options="networkChartOptions" :key="networkChartKey" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { Line } from 'vue-chartjs';
import { useSessionStore } from '../stores/session.store';
import { storeToRefs } from 'pinia';
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale,
  ChartOptions,
  TooltipItem,
} from 'chart.js';

ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

// Define a more specific type for serverStatus if possible, or use as is if memUsed/memTotal are reliably present.
// For now, assuming props.serverStatus will have memUsed and memTotal in MB.
interface ServerStatusData {
  cpuPercent?: number;
  memPercent?: number; // Will be ignored for chart data, but kept for other potential uses
  memUsed?: number; // in MB
  memTotal?: number; // in MB
  netRxRate?: number; // in Bytes/sec
  netTxRate?: number; // in Bytes/sec
  // ... other properties if needed
}

const props = defineProps({
  serverStatus: {
    // Keep serverStatus for current values and Y-axis scaling logic
    type: Object as PropType<ServerStatusData | null>,
    required: true,
  },
  activeSessionId: {
    type: String as PropType<string | null>,
    required: true,
  },
});

const MAX_DATA_POINTS = 60;
const KB_TO_MB_THRESHOLD = 1024; // For network
const MB_TO_GB_THRESHOLD = 1024; // For memory

const { t } = useI18n();
const sessionStore = useSessionStore();
const { sessions } = storeToRefs(sessionStore); // 获取响应式的 sessions

const cpuChartKey = ref(0);
const memoryChartKey = ref(0);
const networkChartKey = ref(0);

const networkRateUnitIsMB = ref(false);
const memoryUnitIsGB = ref(false);

// const networkChartTitle = ref('网络速度 (KB/s)'); // Will be replaced by i18n
// const memoryChartTitle = ref('内存使用情况 (MB)'); // Will be replaced by i18n

const initialLabels = Array.from({ length: MAX_DATA_POINTS }, () => '');

// --- 计算属性：从 Store 获取当前会话的历史数据 ---
const currentSessionStatusManager = computed(() => {
  return props.activeSessionId
    ? sessions.value.get(props.activeSessionId)?.statusMonitorManager
    : null;
});

const currentCpuHistory = computed(() => {
  return currentSessionStatusManager.value?.cpuHistory.value ?? Array(MAX_DATA_POINTS).fill(null);
});

const currentMemUsedHistory = computed(() => {
  // 返回 MB 为单位的历史数据
  return (
    currentSessionStatusManager.value?.memUsedHistory.value ?? Array(MAX_DATA_POINTS).fill(null)
  );
});

const currentNetRxHistory = computed(() => {
  // 返回 Bytes/sec 为单位的历史数据
  return currentSessionStatusManager.value?.netRxHistory.value ?? Array(MAX_DATA_POINTS).fill(null);
});

const currentNetTxHistory = computed(() => {
  // 返回 Bytes/sec 为单位的历史数据
  return currentSessionStatusManager.value?.netTxHistory.value ?? Array(MAX_DATA_POINTS).fill(null);
});

// --- 图表数据结构，现在 data 指向 computed 属性 ---
const cpuChartData = computed(() => ({
  labels: initialLabels, // 标签保持不变
  datasets: [
    {
      label: t('statusMonitor.cpuUsageLabel'),
      backgroundColor: 'rgba(54, 162, 235, 0.2)',
      borderColor: 'rgba(54, 162, 235, 1)',
      borderWidth: 1,
      data: currentCpuHistory.value.map((v) => v ?? 0), // 将 null 映射为 0 用于图表
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 5,
    },
  ],
}));

// 动态计算内存图表数据（转换单位）
const memoryChartData = computed(() => {
  const historyMB = currentMemUsedHistory.value;
  let displayData: (number | null)[];

  // 检查是否需要转换为 GB (基于当前值或历史峰值)
  const currentTotalMB = props.serverStatus?.memTotal ?? 0;
  const historyPeakMB = Math.max(...historyMB.filter((v): v is number => v !== null), 0);
  const requiresGB = currentTotalMB >= MB_TO_GB_THRESHOLD || historyPeakMB >= MB_TO_GB_THRESHOLD;
  memoryUnitIsGB.value = requiresGB; // 更新单位标志

  if (requiresGB) {
    displayData = historyMB.map((mb) =>
      mb === null ? null : parseFloat((mb / MB_TO_GB_THRESHOLD).toFixed(1))
    );
  } else {
    displayData = historyMB.map((mb) => (mb === null ? null : parseFloat(mb.toFixed(1))));
  }

  return {
    labels: initialLabels,
    datasets: [
      {
        label: t('statusMonitor.memoryUsageLabelUnit', { unit: requiresGB ? 'GB' : 'MB' }),
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 1,
        data: displayData.map((v) => v ?? 0), // 将 null 映射为 0
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 5,
      },
    ],
  };
});

// 动态计算网络图表数据（转换单位）
const networkChartData = computed(() => {
  const historyRxBps = currentNetRxHistory.value;
  const historyTxBps = currentNetTxHistory.value;
  let displayRxData: (number | null)[];
  let displayTxData: (number | null)[];

  // 检查是否需要转换为 MB/s (基于当前值或历史峰值)
  const currentRxKB = (props.serverStatus?.netRxRate ?? 0) / 1024;
  const currentTxKB = (props.serverStatus?.netTxRate ?? 0) / 1024;
  const historyPeakRxKB = Math.max(
    ...historyRxBps.filter((v): v is number => v !== null).map((bps) => bps / 1024),
    0
  );
  const historyPeakTxKB = Math.max(
    ...historyTxBps.filter((v): v is number => v !== null).map((bps) => bps / 1024),
    0
  );
  const requiresMB =
    currentRxKB >= KB_TO_MB_THRESHOLD ||
    currentTxKB >= KB_TO_MB_THRESHOLD ||
    historyPeakRxKB >= KB_TO_MB_THRESHOLD ||
    historyPeakTxKB >= KB_TO_MB_THRESHOLD;
  networkRateUnitIsMB.value = requiresMB; // 更新单位标志

  const divisor = requiresMB ? 1024 * 1024 : 1024;
  const precision = requiresMB ? 2 : 1;

  displayRxData = historyRxBps.map((bps) =>
    bps === null ? null : parseFloat((bps / divisor).toFixed(precision))
  );
  displayTxData = historyTxBps.map((bps) =>
    bps === null ? null : parseFloat((bps / divisor).toFixed(precision))
  );

  return {
    labels: initialLabels,
    datasets: [
      {
        label: t('statusMonitor.networkDownloadLabelUnit', { unit: requiresMB ? 'MB/s' : 'KB/s' }),
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 1,
        data: displayRxData.map((v) => v ?? 0), // 将 null 映射为 0
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 5,
      },
      {
        label: t('statusMonitor.networkUploadLabelUnit', { unit: requiresMB ? 'MB/s' : 'KB/s' }),
        backgroundColor: 'rgba(255, 159, 64, 0.2)',
        borderColor: 'rgba(255, 159, 64, 1)',
        borderWidth: 1,
        data: displayTxData.map((v) => v ?? 0), // 将 null 映射为 0
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 5,
      },
    ],
  };
});

const baseChartOptions: Omit<ChartOptions<'line'>, 'scales'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: { labels: { color: '#9CA3AF' } },
    tooltip: { enabled: true, mode: 'index', intersect: false },
  },
  interaction: { mode: 'index', intersect: false },
};

const percentageChartOptions = ref<ChartOptions<'line'>>({
  // For CPU
  ...baseChartOptions,
  scales: {
    y: {
      beginAtZero: true,
      min: 0,
      max: 100,
      ticks: { color: '#9CA3AF', callback: (value) => `${value}%` },
      grid: { color: 'rgba(156, 163, 175, 0.1)' },
    },
    x: {
      ticks: { display: false, color: '#9CA3AF', maxRotation: 0, minRotation: 0 },
      grid: { display: false },
    },
  },
});

const memoryChartOptions = ref<ChartOptions<'line'>>({
  ...baseChartOptions,
  plugins: {
    ...baseChartOptions.plugins,
    tooltip: {
      ...baseChartOptions.plugins?.tooltip,
      callbacks: {
        label: (context: TooltipItem<'line'>) => {
          let label = context.dataset.label || '';
          if (label) {
            label = label.substring(0, label.lastIndexOf('(') - 1); // Remove old unit from label
            label += ': ';
          }
          if (context.parsed.y !== null) {
            const value = parseFloat(context.parsed.y.toFixed(1));
            label += `${value} ${memoryUnitIsGB.value ? 'GB' : 'MB'}`;
          }
          return label;
        },
      },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      min: 0,
      // max will be set dynamically based on memTotal
      ticks: {
        color: '#9CA3AF',
        callback: function (value) {
          return `${parseFloat(Number(value).toFixed(1))}`; // Unit will be implicit from title or tooltip
        },
      },
      grid: { color: 'rgba(156, 163, 175, 0.1)' },
    },
    x: {
      ticks: { display: false, color: '#9CA3AF', maxRotation: 0, minRotation: 0 },
      grid: { display: false },
    },
  },
});

const networkChartOptions = ref<ChartOptions<'line'>>({
  ...baseChartOptions,
  plugins: {
    ...baseChartOptions.plugins,
    tooltip: {
      ...baseChartOptions.plugins?.tooltip,
      callbacks: {
        label: (context: TooltipItem<'line'>) => {
          let label = context.dataset.label || '';
          if (label) {
            label = label.substring(0, label.lastIndexOf('(') - 1); // Remove old unit from label
            label += ': ';
          }
          if (context.parsed.y !== null) {
            const precision = networkRateUnitIsMB.value ? 2 : 1;
            const value = parseFloat(context.parsed.y.toFixed(precision));
            label += `${value} ${networkRateUnitIsMB.value ? 'MB/s' : 'KB/s'}`;
          }
          return label;
        },
      },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      min: 0,
      max: 10, // 初始值，将动态更新
      ticks: {
        color: '#9CA3AF',
        callback: function (value) {
          const precision = networkRateUnitIsMB.value ? 2 : 0; // KB/s usually whole numbers, MB/s two decimal places
          // For KB/s, if the value is very small (e.g. < 1), it might be better to show 1 decimal.
          // However, for simplicity and typical KB/s display, 0 is often fine.
          // Let's adjust for KB to show 1 decimal if it's not a whole number and small.
          if (
            !networkRateUnitIsMB.value &&
            Number(value) !== parseInt(String(value)) &&
            Number(value) < 100
          ) {
            return `${Number(value).toFixed(1)}`;
          }
          return `${Number(value).toFixed(precision)}`;
        },
      },
      grid: { color: 'rgba(156, 163, 175, 0.1)' },
    },
    x: {
      ticks: { display: false, color: '#9CA3AF', maxRotation: 0, minRotation: 0 },
      grid: { display: false },
    },
  },
});

// --- 函数：动态更新 Y 轴范围和单位（基于当前 serverStatus 和 store 中的历史数据） ---
const updateAxisAndUnits = () => {
  // 内存 Y 轴和单位
  if (props.serverStatus && memoryChartOptions.value.scales?.y) {
    const historyMB = currentMemUsedHistory.value;
    const memTotal = props.serverStatus.memTotal ?? 0;
    const requiresGB = memoryUnitIsGB.value; // memoryChartData computed prop already sets this

    let yAxisTopValue = requiresGB
      ? parseFloat((memTotal / MB_TO_GB_THRESHOLD).toFixed(1))
      : parseFloat(memTotal.toFixed(1));

    const currentMaxDataPoint = Math.max(
      ...historyMB
        .filter((v): v is number => v !== null)
        .map((mb) => (requiresGB ? mb / MB_TO_GB_THRESHOLD : mb)),
      0
    );
    yAxisTopValue = Math.max(yAxisTopValue, currentMaxDataPoint);

    if (yAxisTopValue === 0) {
      yAxisTopValue = requiresGB ? 1 : 100;
    } else {
      const epsilon = requiresGB ? 0.01 : 1;
      yAxisTopValue += epsilon;
      yAxisTopValue = requiresGB ? Math.ceil(yAxisTopValue * 100) / 100 : Math.ceil(yAxisTopValue);
    }

    if (memoryChartOptions.value.scales.y.max !== yAxisTopValue) {
      memoryChartOptions.value.scales.y.max = yAxisTopValue;
      memoryChartKey.value++; // 强制重绘以应用新的 max
    }
  }

  // 网络 Y 轴和单位
  if (props.serverStatus && networkChartOptions.value.scales?.y) {
    const historyRxBps = currentNetRxHistory.value;
    const historyTxBps = currentNetTxHistory.value;
    const requiresMB = networkRateUnitIsMB.value; // networkChartData computed prop already sets this
    const divisor = requiresMB ? 1024 * 1024 : 1024;

    const allNetworkData = [
      ...historyRxBps.filter((v): v is number => v !== null).map((bps) => bps / divisor),
      ...historyTxBps.filter((v): v is number => v !== null).map((bps) => bps / divisor),
    ];
    const currentMaxDataPoint = Math.max(...allNetworkData, 0);

    let suggestedMax;
    const baseMultiplier = 1.2;
    if (currentMaxDataPoint === 0) {
      suggestedMax = requiresMB ? 5 : 500;
    } else {
      suggestedMax = currentMaxDataPoint * baseMultiplier;
    }

    const absoluteMinMax = requiresMB ? 1 : 100;
    suggestedMax = Math.max(suggestedMax, absoluteMinMax);

    if (requiresMB) {
      suggestedMax = Math.ceil(suggestedMax);
    } else {
      if (suggestedMax <= 100) {
        suggestedMax = Math.ceil(suggestedMax / 10) * 10;
        if (suggestedMax === 0 && currentMaxDataPoint > 0) suggestedMax = 10;
      } else if (suggestedMax <= 500) {
        suggestedMax = Math.ceil(suggestedMax / 50) * 50;
      } else {
        suggestedMax = Math.ceil(suggestedMax / 100) * 100;
      }
    }

    if (currentMaxDataPoint > 0 && suggestedMax === 0) {
      suggestedMax = requiresMB
        ? 1
        : allNetworkData.some((d) => d > 0 && d < 10 / divisor)
          ? 10
          : 100;
    }
    if (currentMaxDataPoint === 0 && suggestedMax === 0) {
      suggestedMax = requiresMB ? 1 : 100;
    }

    if (networkChartOptions.value.scales.y.max !== suggestedMax) {
      networkChartOptions.value.scales.y.max = suggestedMax;
      networkChartKey.value++; // 强制重绘以应用新的 max
    }
  }
};

// --- 监听 props.serverStatus 的变化，仅用于更新 Y 轴范围和单位 ---
// 数据本身由 computed 属性从 store 获取
watch(
  () => props.serverStatus,
  () => {
    updateAxisAndUnits();
  },
  { deep: true, immediate: true }
); // immediate: true 确保初始加载时设置好轴

// 移除监听 activeSessionId 的 watcher 和 resetChartData 函数

onMounted(() => {
  // 初始轴和单位设置由 watch immediate 处理
});
</script>
