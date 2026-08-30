// 最小限の DOM ヘルパ。テンプレートリテラルの文字列組み立てを安全にする。

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/** data-action 属性を使ったイベント委譲。 */
export function delegate(root, eventName, handlers) {
  root.addEventListener(eventName, (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;
    const handler = handlers[target.dataset.action];
    if (!handler) return;
    event.preventDefault();
    handler(target, event);
  });
}

export function toast(message, kind = 'info', ms = 4200) {
  const root = qs('#toasts');
  const node = el(`<div class="toast ${kind}">${esc(message)}</div>`);
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

/** モーダルを開く。resolve される値は onSubmit の戻り値。 */
export function modal({ title, body, submitLabel = '保存', wide = false, onSubmit, onMount }) {
  const root = qs('#modalRoot');
  root.hidden = false;
  root.innerHTML = `
    <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="close-x" data-close aria-label="閉じる">&times;</button>
      </div>
      <form class="modal-form">
        <div class="modal-body">
          <div class="form-error" hidden></div>
          ${body}
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>キャンセル</button>
          ${onSubmit ? `<button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>` : ''}
        </div>
      </form>
    </div>`;

  const form = qs('.modal-form', root);
  const errorBox = qs('.form-error', root);

  const close = () => {
    root.hidden = true;
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  qsa('[data-close]', root).forEach((b) => b.addEventListener('click', close));
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!onSubmit) return close();
    const submitBtn = qs('button[type=submit]', form);
    submitBtn.disabled = true;
    errorBox.hidden = true;
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      await onSubmit(data, { close, form });
      close();
    } catch (err) {
      errorBox.textContent = err.message || String(err);
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  if (onMount) onMount({ form, close, root });
  const firstInput = qs('input:not([type=hidden]), select, textarea', form);
  if (firstInput) firstInput.focus();
  return { close };
}

export function confirmDialog({ title, message, confirmLabel = '削除する', danger = true }) {
  return new Promise((resolve) => {
    let answered = false;
    const settle = (value) => {
      if (answered) return;
      answered = true;
      resolve(value);
    };

    modal({
      title,
      body: `<p style="margin:0;color:var(--text-2);font-size:13px;line-height:1.8">${message}</p>`,
      submitLabel: confirmLabel,
      onSubmit: () => settle(true),
    });

    const root = qs('#modalRoot');
    if (danger) {
      const submit = qs('button[type=submit]', root);
      submit?.classList.replace('btn-primary', 'btn-danger');
    }
    // 送信以外の経路(×・キャンセル・Esc・背景クリック)で閉じたら false を返す
    const observer = new MutationObserver(() => {
      if (root.hidden) {
        observer.disconnect();
        settle(false);
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ['hidden'] });
  });
}
