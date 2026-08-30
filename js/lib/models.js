// ポートフォリオの計算ロジック。
//
// 取引台帳(BUY / SELL / SPLIT)を時系列に畳み込んで、保有株数・取得原価・
// 平均取得単価・実現損益を求める。取得原価は総平均法(移動平均)で扱う。
//
// もとは Python の app/models.py。挙動を変えないよう 1 対 1 で移植している。

export const BUY = 'BUY';
export const SELL = 'SELL';
export const SPLIT = 'SPLIT';
export const TX_TYPES = [BUY, SELL, SPLIT];

// 浮動小数の丸め誤差で「ごく僅かに残った株数」を保有扱いしないための閾値
export const EPSILON = 1e-9;

export class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerError';
  }
}

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 日付未設定の取引を最も古いものとして先頭に置く並び順。 */
export function sortTransactions(transactions) {
  return [...transactions].sort((a, b) => {
    const da = (a.trade_date || '').trim();
    const db = (b.trade_date || '').trim();
    const ha = da ? 1 : 0;
    const hb = db ? 1 : 0;
    if (ha !== hb) return ha - hb;
    if (da !== db) return da < db ? -1 : 1;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}

/** 分割比率。split_from:split_to = 1:2 なら 2.0(併合なら 1 未満)。 */
export function splitRatio(tx) {
  const from = num(tx.split_from);
  const to = num(tx.split_to);
  if (from <= 0 || to <= 0) {
    throw new LedgerError('分割比率は 1 以上の数値を 2 つ指定してください');
  }
  return to / from;
}

/**
 * 取引台帳から保有状況を計算する。
 *
 * - BUY   : 株数と取得原価(手数料込み)を積み増す
 * - SELL  : 平均取得単価分の原価を取り崩し、差額を実現損益に計上する
 * - SPLIT : 株数のみを比率倍する(取得原価は不変 = 平均取得単価が比率分下がる)
 */
export function computePosition(transactions) {
  const m = {
    shares: 0, cost: 0, avg_price: 0, realized_pl: 0,
    gross_buy: 0, gross_sell: 0, total_fee: 0,
    buy_count: 0, sell_count: 0, split_count: 0,
    first_trade_date: null, last_trade_date: null,
  };

  for (const tx of sortTransactions(transactions)) {
    const type = String(tx.type || '').toUpperCase();
    const date = (tx.trade_date || '').trim() || null;
    if (date) {
      if (m.first_trade_date === null || date < m.first_trade_date) m.first_trade_date = date;
      if (m.last_trade_date === null || date > m.last_trade_date) m.last_trade_date = date;
    }

    if (type === BUY) {
      const qty = num(tx.shares);
      const price = num(tx.price);
      const fee = num(tx.fee);
      if (qty <= 0) throw new LedgerError('買付の株数は 1 以上で入力してください');
      m.shares += qty;
      m.cost += qty * price + fee;
      m.gross_buy += qty * price + fee;
      m.total_fee += fee;
      m.buy_count += 1;

    } else if (type === SELL) {
      const qty = num(tx.shares);
      const price = num(tx.price);
      const fee = num(tx.fee);
      if (qty <= 0) throw new LedgerError('売却の株数は 1 以上で入力してください');
      if (qty > m.shares + EPSILON) {
        throw new LedgerError(
          `売却株数(${qty})が、その時点の保有株数(${m.shares})を超えています`,
        );
      }
      const portion = m.shares > 0 ? qty / m.shares : 0;
      const removedCost = m.cost * portion;
      const proceeds = qty * price - fee;
      m.realized_pl += proceeds - removedCost;
      m.cost -= removedCost;
      m.shares -= qty;
      m.gross_sell += proceeds;
      m.total_fee += fee;
      m.sell_count += 1;
      if (m.shares <= EPSILON) {
        m.shares = 0;
        m.cost = 0;
      }

    } else if (type === SPLIT) {
      m.shares *= splitRatio(tx);
      m.split_count += 1;

    } else {
      throw new LedgerError(`未知の取引種別です: ${tx.type}`);
    }
  }

  m.avg_price = m.shares > EPSILON ? m.cost / m.shares : 0;
  return {
    ...m,
    shares: round(m.shares, 6),
    cost: round(m.cost, 2),
    avg_price: round(m.avg_price, 4),
    realized_pl: round(m.realized_pl, 2),
    gross_buy: round(m.gross_buy, 2),
    gross_sell: round(m.gross_sell, 2),
    total_fee: round(m.total_fee, 2),
  };
}

/** 保有状況に配当と株価を掛け合わせて評価する。 */
export function evaluate(metrics, dividendPerShare = 0, marketPrice = null) {
  const dps = num(dividendPerShare);
  const price = marketPrice ? num(marketPrice) : null;

  const out = {
    ...metrics,
    dividend_per_share: dps,
    market_price: price,
    annual_dividend: dps * metrics.shares,
    yield_on_cost: metrics.avg_price > 0 ? (dps / metrics.avg_price) * 100 : 0,
    current_yield: 0,
    market_value: 0,
    unrealized_pl: 0,
    unrealized_pl_pct: 0,
  };

  if (price && price > 0) {
    out.current_yield = (dps / price) * 100;
    out.market_value = price * metrics.shares;
    out.unrealized_pl = out.market_value - metrics.cost;
    if (metrics.cost > 0) out.unrealized_pl_pct = (out.unrealized_pl / metrics.cost) * 100;
  }

  return {
    ...out,
    annual_dividend: round(out.annual_dividend, 2),
    yield_on_cost: round(out.yield_on_cost, 4),
    current_yield: round(out.current_yield, 4),
    market_value: round(out.market_value, 2),
    unrealized_pl: round(out.unrealized_pl, 2),
    unrealized_pl_pct: round(out.unrealized_pl_pct, 4),
  };
}

/**
 * 決算月から権利確定月(暦月)を推定する。
 * 期末(決算月)と、中間配当があればその 6 か月前。決算月が不明なら空。
 */
export function dividendMonths(fiscalMonth, paysInterim = true) {
  const fm = Number(fiscalMonth);
  if (!fm || fm < 1 || fm > 12) return [];
  if (!paysInterim) return [fm];
  let interim = fm - 6;
  if (interim <= 0) interim += 12;
  return [...new Set([interim, fm])].sort((a, b) => a - b);
}

/**
 * 複数銘柄のサマリー。
 * 平均利回りは単純平均ではなく、投資額で重み付けした加重平均を使う。
 */
export function aggregate(valuations) {
  let totalCost = 0;
  let totalDividend = 0;
  let totalValue = 0;
  let totalRealized = 0;
  let holdings = 0;
  let valuedCost = 0;

  for (const v of valuations) {
    totalCost += v.cost;
    totalDividend += v.annual_dividend;
    totalRealized += v.realized_pl;
    if (v.shares > EPSILON) holdings += 1;
    if (v.market_price) {
      totalValue += v.market_value;
      valuedCost += v.cost;
    }
  }

  const weightedYield = totalCost > 0 ? (totalDividend / totalCost) * 100 : 0;
  const unrealized = valuedCost > 0 ? totalValue - valuedCost : 0;

  return {
    total_cost: round(totalCost, 2),
    annual_dividend: round(totalDividend, 2),
    monthly_dividend: round(totalDividend / 12, 2),
    weighted_yield: round(weightedYield, 4),
    holdings,
    market_value: round(totalValue, 2),
    valued_cost: round(valuedCost, 2),
    unrealized_pl: round(unrealized, 2),
    unrealized_pl_pct: valuedCost > 0 ? round((unrealized / valuedCost) * 100, 4) : 0,
    realized_pl: round(totalRealized, 2),
  };
}
