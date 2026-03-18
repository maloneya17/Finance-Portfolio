import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  Filler,
  type ChartConfiguration,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  Filler,
  ChartDataLabels,
);

Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#94a3b8';

export function setThemeDefaults(dark: boolean): void {
  Chart.defaults.color = dark ? '#cbd5e1' : '#64748b';
  Chart.defaults.borderColor = dark ? '#334155' : '#e2e8f0';
}

// ─── Chart instances ──────────────────────────────────────────────────────────
let trendChart: Chart | null = null;
let spendingChart: Chart | null = null;
let yearlyChart: Chart | null = null;
let wealthChart: Chart | null = null;
let wealthTrendChart: Chart | null = null;

function destroyIfExists(c: Chart | null): null {
  c?.destroy();
  return null;
}

function getCtx(id: string): CanvasRenderingContext2D {
  const canvas = document.getElementById(id) as HTMLCanvasElement | null;
  if (!canvas) throw new Error(`Canvas #${id} not found`);
  return canvas.getContext('2d')!;
}

// ─── Dashboard charts ─────────────────────────────────────────────────────────
import { db } from './db';
import { fmt, getCatColor } from './utils';
import { FIRE_ROLLING_MONTHS, FIRE_DEFAULT_EXP, FIRE_MULTIPLIER } from './constants';

export function updateDashboardCharts(cats: Record<string, number>): void {
  // Spending breakdown (horizontal bar)
  spendingChart = destroyIfExists(spendingChart);
  const spendLabels = Object.keys(cats).sort((a, b) => cats[b] - cats[a]);
  const spendValues = spendLabels.map(c => cats[c]);
  const isDark = db.theme === 'dark';

  spendingChart = new Chart(getCtx('chartSpend'), {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: spendLabels,
      datasets: [{
        data: spendValues,
        backgroundColor: spendLabels.map(c => getCatColor(c)),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: isDark ? '#94a3b8' : '#64748b',
          font: { size: 10, weight: 'bold' },
          formatter: (v: number) => `£${fmt(v)}`,
        },
      },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  } as ChartConfiguration<'bar'>);

  // Cash flow trend (grouped bar, last 6 months)
  trendChart = destroyIfExists(trendChart);
  const labels: string[] = [];
  const dInc: number[] = [];
  const dExp: number[] = [];
  const d = new Date();
  d.setMonth(d.getMonth() - 5);
  for (let i = 0; i < 6; i++) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(d.toLocaleString('default', { month: 'short' }));
    const txs = db.transactions[k] ?? [];
    let inc = 0, exp = 0;
    txs.forEach(t => { if (t.type === 'income') inc += t.amount; else exp += t.amount; });
    dInc.push(inc);
    dExp.push(exp);
    d.setMonth(d.getMonth() + 1);
  }

  const customTotals = {
    id: 'customTotals',
    afterDraw: (chart: Chart) => {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const datasets = chart.data.datasets as { data: number[] }[];
      if (datasets[0]?.data) {
        const totalInc = datasets[0].data.reduce((a, b) => a + b, 0);
        const totalExp = datasets[1]?.data.reduce((a, b) => a + b, 0) ?? 0;
        ctx.save();
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#10b981';
        ctx.fillText(`Inc: £${fmt(totalInc)}`, chartArea.left + 10, chartArea.top + 20);
        ctx.fillStyle = '#f43f5e';
        ctx.fillText(`Exp: £${fmt(totalExp)}`, chartArea.left + 10, chartArea.top + 40);
        ctx.restore();
      }
    },
  };

  trendChart = new Chart(getCtx('chartTrend'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Inc', data: dInc, backgroundColor: '#10b981', borderRadius: 4 },
        { label: 'Exp', data: dExp, backgroundColor: '#f43f5e', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { grid: { display: false } },
      },
      plugins: { legend: { display: false } },
    },
    plugins: [customTotals],
  } as ChartConfiguration<'bar'>);
}

// ─── Reports chart ────────────────────────────────────────────────────────────
export function updateYearlyChart(
  labels: string[],
  incData: number[],
  expData: number[],
): void {
  yearlyChart = destroyIfExists(yearlyChart);
  yearlyChart = new Chart(getCtx('chartYearly'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: incData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          fill: true,
          tension: 0.4,
        },
        {
          label: 'Expense',
          data: expData,
          borderColor: '#f43f5e',
          backgroundColor: 'rgba(244,63,94,0.1)',
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: db.theme === 'dark' ? '#334155' : '#f1f5f9' } },
        x: { grid: { display: false } },
      },
    },
  } as ChartConfiguration<'line'>);
}

// ─── Wealth charts ────────────────────────────────────────────────────────────
export function updateWealthCharts(
  totalAssets: number,
  operatingCash: number,
  totalDebts: number,
  historyLabels: string[],
  historyValues: (number | null)[],
): void {
  wealthChart = destroyIfExists(wealthChart);
  const sum = totalAssets + operatingCash + totalDebts;
  wealthChart = new Chart(getCtx('chartWealth'), {
    type: 'doughnut',
    plugins: [ChartDataLabels],
    data: {
      labels: ['Assets', 'Operating Cash', 'Debt'],
      datasets: [{
        data: [totalAssets, operatingCash, totalDebts],
        backgroundColor: ['#10b981', '#3b82f6', '#f43f5e'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } },
        datalabels: {
          color: '#fff',
          font: { weight: 'bold', size: 10 },
          formatter: (v: number) => sum === 0 ? '' : `${((v / sum) * 100).toFixed(0)}%`,
        },
      },
    },
  } as ChartConfiguration<'doughnut'>);

  wealthTrendChart = destroyIfExists(wealthTrendChart);
  wealthTrendChart = new Chart(getCtx('chartWealthTrend'), {
    type: 'line',
    data: {
      labels: historyLabels,
      datasets: [{
        label: 'Net Worth',
        data: historyValues,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.1)',
        fill: true,
        tension: 0.4,
        spanGaps: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { display: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  } as ChartConfiguration<'line'>);
}

// ─── FIRE calculation helper ──────────────────────────────────────────────────
export function calcFireStats(currentNet: number): {
  avgMonthlyExp: number;
  fireTarget: number;
  progress: number;
  hasData: boolean;
} {
  let totalSpent = 0;
  let hasData = false;
  const fireD = new Date();
  fireD.setMonth(fireD.getMonth() - (FIRE_ROLLING_MONTHS - 1));
  for (let i = 0; i < FIRE_ROLLING_MONTHS; i++) {
    const fk = `${fireD.getFullYear()}-${String(fireD.getMonth() + 1).padStart(2, '0')}`;
    const txs = db.transactions[fk] ?? [];
    let monthExp = 0;
    txs.forEach(t => { if (t.type === 'expense') monthExp += t.amount; });
    totalSpent += monthExp;
    if (monthExp > 0) hasData = true;
    fireD.setMonth(fireD.getMonth() + 1);
  }
  const avgMonthlyExp = hasData ? totalSpent / FIRE_ROLLING_MONTHS : FIRE_DEFAULT_EXP;
  const fireTarget = avgMonthlyExp * 12 * FIRE_MULTIPLIER;
  const progress = Math.min((currentNet / fireTarget) * 100, 100);
  return { avgMonthlyExp, fireTarget, progress, hasData };
}
