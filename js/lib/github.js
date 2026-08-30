// GitHub のリポジトリにある 1 つの JSON ファイルを読み書きする。
//
// Contents API を使い、保存時は取得時の sha を添えることで
// 「別の端末が先に保存していたら弾く」楽観的ロックを効かせる。

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

/** 別の端末が先に保存していたときに投げる。 */
export class RemoteChanged extends GitHubError {
  constructor(message) {
    super(message, 409);
    this.name = 'RemoteChanged';
  }
}

// --- UTF-8 と base64 の相互変換(btoa/atob は多バイト文字を扱えない) ---

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubStore {
  /**
   * @param {object} config
   * @param {string} config.owner  リポジトリの所有者
   * @param {string} config.repo   データ用リポジトリ名
   * @param {string} config.path   ファイルパス (例: portfolio.json)
   * @param {string} config.token  ファインダーグレインドの個人用アクセストークン
   * @param {string} [config.branch]
   */
  constructor({ owner, repo, path, token, branch = 'main' }) {
    this.owner = owner;
    this.repo = repo;
    this.path = path;
    this.token = token;
    this.branch = branch;
    this.sha = null;      // 最後に読み書きしたファイルの sha
  }

  get contentsUrl() {
    return `${API}/repos/${this.owner}/${this.repo}/contents/${this.path}`;
  }

  headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async request(url, options = {}) {
    let res;
    try {
      res = await fetch(url, { ...options, headers: { ...this.headers(), ...(options.headers || {}) } });
    } catch (err) {
      throw new GitHubError(`GitHub に接続できません: ${err.message}`, 0);
    }
    if (res.status === 401) {
      throw new GitHubError('トークンが無効です。設定を確認してください。', 401);
    }
    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      throw new GitHubError(
        remaining === '0'
          ? 'GitHub API の利用回数制限に達しました。しばらく待ってから再試行してください。'
          : 'このリポジトリへの権限がありません。トークンの権限を確認してください。',
        403,
      );
    }
    return res;
  }

  /** 接続確認。リポジトリが見えるかを調べる。 */
  async verify() {
    const res = await this.request(`${API}/repos/${this.owner}/${this.repo}`);
    if (res.status === 404) {
      throw new GitHubError(
        `リポジトリ ${this.owner}/${this.repo} が見つかりません。`
        + '名前が正しいか、トークンにこのリポジトリへの権限があるか確認してください。',
        404,
      );
    }
    if (!res.ok) throw new GitHubError(`GitHub が ${res.status} を返しました`, res.status);
    const repo = await res.json();
    return { full_name: repo.full_name, private: repo.private, default_branch: repo.default_branch };
  }

  /**
   * ファイルを読む。まだ無ければ null を返す(初回保存で作られる)。
   */
  async load() {
    const url = `${this.contentsUrl}?ref=${encodeURIComponent(this.branch)}`;
    const res = await this.request(url, { cache: 'no-store' });
    if (res.status === 404) {
      this.sha = null;
      return null;
    }
    if (!res.ok) throw new GitHubError(`読み込みに失敗しました (${res.status})`, res.status);

    const body = await res.json();
    this.sha = body.sha;
    // 1MB を超えるファイルは content が空になるため、blob API から取り直す
    const text = body.content
      ? fromBase64(body.content)
      : fromBase64((await (await this.request(body.git_url)).json()).content);
    return JSON.parse(text);
  }

  /**
   * ファイルを書く。読み込み時の sha が古ければ RemoteChanged を投げる。
   * @param {object} data     保存する JSON
   * @param {string} message  コミットメッセージ
   */
  async save(data, message) {
    const payload = {
      message,
      content: toBase64(`${JSON.stringify(data, null, 2)}\n`),
      branch: this.branch,
    };
    if (this.sha) payload.sha = this.sha;

    const res = await this.request(this.contentsUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 409 || res.status === 422) {
      throw new RemoteChanged(
        '別の端末で先に保存されています。最新の内容を読み込んでから、もう一度保存してください。',
      );
    }
    if (!res.ok) {
      const detail = await res.text();
      throw new GitHubError(`保存に失敗しました (${res.status}) ${detail.slice(0, 200)}`, res.status);
    }

    const body = await res.json();
    this.sha = body.content.sha;
    return { sha: this.sha, commit: body.commit.sha };
  }
}
