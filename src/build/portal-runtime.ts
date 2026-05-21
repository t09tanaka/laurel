import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { joinPath } from '~/theme/assets.ts';
import { ensureDir } from '~/util/fs.ts';
import type { ResolvedPortalUrls } from './portal-urls.ts';

export const PORTAL_RUNTIME_PATH = 'assets/nectar-portal.js';
export const PORTAL_RUNTIME_VERSION = '1';

export const INLINE_SUBMIT_RUNTIME_JS = `/* Nectar inline members form submit runtime. */
(function () {
  if (typeof window === 'undefined' || !window.fetch || !window.FormData) return;
  window.NectarInlineSubmit = true;

  function find(form, selector) {
    return form.querySelector ? form.querySelector(selector) : null;
  }

  function toggleMessage(el, visible, fallback) {
    if (!el) return;
    if (visible && fallback && !el.textContent) el.textContent = fallback;
    el.hidden = !visible;
    el.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function setState(form, state) {
    form.classList.remove('loading', 'success', 'error');
    if (state) form.classList.add(state);
    form.setAttribute('data-members-form-state', state || '');
  }

  function submitter(form) {
    return find(form, '[data-members-submit]') || find(form, 'button[type="submit"]');
  }

  function withGetParams(action, data) {
    var query = new URLSearchParams(data).toString();
    if (!query) return action;
    return action + (action.indexOf('?') === -1 ? '?' : '&') + query;
  }

  async function handleSubmit(event) {
    if (event.defaultPrevented) return;
    var form = event.target;
    if (!form || !form.matches || !form.matches('form[data-members-form]')) return;
    if (form.hasAttribute('data-nectar-noop') || form.classList.contains('loading')) return;

    var action = form.getAttribute('action') || '';
    if (!action || action === '#') return;

    event.preventDefault();
    var success = find(form, '[data-members-success]');
    var error = find(form, '[data-members-error]');
    var button = submitter(form);
    var data = new FormData(form);
    var method = (form.getAttribute('method') || 'post').toUpperCase();
    var url = method === 'GET' ? withGetParams(action, data) : action;
    var init = { method: method, headers: { Accept: 'application/json' } };
    if (method !== 'GET') init.body = data;

    toggleMessage(success, false);
    toggleMessage(error, false);
    setState(form, 'loading');
    if (button) button.disabled = true;

    try {
      var response = await fetch(url, init);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      setState(form, 'success');
      toggleMessage(success, true);
      form.reset();
    } catch (_err) {
      setState(form, 'error');
      toggleMessage(error, true, 'Subscription failed. Please try again.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener('submit', handleSubmit);
})();
`;

export const PORTAL_RUNTIME_JS = `/* Nectar static Portal runtime. */
(function () {
  var cfg = (typeof window !== 'undefined' && window.NectarPortal) || {};
  var actions = cfg.actions || {};
  var supported = {
    signup: true,
    subscribe: true,
    signin: true,
    account: true,
    upgrade: true,
    recommendations: true
  };

  function warn(action) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[nectar-portal] data-portal="' + action + '" has no configured static destination');
    }
  }

  function usableHref(el) {
    if (!el || !el.getAttribute) return '';
    var href = el.getAttribute('href') || '';
    if (!href || href === '#' || href.indexOf('#/portal/') === 0) return '';
    if (/^javascript:/i.test(href)) return '';
    return href;
  }

  function navigate(url, external) {
    if (!url) return;
    if (external) {
      window.open(url, '_blank', 'noopener');
    } else {
      window.location.href = url;
    }
  }

  function handleClick(event) {
    if (event.defaultPrevented) return;
    var trigger = event.target && event.target.closest
      ? event.target.closest('[data-portal]')
      : null;
    if (!trigger) return;
    if (trigger.hasAttribute && trigger.hasAttribute('data-nectar-recommendations-link')) return;

    var rawAction = trigger.getAttribute('data-portal') || '';
    if (!supported[rawAction]) return;
    var action = rawAction === 'subscribe' ? 'signup' : rawAction;
    var url = actions[action];

    var customEvent;
    if (typeof window.CustomEvent === 'function') {
      customEvent = new CustomEvent('nectar:portal', {
        bubbles: true,
        cancelable: true,
        detail: { action: rawAction, resolvedAction: action, url: url || null, trigger: trigger }
      });
      if (!trigger.dispatchEvent(customEvent)) {
        event.preventDefault();
        return;
      }
    }

    if (url) {
      event.preventDefault();
      navigate(url, action === 'signup' && cfg.open_signup_in_new_tab === true);
      return;
    }

    if (usableHref(trigger)) return;
    event.preventDefault();
    warn(rawAction);
  }

  document.addEventListener('click', handleClick);
})();
`;

export interface EmitPortalRuntimeOptions {
  outputDir: string;
  enabled: boolean;
}

export async function emitPortalRuntime(opts: EmitPortalRuntimeOptions): Promise<boolean> {
  if (!opts.enabled) return false;
  const dest = join(opts.outputDir, PORTAL_RUNTIME_PATH);
  await ensureDir(dirname(dest));
  await writeFile(dest, PORTAL_RUNTIME_JS, 'utf8');
  return true;
}

export interface PortalRuntimeConfig {
  basePath: string;
  portalUrls: ResolvedPortalUrls;
  recommendationsEnabled: boolean;
  openSignupInNewTab?: boolean | undefined;
}

export function renderPortalRuntimeConfig(opts: PortalRuntimeConfig): string {
  const actions: Record<string, string> = {};
  addUrl(actions, 'signup', opts.portalUrls.signup);
  addUrl(actions, 'signin', opts.portalUrls.signin);
  addUrl(actions, 'account', opts.portalUrls.account);
  addUrl(actions, 'upgrade', opts.portalUrls.upgrade);
  if (opts.recommendationsEnabled) {
    addUrl(
      actions,
      'recommendations',
      `${joinPath(opts.basePath, 'recommendations/')}#all-recommendations`,
    );
  }

  const out: { actions: Record<string, string>; open_signup_in_new_tab?: boolean } = { actions };
  if (opts.openSignupInNewTab === true) out.open_signup_in_new_tab = true;
  return JSON.stringify(out);
}

function addUrl(out: Record<string, string>, key: string, value: string | undefined): void {
  if (typeof value === 'string' && value.trim()) out[key] = value;
}
