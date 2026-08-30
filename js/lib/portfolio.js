// 銘柄・ポジション・取引を組み立てて、画面が必要とする形に整える層。
// もとは Python の app/portfolio.py。

import { aggregate, computePosition, dividendMonths, EPSILON, evaluate, sortTransactions } from './models.js?v=202608302325';
import { evaluateDefensive, evaluateSectors, evaluateStockDividends } from './rules.js?v=202608302325';

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function buildPositionView(position, stock, transactions) {
  const metrics = computePosition(transactions);
  return {
    ...position,
    code: stock.code,
    name: stock.name,
    sector: stock.sector,
    classification: stock.classification,
    transaction_count: transactions.length,
    metrics: evaluate(metrics, stock.dividend_per_share || 0, stock.market_price),
  };
}

/** 銘柄単位の合計。複数ロットは合算した数値も併せて返す。 */
function buildStockView(stock, positions) {
  const sum = (key) => positions.reduce((acc, p) => acc + p.metrics[key], 0);
  const shares = sum('shares');
  const cost = sum('cost');

  const rolled = {
    shares,
    cost,
    avg_price: shares > EPSILON ? cost / shares : 0,
    realized_pl: sum('realized_pl'),
    gross_buy: sum('gross_buy'),
    gross_sell: sum('gross_sell'),
    total_fee: sum('total_fee'),
    buy_count: sum('buy_count'),
    sell_count: sum('sell_count'),
    split_count: sum('split_count'),
    first_trade_date: null,
    last_trade_date: null,
  };

  return {
    ...stock,
    dividend_months: dividendMonths(stock.fiscal_month, Boolean(stock.pays_interim ?? 1)),
    positions,
    position_count: positions.length,
    metrics: evaluate(rolled, stock.dividend_per_share || 0, stock.market_price),
  };
}

export function listStockViews(store) {
  const byPosition = new Map();
  for (const tx of store.doc.transactions) {
    if (!byPosition.has(tx.position_id)) byPosition.set(tx.position_id, []);
    byPosition.get(tx.position_id).push(tx);
  }

  const stockById = new Map(store.doc.stocks.map((s) => [s.id, s]));
  const byStock = new Map();
  for (const position of store.listPositions()) {
    const stock = stockById.get(position.stock_id);
    if (!stock) continue;
    if (!byStock.has(stock.id)) byStock.set(stock.id, []);
    byStock.get(stock.id).push(
      buildPositionView(position, stock, byPosition.get(position.id) || []),
    );
  }

  return store.listStocks().map((s) => buildStockView(s, byStock.get(s.id) || []));
}

export function getStockView(store, stockId) {
  const stock = store.getStock(stockId);
  const positions = store.listPositions(stock.id).map((p) => (
    buildPositionView(p, stock, store.listTransactions(p.id))
  ));
  const view = buildStockView(stock, positions);
  const positionIds = new Set(positions.map((p) => p.id));

  view.dividend_history = store.getDividendHistory(stock.id);
  view.profit_history = store.getProfitHistory(stock.id);
  view.transactions = sortTransactions(
    store.doc.transactions.filter((t) => positionIds.has(t.position_id)),
  ).map((t) => ({ ...t, stock_id: stock.id }));
  return view;
}

/** 全取引を新しい順に返す(取引台帳ビュー用)。 */
export function listAllTransactions(store) {
  const positionById = new Map(store.doc.positions.map((p) => [p.id, p]));
  const stockById = new Map(store.doc.stocks.map((s) => [s.id, s]));

  const rows = store.doc.transactions.map((tx) => {
    const position = positionById.get(tx.position_id);
    const stock = position ? stockById.get(position.stock_id) : null;
    return {
      ...tx,
      stock_id: stock ? stock.id : null,
      position_label: position ? position.label : '',
      code: stock ? stock.code : '',
      name: stock ? stock.name : '',
      sector: stock ? stock.sector : '',
    };
  }).filter((t) => t.stock_id !== null);

  return sortTransactions(rows).reverse();
}

function groupBreakdown(views, key) {
  const buckets = new Map();
  for (const v of views) {
    if (v.metrics.shares <= EPSILON) continue;
    const label = String(v[key] || '').trim() || '未分類';
    if (!buckets.has(label)) {
      buckets.set(label, { cost: 0, dividend: 0, market_value: 0, count: 0 });
    }
    const b = buckets.get(label);
    b.cost += v.metrics.cost;
    b.dividend += v.metrics.annual_dividend;
    b.market_value += v.metrics.market_value;
    b.count += 1;
  }

  const total = [...buckets.values()].reduce((sum, b) => sum + b.cost, 0) || 1;
  return [...buckets.entries()]
    .map(([label, b]) => ({
      label,
      cost: round(b.cost, 2),
      dividend: round(b.dividend, 2),
      market_value: round(b.market_value, 2),
      count: b.count,
      share_pct: round((b.cost / total) * 100, 2),
      yield_pct: b.cost > 0 ? round((b.dividend / b.cost) * 100, 3) : 0,
    }))
    .sort((a, b) => b.cost - a.cost);
}

function undatedTransactions(store) {
  const positionById = new Map(store.doc.positions.map((p) => [p.id, p]));
  const stockById = new Map(store.doc.stocks.map((s) => [s.id, s]));
  return store.doc.transactions
    .filter((t) => !t.trade_date)
    .map((t) => {
      const position = positionById.get(t.position_id);
      const stock = position ? stockById.get(position.stock_id) : null;
      return {
        id: t.id, position_id: t.position_id,
        code: stock ? stock.code : '', name: stock ? stock.name : '',
      };
    })
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

export function dashboard(store) {
  const views = listStockViews(store);
  const held = views.filter((v) => v.metrics.shares > EPSILON);
  const settings = store.getSettings();

  const summary = aggregate(views.map((v) => v.metrics));
  summary.stock_count = views.length;
  summary.position_count = views.reduce((sum, v) => sum + v.position_count, 0);
  summary.priced_count = held.filter((v) => v.market_price).length;

  const bySector = groupBreakdown(views, 'sector');
  const byClassification = groupBreakdown(views, 'classification');
  const sectorRule = evaluateSectors(bySector, settings.max_sector_pct);
  const dividendRule = evaluateStockDividends(views, settings.max_stock_dividend_pct);
  const defensiveRule = evaluateDefensive(byClassification, settings.min_defensive_pct);

  const brief = (v) => ({
    id: v.id, code: v.code, name: v.name, sector: v.sector,
    classification: v.classification,
    annual_dividend: v.metrics.annual_dividend,
    yield_on_cost: v.metrics.yield_on_cost,
    cost: v.metrics.cost,
    unrealized_pl_pct: v.metrics.unrealized_pl_pct,
    market_price: v.market_price,
  });

  return {
    summary,
    rules: { sector: sectorRule, stock_dividend: dividendRule, defensive: defensiveRule },
    by_sector: bySector,
    by_classification: byClassification,
    top_dividend: [...held]
      .sort((a, b) => b.metrics.annual_dividend - a.metrics.annual_dividend)
      .slice(0, 10).map(brief),
    top_yield: [...held]
      .sort((a, b) => b.metrics.yield_on_cost - a.metrics.yield_on_cost)
      .slice(0, 10).map(brief),
    needs_attention: {
      no_market_price: held.filter((v) => !v.market_price)
        .map((v) => ({ id: v.id, code: v.code, name: v.name })),
      undated_transactions: undatedTransactions(store),
      sector_over_limit: sectorRule.over.map((r) => ({
        label: r.label, share_pct: r.share_pct, headroom: r.headroom,
      })),
      defensive_short: defensiveRule.passing ? [] : [{
        share_pct: defensiveRule.defensive_share_pct,
        min_pct: defensiveRule.min_pct,
        shortfall: defensiveRule.shortfall,
        shortfall_amount: defensiveRule.shortfall_amount,
      }],
      dividend_over_limit: dividendRule.over.map((r) => ({
        id: r.id, code: r.code, name: r.name,
        share_pct: r.share_pct, headroom: r.headroom, headroom_shares: r.headroom_shares,
      })),
    },
  };
}
