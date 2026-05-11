/* eslint-disable no-undef */
/* global formatUsageRefreshCountdown */

const app = document.getElementById('app');
let refreshInterval;
let currentProviders = [];
let currentAuth = null;
let feedback = { type: '', message: '' };
let feedbackTimeoutId = null;
let formState = { open: false, json: '' };
let editState = { open: false, providerId: '', fields: {} };
let connectionState = 'connected'; // 'connected' | 'disconnected'
const FEEDBACK_TTL_MS = 1500;
const USAGE_REFRESH_MS = 5 * 60 * 1000;
let usageRefreshDueAt = Date.now() + USAGE_REFRESH_MS;
let usageCountdownTimerId = null;
let loadingAll = false;
let pendingLoadAllOptions = null;
let pendingOAuthLogin = null;

// Keep in sync with DEFAULTS.BIND_ADDRESS:PORT/API_PREFIX in @codex-failover/shared
const API = 'http://127.0.0.1:8787/api';

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function api(path, opts = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { ...opts.headers, Origin: 'http://127.0.0.1:8787' },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: body?.error || `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, data: body };
  } catch (err) {
    console.error(`API ${path} failed:`, err);
    return { ok: false, status: 0, error: 'Network error. Is router running?' };
  }
}

function renderApp(status, usageToday) {
  if (window.PopupRender?.render) {
    window.PopupRender.render(status, usageToday, pendingOAuthLogin);
    return;
  }
}

async function loadAll(options = {}) {
  const resetUsageTimer = options.resetUsageTimer !== false;
  const forceUsageRefresh = options.forceUsageRefresh === true;
  if (loadingAll) {
    pendingLoadAllOptions = {
      resetUsageTimer: resetUsageTimer || pendingLoadAllOptions?.resetUsageTimer === true,
      forceUsageRefresh: forceUsageRefresh || pendingLoadAllOptions?.forceUsageRefresh === true,
    };
    return;
  }

  loadingAll = true;
  if (resetUsageTimer) {
    usageRefreshDueAt = Date.now() + USAGE_REFRESH_MS;
  }

  try {
    const usagePath = forceUsageRefresh ? '/dashboard/usage-today?refresh=1' : '/dashboard/usage-today';
    const [statusRes, usageTodayRes] = await Promise.all([
      api('/status'),
      api(usagePath),
    ]);
    const status = statusRes?.ok ? statusRes.data : null;
    const usageToday = usageTodayRes?.ok ? usageTodayRes.data : null;
    if (status === null) {
      connectionState = 'disconnected';
    } else {
      connectionState = 'connected';
    }
    currentProviders = status?.providers || [];
    currentAuth = status?.codexAuth || null;
    saveEditState();
    renderApp(status, usageToday);
  } finally {
    loadingAll = false;
    if (pendingLoadAllOptions) {
      const nextOptions = pendingLoadAllOptions;
      pendingLoadAllOptions = null;
      loadAll(nextOptions);
    } else {
      ensureUsageCountdownTimer();
      updateUsageCountdown();
    }
  }
}

function ensureUsageCountdownTimer() {
  if (usageCountdownTimerId !== null) {
    return;
  }

  usageCountdownTimerId = window.setInterval(() => {
    if (Date.now() >= usageRefreshDueAt) {
      loadAll();
      return;
    }
    updateUsageCountdown();
  }, 1000);
}

function updateUsageCountdown() {
  const el = document.getElementById('usageRefreshTimer');
  if (el) {
    if (typeof formatUsageRefreshCountdown === 'function') {
      el.textContent = formatUsageRefreshCountdown();
    }
  }
}

function requestPopupResize() {
  if (!window.electronAPI?.resizePopup) {
    return;
  }

  requestAnimationFrame(() => {
    const scrollRoot = document.querySelector('.scroll');
    const height = Math.ceil(scrollRoot?.getBoundingClientRect().height || app.getBoundingClientRect().height);
    window.electronAPI.resizePopup(height);
  });
}

function saveFormState() {
  formState.open = !!document.getElementById('addForm') && document.getElementById('addForm')?.style.display !== 'none';
  if (formState.open) {
    formState.json = document.getElementById('jsonInput')?.value ?? formState.json;
  }
}

function saveEditState() {
  if (!editState.open) {
    return;
  }

  const form = document.getElementById('editForm');
  if (form && form.dataset.providerId !== editState.providerId) {
    return;
  }

  editState.fields = {
    ...editState.fields,
    alias: document.getElementById('editAlias')?.value ?? editState.fields.alias,
    baseUrl: document.getElementById('editBaseUrl')?.value ?? editState.fields.baseUrl,
    deploymentName: document.getElementById('editDeployment')?.value ?? editState.fields.deploymentName,
    apiKey: document.getElementById('editApiKey')?.value ?? editState.fields.apiKey,
  };
}

function clearFeedbackTimer() {
  if (feedbackTimeoutId !== null) {
    clearTimeout(feedbackTimeoutId);
    feedbackTimeoutId = null;
  }
}

function setFeedback(type, message, opts = {}) {
  const preserveFormState = opts.preserveFormState !== false;
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : FEEDBACK_TTL_MS;

  if (preserveFormState) {
    saveFormState();
    saveEditState();
  }
  clearFeedbackTimer();
  feedback = { type, message };
  loadAll();

  if (!message || ttlMs <= 0) {
    return;
  }

  feedbackTimeoutId = window.setTimeout(() => {
    feedback = { type: '', message: '' };
    feedbackTimeoutId = null;
    loadAll();
  }, ttlMs);
}

function showAddForm() {
  document.getElementById('addForm').style.display = 'block';
  document.getElementById('addBtnRow').style.display = 'none';
  document.getElementById('aliasInput').value = '';
  document.getElementById('baseUrlInput').value = '';
  document.getElementById('deploymentNameInput').value = '';
  document.getElementById('apiKeyInput').value = '';
  onTypeChange();
  requestPopupResize();
}

function hideAddForm() {
  formState = { open: false, json: '' };
  clearFeedbackTimer();
  feedback = { type: '', message: '' };
  const form = document.getElementById('addForm');
  const btnRow = document.getElementById('addBtnRow');
  if (form) form.style.display = 'none';
  if (btnRow) btnRow.style.display = 'flex';
  requestPopupResize();
}

function showEditForm(providerId) {
  if (editState.open) {
    saveEditState();
  }

  const provider = currentProviders.find((p) => p.id === providerId);
  if (!provider) {
    return;
  }

  editState = {
    open: true,
    providerId,
    fields: {
      alias: provider.alias || '',
      baseUrl: provider.baseUrl || '',
      deploymentName: provider.deploymentName || '',
      apiKey: '',
    },
  };
  loadAll();
}

function hideEditForm() {
  editState = { open: false, providerId: '', fields: {} };
  loadAll();
}

async function saveEditProvider() {
  saveEditState();
  const id = editState.providerId;
  const provider = currentProviders.find((p) => p.id === id);
  if (!provider) return;

  const isOAuth = provider.credentialMode === 'inbound-authorization';
  const isAzure = provider.type === 'azure-openai-api-key';

  const patch = {};
  patch.alias = document.getElementById('editAlias')?.value.trim() || undefined;

  if (!isOAuth) {
    const apiKey = document.getElementById('editApiKey')?.value.trim();
    if (apiKey) patch.apiKey = apiKey;
    if (isAzure) {
      patch.baseUrl = document.getElementById('editBaseUrl')?.value.trim() || undefined;
      patch.deploymentName = document.getElementById('editDeployment')?.value.trim() || undefined;
    }
  }

  const result = await api(`/providers/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });

  if (result?.ok) {
    editState = { open: false, providerId: '', fields: {} };
    setFeedback('success', `Provider ${id} updated.`, { preserveFormState: false });
  } else {
    setFeedback('error', `Failed: ${result?.error || 'Unknown error'}`);
  }
}

async function toggleProvider(id, enabled, enabledCountSnapshot) {
  if (!enabled && enabledCountSnapshot <= 1) {
    setFeedback('error', 'At least one provider must remain enabled.');
    return;
  }

  const result = await api(`/providers/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (result?.ok) {
    const persistedEnabled = result?.data?.enabled === true;
    setFeedback('success', `Provider ${id} ${persistedEnabled ? 'enabled' : 'disabled'}.`);
  } else {
    setFeedback('error', `Failed to update provider: ${result?.error || 'Unknown error'}`);
  }
}

async function selectOAuthProvider(id, enabled) {
  const provider = currentProviders.find((p) => p.id === id);
  if (!provider || provider.credentialMode !== 'inbound-authorization') return;

  if (!enabled) {
    const currentlyEnabledCount = currentProviders.filter((p) => p.enabled).length;
    if (currentlyEnabledCount <= 1) {
      setFeedback('error', 'At least one provider must remain enabled.');
      loadAll();
      return;
    }
    const result = await api(`/providers/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    if (result?.ok) {
      setFeedback('success', `Provider ${id} disabled.`);
    } else {
      setFeedback('error', `Failed: ${result?.error || 'Unknown error'}`);
    }
    return;
  }

  const isCurrentAuth = currentAuth?.accountId && provider.accountId === currentAuth.accountId && !currentAuth?.isExpired;

  if (!isCurrentAuth) {
    if (pendingOAuthLogin?.timeoutId) {
      clearTimeout(pendingOAuthLogin.timeoutId);
    }

    pendingOAuthLogin = { providerId: id };
    setFeedback('info', 'Opening login window...');

    const LOGIN_TIMEOUT_MS = 2 * 60 * 1000;
    const timeoutId = window.setTimeout(() => {
      if (pendingOAuthLogin?.providerId === id) {
        pendingOAuthLogin = null;
        setFeedback('error', 'Login timed out. Please try again.');
        loadAll();
      }
    }, LOGIN_TIMEOUT_MS);

    pendingOAuthLogin.timeoutId = timeoutId;
    loadAll();

    const loginResult = await api(`/providers/${id}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (pendingOAuthLogin?.providerId !== id) {
      return;
    }

    if (!loginResult?.ok || loginResult?.data?.success !== true) {
      clearTimeout(timeoutId);
      pendingOAuthLogin = null;
      setFeedback('error', 'Login failed. Cannot activate OAuth account.');
      loadAll();
      return;
    }
  }

  const otherOAuthProviders = currentProviders.filter(
    (candidate) => candidate.credentialMode === 'inbound-authorization'
      && candidate.id !== id
      && candidate.enabled,
  );
  for (const other of otherOAuthProviders) {
    await api(`/providers/${other.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
  }

  const enableResult = await api(`/providers/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });

  if (pendingOAuthLogin?.timeoutId) {
    clearTimeout(pendingOAuthLogin.timeoutId);
  }
  pendingOAuthLogin = null;

  if (enableResult?.ok) {
    setFeedback('success', `Provider ${id} activated.`);
  } else {
    setFeedback('error', `Failed to activate provider: ${enableResult?.error || 'Unknown error'}`);
  }
}

function onTypeChange() {
  const type = document.getElementById('typeInput').value;
  const isAzure = type === 'azure-openai-api-key';
  document.getElementById('baseUrlField').style.display = isAzure ? 'block' : 'none';
  document.getElementById('deploymentNameField').style.display = isAzure ? 'block' : 'none';
  requestPopupResize();
}

async function addProvider() {
  const type = document.getElementById('typeInput').value;
  const isAzure = type === 'azure-openai-api-key';
  const alias = document.getElementById('aliasInput').value.trim() || undefined;
  const baseUrl = isAzure ? document.getElementById('baseUrlInput').value.trim() : 'https://api.openai.com/v1';
  const deploymentName = isAzure ? document.getElementById('deploymentNameInput').value.trim() : undefined;
  const apiKey = document.getElementById('apiKeyInput').value.trim();

  if (isAzure && !baseUrl) {
    setFeedback('error', 'Base URL is required.');
    return;
  }
  if (isAzure && !deploymentName) {
    setFeedback('error', 'Deployment name is required.');
    return;
  }
  if (!apiKey) {
    setFeedback('error', 'API key is required.');
    return;
  }

  const existing = currentProviders.filter((p) => p.type === type).length;
  const provider = {
    id: isAzure ? `azure-${existing + 1}` : `openai-${existing + 1}`,
    type,
    alias,
    baseUrl,
    deploymentName,
    apiKey,
    priority: currentProviders.length + 1,
    credentialMode: 'stored-api-key',
    modelAlias: { default: 'default' },
  };

  const result = await api('/providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(provider),
  });

  if (result?.ok) {
    formState = { open: false, json: '' };
    setFeedback('success', `Provider ${provider.id} added.`, { preserveFormState: false });
  } else {
    setFeedback('error', `Failed: ${result?.error || 'Unknown error'}`);
  }
}

async function deleteProvider(id) {
  if (!confirm(`Delete provider ${id}?`)) {
    return;
  }
  const result = await api(`/providers/${id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
  });

  if (result?.ok) {
    setFeedback('success', `Provider ${id} deleted.`);
  } else {
    setFeedback('error', `Failed: ${result?.error || 'Unknown error'}`);
  }
}

async function runCodexLogin() {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Running...';

  const oauthProvider = currentProviders.find((p) => p.type === 'openai-oauth-pass-through');
  const id = oauthProvider?.id || 'openai-oauth';

  const result = await api(`/providers/${id}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  btn.disabled = false;
  btn.textContent = result?.success ? 'Done ✓' : 'Failed ✗';
  setTimeout(() => {
    btn.textContent = 'Run codex login';
    loadAll();
  }, 2000);
}

function resetFallback() {
  fetch(`${API}/fallback-state/reset`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:8787' },
  }).then(() => setTimeout(loadAll, 500));
}

function refreshUsageNow() {
  saveFormState();
  usageRefreshDueAt = Date.now() + USAGE_REFRESH_MS;
  updateUsageCountdown();
  loadAll({ forceUsageRefresh: true });
}

function refreshNow() {
  refreshUsageNow();
}

function reconnect() {
  connectionState = 'connected';
  loadAll();
}

function initPopup() {
  loadAll();
  if (window.electronAPI) {
    window.electronAPI.onRefresh(() => loadAll());
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initPopup, { once: true });
} else {
  initPopup();
}

// Export globals for inline onclick handlers (popup-render.js templates).
window.showAddForm = showAddForm;
window.hideAddForm = hideAddForm;
window.showEditForm = showEditForm;
window.hideEditForm = hideEditForm;
window.saveEditProvider = saveEditProvider;
window.toggleProvider = toggleProvider;
window.selectOAuthProvider = selectOAuthProvider;
window.onTypeChange = onTypeChange;
window.addProvider = addProvider;
window.deleteProvider = deleteProvider;
window.runCodexLogin = runCodexLogin;
window.resetFallback = resetFallback;
window.refreshUsageNow = refreshUsageNow;
window.refreshNow = refreshNow;
window.reconnect = reconnect;
window.loadAll = loadAll;
window.requestPopupResize = requestPopupResize;
window.formatDuration = formatDuration;

// Keep referenced state bindings alive for linting; these are read by popup-render.js.
void refreshInterval;
void currentAuth;
void feedback;
void connectionState;
