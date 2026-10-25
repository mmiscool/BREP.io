(() => {
  const HOSTNAME = 'brep.io';
  const NOTICE_ID = 'brep-deprecation-notice';
  const REDIRECT_URL = 'https://next.BREP.io';
  const REDIRECT_DELAY_MS = 10000;

  let redirectTimer = null;

  function isLegacyBrepHost() {
    try {
      return window.location.protocol === 'https:'
        && String(window.location.hostname || '').toLowerCase() === HOSTNAME;
    } catch {
      return false;
    }
  }

  function clearRedirectTimer() {
    if (redirectTimer !== null) {
      window.clearTimeout(redirectTimer);
      redirectTimer = null;
    }
  }

  function startRedirectTimer() {
    clearRedirectTimer();
    redirectTimer = window.setTimeout(() => {
      window.location.assign(REDIRECT_URL);
    }, REDIRECT_DELAY_MS);
  }

  function showDeprecationNotice() {
    if (!isLegacyBrepHost() || document.getElementById(NOTICE_ID)) return;

    const style = document.createElement('style');
    style.textContent = `
      #${NOTICE_ID} {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        width: min(760px, calc(100vw - 32px));
        padding: 16px 96px 16px 20px;
        border: 2px solid #f59e0b;
        border-radius: 12px;
        background: rgba(69, 35, 5, 0.97);
        color: #fff7ed;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${NOTICE_ID} strong {
        display: block;
        margin-bottom: 6px;
        font-size: 16px;
        letter-spacing: 0.02em;
      }
      #${NOTICE_ID} a,
      #${NOTICE_ID} button {
        color: #fde68a;
        font-weight: 700;
      }
      #${NOTICE_ID} .action-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 10px;
      }
      #${NOTICE_ID} .redirect-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 36px;
        padding: 0 14px;
        border: 1px solid rgba(253, 230, 138, 0.7);
        border-radius: 8px;
        background: rgba(253, 230, 138, 0.12);
        color: #fff7ed;
        text-decoration: none;
        cursor: pointer;
        font: 700 13px/1.2 system-ui, sans-serif;
      }
      #${NOTICE_ID} .redirect-button:hover {
        background: rgba(253, 230, 138, 0.2);
      }
      #${NOTICE_ID} button {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 30px;
        height: 30px;
        border: 1px solid rgba(255, 247, 237, 0.45);
        border-radius: 6px;
        background: transparent;
        color: #fff7ed;
        cursor: pointer;
        font: 20px/1 system-ui, sans-serif;
      }
      #${NOTICE_ID} button:hover { background: rgba(255, 247, 237, 0.14); }
      #${NOTICE_ID} button:focus-visible,
      #${NOTICE_ID} .redirect-button:focus-visible {
        outline: 2px solid #fde68a;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);

    const notice = document.createElement('aside');
    notice.id = NOTICE_ID;
    notice.setAttribute('role', 'status');
    notice.innerHTML = `
      <button type="button" aria-label="Dismiss deprecation notice" title="Dismiss">&times;</button>
      <strong>next.BREP.io</strong>
      <span>This legacy app will redirect to <a href="${REDIRECT_URL}">next.BREP.io</a> in 10 seconds unless you click the button below.</span>
      <div class="action-row">
        <a class="redirect-button" href="${REDIRECT_URL}">Go to next.BREP.io</a>
      </div>
    `;

    notice.querySelector('button')?.addEventListener('click', () => {
      clearRedirectTimer();
      notice.remove();
    });

    notice.querySelector('.redirect-button')?.addEventListener('click', () => {
      clearRedirectTimer();
    });

    document.body.appendChild(notice);
    startRedirectTimer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showDeprecationNotice, { once: true });
  } else {
    showDeprecationNotice();
  }
})();
