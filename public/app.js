const REFRESH_INTERVAL_MS = 5000;
const HISTORY_REFRESH_INTERVAL_MS = 60000;

const krwFormatter = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const state = {
  instrumentCharts: {},
  pnlChart: null,
  purchaseDate: null,
  latestPositions: [],
  lastTradingDate: null,
};

const INSTRUMENT_CHART_META = {
  "005930": {
    canvasId: "samsungChart",
    titleId: "samsungChartTitle",
    title: "삼성전자 종가 추이",
    borderColor: "#0b57d0",
    backgroundColor: "rgba(11, 87, 208, 0.08)",
  },
  "0167A0": {
    canvasId: "etfChart",
    titleId: "etfChartTitle",
    title: "SOL AI반도체TOP2플러스 ETF 종가 추이",
    borderColor: "#f57c00",
    backgroundColor: "rgba(245, 124, 0, 0.08)",
  },
};

function formatKRW(value) {
  return krwFormatter.format(value ?? 0);
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${percentFormatter.format(value ?? 0)}%`;
}

function setStatus(text, className) {
  const badge = document.getElementById("statusBadge");
  badge.textContent = text;
  badge.className = `status ${className}`;
}

function formatDateShort(dateString) {
  const date = new Date(`${dateString}T00:00:00+09:00`);
  return date.toLocaleDateString("ko-KR");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`요청 실패: ${response.status}`);
  }
  return response.json();
}

function renderSummary(summary) {
  const pnlClass = summary.totalPnl > 0 ? "up" : summary.totalPnl < 0 ? "down" : "";

  document.getElementById("totalInvested").textContent = formatKRW(summary.totalInvested);
  document.getElementById("totalValuation").textContent = formatKRW(summary.totalValuation);

  const totalPnlEl = document.getElementById("totalPnl");
  totalPnlEl.textContent = formatKRW(summary.totalPnl);
  totalPnlEl.className = pnlClass;

  const totalPnlRateEl = document.getElementById("totalPnlRate");
  totalPnlRateEl.textContent = formatPercent(summary.totalPnlRate);
  totalPnlRateEl.className = pnlClass;
}

function renderRows(positions) {
  const tbody = document.getElementById("positionRows");
  tbody.innerHTML = "";

  positions.forEach((position) => {
    const tr = document.createElement("tr");
    const pnlClass = position.pnl > 0 ? "up" : position.pnl < 0 ? "down" : "";

    tr.innerHTML = `
      <td>${position.name} (${position.code})</td>
      <td>${position.quantity.toLocaleString("ko-KR")}주</td>
      <td>${formatKRW(position.averagePrice)}</td>
      <td>${formatKRW(position.currentPrice)}</td>
      <td>${formatKRW(position.valuation)}</td>
      <td class="${pnlClass}">${formatKRW(position.pnl)}</td>
      <td class="${pnlClass}">${formatPercent(position.pnlRate)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderChartTitles(purchaseDate) {
  const suffix = `${formatDateShort(purchaseDate)} 이후`;
  Object.values(INSTRUMENT_CHART_META).forEach((meta) => {
    const el = document.getElementById(meta.titleId);
    if (!el) {
      return;
    }
    el.textContent = `${meta.title} (${suffix})`;
  });

  const portfolioTitle = document.getElementById("portfolioTrendTitle");
  if (portfolioTitle) {
    portfolioTitle.textContent = `총 자산/손익 추이 (종가 기준, ${suffix})`;
  }
}

function prepareInstrumentCharts(seriesPayload) {
  seriesPayload.forEach((series) => {
    const meta = INSTRUMENT_CHART_META[series.code];
    if (!meta) {
      return;
    }

    const canvas = document.getElementById(meta.canvasId);
    if (!canvas) {
      return;
    }

    const labels = series.points.map((point) => point.date);
    const values = series.points.map((point) => point.close);

    const existingChart = state.instrumentCharts[series.code];
    if (existingChart) {
      existingChart.data.labels = labels;
      existingChart.data.datasets[0].data = values;
      existingChart.update("none");
      return;
    }

    state.instrumentCharts[series.code] = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: `${series.name} (${series.code})`,
            code: series.code,
            data: values,
            borderColor: meta.borderColor,
            backgroundColor: meta.backgroundColor,
            borderWidth: 2,
            fill: true,
            tension: 0.15,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            ticks: {
              callback(value) {
                return formatKRW(value);
              },
            },
          },
        },
      },
    });
  });
}

function buildPortfolioTrendPoints(seriesPayload, positions, purchaseDate) {
  const closeByCode = {};
  const dateSet = new Set();

  seriesPayload.forEach((series) => {
    closeByCode[series.code] = new Map();
    series.points.forEach((point) => {
      if (point.date >= purchaseDate) {
        dateSet.add(point.date);
        closeByCode[series.code].set(point.date, point.close);
      }
    });
  });

  const allDates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  const labels = [];
  const valuations = [];
  const pnls = [];
  const totalInvested = positions.reduce((sum, position) => sum + position.invested, 0);

  for (const date of allDates) {
    let valuation = 0;
    let isComplete = true;

    for (const position of positions) {
      const close = closeByCode[position.code]?.get(date);
      if (close === undefined) {
        isComplete = false;
        break;
      }
      valuation += close * position.quantity;
    }

    if (!isComplete) {
      continue;
    }

    labels.push(date);
    valuations.push(valuation);
    pnls.push(valuation - totalInvested);
  }

  return { labels, valuations, pnls };
}

function preparePortfolioTrendChart(trendPoints) {
  if (state.pnlChart) {
    state.pnlChart.data.labels = trendPoints.labels;
    state.pnlChart.data.datasets[0].data = trendPoints.valuations;
    state.pnlChart.data.datasets[1].data = trendPoints.pnls;
    state.pnlChart.update("none");
    return;
  }

  const ctx = document.getElementById("pnlChart");
  state.pnlChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: trendPoints.labels,
      datasets: [
        {
          label: "총 평가금액",
          data: trendPoints.valuations,
          borderColor: "#1d4ed8",
          backgroundColor: "rgba(29, 78, 216, 0.08)",
          borderWidth: 2,
          fill: true,
          tension: 0.15,
          yAxisID: "y",
        },
        {
          label: "총 손익",
          data: trendPoints.pnls,
          borderColor: "#15803d",
          backgroundColor: "rgba(21, 128, 61, 0.08)",
          borderWidth: 2,
          fill: false,
          tension: 0.15,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
      },
      scales: {
        y: {
          position: "left",
          ticks: {
            callback(value) {
              return formatKRW(value);
            },
          },
        },
        y1: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: {
            callback(value) {
              return formatKRW(value);
            },
          },
        },
      },
    },
  });
}

async function refreshHistoryCharts() {
  if (!state.purchaseDate) {
    return;
  }

  try {
    const history = await fetchJson(`/api/history?from=${encodeURIComponent(state.purchaseDate)}`);

    let positions = state.latestPositions;
    if (!Array.isArray(positions) || positions.length === 0) {
      const quotes = await fetchJson("/api/quotes");
      positions = quotes.positions;
      state.latestPositions = quotes.positions;
    }

    prepareInstrumentCharts(history.series);
    preparePortfolioTrendChart(buildPortfolioTrendPoints(history.series, positions, state.purchaseDate));
  } catch (error) {
    console.error(error);
  }
}

async function initialize() {
  try {
    setStatus("로딩 중", "pending");
    const portfolio = await fetchJson("/api/portfolio");
    const purchaseDate = portfolio.purchaseDate || "2026-03-31";
    state.purchaseDate = purchaseDate;

    const [history, quotes] = await Promise.all([
      fetchJson(`/api/history?from=${encodeURIComponent(purchaseDate)}`),
      fetchJson("/api/quotes"),
    ]);
    state.latestPositions = quotes.positions;
    state.lastTradingDate = String(quotes.updatedAt).slice(0, 10);

    renderChartTitles(purchaseDate);
    prepareInstrumentCharts(history.series);
    preparePortfolioTrendChart(
      buildPortfolioTrendPoints(history.series, quotes.positions, purchaseDate)
    );

    renderRows(quotes.positions);
    renderSummary(quotes.summary);
    document.getElementById("updatedAt").textContent = new Date(quotes.updatedAt).toLocaleString(
      "ko-KR"
    );
    setStatus("실시간 연결됨", "ok");
  } catch (error) {
    console.error(error);
    setStatus("초기 로딩 실패", "error");
  }
}

async function refreshQuotes() {
  try {
    const quotes = await fetchJson("/api/quotes");
    state.latestPositions = quotes.positions;
    renderRows(quotes.positions);
    renderSummary(quotes.summary);
    document.getElementById("updatedAt").textContent = new Date(quotes.updatedAt).toLocaleString(
      "ko-KR"
    );

    const nextTradingDate = String(quotes.updatedAt).slice(0, 10);
    if (state.lastTradingDate && state.lastTradingDate !== nextTradingDate) {
      state.lastTradingDate = nextTradingDate;
      await refreshHistoryCharts();
    } else {
      state.lastTradingDate = nextTradingDate;
    }

    setStatus("실시간 연결됨", "ok");
  } catch (error) {
    console.error(error);
    setStatus("조회 실패, 재시도 중", "error");
  }
}

initialize().finally(() => {
  setInterval(refreshQuotes, REFRESH_INTERVAL_MS);
  setInterval(refreshHistoryCharts, HISTORY_REFRESH_INTERVAL_MS);
});
