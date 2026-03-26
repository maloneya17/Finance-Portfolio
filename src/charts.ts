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
import { sym } from './utils';

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
let debtTimelineChart: Chart | null = null;

function destroyIfExists(c: Chart | null): null {
  c?.destroy();
  return null;
}

function getCtx(id: string): CanvasRenderingContext2D {
  const canvas = document.getElementById(id) as HTMLCanvasElement | null;
  if (!canvas) throw new Error(`Canvas #${id} not found`);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`Canvas #${id} 2d context unavailable`);
  return ctx;
}

// ─── Dashboard charts ─────────────────────────────────────────────────────────
import { db } from './db';
import { math, fmt, getCatColor } from './utils';
import { FIRE_ROLLING_MONTHS, FIRE_DEFAULT_EXP, FIRE_MULTIPLIER } from './constants';

export function updateDashboardCharts(cats: Record<string, number>, forecastExp?: number): void {
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
          formatter: (v: number) => `${sym()}${fmt(v)}`,
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
    txs.forEach(t => { if (t.type === 'income') inc += math(t.amount); else exp += math(t.amount); });
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
        ctx.fillText(`Inc: ${sym()}${fmt(totalInc)}`, chartArea.left + 10, chartArea.top + 20);
        ctx.fillStyle = '#f43f5e';
        ctx.fillText(`Exp: ${sym()}${fmt(totalExp)}`, chartArea.left + 10, chartArea.top + 40);
        ctx.restore();
      }
    },
  };

  // Forecast ghost: sparse bar on current month showing projected month-end spend.
  // Only render when the caller passes a forecast (current month only); value of 0
  // means "under pace" so we still draw the ghost to show the projection.
  const dForecast: (number | null)[] = Array(6).fill(null);
  if (forecastExp !== undefined && forecastExp > 0) dForecast[5] = forecastExp;

  trendChart = new Chart(getCtx('chartTrend'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Inc', data: dInc, backgroundColor: '#10b981', borderRadius: 4 },
        { label: 'Exp', data: dExp, backgroundColor: '#f43f5e', borderRadius: 4 },
        {
          label: 'Forecast',
          data: dForecast,
          backgroundColor: 'rgba(244,63,94,0.2)',
          borderColor: 'rgba(244,63,94,0.5)',
          borderWidth: 1,
          borderRadius: 4,
          borderDash: [4, 4],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.datasetIndex === 2 && ctx.raw !== null) return `Forecast: ${sym()}${fmt(ctx.raw as number)}`;
              return `${ctx.dataset.label}: ${sym()}${fmt(ctx.raw as number)}`;
            },
          },
        },
      },
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
  fireTarget?: number,
): void {
  wealthChart = destroyIfExists(wealthChart);
  const clampedAssets = Math.max(0, totalAssets);
  const clampedCash = Math.max(0, operatingCash);
  const clampedDebts = Math.max(0, totalDebts);
  // Use clamped values for the sum so the datalabels percentages add up to 100%
  // even when operatingCash or other values are negative.
  const sum = clampedAssets + clampedCash + clampedDebts;
  wealthChart = new Chart(getCtx('chartWealth'), {
    type: 'doughnut',
    plugins: [ChartDataLabels],
    data: {
      labels: ['Assets', 'Operating Cash', 'Debt'],
      datasets: [{
        data: [clampedAssets, clampedCash, clampedDebts],
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

  // Extend chart 3 months into the future for the trend projection line
  const projMonths = 3;
  const allLabels = [...historyLabels];
  for (let i = 1; i <= projMonths; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    allLabels.push(d.toLocaleString('default', { month: 'short', year: '2-digit' }));
  }

  // Actual net worth data — pad future slots with null
  const netWorthData: (number | null)[] = [...historyValues, ...Array(projMonths).fill(null)];

  // FIRE target — horizontal dashed line across all labels (only if set)
  const fireData: (number | null)[] | null = (fireTarget && fireTarget > 0)
    ? allLabels.map(() => fireTarget)
    : null;

  // Linear trend projection: fit a line through the last ≤6 non-null history points,
  // then extrapolate from the last known value through the 3 future slots.
  const nonNull = historyValues.reduce<{ i: number; v: number }[]>((acc, v, i) => {
    if (v !== null) acc.push({ i, v });
    return acc;
  }, []);
  const trendData: (number | null)[] = Array(allLabels.length).fill(null);
  if (nonNull.length >= 2) {
    const pts = nonNull.slice(-6);
    const x0 = pts[0].i;
    const x1 = pts[pts.length - 1].i;
    const slope = x1 > x0 ? (pts[pts.length - 1].v - pts[0].v) / (x1 - x0) : 0;
    const last  = nonNull[nonNull.length - 1];
    // Plot from last known point through 3 future months
    for (let step = 0; step <= projMonths; step++) {
      const chartIdx = last.i + step;
      if (chartIdx < allLabels.length) {
        trendData[chartIdx] = math(last.v + slope * step);
      }
    }
  }

  const isDark = db.theme === 'dark';
  const datasets: ChartConfiguration<'line'>['data']['datasets'] = [
    {
      label: 'Net Worth',
      data: netWorthData,
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99,102,241,0.08)',
      fill: true,
      tension: 0.4,
      spanGaps: false,
      pointRadius: netWorthData.map((v, i) => {
        // Show point only on the most recent non-null value
        const isLast = nonNull.length > 0 && i === nonNull[nonNull.length - 1].i;
        return isLast ? 4 : 0;
      }),
      pointBackgroundColor: '#6366f1',
    },
  ];

  if (nonNull.length >= 2) {
    datasets.push({
      label: 'Trend',
      data: trendData,
      borderColor: 'rgba(99,102,241,0.4)',
      backgroundColor: 'transparent',
      borderDash: [4, 4],
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
    });
  }

  if (fireData) {
    datasets.push({
      label: 'FIRE Target',
      data: fireData,
      borderColor: 'rgba(245,158,11,0.6)',
      backgroundColor: 'transparent',
      borderDash: [6, 3],
      borderWidth: 1.5,
      fill: false,
      tension: 0,
      pointRadius: 0,
    });
  }

  wealthTrendChart = new Chart(getCtx('chartWealthTrend'), {
    type: 'line',
    data: { labels: allLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: Boolean(fireData),
          labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 }, color: isDark ? '#94a3b8' : '#64748b' },
        },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw as number | null;
              if (v === null) return '';
              if (ctx.dataset.label === 'Trend') return `Trend: ${sym()}${fmt(v)}`;
              if (ctx.dataset.label === 'FIRE Target') return `FIRE: ${sym()}${fmt(v)}`;
              return `Net Worth: ${sym()}${fmt(v)}`;
            },
          },
        },
      },
      scales: {
        x: { display: true, grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, maxTicksLimit: 6 } },
        y: { display: true, grid: { color: isDark ? '#1e293b' : '#f1f5f9' }, ticks: { font: { size: 9 }, callback: (v) => `${sym()}${fmt(v as number)}` } },
      },
    },
  } as ChartConfiguration<'line'>);
}

// ─── Debt Payoff Timeline chart ───────────────────────────────────────────────
import type { DebtPayoff } from './finance';

export function updateDebtTimelineChart(plans: DebtPayoff[]): void {
  debtTimelineChart = destroyIfExists(debtTimelineChart);
  const canvas = document.getElementById('chartDebtTimeline') as HTMLCanvasElement | null;
  if (!canvas) return;

  const payable = plans.filter(p => p.monthsToPayoff > 0);
  const wrap = canvas.closest<HTMLElement>('.debt-timeline-wrap');
  if (payable.length === 0) {
    if (wrap) wrap.style.display = 'none';
    return;
  }
  if (wrap) wrap.style.display = '';

  const isDark = db.theme === 'dark';
  const maxM   = Math.max(...payable.map(p => p.monthsToPayoff));

  debtTimelineChart = new Chart(canvas.getContext('2d')!, {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: payable.map(p => p.name),
      datasets: [{
        data: payable.map(p => p.monthsToPayoff),
        backgroundColor: payable.map(p => {
          const ratio = p.monthsToPayoff / maxM;
          if (ratio < 0.33) return '#10b981';
          if (ratio < 0.67) return '#f59e0b';
          return '#f43f5e';
        }),
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
          formatter: (v: number) => {
            const yr = Math.floor(v / 12);
            const mo = v % 12;
            return yr > 0 ? `${yr}y ${mo}m` : `${mo}m`;
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = payable[ctx.dataIndex];
              const parts = [`${ctx.raw as number} months to payoff`];
              if (p.totalInterest > 0) parts.push(`Interest: ${sym()}${fmt(p.totalInterest)}`);
              parts.push(`Done: ${p.payoffDateStr}`);
              return parts;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 9 } },
          title: { display: true, text: 'Months to payoff', font: { size: 9 } },
        },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  } as ChartConfiguration<'bar'>);
}

// ─── Category Trend stacked bar chart (Reports) ───────────────────────────────
let categoryTrendChart: Chart | null = null;

export function updateCategoryTrendChart(
  monthLabels: string[],
  catMonthlyMap: Record<string, number[]>,
): void {
  categoryTrendChart = destroyIfExists(categoryTrendChart);
  const canvas = document.getElementById('chartCatTrend') as HTMLCanvasElement | null;
  if (!canvas) return;

  const isDark = db.theme === 'dark';

  // Pick top-8 categories by total spend
  const catTotals = Object.entries(catMonthlyMap)
    .map(([cat, values]) => ({ cat, total: values.reduce((a, b) => a + b, 0) }))
    .filter(e => e.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  if (catTotals.length === 0) {
    const wrap = canvas.closest<HTMLElement>('.cat-trend-wrap');
    if (wrap) wrap.style.display = 'none';
    return;
  }
  const wrap = canvas.closest<HTMLElement>('.cat-trend-wrap');
  if (wrap) wrap.style.display = '';

  const palette = [
    '#6366f1', '#f43f5e', '#f59e0b', '#10b981',
    '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
  ];

  const datasets = catTotals.map(({ cat, total: _total }, i) => ({
    label: cat,
    data: catMonthlyMap[cat],
    backgroundColor: palette[i % palette.length],
    borderRadius: 3,
    borderSkipped: false as const,
    stack: 'stack0',
  }));

  categoryTrendChart = new Chart(canvas.getContext('2d')!, {
    type: 'bar',
    data: { labels: monthLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top' as const,
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            font: { size: 10 },
            color: isDark ? '#94a3b8' : '#64748b',
          },
        },
        datalabels: { display: false },
        tooltip: {
          mode: 'index' as const,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${sym()}${fmt(ctx.raw as number)}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { size: 10 }, color: isDark ? '#94a3b8' : '#64748b' },
        },
        y: {
          stacked: true,
          grid: { color: isDark ? '#1e293b' : '#f1f5f9' },
          ticks: {
            font: { size: 9 },
            color: isDark ? '#94a3b8' : '#64748b',
            callback: (v) => `${sym()}${fmt(v as number)}`,
          },
        },
      },
    },
  } as ChartConfiguration<'bar'>);
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
  let monthsWithData = 0;
  const fireD = new Date();
  fireD.setMonth(fireD.getMonth() - (FIRE_ROLLING_MONTHS - 1));
  for (let i = 0; i < FIRE_ROLLING_MONTHS; i++) {
    const fk = `${fireD.getFullYear()}-${String(fireD.getMonth() + 1).padStart(2, '0')}`;
    const txs = db.transactions[fk] ?? [];
    let monthExp = 0;
    txs.forEach(t => { if (t.type === 'expense') monthExp += math(t.amount); });
    totalSpent += monthExp;
    if (monthExp > 0) { hasData = true; monthsWithData++; }
    fireD.setMonth(fireD.getMonth() + 1);
  }
  // Divide by actual months with data so a new user with 1 month of expenses
  // doesn't get their FIRE target deflated by 5 empty months in the rolling window.
  const avgMonthlyExp = monthsWithData > 0 ? totalSpent / monthsWithData : FIRE_DEFAULT_EXP;
  const fireTarget = avgMonthlyExp * 12 * FIRE_MULTIPLIER;
  const progress = Math.min(Math.max((currentNet / fireTarget) * 100, 0), 100);
  return { avgMonthlyExp, fireTarget, progress, hasData };
}
