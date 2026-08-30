// ごく小さなテストランナー。Node.js を使わずブラウザで実行する。

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name, fn) {
  if (!current) throw new Error('it() は describe() の中で呼んでください');
  current.tests.push({ name, fn });
}

function fail(message) {
  throw new Error(message);
}

export const expect = (actual) => ({
  toBe(expected) {
    if (actual !== expected) fail(`期待値 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  },
  toEqual(expected) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) fail(`期待値 ${b} / 実際 ${a}`);
  },
  toBeCloseTo(expected, digits = 6) {
    const tolerance = 0.5 * 10 ** -digits;
    if (Math.abs(actual - expected) > tolerance) {
      fail(`期待値 ${expected} に近いこと / 実際 ${actual}(許容 ${tolerance})`);
    }
  },
  toBeGreaterThan(expected) {
    if (!(actual > expected)) fail(`${actual} > ${expected} であること`);
  },
  toBeLessThan(expected) {
    if (!(actual < expected)) fail(`${actual} < ${expected} であること`);
  },
  toBeNull() {
    if (actual !== null) fail(`null であること / 実際 ${JSON.stringify(actual)}`);
  },
  toContain(expected) {
    if (!actual.includes(expected)) fail(`${JSON.stringify(actual)} が ${JSON.stringify(expected)} を含むこと`);
  },
  notToContain(expected) {
    if (actual.includes(expected)) fail(`${JSON.stringify(actual)} が ${JSON.stringify(expected)} を含まないこと`);
  },
  toThrow(expectedMessage) {
    let threw = false;
    let message = '';
    try {
      actual();
    } catch (err) {
      threw = true;
      message = err.message;
    }
    if (!threw) fail('例外が投げられること');
    if (expectedMessage && !message.includes(expectedMessage)) {
      fail(`例外メッセージに ${JSON.stringify(expectedMessage)} を含むこと / 実際 ${JSON.stringify(message)}`);
    }
  },
});

export function run() {
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const suite of suites) {
    for (const test of suite.tests) {
      try {
        test.fn();
        passed += 1;
        results.push({ suite: suite.name, test: test.name, ok: true });
      } catch (err) {
        failed += 1;
        results.push({ suite: suite.name, test: test.name, ok: false, error: err.message });
      }
    }
  }
  return { passed, failed, total: passed + failed, results };
}

export function render(summary) {
  const root = document.getElementById('results');
  const bySuite = new Map();
  for (const r of summary.results) {
    if (!bySuite.has(r.suite)) bySuite.set(r.suite, []);
    bySuite.get(r.suite).push(r);
  }

  document.getElementById('summary').innerHTML =
    `<span class="${summary.failed ? 'fail' : 'pass'}">`
    + `${summary.failed ? '失敗' : '成功'} — ${summary.passed} / ${summary.total} 件</span>`;

  root.innerHTML = [...bySuite.entries()].map(([name, tests]) => `
    <section>
      <h2>${name}</h2>
      ${tests.map((t) => `
        <div class="row ${t.ok ? 'pass' : 'fail'}">
          <span class="mark">${t.ok ? '✓' : '✗'}</span>
          <span>${t.test}</span>
          ${t.error ? `<pre>${t.error}</pre>` : ''}
        </div>`).join('')}
    </section>`).join('');
}
