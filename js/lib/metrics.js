// 業績指標が高配当株として好ましい形かを判定する。
//
// 判定は会社予想を含めず、実績だけで行う。予想は会社の希望が入るため、
// 買うかどうかの判断材料としては実績を見る。
//
// 結果は ok(適合) / warn(注意) / bad(不適) / unknown(判断不足) の 4 つ。
// warn を挟むのは、基準ぎりぎりを一律で「不適」と切り捨てないため。

const MIN_YEARS = 3;          // これ未満の年数では傾向を判断しない
const FLAT_PCT = 1.0;         // 年あたり ±1% 以内は「横ばい」とみなす

/**
 * 年あたりの変化率(%)。最小二乗法の傾きを平均値で割って求める。
 *
 * 単純な「最初と最後の比較」だと、たまたまの凹凸に振り回される。
 * すべての年を使う傾きなら、途中の落ち込みも含めて均される。
 */
export function trendPct(values) {
  const ys = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (ys.length < MIN_YEARS) return null;
  const n = ys.length;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  if (meanY === 0) return null;

  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  if (den === 0) return null;
  // 水準の違う指標どうしを同じ物差しで見るため、平均値に対する割合にする
  return ((num / den) / Math.abs(meanY)) * 100;
}

function pct(value, digits = 1) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/** 右肩上がりか。 */
function risingJudge(values, { label = '右肩上がりか' } = {}) {
  const slope = trendPct(values);
  if (slope === null) return { status: 'unknown', summary: '年数が足りません', criterion: label };
  if (slope > FLAT_PCT) {
    return { status: 'ok', summary: `伸びています(年あたり ${pct(slope)})`, criterion: label };
  }
  if (slope >= -FLAT_PCT) {
    return { status: 'warn', summary: `横ばいです(年あたり ${pct(slope)})`, criterion: label };
  }
  return { status: 'bad', summary: `減っています(年あたり ${pct(slope)})`, criterion: label };
}

/** 直近の値が下限以上か。warn を挟む幅も受け取る。 */
function minJudge(values, { min, warn, label, unit = '%' }) {
  const latest = values.at(-1);
  if (typeof latest !== 'number') {
    return { status: 'unknown', summary: '値がありません', criterion: label };
  }
  const shown = `直近 ${latest.toFixed(1)}${unit}`;
  if (latest >= min) return { status: 'ok', summary: shown, criterion: label };
  if (latest >= warn) return { status: 'warn', summary: `${shown}(基準にやや届きません)`, criterion: label };
  return { status: 'bad', summary: `${shown}(基準を下回ります)`, criterion: label };
}

/** 直近の値が範囲に収まっているか。高すぎる側をとくに嫌う。 */
function rangeJudge(values, { low, high, hardHigh, label }) {
  const latest = values.at(-1);
  if (typeof latest !== 'number') {
    return { status: 'unknown', summary: '値がありません', criterion: label };
  }
  const shown = `直近 ${latest.toFixed(1)}%`;
  if (latest >= low && latest <= high) return { status: 'ok', summary: shown, criterion: label };
  if (latest > hardHigh) {
    return { status: 'bad', summary: `${shown}(高すぎます。利益以上に配っていないか)`, criterion: label };
  }
  if (latest > high) {
    return { status: 'warn', summary: `${shown}(やや高めです)`, criterion: label };
  }
  return { status: 'warn', summary: `${shown}(やや低めです)`, criterion: label };
}

/** 黒字が続いていて、かつ伸びているか。 */
function positiveRisingJudge(values, { label }) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < MIN_YEARS) {
    return { status: 'unknown', summary: '年数が足りません', criterion: label };
  }
  const losses = nums.filter((v) => v < 0).length;
  if (nums.at(-1) < 0) {
    return { status: 'bad', summary: '直近が赤字です', criterion: label };
  }
  const rising = risingJudge(nums, { label });
  if (losses) {
    // 過去の赤字は、伸びていても手放しでは良しとしない
    return {
      status: rising.status === 'ok' ? 'warn' : 'bad',
      summary: `過去に赤字が ${losses} 年あります・${rising.summary}`,
      criterion: label,
    };
  }
  return { ...rising, summary: `黒字が続いています・${rising.summary}` };
}

/** 減配が無く、かつ増配傾向か。 */
function dividendJudge(values, { label, years = [] }) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < MIN_YEARS) {
    return { status: 'unknown', summary: '年数が足りません', criterion: label };
  }
  const cutYears = [];
  nums.forEach((v, i) => {
    if (i > 0 && v < nums[i - 1]) cutYears.push(years[i]);
  });
  const rising = risingJudge(nums, { label });
  if (cutYears.length) {
    // いつの話かで受け取り方が変わるので、直近の減配年を添える
    const last = cutYears.filter(Boolean).at(-1);
    return {
      status: 'bad',
      summary: `減配が ${cutYears.length} 回あります`
        + `${last ? `(直近 ${last} 年度)` : ''}・${rising.summary}`,
      criterion: label,
    };
  }
  return {
    status: rising.status === 'bad' ? 'warn' : rising.status,
    summary: `減配なし・${rising.summary}`,
    criterion: label,
  };
}

// 指標ごとの基準。画面の並び順と同じ。
export const METRIC_RULES = {
  revenue: { criterion: '右肩上がりか', judge: (v) => risingJudge(v) },
  operating_margin: {
    criterion: '10% 以上',
    judge: (v) => minJudge(v, { min: 10, warn: 8, label: '10% 以上' }),
  },
  eps: { criterion: '右肩上がりか', judge: (v) => risingJudge(v) },
  operating_cf: {
    criterion: '黒字で右肩上がりか',
    judge: (v) => positiveRisingJudge(v, { label: '黒字で右肩上がりか' }),
  },
  dividend_per_share: {
    criterion: '減配なし・右肩上がりか',
    judge: (v, years) => dividendJudge(v, { label: '減配なし・右肩上がりか', years }),
  },
  payout_ratio: {
    criterion: '30〜50%',
    judge: (v) => rangeJudge(v, { low: 30, high: 50, hardHigh: 70, label: '30〜50%' }),
  },
  equity_ratio: {
    criterion: '40% 以上',
    judge: (v) => minJudge(v, { min: 40, warn: 30, label: '40% 以上' }),
  },
  cash: { criterion: '右肩上がりか', judge: (v) => risingJudge(v) },
};

/**
 * 決算履歴から 1 指標を判定する。
 * 会社予想の年度は除く(判断材料は実績に限る)。
 */
export function judgeMetric(key, history) {
  const rule = METRIC_RULES[key];
  if (!rule) return null;
  const rows = (history || [])
    .filter((r) => !r.forecast && typeof r[key] === 'number' && Number.isFinite(r[key]));
  return rule.judge(rows.map((r) => r[key]), rows.map((r) => r.fiscal_year));
}

export const STATUS_LABEL = {
  ok: ['適合', 'buy'],
  warn: ['注意', 'warn'],
  bad: ['不適', 'sell'],
  unknown: ['判断不足', ''],
};

// 判定を点数にする。判断できなかった項目は 0 点。
// 満点を項目数で固定するため、確かめられない項目は加点しない。
export const STATUS_POINTS = { ok: 5, warn: 3, bad: 0, unknown: 0 };
export const POINTS_PER_ITEM = 5;

/**
 * 指標の判定をまとめて点数にする。
 * verdicts は画面に出したものと同じ判定([{key, verdict}])を渡す。
 */
export function scoreVerdicts(verdicts) {
  const scored = verdicts.filter((v) => v.verdict);
  const total = scored.reduce((sum, v) => sum + STATUS_POINTS[v.verdict.status], 0);
  const max = scored.length * POINTS_PER_ITEM;
  return {
    total,
    max,
    items: scored.length,
    // 判断できなかった項目数。満点に届かない理由が「悪い」のか
    // 「まだ分からない」のかを見分けるために持つ
    unknown: scored.filter((v) => v.verdict.status === 'unknown').length,
    pct: max > 0 ? (total / max) * 100 : 0,
  };
}
