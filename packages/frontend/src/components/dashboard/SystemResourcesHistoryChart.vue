<template>
    <div class="h-48">
        <Line :data="chartData" :options="chartOptions" />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Line } from 'vue-chartjs';
import {
    Chart as ChartJS,
    Title,
    Tooltip,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    CategoryScale,
    type ChartData,
    type ChartOptions,
} from 'chart.js';

ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

const props = defineProps<{
    history: Array<{
        timestamp: number;
        cpuPercent: number;
        memPercent: number;
        diskPercent: number;
    }>;
}>();

const { t } = useI18n();

const labels = computed(() =>
    props.history.map((p) => {
        const date = new Date(p.timestamp);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date
            .getSeconds()
            .toString()
            .padStart(2, '0')}`;
    })
);

const chartData = computed<ChartData<'line'>>(() => ({
    labels: labels.value,
    datasets: [
        {
            label: 'CPU',
            data: props.history.map((p) => p.cpuPercent),
            borderColor: '#409eff',
            backgroundColor: 'rgba(64, 158, 255, 0.15)',
            tension: 0.25,
            pointRadius: 0,
        },
        {
            label: t('dashboard.memory'),
            data: props.history.map((p) => p.memPercent),
            borderColor: '#67c23a',
            backgroundColor: 'rgba(103, 194, 58, 0.15)',
            tension: 0.25,
            pointRadius: 0,
        },
        {
            label: t('dashboard.disk'),
            data: props.history.map((p) => p.diskPercent),
            borderColor: '#e6a23c',
            backgroundColor: 'rgba(230, 162, 60, 0.15)',
            tension: 0.25,
            pointRadius: 0,
        },
    ],
}));

const chartOptions = computed<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { display: true, position: 'bottom' },
        tooltip: { enabled: true },
        title: { display: false },
    },
    scales: {
        x: {
            display: false,
            grid: { display: false },
        },
        y: {
            beginAtZero: true,
            max: 100,
            ticks: { stepSize: 25 },
        },
    },
}));
</script>

