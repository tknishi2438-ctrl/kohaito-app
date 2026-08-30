// ポートフォリオの分散ルールの判定。
//
// - セクター集中度  : 1 セクターあたり投資額の N% 以下
// - 配当の銘柄集中度: 1 銘柄が年間配当合計に占める割合が N% 以下
//
// もとは Python の app/rules.py。

export const DEFAULT_MAX_SECTOR_PCT = 20;
export const DEFAULT_MAX_STOCK_DIVIDEND_PCT = 3;

// 上限に近づいたら警告する閾値(上限に対する割合)
const WARN_RATIO = 0.85;

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function statusFor(share, limit) {
  if (share > limit) return 'over';
  if (share >= limit * WARN_RATIO) return 'warn';
  return 'ok';
}

/**
 * あと何円(何単位)まで積み増せるかを返す。
 *
 * 追加投資は対象の額と全体の額の両方を増やすため、単純な
 * 「上限額 − 現在額」ではない。追加額を x として
 *
 *     (対象 + x) / (全体 + x) <= 上限
 *
 * を x について解くと x <= (上限 * 全体 - 対象) / (1 - 上限)。
 * 上限を既に超えている場合は負の値(必要な圧縮額)を返す。
 */
export function headroom(targetAmount, totalAmount, limitPct) {
  const limit = limitPct / 100;
  if (limit >= 1) return Infinity;
  return (limit * totalAmount - targetAmount) / (1 - limit);
}

/** セクター別の集計結果にルール判定を付ける。 */
export function evaluateSectors(rows, limitPct = DEFAULT_MAX_SECTOR_PCT) {
  const limit = Number(limitPct);
  const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);

  const sectors = rows.map((row) => ({
    ...row,
    status: statusFor(row.share_pct, limit),
    headroom: totalCost > 0 ? round(headroom(row.cost, totalCost, limit), 2) : 0,
    limit_pct: limit,
  }));

  const over = sectors.filter((r) => r.status === 'over');
  return {
    limit_pct: limit,
    total_cost: round(totalCost, 2),
    sectors,
    over,
    warn: sectors.filter((r) => r.status === 'warn'),
    passing: over.length === 0,
    max_share_pct: round(Math.max(0, ...sectors.map((r) => r.share_pct)), 2),
  };
}

/**
 * 銘柄ごとの年間配当が配当合計に占める割合を判定する。
 * 余力は株数と投資額にも換算し、「あと何株買えるか」まで示す。
 */
export function evaluateStockDividends(views, limitPct = DEFAULT_MAX_STOCK_DIVIDEND_PCT) {
  const limit = Number(limitPct);
  const held = views.filter((v) => v.metrics.shares > 0 && v.metrics.annual_dividend > 0);
  const total = held.reduce((sum, v) => sum + v.metrics.annual_dividend, 0);

  const stocks = held.map((view) => {
    const dividend = view.metrics.annual_dividend;
    const share = total > 0 ? (dividend / total) * 100 : 0;
    const room = total > 0 ? headroom(dividend, total, limit) : 0;

    // 配当額の余力を株数・投資額に換算する
    const dps = view.dividend_per_share || 0;
    const price = view.market_price || view.metrics.avg_price || 0;
    const roomShares = dps > 0 ? room / dps : null;
    const roomAmount = roomShares !== null && price > 0 ? roomShares * price : null;

    return {
      id: view.id,
      code: view.code,
      name: view.name,
      sector: view.sector,
      classification: view.classification,
      annual_dividend: round(dividend, 2),
      share_pct: round(share, 3),
      status: statusFor(share, limit),
      headroom: round(room, 2),
      headroom_shares: roomShares === null ? null : round(roomShares, 2),
      headroom_amount: roomAmount === null ? null : round(roomAmount, 2),
      limit_pct: limit,
    };
  });

  stocks.sort((a, b) => b.share_pct - a.share_pct);
  const over = stocks.filter((r) => r.status === 'over');

  return {
    limit_pct: limit,
    total_dividend: round(total, 2),
    stocks,
    over,
    warn: stocks.filter((r) => r.status === 'warn'),
    passing: over.length === 0,
    max_share_pct: round(Math.max(0, ...stocks.map((r) => r.share_pct)), 3),
    even_share_pct: stocks.length ? round(100 / stocks.length, 3) : 0,
  };
}
