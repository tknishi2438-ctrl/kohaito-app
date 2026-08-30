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

export function date(value) {
  if (!value) return '日付未設定';
  return String(value).replaceAll('-', '/');
}

export function dateTime(value) {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 16).replaceAll('-', '/');
}

export function signClass(value) {
  if (!value) return '';
  return value > 0 ? 'pos' : value < 0 ? 'neg' : '';
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const TX_LABEL = { BUY: '買付', SELL: '売却', SPLIT: '分割' };

/**
 * 銘柄の分類。元のスプレッドシートの K / D 列をそのまま引き継いでいる。
 * 景気敏感株とディフェンシブ株の比率は、ポートフォリオの守りの強さを示す。
 */
export const CLASSIFICATION = {
  K: {
    label: '景気敏感株', short: '景気敏感', note: '景気の波を受けやすい業種',
    colorVar: '--k-color',
  },
  D: {
    label: 'ディフェンシブ株', short: 'ディフェンシブ', note: '景気に左右されにくい業種',
    colorVar: '--d-color',
  },
};

export function classification(code) {
  return CLASSIFICATION[String(code || '').toUpperCase()]
    ?? { label: String(code || '未分類'), short: String(code || '未分類'), note: '', colorVar: null };
}

/** 分類の表示色を CSS 変数から取り出す(テーマの切り替えに追従させるため)。 */
export function classificationColor(code) {
  const { colorVar } = classification(code);
  if (!colorVar) return null;
  return getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim() || null;
}
