// 明暗テーマの切り替えと記憶。

const KEY = 'khk.theme';
const LIGHT = 'light';
const DARK = 'dark';

export function current() {
  return document.documentElement.dataset.theme === DARK ? DARK : LIGHT;
}

export function apply(theme) {
  const next = theme === DARK ? DARK : LIGHT;
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // プライベートウィンドウなどで保存できなくても、表示自体は切り替わる
  }
  return next;
}

export function toggle() {
  return apply(current() === DARK ? LIGHT : DARK);
}

/**
 * 保存された設定を復元する。未設定なら明るいテーマを既定にする。
 * ちらつきを避けるため、画面描画より前に呼ぶこと。
 */
export function restore() {
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    saved = null;
  }
  return apply(saved === DARK ? DARK : LIGHT);
}
