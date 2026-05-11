/* eslint-disable no-undef */
/* global app, connectionState, usageRefreshDueAt, feedback, formState, editState, requestPopupResize, formatDuration */

function renderConnectionBar() {
  return `
    <div class="connection-bar">
      <span class="connection-dot ${connectionState}"></span>
      ${connectionState === 'disconnected' ? `
        <span class="reconnect-btn" onclick="reconnect()">reconnect</span>
      ` : ''}
      <span style="color:${connectionState === 'connected' ? '#666' : '#ef4444'}">${connectionState === 'connected' ? 'Connected' : 'Disconnected'}</span>
    </div>
  `;
}

function formatUsageRefreshCountdown() {
  const remainingMs = Math.max(0, usageRefreshDueAt - Date.now());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatResetTime(resetStr) {
  if (!resetStr) return '';
  try {
    const resetDate = new Date(resetStr);
    const now = new Date();
    const diffMs = resetDate - now;
    if (diffMs <= 0) return 'now';
    return formatDuration(diffMs);
  } catch {
    return resetStr;
  }
}

function formatResetAt(epochSeconds) {
  if (!epochSeconds) return '';
  const date = new Date(epochSeconds * 1000);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) {
    return time;
  }
  return `${time} ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function percentColor(percent) {
  return percent > 50 ? '#22c55e' : percent > 20 ? '#eab308' : '#ef4444';
}

function codexLimitLabel(limit) {
  if (!limit?.windowMinutes) return 'Limit';
  if (limit.windowMinutes === 300) return '5h limit';
  if (limit.windowMinutes === 10080) return 'Weekly limit';
  if (limit.windowMinutes < 60) return `${limit.windowMinutes}m limit`;
  if (limit.windowMinutes % 60 === 0) return `${limit.windowMinutes / 60}h limit`;
  return `${limit.windowMinutes}m limit`;
}

function renderCodexLimitRow(limit) {
  const pct = clampPercent(limit.remainingPercent);
  const color = percentColor(pct);
  return `
    <div style="margin-top:3px;">
      <div class="usage-line">
        <span>${codexLimitLabel(limit)}</span>
        <strong style="color:${color}">${pct}% left${limit.resetsAt ? ` · ${formatResetAt(limit.resetsAt)}` : ''}</strong>
      </div>
      <div class="usage-bar">
        <div class="usage-bar-fill" style="width:${pct}%;background:${color};"></div>
      </div>
    </div>
  `;
}

function renderCodexLimits(codexSession) {
  const limits = codexSession?.limits;
  if (!limits?.available) {
    return `<div style="font-size:10px;color:#999;margin-top:2px;">Limits not available for this account</div>`;
  }

  return `
    <div>
      ${limits.primary ? renderCodexLimitRow(limits.primary) : ''}
      ${limits.secondary ? renderCodexLimitRow(limits.secondary) : ''}
      ${limits.planType ? `<div style="font-size:9px;color:#888;margin-top:1px;">Plan: ${limits.planType}</div>` : ''}
    </div>
  `;
}

function formatTokenCount(value) {
  if (!Number.isFinite(value)) return '0';
  return formatCompactNumber(value);
}

function formatCompactNumber(value) {
  if (!Number.isFinite(value)) return '0';
  const units = ['', 'k', 'M', 'B', 'T'];
  let scaled = Math.abs(value);
  let unitIndex = 0;
  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }
  const sign = value < 0 ? '-' : '';
  return `${sign}${trimFixed(scaled, 2)}${units[unitIndex]}`;
}

function trimFixed(value, decimals) {
  return value.toFixed(decimals).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function renderCodexSessionUsage(codexSession) {
  const total = codexSession?.usage?.total;
  if (!total) {
    return '';
  }

  return `
    <div class="usage-grid" style="margin-top:3px;">
      <div class="usage-card">
        <div class="usage-value" style="color:#22c55e;font-size:11px;">${formatTokenCount(total.totalTokens)}</div>
        <div class="usage-label">Session</div>
      </div>
      <div class="usage-card">
        <div class="usage-value" style="color:#3b82f6;font-size:11px;">${formatTokenCount(total.inputTokens)}</div>
        <div class="usage-label">Input</div>
      </div>
      <div class="usage-card">
        <div class="usage-value" style="color:#888;font-size:11px;">${formatTokenCount(total.outputTokens)}</div>
        <div class="usage-label">Output</div>
      </div>
    </div>
  `;
}

function renderProviderUsage(usage) {
  return `
    <div class="usage-grid" style="margin-top:3px;">
      <div class="usage-card">
        <div class="usage-value" style="color:#3b82f6;font-size:11px;">$${trimFixed(usage.estimatedCostUsd || 0, 2)}</div>
        <div class="usage-label">Cost</div>
      </div>
      <div class="usage-card">
        <div class="usage-value" style="color:#22c55e;font-size:11px;">${formatTokenCount(usage.totalTokens || 0)}</div>
        <div class="usage-label">Tokens</div>
      </div>
      <div class="usage-card">
        <div class="usage-value" style="color:#888;font-size:11px;">${usage.requestCount || 0}</div>
        <div class="usage-label">Reqs</div>
      </div>
    </div>
  `;
}

function renderLocalSessionUsage(usage) {
  return `
    <div class="usage-grid" style="margin-top:3px;">
      <div class="usage-card">
        <div class="usage-value" style="color:#22c55e;font-size:11px;">${formatTokenCount(usage.localSessionTokens || 0)}</div>
        <div class="usage-label">Stored</div>
      </div>
      <div class="usage-card">
        <div class="usage-value" style="color:#3b82f6;font-size:11px;">${formatTokenCount(usage.localSessionInputTokens || 0)}</div>
        <div class="usage-label">Input</div>
      </div>
      <div class="usage-card">
        <div class="usage-value" style="color:#888;font-size:11px;">${formatTokenCount(usage.localSessionOutputTokens || 0)}</div>
        <div class="usage-label">Output</div>
      </div>
    </div>
  `;
}

function render(status, usageToday, pendingOAuthLogin) {
  if (!status) {
    app.innerHTML = `
      <div class="error">
        <div>⚠️ Router not running</div>
        <div style="font-size: 10px; margin-top: 4px;">Start with: codex-failover start</div>
      </div>
      ${renderConnectionBar()}
    `;
    requestPopupResize();
    return;
  }

  const providers = status.providers || [];
  const enabledProviders = providers.filter((p) => p.enabled).sort((a, b) => a.priority - b.priority);
  const primary = enabledProviders[0];
  const rawActiveId = status.activeProviderId || '';
  const activeId = enabledProviders.some((p) => p.id === rawActiveId) ? rawActiveId : (primary?.id || '');
  const isFallback = enabledProviders.length > 1 && !!primary && !!activeId && activeId !== primary.id;
  const statusClass = isFallback ? 'fallback' : (activeId ? 'active' : 'error');
  const statusText = isFallback ? 'Fallback' : (activeId ? 'Primary' : 'Error');

  const codexAuth = status.codexAuth || {};
  const authSection = codexAuth.detected
    ? `
      <div class="section">
        <div class="section-title">Codex Auth</div>
        <div class="info-row">
          <span class="info-label">Account</span>
          <span class="info-value">${codexAuth.email || codexAuth.accountId || 'Unknown'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Status</span>
          <span class="info-value" style="color:${codexAuth.isExpired ? '#ef4444' : '#22c55e'}">${codexAuth.isExpired ? 'Expired' : 'Valid'}</span>
        </div>
        ${codexAuth.isExpired ? `
          <div class="actions">
            <button class="btn btn-primary" onclick="runCodexLogin()">Run codex login</button>
          </div>
        ` : ''}
      </div>
    `
    : `
      <div class="section">
        <div class="section-title">Codex Auth</div>
        <div style="color:#666;font-size:11px;">No auth detected. Run <code>codex login</code> first.</div>
        <div class="actions">
          <button class="btn btn-primary" onclick="runCodexLogin()">Run codex login</button>
        </div>
      </div>
    `;

  const codexSession = usageToday?.codexSession;
  const codexLimitSession = usageToday?.codexLimitSession || (codexSession?.limits?.available ? codexSession : null);
  const usageSection = usageToday && usageToday.providers?.length > 0
    ? `
      <div class="section">
        <div class="section-title">
          <span>Usage</span>
          <button class="usage-refresh-timer" id="usageRefreshTimer" onclick="refreshUsageNow()" title="Refresh usage now">${formatUsageRefreshCountdown()}</button>
        </div>
        ${usageToday.providers.filter((p) => p.enabled).map((p) => {
          const isOAuth = p.type === 'openai-oauth-pass-through';
          const isActiveApiProvider = !isOAuth && p.providerId === activeId;
          const providerCodexSession = p.codexSession || (isActiveApiProvider && !codexSession?.modelProvider ? codexSession : null);
          const providerSessionTotal = providerCodexSession?.usage?.total?.totalTokens || 0;
          const hasActualProviderUsage = (p.requestCount || 0) > 0 || (p.totalTokens || 0) > 0;
          const hasLocalSessionUsage = (p.localSessionTokens || 0) > 0;
          const shouldShowCodexSessionUsage = isActiveApiProvider
            && p.requestCount === 0
            && providerCodexSession?.usage
            && !providerCodexSession?.limits?.available
            && providerSessionTotal >= (p.totalTokens || 0);
          const displayName = p.alias || p.providerId;
          const name = displayName.length > 20 ? `${displayName.slice(0, 18)}…` : displayName;
          let details = '';

          if (isOAuth && codexLimitSession) {
            details = renderCodexLimits(codexLimitSession);
          } else if (isOAuth && p.rateLimit) {
            const reqPct = p.rateLimit.limitRequests > 0 ? Math.round((p.rateLimit.remainingRequests / p.rateLimit.limitRequests) * 100) : 100;
            const tokPct = p.rateLimit.limitTokens > 0 ? Math.round((p.rateLimit.remainingTokens / p.rateLimit.limitTokens) * 100) : 100;
            const color = Math.min(reqPct, tokPct) > 50 ? '#22c55e' : Math.min(reqPct, tokPct) > 20 ? '#eab308' : '#ef4444';
            details = `
              <div style="margin-top:3px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;">
                  <span>Requests</span>
                  <span style="color:${color}">${p.rateLimit.remainingRequests}/${p.rateLimit.limitRequests}</span>
                </div>
                <div style="height:3px;background:#eee;border-radius:2px;margin:2px 0;">
                  <div style="height:100%;width:${reqPct}%;background:${color};border-radius:2px;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;">
                  <span>Tokens</span>
                  <span style="color:${color}">${formatTokenCount(p.rateLimit.remainingTokens)}/${formatTokenCount(p.rateLimit.limitTokens)}</span>
                </div>
                <div style="height:3px;background:#eee;border-radius:2px;margin:2px 0;">
                  <div style="height:100%;width:${tokPct}%;background:${color};border-radius:2px;"></div>
                </div>
                ${p.rateLimit.resetRequests ? `<div style="font-size:9px;color:#888;">Resets in ${formatResetTime(p.rateLimit.resetRequests)}</div>` : ''}
              </div>
            `;
          } else if (shouldShowCodexSessionUsage) {
            details = renderCodexSessionUsage(providerCodexSession);
          } else if (hasActualProviderUsage) {
            details = renderProviderUsage(p);
          } else if (isActiveApiProvider && providerCodexSession?.usage && !providerCodexSession?.limits?.available) {
            details = renderCodexSessionUsage(providerCodexSession);
          } else if (hasLocalSessionUsage) {
            details = renderLocalSessionUsage(p);
          } else {
            details = renderProviderUsage(p);
          }

          return `
            <div style="padding:4px 0;border-bottom:1px solid #f0f0f0;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:500;font-size:11px;">${name}</span>
                <span style="font-size:9px;color:#888;">${isOAuth ? 'OAuth' : 'API'}</span>
              </div>
              ${details}
            </div>
          `;
        }).join('')}
      </div>
    `
    : '';

  const providersHtml = providers.map((p) => {
    const isEnabled = !!p.enabled;
    const isActive = isEnabled && p.id === activeId;
    const isOAuth = p.credentialMode === 'inbound-authorization';
    const isPending = isOAuth && pendingOAuthLogin?.providerId === p.id;
    let badgeClass;
    if (isPending) {
      badgeClass = 'pending';
    } else if (isActive) {
      badgeClass = 'active';
    } else if (isEnabled) {
      badgeClass = 'fallback';
    } else {
      badgeClass = 'disabled';
    }
    const badgeText = isPending ? 'pending' : badgeClass;
    const authLabel = isOAuth ? 'OAuth' : 'API Key';
    const displayName = p.alias || (p.accountId && p.accountId !== 'default' ? `${p.id} (${p.accountId})` : p.id);
    const isEditing = editState.open && editState.providerId === p.id;
    const isAzure = p.type === 'azure-openai-api-key';
    const editFields = isEditing ? editState.fields : {};
    const existingAlias = editFields.alias ?? p.alias ?? '';
    const existingBaseUrl = editFields.baseUrl ?? p.baseUrl ?? '';
    const existingDeploymentName = editFields.deploymentName ?? p.deploymentName ?? '';
    const existingApiKey = editFields.apiKey ?? '';
    const editFormHtml = isEditing ? `
      <div class="edit-form" id="editForm" data-provider-id="${escapeAttr(p.id)}" style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;font-weight:600;color:#3b82f6;margin-bottom:4px;">Edit Provider</div>
        <div class="form-field">
          <label>Alias</label>
          <input class="form-input" id="editAlias" value="${escapeAttr(existingAlias)}" />
        </div>
        ${!isOAuth && isAzure ? `
          <div class="form-field">
            <label>Base URL</label>
            <input class="form-input" id="editBaseUrl" value="${escapeAttr(existingBaseUrl)}" />
          </div>
          <div class="form-field">
            <label>Deployment Name</label>
            <input class="form-input" id="editDeployment" value="${escapeAttr(existingDeploymentName)}" />
          </div>
        ` : ''}
        ${!isOAuth ? `
          <div class="form-field">
            <label>API Key</label>
            <input class="form-input" id="editApiKey" type="password" placeholder="Leave empty to keep current" value="${escapeAttr(existingApiKey)}" />
          </div>
        ` : ''}
        <div class="actions">
          <button class="btn btn-secondary" onclick="hideEditForm()">Cancel</button>
          <button class="btn btn-primary" onclick="saveEditProvider()">Save</button>
        </div>
      </div>
    ` : '';
    const deleteBtn = !p.enabled ? `<span style="cursor:pointer;padding:2px;display:inline-flex;align-items:center;" onclick="deleteProvider('${p.id}')" title="Delete provider"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></span>` : '';
    const canDisable = !p.enabled || enabledProviders.length > 1;
    let toggleClass;
    if (isOAuth) {
      if (isPending) {
        toggleClass = 'toggle pending';
      } else if (isActive) {
        toggleClass = 'toggle on';
      } else {
        toggleClass = `toggle ${canDisable ? '' : 'locked'}`;
      }
    } else {
      toggleClass = `toggle ${p.enabled ? 'on' : ''} ${canDisable ? '' : 'locked'}`;
    }
    const toggleClickHandler = isOAuth
      ? `onclick="selectOAuthProvider('${p.id}', ${!p.enabled}, ${enabledProviders.length})"`
      : `onclick="toggleProvider('${p.id}', ${!p.enabled}, ${enabledProviders.length})"`;
    return `
      <div class="provider-row" ondblclick="showEditForm('${p.id}')">
        <div class="provider-info">
          <div class="provider-name">${displayName}</div>
          <div class="provider-type">${authLabel}</div>
        </div>
        <div class="provider-actions">
          <span class="badge ${badgeClass}">${badgeText}</span>
          <div class="${toggleClass}" ${toggleClickHandler}></div>
          ${deleteBtn}
        </div>
      </div>
      ${editFormHtml}
    `;
  }).join('');

  app.innerHTML = `
    <div class="header">
      <div class="status-dot ${statusClass}"></div>
      <div class="title">codex-failover — ${statusText}</div>
    </div>

    ${authSection}
    ${usageSection}

    <div class="section">
      <div class="section-title">Providers (${providers.length})</div>
      ${providersHtml || '<div style="color:#666;font-size:11px;">No providers configured.</div>'}
      <div class="add-provider-form" id="addForm" style="display:none">
        <div class="form-field">
          <label>Alias <span style="font-weight:400;color:#aaa;">(optional)</span></label>
          <input class="form-input" id="aliasInput" placeholder="My Provider" />
        </div>
        <div class="form-field">
          <label>Type</label>
          <select class="form-input" id="typeInput" onchange="onTypeChange()">
            <option value="azure-openai-api-key">Azure OpenAI</option>
            <option value="openai-api-key">OpenAI API Key</option>
          </select>
        </div>
        <div class="form-field" id="baseUrlField">
          <label>Base URL</label>
          <input class="form-input" id="baseUrlInput" placeholder="https://resource.openai.azure.com/openai/responses?api-version=preview" />
        </div>
        <div class="form-field" id="deploymentNameField">
          <label>Deployment Name</label>
          <input class="form-input" id="deploymentNameInput" placeholder="gpt-5.1" />
        </div>
        <div class="form-field">
          <label>API Key</label>
          <input class="form-input" id="apiKeyInput" type="password" placeholder="your-api-key" />
        </div>
        <div class="actions">
          <button class="btn btn-secondary" onclick="hideAddForm()">Cancel</button>
          <button class="btn btn-primary" onclick="addProvider()">Add</button>
        </div>
      </div>
      <div class="actions" id="addBtnRow">
        <button class="btn btn-secondary" onclick="showAddForm()">+ Add Provider</button>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-secondary" onclick="resetFallback()">Reset Fallback</button>
      <button class="btn btn-primary" onclick="refreshNow()">Refresh</button>
    </div>

    ${renderConnectionBar()}
    ${feedback.message ? `<div class="feedback ${feedback.type}">${feedback.message}</div>` : ''}
  `;

  if (formState.open) {
    requestAnimationFrame(() => {
      const form = document.getElementById('addForm');
      const btnRow = document.getElementById('addBtnRow');
      if (form && btnRow) {
        form.style.display = 'block';
        btnRow.style.display = 'none';
      }
      const jsonEl = document.getElementById('jsonInput');
      if (jsonEl) jsonEl.value = formState.json;
      requestPopupResize();
    });
  } else if (editState.open) {
    requestPopupResize();
  } else {
    requestPopupResize();
  }

  if (editState.open) {
    requestAnimationFrame(() => {
      const editAlias = document.getElementById('editAlias');
      if (editAlias && editState.fields.alias !== undefined) {
        editAlias.value = editState.fields.alias;
      }
      const editBaseUrl = document.getElementById('editBaseUrl');
      if (editBaseUrl && editState.fields.baseUrl !== undefined) {
        editBaseUrl.value = editState.fields.baseUrl;
      }
      const editDeployment = document.getElementById('editDeployment');
      if (editDeployment && editState.fields.deploymentName !== undefined) {
        editDeployment.value = editState.fields.deploymentName;
      }
      const editApiKey = document.getElementById('editApiKey');
      if (editApiKey && editState.fields.apiKey !== undefined) {
        editApiKey.value = editState.fields.apiKey;
      }
      requestPopupResize();
    });
  }
}

window.PopupRender = {
  render,
  formatDuration,
};
