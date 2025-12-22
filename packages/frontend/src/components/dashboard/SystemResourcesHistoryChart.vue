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
const appearanceStore = useAppearanceStore();

const textColor = computed(() => appearanceStore.currentUiTheme['--text-color'] || '#333333');
const textColorSecondary = computed(() => appearanceStore.currentUiTheme['--text-color-secondary'] || '#666666');
const borderColor = computed(() => appearanceStore.currentUiTheme['--border-color'] || '#cccccc');

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
            tension: 0.3,
            pointRadius: 0,
            fill: true,
        },
        {
            label: t('dashboard.memory'),
            data: props.history.map((p) => p.memPercent),
            borderColor: '#67c23a',
            backgroundColor: 'rgba(103, 194, 58, 0.15)',
            tension: 0.3,
            pointRadius: 0,
            fill: true,
        },
        {
            label: t('dashboard.disk'),
            data: props.history.map((p) => p.diskPercent),
            borderColor: '#e6a23c',
            backgroundColor: 'rgba(230, 162, 60, 0.15)',
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
                font: { size: 11 }
            }
        },
        tooltip: { 
            enabled: true,
            backgroundColor: appearanceStore.currentUiTheme['--header-bg-color'] || 'rgba(0,0,0,0.8)',
            titleColor: textColor.value,
            bodyColor: textColor.value,
            borderColor: borderColor.value,
            borderWidth: 1,
            mode: 'index',
            intersect: false
        },
        title: { display: false },
    },
    interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
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
                font: { size: 10 }
            }
        },
        y: {
            beginAtZero: true,
            max: 100,
            ticks: { 
                stepSize: 25,
                color: textColorSecondary.value,
                font: { size: 10 }
            },
            grid: {
                color: borderColor.value,
                drawTicks: false
            }
        },
    },
}));
</script>

