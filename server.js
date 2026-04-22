const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const NAVER_BASE_URL = "https://m.stock.naver.com";
const REQUEST_TIMEOUT_MS = 8000;
const PURCHASE_DATE = "2026-03-31";
const HISTORY_PAGE_SIZE = 60;
const MAX_HISTORY_PAGES = 20;

const STARTING_CASH = 250000;
const HOLDINGS = [
  {
    key: "samsung",
    name: "삼성전자",
    code: "005930",
    quantity: 1,
    averagePrice: 169100,
  },
  {
    key: "sol_ai_top2_plus",
    name: "SOL AI반도체TOP2플러스 ETF",
    code: "0167A0",
    quantity: 9,
    averagePrice: 9200,
  },
];

function parseKoreanNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json, text/plain, */*",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBasicQuote(code) {
  const data = await fetchWithTimeout(`${NAVER_BASE_URL}/api/stock/${code}/basic`);
  return {
    code: data.itemCode,
    name: data.stockName,
    marketStatus: data.marketStatus,
    localTradedAt: data.localTradedAt,
    currentPrice: parseKoreanNumber(data.closePrice),
    dayChange: parseKoreanNumber(data.compareToPreviousClosePrice),
    dayChangeRate: Number(data.fluctuationsRatio),
  };
}

async function fetchPriceHistory(code, options = {}) {
  const { days = 60, fromDate } = options;
  const rowsDesc = [];

  for (let page = 1; page <= MAX_HISTORY_PAGES; page += 1) {
    const pageData = await fetchWithTimeout(
      `${NAVER_BASE_URL}/api/stock/${code}/price?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`
    );

    if (!Array.isArray(pageData) || pageData.length === 0) {
      break;
    }

    rowsDesc.push(...pageData);

    const oldestDate = pageData[pageData.length - 1]?.localTradedAt;
    if (fromDate && oldestDate && oldestDate < fromDate) {
      break;
    }

    if (!fromDate && rowsDesc.length >= days) {
      break;
    }

    if (pageData.length < HISTORY_PAGE_SIZE) {
      break;
    }
  }

  const selectedRows = fromDate ? rowsDesc : rowsDesc.slice(0, days);
  const points = selectedRows
    .map((item) => ({
      date: item.localTradedAt,
      close: parseKoreanNumber(item.closePrice),
    }))
    .reverse();

  return fromDate ? points.filter((point) => point.date >= fromDate) : points;
}

function computeInvested() {
  return HOLDINGS.reduce(
    (sum, holding) => sum + holding.averagePrice * holding.quantity,
    0
  );
}

async function buildQuotePayload() {
  const quotes = await Promise.all(HOLDINGS.map((holding) => fetchBasicQuote(holding.code)));

  let newestTimestamp = null;
  const positions = HOLDINGS.map((holding) => {
    const quote = quotes.find((item) => item.code === holding.code);
    const currentPrice = quote?.currentPrice ?? 0;
    const invested = holding.averagePrice * holding.quantity;
    const valuation = currentPrice * holding.quantity;
    const pnl = valuation - invested;
    const pnlRate = invested === 0 ? 0 : (pnl / invested) * 100;

    if (quote?.localTradedAt) {
      const timestamp = new Date(quote.localTradedAt);
      if (!Number.isNaN(timestamp.valueOf())) {
        if (!newestTimestamp || timestamp > newestTimestamp) {
          newestTimestamp = timestamp;
        }
      }
    }

    return {
      ...holding,
      invested,
      currentPrice,
      valuation,
      pnl,
      pnlRate,
      marketStatus: quote?.marketStatus ?? "UNKNOWN",
      localTradedAt: quote?.localTradedAt ?? null,
      dayChange: quote?.dayChange ?? 0,
      dayChangeRate: quote?.dayChangeRate ?? 0,
    };
  });

  const totalInvested = positions.reduce((sum, pos) => sum + pos.invested, 0);
  const totalValuation = positions.reduce((sum, pos) => sum + pos.valuation, 0);
  const totalPnl = totalValuation - totalInvested;
  const totalPnlRate = totalInvested === 0 ? 0 : (totalPnl / totalInvested) * 100;

  return {
    updatedAt: newestTimestamp ? newestTimestamp.toISOString() : new Date().toISOString(),
    positions,
    summary: {
      totalInvested,
      totalValuation,
      totalPnl,
      totalPnlRate,
      startingCash: STARTING_CASH,
      cashDifference: STARTING_CASH - totalInvested,
      purchaseDate: PURCHASE_DATE,
    },
  };
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/portfolio", (req, res) => {
  const invested = computeInvested();
  res.json({
    purchaseDate: PURCHASE_DATE,
    startingCash: STARTING_CASH,
    invested,
    cashDifference: STARTING_CASH - invested,
    holdings: HOLDINGS,
  });
});

app.get("/api/quotes", async (req, res) => {
  try {
    const payload = await buildQuotePayload();
    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(502).json({
      message: "실시간 시세 조회에 실패했습니다.",
      detail: error.message,
    });
  }
});

app.get("/api/history", async (req, res) => {
  const rawDays = Number(req.query.days);
  const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 10), 250) : 60;
  const fromDate =
    typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : null;

  try {
    const series = await Promise.all(
      HOLDINGS.map(async (holding) => ({
        code: holding.code,
        name: holding.name,
        points: await fetchPriceHistory(holding.code, { days, fromDate }),
      }))
    );

    res.json({
      days,
      fromDate,
      series,
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({
      message: "차트 데이터 조회에 실패했습니다.",
      detail: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
