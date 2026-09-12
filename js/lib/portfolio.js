// 銘柄・ポジション・取引を組み立てて、画面が必要とする形に整える層。
// もとは Python の app/portfolio.py。

import {
  aggregate, computePosition, dividendMonths, EPSILON, evaluate, firstBuy, sortTransactions,
} from './models.js?v=202609121924';
import {
  evaluateDefensive, evaluateSectors, evaluateStockDividends, planAveraging,
} from './rules.js?v=202609121924';
import { lotName } from './format.js?v=202609121924';

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function buildPositionView(position, stock, transactions, settings = {}) {
  const metrics = computePosition(transactions);
  // ナンピンはロット単位で見る。ロットごとに買い始めた値段が違うため
  const base = firstBuy(transactions);
  // 振替で始まったロット(分割で切り出した分)は、その受入を 1 回目と数える
  const acquisitions = metrics.buy_count + (base?.from_transfer ? 1 : 0);
  const plan = planAveraging(
    { basePrice: base?.price ?? null, buyCount: acquisitions, marketPrice: stock.market_price },
    dropsOf(settings),
  );
  return {
    ...position,
    code: stock.code,
    name: stock.name,
    sector: stock.sector,
    classification: stock.classification,
    transaction_count: transactions.length,
    first_buy: base,
    // 打止めにしたロットは、目安は残したまま買い時としては扱わない
    averaging: plan && position.averaging_stopped
      ? { ...plan, stopped: true, actionable: false }
      : plan,
    metrics: evaluate(metrics, stock.dividend_per_share || 0, stock.market_price),
  };
}

function dropsOf(settings) {
  return [settings.second_buy_drop_pct, settings.third_buy_drop_pct].filter((v) => v > 0);
}

/**
 * 銘柄としての代表になるロットを選ぶ。
 *
 * まだ買い増す余地のあるロット(打止めでなく、次の回が残っている)を優先し、
 * その中では買い時のもの、目安に近いものを先に見る。そうしたロットが
 * 1 つも無いときだけ、打止めや買い終えたロットを代表にする。
 * つまり「打止め」と出るのは、全ロットが打止めのときに限られる。
 */
function leadingLot(positions) {
  const held = positions.filter((p) => p.metrics.shares > EPSILON && p.averaging);
  if (!held.length) return null;

  const open = held.filter((p) => !p.averaging.stopped && p.averaging.next);
  const pool = open.length ? open : held;
  const sorted = [...pool].sort((a, b) => {
    // 打止めは最後に回す(「完了」のほうが伝える情報が多い)
    const stopped = Number(Boolean(a.averaging.stopped)) - Number(Boolean(b.averaging.stopped));
    if (stopped) return stopped;
    if (a.averaging.actionable !== b.averaging.actionable) return a.averaging.actionable ? -1 : 1;
    return (a.averaging.next?.gap_pct ?? Infinity) - (b.averaging.next?.gap_pct ?? Infinity);
  });
  const lot = sorted[0];
  return {
    ...lot.averaging,
    position_id: lot.id,
    position_label: lotName(lot, positions.indexOf(lot)),
  };
}

/**
 * 銘柄の状態。
 * - held      : いま持っている
 * - candidate : まだ一度も買っていない(購入候補)
 * - sold      : 買ったが売り切った
 */
function stockStatus(rolled) {
  if (rolled.shares > EPSILON) return 'held';
  return rolled.buy_count > 0 ? 'sold' : 'candidate';
}

/** 銘柄単位の合計。複数ロットは合算した数値も併せて返す。 */
function buildStockView(stock, positions, settings = {}) {
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
    // 一度も買っていない銘柄は購入候補。売り切った銘柄とは区別する
    status: stockStatus(rolled),
    // 銘柄としては、いちばん買い時に近いロットを代表として見せる
    averaging: leadingLot(positions),
    metrics: evaluate(rolled, stock.dividend_per_share || 0, stock.market_price),
  };
}

export function listStockViews(store) {
  const byPosition = new Map();
  for (const tx of store.doc.transactions) {
    if (!byPosition.has(tx.position_id)) byPosition.set(tx.position_id, []);
    byPosition.get(tx.position_id).push(tx);
  }

  const settings = store.getSettings();
  const stockById = new Map(store.doc.stocks.map((s) => [s.id, s]));
  const byStock = new Map();
  for (const position of store.listPositions()) {
    const stock = stockById.get(position.stock_id);
    if (!stock) continue;
    if (!byStock.has(stock.id)) byStock.set(stock.id, []);
    byStock.get(stock.id).push(
      buildPositionView(position, stock, byPosition.get(position.id) || [], settings),
    );
  }

  return store.listStocks().map((s) => buildStockView(s, byStock.get(s.id) || [], settings));
}

export function getStockView(store, stockId) {
  const stock = store.getStock(stockId);
  const settings = store.getSettings();
  const positions = store.listPositions(stock.id).map((p) => (
    buildPositionView(p, stock, store.listTransactions(p.id), settings)
  ));
  const view = buildStockView(stock, positions, settings);
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
  // 名前の無いロットを「ロット1」と呼ぶため、銘柄の中での位置を控えておく
  const orderInStock = new Map();
  for (const stock of store.doc.stocks) {
    store.listPositions(stock.id).forEach((p, i) => orderInStock.set(p.id, i));
  }

  const rows = store.doc.transactions.map((tx) => {
    const position = positionById.get(tx.position_id);
    const stock = position ? stockById.get(position.stock_id) : null;
    return {
      ...tx,
      stock_id: stock ? stock.id : null,
      position_label: position ? lotName(position, orderInStock.get(position.id) ?? 0) : '',
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

  // ナンピンの買い時。近いものも添えて、近い順に並べる
  const withPlan = held.filter(
    (v) => v.averaging && v.averaging.next && v.market_price && !v.averaging.stopped,
  );
  const brief = (v) => ({
    id: v.id, code: v.code, name: v.name, sector: v.sector, classification: v.classification,
    market_price: v.market_price,
    position_label: v.averaging.position_label,
    // 同じ銘柄でもロットごとに基準が違うので、どのロットの話か添える
    multi_lot: v.position_count > 1,
    base_price: v.averaging.base_price,
    change_pct: v.averaging.change_pct,
    round: v.averaging.next.round,
    target_price: v.averaging.next.target_price,
    gap_pct: v.averaging.next.gap_pct,
    drop_pct: v.averaging.next.drop_pct,
  });
  const byGap = (a, b) => a.gap_pct - b.gap_pct;

  return {
    summary,
    rules: { sector: sectorRule, stock_dividend: dividendRule, defensive: defensiveRule },
    averaging: {
      second_drop_pct: settings.second_buy_drop_pct,
      third_drop_pct: settings.third_buy_drop_pct,
      ready: withPlan.filter((v) => v.averaging.actionable).map(brief).sort(byGap),
      near: withPlan.filter((v) => !v.averaging.actionable && v.averaging.next.status === 'near')
        .map(brief).sort(byGap),
      watching: withPlan.length,
      completed: held.filter((v) => v.averaging?.completed).length,
    },
    by_sector: bySector,
    by_classification: byClassification,
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
