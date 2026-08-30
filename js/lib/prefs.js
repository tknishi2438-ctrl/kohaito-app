// 画面の表示設定(どのパネルを開くかなど)をブラウザに記憶する。
// サーバには送らないため、端末ごとの設定になる。

const PREFIX = 'khk.pref.';

export function getBool(key, fallback = false) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    // プライベートウィンドウなどで読めない場合は既定値で動かす
    return fallback;
  }
}

export function setBool(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value ? '1' : '0');
  } catch {
    // 保存できなくても、その場の表示は切り替わる
  }
  return value;
}

export function toggleBool(key, fallback = false) {
  return setBool(key, !getBool(key, fallback));
}

/**
 * トグルスイッチの HTML を返す。
 * data-action で押されたときの処理を呼び出し側の delegate に任せる。
 */
export function switchHtml(action, checked, label) {
  return `
    <button type="button" class="switch" role="switch" data-action="${action}"
            aria-checked="${checked}" aria-label="${label}">
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-label">${checked ? '表示中' : '非表示'}</span>
    </button>`;
}
