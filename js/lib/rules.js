// ポートフォリオの分散ルールの判定。
//
// - セクター集中度  : 1 セクターあたり投資額の N% 以下
// - 配当の銘柄集中度: 1 銘柄が年間配当合計に占める割合が N% 以下
//
// もとは Python の app/rules.py。

export const DEFAULT_MAX_SECTOR_PCT = 20;
export const DEFAULT_MAX_STOCK_DIVIDEND_PCT = 3;
export const DEFAULT_MIN_DEFENSIVE_PCT = 50;

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

/**
 * セクター別の集計結果にルール判定を付ける。
 *
 * 判定は**年間配当ベース**。「1 つのセクターに配当収入を頼りすぎない」ことを
 * 見るためで、銘柄側のルールと物差しを揃えている。
 * (投資額ベースの構成比は「セクター別構成」の円グラフが受け持つ)
 */
export function evaluateSectors(rows, limitPct = DEFAULT_MAX_SECTOR_PCT) {
  const limit = Number(limitPct);
  const totalDividend = rows.reduce((sum, r) => sum + r.dividend, 0);

  const sectors = rows.map((row) => {
    const share = totalDividend > 0 ? (row.dividend / totalDividend) * 100 : 0;
    const room = totalDividend > 0 ? headroom(row.dividend, totalDividend, limit) : 0;
    // 配当の余力を、そのセクターの現在の利回りで投資額に換算する
    const investable = row.yield_pct > 0 ? room / (row.yield_pct / 100) : null;

    return {
      ...row,
      share_pct: round(share, 2),          // 配当ベースの構成比で上書きする
      cost_share_pct: row.share_pct,       // 投資額ベースの構成比も残しておく
      status: statusFor(share, limit),
      headroom: round(room, 2),            // 配当額としての余力
      headroom_amount: investable === null ? null : round(investable, 2),
      limit_pct: limit,
    };
  });

  sectors.sort((a, b) => b.share_pct - a.share_pct);
  const over = sectors.filter((r) => r.status === 'over');
  return {
    limit_pct: limit,
    total_dividend: round(totalDividend, 2),
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


// --------------------------------------------------- ディフェンシブ株の比率

/**
 * ディフェンシブ株(D)を一定割合以上に保てているかを見る。
 *
 * 上の 2 つが「◯% 以下に抑える」上限のルールなのに対し、これは
 * 「◯% 以上を保つ」下限のルール。分母は他と揃えて**年間配当**を使う。
 *
 * 不足分・余地は配当額で求めたあと、それぞれの利回りで投資額に換算する。
 */
export function evaluateDefensive(rows, minPct = DEFAULT_MIN_DEFENSIVE_PCT) {
  const min = Number(minPct);
  const total = rows.reduce((sum, r) => sum + r.dividend, 0);
  const find = (label) => rows.find((r) => String(r.label).toUpperCase() === label);
  const defensive = find('D');
  const cyclical = find('K');

  const dividend = defensive ? defensive.dividend : 0;
  const share = total > 0 ? (dividend / total) * 100 : 0;
  const ratio = min / 100;

  // 不足しているとき: ディフェンシブ株の配当をいくら増やせば下限に届くか
  //   (D + x) / (T + x) >= min  =>  x >= (min*T - D) / (1 - min)
  const shortfall = ratio < 1 && total > 0
    ? Math.max(0, (ratio * total - dividend) / (1 - ratio))
    : 0;

  // 満たしているとき: 景気敏感株の配当をいくら増やしても下限を割らないか
  //   D / (T + y) >= min  =>  y <= D/min - T
  const cyclicalRoom = ratio > 0 && total > 0 ? Math.max(0, dividend / ratio - total) : 0;

  // 配当額を、それぞれの利回りで投資額に換算する
  const toAmount = (amount, row) => (
    row && row.yield_pct > 0 ? round(amount / (row.yield_pct / 100), 2) : null
  );

  return {
    min_pct: min,
    total_dividend: round(total, 2),
    defensive_dividend: round(dividend, 2),
    defensive_share_pct: round(share, 2),
    defensive_count: defensive ? defensive.count : 0,
    cyclical_share_pct: cyclical && total > 0 ? round((cyclical.dividend / total) * 100, 2) : 0,
    cyclical_count: cyclical ? cyclical.count : 0,
    passing: share >= min,
    shortfall: round(shortfall, 2),                     // 不足している配当額
    shortfall_amount: toAmount(shortfall, defensive),   // それを得るための投資額
    cyclical_room: round(cyclicalRoom, 2),              // 増やせる景気敏感株の配当額
    cyclical_room_amount: toAmount(cyclicalRoom, cyclical),
  };
}
