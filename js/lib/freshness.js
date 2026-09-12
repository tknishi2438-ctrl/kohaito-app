// 古い画面を掴んだままにならないようにする。
//
// GitHub Pages は index.html にも `Cache-Control: max-age=600` を付ける。
// 読み込む JavaScript には版番号を付けているが、その版番号を書いている
// index.html 自体が古いままだと、結局 10 分間は古い画面が出続ける。
//
// そこで、版番号だけを書いた小さなファイルをキャッシュを避けて読みに行き、
// 手元の版と違えば index.html を取り直してから読み込み直す。

const VERSION_FILE = './version.json';
const RELOADED_KEY = 'khk.reloadedFor';

function currentVersion() {
  return document.querySelector('meta[name="app-version"]')?.content || '';
}

function alreadyReloadedFor(version) {
  try {
    return sessionStorage.getItem(RELOADED_KEY) === version;
  } catch {
    // 記録できないときは、繰り返しを避けるため「済み」とみなす
    return true;
  }
}

function markReloaded(version) {
  try {
    sessionStorage.setItem(RELOADED_KEY, version);
  } catch { /* 記録できなくても、この先の判断は変わらない */ }
}

/**
 * 新しい版が出ていれば、一度だけ読み込み直す。
 * 取りに行けない(手元で開いている・通信できない)ときは何もしない。
 */
export async function ensureLatest() {
  const here = currentVersion();
  if (!here) return null;   // 版番号が無いのは手元で動かしているとき

  let latest;
  try {
    const res = await fetch(`${VERSION_FILE}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    ({ version: latest } = await res.json());
  } catch {
    return null;
  }
  if (!latest || latest === here) return null;

  // 同じ版で何度も読み込み直さない(取り直しても直らない場合の堂々巡りを防ぐ)
  if (alreadyReloadedFor(latest)) return latest;
  markReloaded(latest);

  try {
    // index.html を取り直してキャッシュを入れ替えてから読み込み直す。
    // これをしないと、読み込み直しても古い index.html が使われてしまう
    await fetch('./index.html', { cache: 'reload' });
  } catch { /* 取り直せなくても、読み込み直す価値はある */ }
  location.reload();
  return latest;
}
