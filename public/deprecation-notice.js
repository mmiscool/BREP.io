(() => {
  const HOSTNAME = 'brep.io';
  const NOTICE_ID = 'brep-deprecation-notice';

  function isLegacyBrepHost() {
    try {
      return window.location.protocol === 'https:'
        && String(window.location.hostname || '').toLowerCase() === HOSTNAME;
    } catch {
      return false;
    }
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
        padding: 16px 20px;
        border: 2px solid #f59e0b;
        border-radius: 12px;
        background: rgba(69, 35, 5, 0.97);
        color: #fff7ed;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${NOTICE_ID} strong { display: block; margin-bottom: 5px; font-size: 16px; }
      #${NOTICE_ID} a { color: #fde68a; font-weight: 700; }
    `;
    document.head.appendChild(style);

    const notice = document.createElement('aside');
    notice.id = NOTICE_ID;
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<strong>BREP.io is deprecated</strong>'
      + '<span>This legacy application is no longer under active development. '
      + 'Please use the new <a href="https://next.BREP.io">BREP.io project</a>, '
      + 'built completely from scratch in Rust with a real BREP kernel, real surfaces, '
      + 'and STEP file reading and writing.</span>';
    document.body.appendChild(notice);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showDeprecationNotice, { once: true });
  } else {
    showDeprecationNotice();
  }
})();
