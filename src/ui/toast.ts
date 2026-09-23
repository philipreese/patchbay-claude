/** Transient message at the bottom of the screen. kind 'warn' for refusals/errors. */
let host: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'warn' | 'ok' = 'info', ms = 3200) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, ms);
  // keep at most 3
  while (host.children.length > 3) host.firstElementChild!.remove();
}
