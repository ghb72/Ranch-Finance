/**
 * reports.js - Reports and charts view
 * Shows summary cards and Chart.js graphs
 */
import Chart from 'chart.js/auto';
import { getTransactionsByDateRange, getSummary } from '../db.js';
import { formatCurrency, getPeriodDates } from '../utils.js';

let barChart = null;
let doughnutChart = null;
let currentPeriod = 'month';

/**
 * Render the reports view
 */
export async function renderReports() {
  const container = document.getElementById('view-reports');
  container.classList.add('active');

  container.innerHTML = `
    <div class="header">
      <h1 class="header__title">📊 Reportes</h1>
    </div>

    <div class="reports-header">
      <button class="period-btn ${currentPeriod === 'day' ? 'active' : ''}" data-period="day">Hoy</button>
      <button class="period-btn ${currentPeriod === 'week' ? 'active' : ''}" data-period="week">Semana</button>
      <button class="period-btn ${currentPeriod === 'month' ? 'active' : ''}" data-period="month">Mes</button>
      <button class="period-btn ${currentPeriod === 'year' ? 'active' : ''}" data-period="year">Año</button>
    </div>

    <div class="summary-grid" id="summary-grid">
      <!-- Populated dynamically -->
    </div>

    <div class="chart-card">
      <div class="chart-card__title">Ingresos vs Gastos</div>
      <div class="chart-container">
        <canvas id="chart-bar"></canvas>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-card__title">Distribución</div>
      <div class="chart-container">
        <canvas id="chart-doughnut"></canvas>
      </div>
    </div>
  `;

  // Period button listeners
  container.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentPeriod = btn.dataset.period;
      container.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateCharts();
    });
  });

  await updateCharts();
}

/**
 * Update summary cards and charts for the current period
 */
async function updateCharts() {
  const { start, end } = getPeriodDates(currentPeriod);
  const summary = await getSummary(start, end);
  const transactions = await getTransactionsByDateRange(start, end);

  // Update summary cards
  const summaryGrid = document.getElementById('summary-grid');
  if (summaryGrid) {
    summaryGrid.innerHTML = `
      <div class="summary-card">
        <div class="summary-card__label">Ingresos</div>
        <div class="summary-card__value text-green">${formatCurrency(summary.totalIngresos)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Gastos</div>
        <div class="summary-card__value text-red">${formatCurrency(summary.totalGastos)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Balance</div>
        <div class="summary-card__value ${summary.balance >= 0 ? 'text-green' : 'text-red'}">
          ${formatCurrency(summary.balance)}
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Transacciones</div>
        <div class="summary-card__value text-blue">${summary.transacciones}</div>
      </div>
    `;
  }

  // Prepare chart data
  const chartData = prepareChartData(transactions);

  // Update bar chart
  updateBarChart(chartData);

  // Update doughnut chart
  updateDoughnutChart(summary);
}

/**
 * Prepare daily aggregated data for charts
 */
function prepareChartData(transactions) {
  const dailyData = {};

  transactions.forEach((t) => {
    const day = t.fecha;
    if (!dailyData[day]) {
      dailyData[day] = { ingresos: 0, gastos: 0 };
    }
    if (t.tipo === 'ingreso') {
      dailyData[day].ingresos += t.monto;
    } else {
      dailyData[day].gastos += t.monto;
    }
  });

  // Sort by date
  const sortedDays = Object.keys(dailyData).sort();
  const labels = sortedDays.map((d) => {
    const date = new Date(d + 'T12:00:00');
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  });

  return {
    labels,
    ingresos: sortedDays.map((d) => dailyData[d].ingresos),
    gastos: sortedDays.map((d) => dailyData[d].gastos),
  };
}

/**
 * Update the bar chart
 */
function updateBarChart(data) {
  const canvas = document.getElementById('chart-bar');
  if (!canvas) return;

  // Destroy existing chart
  if (barChart) {
    barChart.destroy();
    barChart = null;
  }

  const ctx = canvas.getContext('2d');

  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels.length > 0 ? data.labels : ['Sin datos'],
      datasets: [
        {
          label: 'Ingresos',
          data: data.ingresos.length > 0 ? data.ingresos : [0],
          backgroundColor: 'rgba(0, 214, 143, 0.7)',
          borderColor: '#00d68f',
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: 'Gastos',
          data: data.gastos.length > 0 ? data.gastos : [0],
          backgroundColor: 'rgba(255, 107, 107, 0.7)',
          borderColor: '#ff6b6b',
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#8b8da3',
            font: { family: 'Inter', size: 12 },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#5a5c72', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          ticks: {
            color: '#5a5c72',
            font: { size: 10 },
            callback: (v) => '$' + v.toLocaleString(),
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

/**
 * Update the doughnut chart
 */
function updateDoughnutChart(summary) {
  const canvas = document.getElementById('chart-doughnut');
  if (!canvas) return;

  if (doughnutChart) {
    doughnutChart.destroy();
    doughnutChart = null;
  }

  const ctx = canvas.getContext('2d');
  const hasData = summary.totalIngresos > 0 || summary.totalGastos > 0;

  doughnutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: hasData ? ['Ingresos', 'Gastos'] : ['Sin datos'],
      datasets: [
        {
          data: hasData ? [summary.totalIngresos, summary.totalGastos] : [1],
          backgroundColor: hasData
            ? ['rgba(0, 214, 143, 0.8)', 'rgba(255, 107, 107, 0.8)']
            : ['rgba(90, 92, 114, 0.3)'],
          borderColor: hasData
            ? ['#00d68f', '#ff6b6b']
            : ['rgba(90, 92, 114, 0.5)'],
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#8b8da3',
            font: { family: 'Inter', size: 13 },
            padding: 20,
          },
        },
      },
    },
  });
}
