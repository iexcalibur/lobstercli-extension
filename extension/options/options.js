/**
 * LobsterCLI Extension — Options Page Logic
 */

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    keyHint: 'Get your key at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com/api-keys</a>',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
  },
  anthropic: {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    keyHint: 'Get your key at <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a>',
    models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
  },
  gemini: {
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    keyHint: 'Get your key at <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a> (free tier available)',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview'],
  },
  ollama: {
    name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    keyHint: 'No API key needed. Install from <a href="https://ollama.ai" target="_blank">ollama.ai</a> and run <code>ollama serve</code>',
    models: ['llama3.1', 'llama3.2', 'mistral', 'codestral', 'qwen2.5', 'deepseek-r1'],
  },
};

const providerSelect = document.getElementById('provider');
const apiKeyInput = document.getElementById('api-key');
const modelSelect = document.getElementById('model');
const baseUrlInput = document.getElementById('base-url');
const keyHint = document.getElementById('key-hint');
const fieldApiKey = document.getElementById('field-api-key');
const fieldModel = document.getElementById('field-model');
const fieldBaseUrl = document.getElementById('field-base-url');
const statusDiv = document.getElementById('status');

// Load saved config
document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);

  if (config.aiProvider) {
    providerSelect.value = config.aiProvider;
    updateProviderUI(config.aiProvider);

    if (config.aiApiKey) apiKeyInput.value = config.aiApiKey;
    if (config.aiModel) {
      // Ensure model option exists
      setTimeout(() => { modelSelect.value = config.aiModel; }, 50);
    }
    if (config.aiBaseURL) baseUrlInput.value = config.aiBaseURL;
  }
});

// Provider change
providerSelect.addEventListener('change', () => {
  const provider = providerSelect.value;
  updateProviderUI(provider);
  statusDiv.className = 'status';
  statusDiv.style.display = 'none';
});

function updateProviderUI(provider) {
  if (!provider) {
    fieldApiKey.style.display = 'none';
    fieldModel.style.display = 'none';
    fieldBaseUrl.style.display = 'none';
    return;
  }

  const p = PROVIDERS[provider];
  if (!p) return;

  // Show/hide API key field
  if (provider === 'ollama') {
    fieldApiKey.style.display = 'none';
  } else {
    fieldApiKey.style.display = 'block';
  }
  keyHint.innerHTML = p.keyHint;

  // Populate models
  fieldModel.style.display = 'block';
  modelSelect.innerHTML = '';
  for (const m of p.models) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m + (m === p.defaultModel ? ' (recommended)' : '');
    modelSelect.appendChild(opt);
  }
  modelSelect.value = p.defaultModel;

  // Base URL
  fieldBaseUrl.style.display = 'block';
  baseUrlInput.placeholder = p.baseURL;
}

// Save
document.getElementById('btn-save').addEventListener('click', async () => {
  const provider = providerSelect.value;

  if (!provider) {
    await chrome.storage.local.remove(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);
    showStatus('success', 'AI features disabled. Settings cleared.');
    return;
  }

  const p = PROVIDERS[provider];
  const config = {
    aiProvider: provider,
    aiApiKey: apiKeyInput.value.trim(),
    aiModel: modelSelect.value || p.defaultModel,
    aiBaseURL: baseUrlInput.value.trim() || p.baseURL,
  };

  await chrome.storage.local.set(config);
  showStatus('success', 'Settings saved! Provider: ' + p.name + ' / Model: ' + config.aiModel);
});

// Test
document.getElementById('btn-test').addEventListener('click', async () => {
  const provider = providerSelect.value;
  if (!provider) {
    showStatus('error', 'Select a provider first');
    return;
  }

  const p = PROVIDERS[provider];
  showStatus('success', 'Testing connection...');

  const response = await chrome.runtime.sendMessage({
    action: 'testConnection',
    provider,
    apiKey: apiKeyInput.value.trim(),
    model: modelSelect.value || p.defaultModel,
    baseURL: baseUrlInput.value.trim() || p.baseURL,
  });

  if (response.success) {
    showStatus('success', 'Connected! Response: ' + response.response);
  } else {
    showStatus('error', 'Connection failed: ' + response.error);
  }
});

function showStatus(type, message) {
  statusDiv.className = 'status ' + type;
  statusDiv.textContent = message;
  statusDiv.style.display = 'block';
}
