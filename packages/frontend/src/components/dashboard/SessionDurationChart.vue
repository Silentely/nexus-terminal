<template>
    <div class="h-48">
        <Bar :data="chartData" :options="chartOptions" />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Bar } from 'vue-chartjs';
import {
    Chart as ChartJS,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    type ChartData,
    type ChartOptions
} from 'chart.js';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const props = defineProps<{
    distribution: Record<string, number>;
}>();

const { t } = useI18n();

const values = computed(() => ([
    props.distribution.lt5min ?? 0,
    props.distribution['5min-30min'] ?? 0,
    props.distribution['30min-1hr'] ?? 0,
    props.distribution.gt1hr ?? 0,
]));

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
        legend: { display: false },
        tooltip: { enabled: true },
    },
    scales: {
        x: {
            ticks: { maxRotation: 0, minRotation: 0 },
            grid: { display: false },
        },
        y: {
            beginAtZero: true,
            ticks: { precision: 0 },
        },
    },
}));
</script>

