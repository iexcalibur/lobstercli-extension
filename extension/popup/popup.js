/**
 * LobsterCLI Extension — Chat UI (works as popup AND side panel)
 */

let currentTab = null;
let aiConfig = null;
let chatStarted = false;
let interceptorActive = false;
let formObserverActive = false;
let formPollInterval = null;
let pageAccessible = false;
let isProcessing = false;

async function loadAiConfig() {
  const stored = await chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);
  if (stored.aiApiKey || stored.aiProvider === 'ollama') {
    aiConfig = stored;
  } else {
    aiConfig = null;
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  await loadAiConfig();

  setupListeners();

  // Get current tab and update context
  await refreshCurrentTab();

  // Listen for tab switches
  chrome.tabs.onActivated.addListener(async () => {
    await refreshCurrentTab();
  });

  // Listen for tab URL changes (full navigation)
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (currentTab && tabId === currentTab.id) {
      // Catch both full page loads AND in-page URL changes (SPA, pushState, hash)
      if (changeInfo.status === 'complete' || changeInfo.url) {
        await refreshCurrentTab();
        if (formObserverActive) stopFormPolling();
      }
    }
  });

  // Poll for in-page changes that Chrome doesn't fire events for
  // (e.g., Gmail tab switches, SPA route changes via history.replaceState)
  setInterval(async () => {
    if (!currentTab?.id || !pageAccessible) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && tab.url !== lastKnownUrl) {
        lastKnownUrl = tab.url;
        currentTab = tab;
        document.getElementById('context-text').textContent = tab.title || tab.url;
      }
    } catch {}
  }, 2000);

  // Listen for storage changes (user saves API key in settings)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.aiApiKey || changes.aiProvider || changes.aiModel || changes.aiBaseURL) {
      loadAiConfig();
    }
  });
});

let lastKnownUrl = '';

async function refreshCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    currentTab = tab;
    lastKnownUrl = tab?.url || '';

    const isRestricted = !tab?.url ||
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('about:') ||
      tab.url.startsWith('edge://') ||
      tab.url === '';

    pageAccessible = !isRestricted;

    // Update context bar
    const contextText = document.getElementById('context-text');
    if (pageAccessible) {
      contextText.textContent = tab.title || tab.url;
      enableSuggestions();
    } else {
      contextText.textContent = 'Navigate to a website to analyze it';
    }
  } catch {
    pageAccessible = false;
  }
}

function enableSuggestions() {}
function disableSuggestions() {}

function setupListeners() {
  document.getElementById('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('btn-new-chat').addEventListener('click', resetChat);
  document.getElementById('btn-send').addEventListener('click', handleSend);

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  document.getElementById('chat-input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  });

  document.getElementById('context-close').addEventListener('click', () => {
    document.getElementById('context-bar').style.display = 'none';
  });
}

// ── Chat Management ──
function resetChat() {
  chatStarted = false;
  interceptorActive = false;
  stopFormPolling();
  if (currentTab?.id && pageAccessible) {
    execInPage(() => {
      if (typeof lobsterDisconnectFormObserver === 'function') lobsterDisconnectFormObserver();
    }).catch(() => {});
  }
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = '';

  const welcome = document.createElement('div');
  welcome.className = 'welcome';
  welcome.id = 'welcome';
  welcome.innerHTML = `
    <div class="welcome-greeting">Hello!</div>
    <div class="welcome-sub">How can I help you today?</div>
    <div class="examples" id="examples">
      <div class="examples-label">Try asking</div>
      <span class="example-item">"Summarize this page"</span>
      <span class="example-item">"What are the key points?"</span>
      <span class="example-item">"Explain this simply"</span>
      <span class="example-item">"What's happening in this video?"</span>
      <span class="example-item">"Help me draft a reply"</span>
    </div>
  `;
  chatArea.appendChild(welcome);

  document.getElementById('chat-input').value = '';
  document.getElementById('chat-input').style.height = 'auto';
  document.getElementById('context-bar').style.display = 'flex';
  refreshCurrentTab();
}

function startChat() {
  if (chatStarted) return;
  chatStarted = true;
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
}

function addUserMessage(text) {
  startChat();
  const chatArea = document.getElementById('chat-area');
  const msg = document.createElement('div');
  msg.className = 'message message-user';
  msg.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
  chatArea.appendChild(msg);
  scrollToBottom();
}

function addBotMessage(html, actions = []) {
  const chatArea = document.getElementById('chat-area');
  const typing = chatArea.querySelector('.typing-indicator');
  if (typing) typing.parentElement.remove();

  const msg = document.createElement('div');
  msg.className = 'message message-bot';

  let actionsHtml = '';
  if (actions.length > 0) {
    actionsHtml = '<div class="msg-actions">' +
      actions.map(a => `<button class="msg-action-btn" data-copy="${a.copy ? 'true' : ''}" data-action="${a.action || ''}">${a.label}</button>`).join('') +
      '</div>';
  }

  msg.innerHTML = `
    <div class="msg-header"><span class="bot-icon">L</span><span class="bot-name">lobstercli</span></div>
    <div class="msg-bubble">${html}${actionsHtml}</div>
  `;

  // Store copy data on buttons
  chatArea.appendChild(msg);

  const actionBtns = msg.querySelectorAll('.msg-action-btn');
  actionBtns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (actions[i]?.copy) {
        navigator.clipboard.writeText(actions[i].copy);
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 1500);
      }
      if (actions[i]?.action) handleAction(actions[i].action);
    });
  });

  scrollToBottom();
}

function showTyping() {
  startChat();
  const chatArea = document.getElementById('chat-area');
  const msg = document.createElement('div');
  msg.className = 'message message-bot';
  msg.innerHTML = `
    <div class="msg-header"><span class="bot-icon">L</span><span class="bot-name">lobstercli</span></div>
    <div class="typing-indicator"><span></span><span></span><span></span></div>
  `;
  chatArea.appendChild(msg);
  scrollToBottom();
}

function scrollToBottom() {
  const chatArea = document.getElementById('chat-area');
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ── Form Observer Polling ──
function startFormPolling() {
  if (formPollInterval) return;
  formPollInterval = setInterval(async () => {
    if (!formObserverActive || !currentTab?.id || !pageAccessible) return;
    try {
      const changes = await execInPage(() => lobsterGetFormChanges());
      if (changes && changes.length > 0) {
        for (const change of changes) {
          renderFormChange(change);
        }
      }
    } catch {
      stopFormPolling();
    }
  }, 1500);
}

function stopFormPolling() {
  if (formPollInterval) {
    clearInterval(formPollInterval);
    formPollInterval = null;
  }
  formObserverActive = false;
}

function renderFormChange(change) {
  let html = '<div class="badge-row">';
  html += '<span class="badge badge-green">FORM UPDATE</span>';
  html += `<span class="badge badge-blue">${change.newFields.length} new field(s)</span>`;
  if (change.removedCount > 0) {
    html += `<span class="badge badge-red">${change.removedCount} removed</span>`;
  }
  html += '</div>';

  if (change.newFields.length > 0) {
    html += '<h3>New fields detected</h3>';
    html += '<div class="form-card">';
    for (const field of change.newFields) {
      html += '<div class="form-field">';
      html += `<span class="field-type">${field.type}</span>`;
      html += `<span class="field-label">${escapeHtml(field.label || field.name || 'unnamed')}</span>`;
      if (field.required) html += '<span class="field-required">req</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  addBotMessage(html);
}

// ── Send Message ──
async function handleSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || isProcessing) return;

  input.value = '';
  input.style.height = 'auto';

  addUserMessage(text);

  // Check page access
  if (!pageAccessible) {
    addBotMessage('Navigate to a website first — I can\'t access browser internal pages like <code>chrome://</code> or the new tab page.<br><br>Try opening any website and I\'ll be able to analyze it for you!');
    return;
  }

  showTyping();

  const lower = text.toLowerCase();

  // Check for explicit built-in commands first (exact matches only)
  if (/^(summarize|summarise|summary)\b/i.test(text.trim())) {
    await handleAction('summary');
  } else if (/^extract\b.*markdown/i.test(text.trim()) || lower === 'markdown') {
    await handleAction('extract');
  } else if (/^(detect|scan|find).*forms?\b/i.test(text.trim())) {
    await handleAction('forms');
  } else if (/^(show|list|get).*links?\b/i.test(text.trim())) {
    await handleAction('links');
  } else if (/^(monitor|start|show).*(network|api)/i.test(text.trim())) {
    await handleAction('network');
  } else if (/^(dom )?snapshot\b/i.test(text.trim())) {
    await handleAction('snapshot');
  } else {
    // Ask the Brain what data sources are needed
    await handleSmartQuestion(text);
  }
}

// ── Actions ──
async function handleAction(action) {
  if (isProcessing) return;

  if (!pageAccessible) {
    if (!chatStarted) {
      startChat();
      addUserMessage(action);
    }
    addBotMessage('Navigate to a website first — I can\'t access browser internal pages.<br><br>Open any website like <b>google.com</b> and try again!');
    return;
  }

  if (!chatStarted) {
    startChat();
    const labels = {
      summary: 'Summarize this page',
      keypoints: 'What are the key points?',
      explain: 'Explain this simply',
      videosummary: 'What\'s happening in this video?',
      draft: 'Help me draft a reply',
      vision: 'What\'s on screen right now?',
      forms: 'Detect all forms',
      links: 'Show key links',
      network: 'Monitor API calls',
      snapshot: 'DOM snapshot',
    };
    addUserMessage(labels[action] || action);
    showTyping();
  }

  switch (action) {
    case 'summary': return await doSummary();
    case 'keypoints': return await handleSmartQuestion('What are the key points and main takeaways from this page? List them as concise bullet points.');
    case 'explain': return await handleSmartQuestion('Explain the content of this page in simple, easy to understand terms. Avoid jargon and break down complex ideas.');
    case 'videosummary': return await handleSmartQuestion('What is happening in this video? Give me a detailed summary of the video content, the main topics discussed, and any key moments.');
    case 'draft': return await handleSmartQuestion('Based on the content of this page, help me draft a thoughtful reply or response. Suggest what key points to address.');
    case 'extract': return await doExtract();
    case 'forms': return await doForms();
    case 'links': return await doLinks();
    case 'network': return await doNetwork();
    case 'snapshot': return await doSnapshot();
    case 'vision': return await handleAIQuestion('Describe in detail what is currently visible on this page. What content, images, and UI elements can you see?', true);
  }
}

async function doSummary() {
  try {
    const summary = await execInPage(() => {
      const title = document.title || '';
      const description = document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('meta[property="og:description"]')?.content || '';
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';

      const headings = [];
      document.querySelectorAll('h1, h2, h3').forEach(h => {
        const text = h.textContent.trim();
        if (text && text.length < 200) headings.push({ level: parseInt(h.tagName[1]), text: text.slice(0, 100) });
      });

      let mainText = '';
      const article = document.querySelector('article') || document.querySelector('[role="main"]') ||
        document.querySelector('main') || document.querySelector('.content') || document.querySelector('#content');
      if (article) {
        mainText = article.innerText?.trim()?.slice(0, 1000) || '';
      } else {
        let maxLen = 0;
        document.querySelectorAll('div, section').forEach(el => {
          const text = el.innerText?.trim() || '';
          if (text.length > maxLen && text.length < 50000) { maxLen = text.length; mainText = text.slice(0, 1000); }
        });
      }

      let pageType = 'webpage';
      if (document.querySelector('article, .post, .blog-post')) pageType = 'article';
      else if (document.querySelector('.product, [itemtype*="Product"]')) pageType = 'product';
      else if (document.querySelector('form[action*="search"], input[type="search"]')) pageType = 'search';
      else if (document.forms.length > 2) pageType = 'form-heavy';

      const wordCount = document.body?.innerText?.split(/\s+/).filter(Boolean).length || 0;

      let framework = '';
      try {
        if (document.querySelector('#__next, script[src*="_next"]')) framework = 'Next.js';
        else if (document.querySelector('[data-reactroot], #root')) framework = 'React';
        else if (document.querySelector('[ng-version]')) framework = 'Angular';
        else if (document.querySelector('#app[data-v-app]')) framework = 'Vue';
      } catch {}

      return { title, h1, description, pageType, wordCount, framework,
        headings: headings.slice(0, 12), mainText: mainText.slice(0, 400),
        linkCount: document.querySelectorAll('a[href]').length,
        imageCount: document.querySelectorAll('img').length,
        formCount: document.forms.length };
    });

    if (!summary) { addBotMessage('Could not analyze this page.'); return; }

    let html = '<div class="badge-row">';
    html += `<span class="badge badge-red">${summary.pageType}</span>`;
    if (summary.framework) html += `<span class="badge badge-purple">${summary.framework}</span>`;
    html += `<span class="badge badge-blue">${summary.wordCount.toLocaleString()} words</span>`;
    html += `<span class="badge badge-green">${summary.linkCount} links</span>`;
    html += '</div>';

    if (summary.h1 || summary.title) html += `<h3>Title</h3><p>${escapeHtml(summary.h1 || summary.title)}</p>`;
    if (summary.description) html += `<h3>Description</h3><p>${escapeHtml(summary.description)}</p>`;
    if (summary.mainText) html += `<h3>Content Preview</h3><p>${escapeHtml(summary.mainText)}${summary.mainText.length >= 400 ? '...' : ''}</p>`;
    if (summary.headings?.length > 0) {
      html += '<h3>Structure</h3><ul>';
      for (const h of summary.headings) html += `<li>${'#'.repeat(h.level)} ${escapeHtml(h.text)}</li>`;
      html += '</ul>';
    }

    addBotMessage(html);
  } catch (err) {
    addBotMessage('Error analyzing page: ' + escapeHtml(err.message));
  }
}

async function doExtract() {
  try {
    await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/markdown.js'] });
    const md = await execInPage(() => lobsterMarkdown());
    const preview = typeof md === 'string' ? md.slice(0, 2000) : '';
    addBotMessage(
      `<h3>Markdown extracted (${md?.length || 0} chars)</h3><div class="code-block">${escapeHtml(preview)}${md?.length > 2000 ? '\n\n... (click Copy for full content)' : ''}</div>`,
      [{ label: 'Copy full Markdown', copy: md }]
    );
  } catch (err) {
    addBotMessage('Error extracting markdown: ' + escapeHtml(err.message));
  }
}

async function doSnapshot() {
  try {
    await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/snapshot.js'] });
    const snap = await execInPage(() => lobsterSnapshot());
    const preview = typeof snap === 'string' ? snap.slice(0, 2000) : '';
    addBotMessage(
      `<h3>DOM Snapshot (${snap?.length || 0} chars)</h3><div class="code-block">${escapeHtml(preview)}${snap?.length > 2000 ? '\n\n... (click Copy for full snapshot)' : ''}</div>`,
      [{ label: 'Copy full snapshot', copy: snap }]
    );
  } catch (err) {
    addBotMessage('Error taking snapshot: ' + escapeHtml(err.message));
  }
}

async function doForms() {
  try {
    await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/form-state.js'] });
    const state = await execInPage(() => lobsterFormState());

    if (!state || (state.forms.length === 0 && state.orphanFields.length === 0)) {
      addBotMessage('No forms or input fields found on this page.');
      return;
    }

    let html = `<h3>${state.forms.length} form(s) found</h3>`;
    for (const form of state.forms) {
      html += '<div class="form-card">';
      html += `<h4><span class="badge badge-blue">${form.method}</span> ${escapeHtml(form.name || form.id || 'Unnamed Form')}</h4>`;
      for (const field of form.fields) {
        html += '<div class="form-field">';
        html += `<span class="field-type">${field.type}</span>`;
        html += `<span class="field-label">${escapeHtml(field.label || field.name || 'unnamed')}</span>`;
        if (field.value && field.value !== '' && field.value !== false) html += `<span class="field-value">${escapeHtml(String(field.value))}</span>`;
        if (field.required) html += '<span class="field-required">req</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    if (state.orphanFields.length > 0) {
      html += `<div class="form-card"><h4><span class="badge badge-purple">Orphan</span> ${state.orphanFields.length} standalone fields</h4>`;
      for (const f of state.orphanFields) {
        html += `<div class="form-field"><span class="field-type">${f.type}</span><span class="field-label">${escapeHtml(f.label || f.name || '')}</span></div>`;
      }
      html += '</div>';
    }

    addBotMessage(html);

    // Install form observer for live change detection
    if (!formObserverActive) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/form-observer.js'] });
        await execInPage(() => lobsterInstallFormObserver());
        formObserverActive = true;
        startFormPolling();
      } catch {}
    }
  } catch (err) {
    addBotMessage('Error scanning forms: ' + escapeHtml(err.message));
  }
}

async function doLinks() {
  try {
    const links = await execInPage(() => {
      const results = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const text = a.textContent?.trim();
        if (text && text.length > 2 && text.length < 100 && !text.includes('\n')) {
          results.push({ text, href: a.href });
        }
      });
      return results.slice(0, 20);
    });

    if (!links || links.length === 0) {
      addBotMessage('No meaningful links found on this page.');
      return;
    }

    let html = `<h3>${links.length} key links</h3><ul>`;
    for (const link of links) {
      html += `<li><a href="${escapeHtml(link.href)}" target="_blank">${escapeHtml(link.text)}</a></li>`;
    }
    html += '</ul>';
    addBotMessage(html);
  } catch (err) {
    addBotMessage('Error extracting links: ' + escapeHtml(err.message));
  }
}

async function doNetwork() {
  if (!interceptorActive) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/interceptor.js'] });
      await execInPage(() => lobsterInstallInterceptor());
      interceptorActive = true;
      addBotMessage('Network monitor activated! I\'m intercepting all fetch/XHR calls now.<br><br>Browse around, then type <b>"show network"</b> to see captured API calls.');
    } catch (err) {
      addBotMessage('Error starting network monitor: ' + escapeHtml(err.message));
    }
    return;
  }

  const requests = await execInPage(() => {
    const store = window.__lobster_interceptor__;
    if (!store) return [];
    const reqs = [...store.requests];
    store.requests = [];
    return reqs;
  });

  if (!requests || requests.length === 0) {
    addBotMessage('No API calls captured yet. Interact with the page and try again.');
    return;
  }

  let html = `<h3>${requests.length} API calls captured</h3>`;
  for (const req of requests) {
    let displayUrl = req.url;
    try { const u = new URL(req.url); displayUrl = u.pathname + u.search; } catch {}
    html += `<div class="network-entry"><span class="method ${req.method}">${req.method}</span><span>${escapeHtml(displayUrl.slice(0, 80))}</span></div>`;
  }
  addBotMessage(html, [{ label: 'Copy as JSON', copy: JSON.stringify(requests, null, 2) }]);
}

/**
 * Smart question handler — asks the Brain what data to gather, then answers.
 */
async function handleSmartQuestion(question) {
  await loadAiConfig();

  if (!aiConfig) {
    addBotMessage(
      'AI features need an API key. Click the <b>gear icon</b> above to configure one.<br><br>' +
      'Supports <b>OpenAI</b>, <b>Anthropic</b>, <b>Google Gemini</b> (free tier!), and <b>Ollama</b> (local, free).<br><br>' +
      'Meanwhile, try the built-in commands — they work without any AI!');
    return;
  }

  if (!pageAccessible) {
    addBotMessage('Navigate to a website first so I can analyze its content for you.');
    return;
  }

  isProcessing = true;
  disableSuggestions();

  try {
    // ── PDF Detection: if current page is a PDF, extract via background worker ──
    const isPdf = currentTab.url?.toLowerCase().endsWith('.pdf') ||
                  /\/pdf\//.test(currentTab.url || '') ||
                  /arxiv\.org\/pdf\//.test(currentTab.url || '') ||
                  /[?&]format=pdf/i.test(currentTab.url || '');

    if (isPdf) {
      addBotMessage('<span class="badge">PDF</span> Extracting text from PDF...');

      const pdfResult = await chrome.runtime.sendMessage({
        action: 'extractPdf',
        url: currentTab.url,
      });

      if (!pdfResult.success) {
        addBotMessage('Failed to extract PDF: ' + escapeHtml(pdfResult.error));
        return;
      }

      const pdfContext = `[PDF Document: ${pdfResult.metadata.title}]\n` +
        `Pages: ${pdfResult.metadata.pages} | Words: ${pdfResult.wordCount}\n` +
        `Author: ${pdfResult.metadata.author || 'unknown'}\n\n` +
        pdfResult.text.slice(0, 15000);

      // Remove the "extracting" message
      const chatArea = document.getElementById('chat-area');
      const lastMsg = chatArea.querySelector('.message-bot:last-child');
      if (lastMsg) lastMsg.remove();

      // Send to AI with PDF content
      const response = await chrome.runtime.sendMessage({
        action: 'askAI',
        prompt: question,
        pageContent: pdfContext,
        pageUrl: currentTab.url,
        pageTitle: pdfResult.metadata.title,
        screenshot: null,
      });

      if (response.error) {
        addBotMessage('Error: ' + escapeHtml(response.error));
      } else {
        addBotMessage(formatAIResponse(response.answer));
      }
      return;
    }

    // ── YouTube Detection: extract transcript with SAPISIDHASH auth ──
    const videoId = extractYoutubeVideoId(currentTab.url);
    if (videoId) {
      console.log('[LobsterCLI] YouTube detected, videoId:', videoId);
      let ytResult = null;

      // Strategy 1: MAIN world — full extraction with authenticated caption fetch.
      // YouTube requires SAPISIDHASH auth for both innertube API and timedtext URLs.
      // We do everything inside the page context where we have cookies + crypto.subtle.
      try {
        const injectionResults = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          world: 'MAIN',
          func: async () => {
            try {
              // ── Helper: generate SAPISIDHASH auth header ──
              async function generateSAPISIDHASH() {
                const cookies = document.cookie.split(';').map(c => c.trim());
                const sapisidCookie = cookies.find(c => c.startsWith('SAPISID='))
                  || cookies.find(c => c.startsWith('__Secure-3PAPISID='));
                if (!sapisidCookie) return null;
                const sapisid = sapisidCookie.split('=')[1];
                const timestamp = Math.floor(Date.now() / 1000);
                const origin = 'https://www.youtube.com';
                const msgBuffer = new TextEncoder().encode(`${timestamp} ${sapisid} ${origin}`);
                const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
                const hashHex = Array.from(new Uint8Array(hashBuffer))
                  .map(b => b.toString(16).padStart(2, '0')).join('');
                return `SAPISIDHASH ${timestamp}_${hashHex}`;
              }

              // ── Helper: decode HTML entities in caption XML ──
              function decodeEntities(str) {
                return str
                  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
                  .replace(/&#x2F;/g, '/').replace(/&apos;/g, "'")
                  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
              }

              // ── Helper: fetch caption XML and parse to text ──
              async function fetchCaptionText(captionUrl, authHeader) {
                const headers = {};
                if (authHeader) headers['Authorization'] = authHeader;
                const resp = await fetch(captionUrl, { credentials: 'include', headers });
                const xml = await resp.text();
                if (!xml) return null;
                const segments = [];
                const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
                let m;
                while ((m = regex.exec(xml)) !== null) {
                  const t = decodeEntities(m[1]).replace(/\n/g, ' ').trim();
                  if (t) segments.push(t);
                }
                return segments.join(' ').replace(/\s+/g, ' ').trim();
              }

              // ── Step 1: Get video details from page JS globals ──
              let playerResponse = null;
              const moviePlayer = document.getElementById('movie_player');
              if (moviePlayer && typeof moviePlayer.getPlayerResponse === 'function') {
                playerResponse = moviePlayer.getPlayerResponse();
              }
              if (!playerResponse) playerResponse = window.ytInitialPlayerResponse;

              const details = playerResponse?.videoDetails || {};
              const videoId = details.videoId || '';
              const title = details.title || '';
              const channel = details.author || '';
              const lengthSeconds = details.lengthSeconds || '0';

              // ── Step 2: Generate auth header ──
              const authHeader = await generateSAPISIDHASH();

              // ── Step 3: Get caption tracks via innertube player API (with auth) ──
              // The page-level playerResponse has tracks, but their URLs return empty
              // without auth. Using innertube with auth gives fresh, working URLs.
              const cfg = window.ytcfg?.data_ || {};
              const apiKey = cfg.INNERTUBE_API_KEY;
              const clientVersion = cfg.INNERTUBE_CLIENT_VERSION;
              const visitorData = cfg.VISITOR_DATA;

              const innertubeHeaders = { 'Content-Type': 'application/json' };
              if (authHeader) innertubeHeaders['Authorization'] = authHeader;
              if (visitorData) innertubeHeaders['X-Goog-Visitor-Id'] = visitorData;
              innertubeHeaders['X-Youtube-Client-Name'] = '1';
              innertubeHeaders['X-Youtube-Client-Version'] = clientVersion;

              const playerResp = await fetch(
                `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
                {
                  method: 'POST',
                  credentials: 'include',
                  headers: innertubeHeaders,
                  body: JSON.stringify({
                    videoId: videoId || window.location.href.match(/[?&]v=([\w-]{11})/)?.[1],
                    context: {
                      client: { clientName: 'WEB', clientVersion, hl: 'en', visitorData },
                    },
                  }),
                }
              );
              const playerData = await playerResp.json();
              const tracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

              if (tracks.length === 0) {
                return { error: 'No caption tracks available', title, channel };
              }

              // ── Step 4: Pick best track and fetch captions ──
              const bestTrack =
                tracks.find(t => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
                tracks.find(t => t.languageCode?.startsWith('en')) ||
                tracks.find(t => t.kind !== 'asr') ||
                tracks[0];

              if (!bestTrack?.baseUrl) {
                return { error: 'No valid caption URL', title, channel };
              }

              const fullText = await fetchCaptionText(bestTrack.baseUrl, authHeader);
              if (!fullText) {
                return { error: 'Transcript was empty after fetch', title, channel };
              }

              const secs = parseInt(lengthSeconds, 10);
              const mins = Math.floor(secs / 60);
              const remSecs = secs % 60;

              return {
                success: true,
                text: fullText,
                metadata: {
                  title: title || playerData.videoDetails?.title || 'Unknown',
                  channel: channel || playerData.videoDetails?.author || 'Unknown',
                  duration: `${mins}:${String(remSecs).padStart(2, '0')}`,
                  language: bestTrack.languageCode || 'unknown',
                  captionType: bestTrack.kind === 'asr' ? 'auto-generated' : 'manual',
                },
                wordCount: fullText.split(/\s+/).filter(Boolean).length,
              };
            } catch (e) {
              return { error: e.message };
            }
          },
        });

        ytResult = injectionResults?.[0]?.result;
        console.log('[LobsterCLI] Strategy 1 (MAIN world + auth):', ytResult?.success ? 'SUCCESS' : ytResult?.error);
      } catch (err) {
        console.log('[LobsterCLI] Strategy 1 exception:', err.message);
      }

      // Strategy 2: service worker fallback (for incognito / no cookies)
      if (!ytResult?.success) {
        console.log('[LobsterCLI] Trying Strategy 2 (service worker)...');
        ytResult = await chrome.runtime.sendMessage({
          action: 'extractYoutubeTranscriptById',
          videoId,
        });
        console.log('[LobsterCLI] Strategy 2 result:', ytResult?.success ? 'SUCCESS' : ytResult?.error);
      }

      if (ytResult?.success) {
        // If user is asking for the raw transcript, return it directly (bypasses AI copyright refusal)
        const transcriptAsk = /\b(transcript|transcription|captions?|subtitles?)\b/i;
        const fullAsk = /\b(full|entire|complete|whole|all|share|give|show|provide|copy|paste|raw|dump)\b/i;
        if (transcriptAsk.test(question) && fullAsk.test(question)) {
          const header = `<strong>${escapeHtml(ytResult.metadata.title)}</strong><br>` +
            `Channel: ${escapeHtml(ytResult.metadata.channel)} | Duration: ${ytResult.metadata.duration}<br>` +
            `Language: ${ytResult.metadata.language}${ytResult.metadata.captionType === 'auto-generated' ? ' (auto-generated)' : ''}<br>` +
            `Words: ${ytResult.wordCount}<br><br>`;
          addBotMessage(header + '<pre style="white-space:pre-wrap;max-height:400px;overflow-y:auto;">' + escapeHtml(ytResult.text.slice(0, 15000)) + '</pre>');
          return;
        }

        const ytContext = `[YouTube Video: ${ytResult.metadata.title}]\n` +
          `Channel: ${ytResult.metadata.channel} | Duration: ${ytResult.metadata.duration}\n` +
          `Language: ${ytResult.metadata.language}${ytResult.metadata.captionType === 'auto-generated' ? ' (auto-generated)' : ''}\n` +
          `Words: ${ytResult.wordCount}\n\n` +
          `Transcript:\n${ytResult.text.slice(0, 15000)}`;

        const response = await chrome.runtime.sendMessage({
          action: 'askAI',
          prompt: question,
          pageContent: ytContext,
          pageUrl: currentTab.url,
          pageTitle: ytResult.metadata.title,
          screenshot: null,
          isTranscript: true,
        });

        if (response.error) {
          addBotMessage('Error: ' + escapeHtml(response.error));
        } else {
          addBotMessage(formatAIResponse(response.answer));
        }
        return;
      }

      // Transcript extraction failed — check if user was asking for the transcript
      const transcriptKeywords = /\b(transcript|transcription|captions?|subtitles?)\b/i;
      if (transcriptKeywords.test(question)) {
        const errorDetail = ytResult?.error || 'unknown error';
        console.log('[LobsterCLI] YouTube transcript extraction failed:', errorDetail);
        addBotMessage(`Could not extract the transcript for this video (${escapeHtml(errorDetail)}). The video may not have captions available, or YouTube may have blocked the request. Try refreshing the page and asking again.`);
        return;
      }

      console.log('[LobsterCLI] YouTube transcript extraction failed for videoId:', videoId);
      console.log('[LobsterCLI] Result:', JSON.stringify(ytResult));
      // Fall through to page content for non-transcript questions
    }

    // ── Normal page flow ──

    // Step 1: Ask the Brain what data sources we need
    const brain = await chrome.runtime.sendMessage({
      action: 'brain',
      prompt: question,
      pageTitle: currentTab.title,
      pageUrl: currentTab.url,
    });

    // Step 2: Gather only what the Brain says we need
    let screenshot = null;
    let pageContent = '';
    let formData = null;

    if (brain.screenshot) {
      const result = await chrome.runtime.sendMessage({
        action: 'captureScreenshot',
        tabId: currentTab.id,
      });
      if (result?.screenshot) screenshot = result.screenshot;
    }

    if (brain.markdown) {
      await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/markdown.js'] });
      const md = await execInPage(() => {
        try { return lobsterMarkdown(); }
        catch { return document.body?.innerText?.slice(0, 8000) || ''; }
      });
      pageContent = typeof md === 'string' ? md.slice(0, 8000) : '';
    }

    if (brain.forms) {
      await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/form-state.js'] });
      formData = await execInPage(() => lobsterFormState());

      // Drain any pending observer changes for AI context
      let recentChanges = null;
      if (formObserverActive) {
        recentChanges = await execInPage(() => lobsterGetFormChanges());
      }

      if (formData) {
        pageContent += '\n\n--- FORM DATA ---\n' + JSON.stringify(formData, null, 2);
        if (recentChanges && recentChanges.length > 0) {
          pageContent += '\n\n--- RECENT FORM CHANGES ---\n' +
            'Note: The following fields appeared dynamically after the initial page load.\n' +
            JSON.stringify(recentChanges.map(c => ({ newFields: c.newFields, removedCount: c.removedCount, timestamp: c.timestamp })), null, 2);
        }
      }

      // Install observer if not yet active
      if (!formObserverActive) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/form-observer.js'] });
          await execInPage(() => lobsterInstallFormObserver());
          formObserverActive = true;
          startFormPolling();
        } catch {}
      }
    }

    // Step 3: Send to AI with the right context
    const response = await chrome.runtime.sendMessage({
      action: 'askAI',
      prompt: question,
      pageContent,
      pageUrl: currentTab.url,
      pageTitle: currentTab.title,
      screenshot,
    });

    if (response.error) {
      addBotMessage('Error: ' + escapeHtml(response.error));
    } else {
      addBotMessage(formatAIResponse(response.answer));
    }
  } catch (err) {
    addBotMessage('Error: ' + escapeHtml(err.message));
  } finally {
    isProcessing = false;
    enableSuggestions();
  }
}

async function handleAIQuestion(question, includeScreenshot = false) {
  // Always re-check config in case user just saved it
  await loadAiConfig();

  if (!aiConfig) {
    addBotMessage(
      'AI features need an API key. Click the <b>gear icon</b> above to configure one.<br><br>' +
      'Supports <b>OpenAI</b>, <b>Anthropic</b>, <b>Google Gemini</b> (free tier!), and <b>Ollama</b> (local, free).<br><br>' +
      'Meanwhile, try the built-in commands — they work without any AI!');
    return;
  }

  if (!pageAccessible) {
    addBotMessage('Navigate to a website first so I can analyze its content for you.');
    return;
  }

  try {
    // Capture screenshot if needed (visual questions)
    let screenshot = null;
    if (includeScreenshot) {
      const screenshotResult = await chrome.runtime.sendMessage({
        action: 'captureScreenshot',
        tabId: currentTab.id,
      });
      if (screenshotResult?.screenshot) {
        screenshot = screenshotResult.screenshot;
      }
    }

    // Get page text content
    await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/markdown.js'] });
    const markdown = await execInPage(() => {
      try { return lobsterMarkdown(); }
      catch { return document.body?.innerText?.slice(0, 8000) || ''; }
    });
    const pageContent = typeof markdown === 'string' ? markdown.slice(0, 8000) : '';

    const response = await chrome.runtime.sendMessage({
      action: 'askAI',
      prompt: question,
      pageContent,
      pageUrl: currentTab.url,
      pageTitle: currentTab.title,
      screenshot,
    });

    if (response.error) {
      addBotMessage('Error: ' + escapeHtml(response.error));
    } else {
      addBotMessage(formatAIResponse(response.answer));
    }
  } catch (err) {
    addBotMessage('Error: ' + escapeHtml(err.message));
  }
}

// ── Helpers ──
async function execInPage(func, args = []) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func,
      args,
    });
    return results?.[0]?.result;
  } catch (err) {
    console.error('execInPage failed:', err);
    return null;
  }
}

function formatAIResponse(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/`(.*?)`/g, '<code style="background:var(--bg);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function extractYoutubeVideoId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|v\/)|youtu\.be\/)([\w-]{11})/);
  return match?.[1] || null;
}
