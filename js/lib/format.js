// 数値・日付の表示整形。桁を揃えるため既定で等幅表示を前提にしている。

const YEN = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
const YEN2 = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function yen(value, { sign = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}¥${YEN.format(Math.round(value))}`;
}

export function yenPrecise(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `¥${YEN2.format(value)}`;
}

export function pct(value, { digits = 2, sign = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}%`;
}

export function shares(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const rounded = Math.round(value * 1e6) / 1e6;
  return Number.isInteger(rounded)
    ? YEN.format(rounded)
    : rounded.toLocaleString('ja-JP', { maximumFractionDigits: 4 });
}

export function num(value, digits = 2) {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('ja-JP', { maximumFractionDigits: digits });
}

/**
 * 取引月の表示。取引日は年月(YYYY-MM)で持つ。
 * 以前の形式(YYYY-MM-DD)が残っていても年月だけを見せる。
 */
export function date(value) {
  if (!value) return '未設定';
  return String(value).slice(0, 7).replaceAll('-', '/');
}

/**
 * 日付をそのまま(YYYY/MM/DD)見せる。
 * 株価の取得日など、何日時点かが意味を持つものに使う。
 */
export function fullDate(value) {
  if (!value) return '未設定';
  return String(value).slice(0, 10).replaceAll('-', '/');
}

// 末尾の Z や +09:00 など、時差の指定が付いているか
const HAS_TIMEZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * 日時の表示(YYYY/MM/DD HH:MM)。
 *
 * 保存されている値は 2 種類ある。ブラウザが書いた同期時刻は UTC(末尾 Z)、
 * Python が書いた取得時刻は手元の時刻(時差の指定なし)。前者をそのまま
 * 見せると 9 時間ずれるので、時差の指定があるときは手元の時刻に直す。
 */
export function dateTime(value) {
  if (!value) return '—';
  const text = String(value).trim();
  if (HAS_TIMEZONE.test(text)) {
    const at = new Date(text);
    if (!Number.isNaN(at.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      return `${at.getFullYear()}/${p(at.getMonth() + 1)}/${p(at.getDate())}`
        + ` ${p(at.getHours())}:${p(at.getMinutes())}`;
    }
  }
  return text.replace('T', ' ').slice(0, 16).replaceAll('-', '/');
}

export function signClass(value) {
  if (!value) return '';
  return value > 0 ? 'pos' : value < 0 ? 'neg' : '';
}

/** 入力欄の初期値に使う今月(YYYY-MM)。 */
export function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 取引月を YYYY-MM に揃える。
 * 「2025/04」「2025-04-15」など、どの書き方で来ても受け取れるようにする。
 */
export function normalizeMonth(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const m = text.match(/^(\d{4})[-/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}`;
}

export const TX_LABEL = {
  BUY: '買付', SELL: '売却', SPLIT: '分割', MOVE_OUT: '払出', MOVE_IN: '受入',
};

/**
 * 銘柄の分類。元のスプレッドシートの K / D 列をそのまま引き継いでいる。
 * 景気敏感株とディフェンシブ株の比率は、ポートフォリオの守りの強さを示す。
 */
export const CLASSIFICATION = {
  K: { label: '景気敏感株', short: '景気敏感', note: '景気の波を受けやすい業種' },
  D: { label: 'ディフェンシブ株', short: 'ディフェンシブ', note: '景気に左右されにくい業種' },
};

export function classification(code) {
  return CLASSIFICATION[String(code || '').toUpperCase()]
    ?? { label: String(code || '未分類'), short: String(code || '未分類'), note: '' };
}
