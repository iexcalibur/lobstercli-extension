/**
 * LobsterCLI Extension — Background Service Worker
 *
 * Handles LLM API calls (OpenAI, Anthropic, Gemini, Ollama),
 * screenshot capture, and config storage.
 */

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  anthropic: {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  gemini: {
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
  },
  ollama: {
    name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
  },
};

// ── Open side panel when extension icon is clicked ──
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Listen for messages from side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'brain') {
    handleBrain(message).then(sendResponse);
    return true;
  }

  if (message.action === 'askAI') {
    handleAskAI(message).then(sendResponse);
    return true;
  }

  if (message.action === 'captureScreenshot') {
    handleCaptureScreenshot(message).then(sendResponse);
    return true;
  }

  if (message.action === 'extractPdf') {
    handleExtractPdf(message).then(sendResponse);
    return true;
  }

  if (message.action === 'testConnection') {
    handleTestConnection(message).then(sendResponse);
    return true;
  }
});

/**
 * Brain — lightweight intent classifier.
 * Makes one cheap LLM call to decide what data the main call needs.
 */
async function handleBrain({ prompt, pageTitle, pageUrl }) {
  try {
    const config = await chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);

    if (!config.aiApiKey && config.aiProvider !== 'ollama') {
      // No AI — fall back to heuristic
      return heuristicBrain(prompt);
    }

    const provider = config.aiProvider || 'openai';
    const baseURL = config.aiBaseURL || PROVIDERS[provider]?.baseURL;
    const apiKey = config.aiApiKey || '';

    // Use the cheapest/fastest model for classification
    const classifierModel = {
      openai: 'gpt-4o-mini',
      anthropic: 'claude-haiku-4-5-20251001',
      gemini: 'gemini-2.5-flash-lite',
      ollama: config.aiModel || 'llama3.1',
    }[provider] || config.aiModel;

    const classifierPrompt = `You are an intent classifier for a browser extension that analyzes web pages. Given a user's question about a webpage, decide what data sources are needed to answer it.

Current page: "${pageTitle}" (${pageUrl})

Respond ONLY with a JSON object, nothing else:
{
  "screenshot": true/false,  // needs to SEE the page visually (images, layout, colors, UI, charts, visual content)
  "markdown": true/false,    // needs page TEXT content (articles, paragraphs, data, written content)
  "forms": true/false,       // asking about forms, inputs, fields on the page
  "network": true/false,     // asking about API calls, network requests, data the site fetches
  "intent": "brief 5-word description of what user wants"
}

Rules:
- screenshot=true ONLY when the answer requires SEEING the page (images, visual layout, colors, what something looks like, charts, graphs, screenshots within the page)
- markdown=true for ANY question about text content, meaning, topics, summaries
- forms=true ONLY when specifically asking about form fields or inputs
- network=true ONLY when asking about APIs, requests, or data fetching
- Most questions need markdown=true only
- "what is this page about" → screenshot:false, markdown:true
- "what images are on this page" → screenshot:true, markdown:false
- "what does this email say" → screenshot:false, markdown:true
- "what is showing on screen" → screenshot:true, markdown:true
- "describe the layout" → screenshot:true, markdown:false
- "what color is the header" → screenshot:true, markdown:false
- "summarize the content" → screenshot:false, markdown:true`;

    const messages = [
      { role: 'system', content: classifierPrompt },
      { role: 'user', content: prompt },
    ];

    let response;
    if (provider === 'anthropic') {
      response = await callAnthropic(baseURL, apiKey, classifierModel, classifierPrompt, prompt, null);
    } else {
      response = await callOpenAICompatible(baseURL, apiKey, classifierModel, classifierPrompt, prompt, null, provider);
    }

    // Parse JSON from response
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          screenshot: !!parsed.screenshot,
          markdown: parsed.markdown !== false, // default true
          forms: !!parsed.forms,
          network: !!parsed.network,
          intent: parsed.intent || '',
          source: 'llm',
        };
      }
    } catch {}

    // If JSON parsing fails, fall back to heuristic
    return heuristicBrain(prompt);
  } catch (err) {
    // On any error, fall back to heuristic (don't block the user)
    return heuristicBrain(prompt);
  }
}

/**
 * Heuristic fallback when LLM classifier is unavailable
 */
function heuristicBrain(prompt) {
  const lower = prompt.toLowerCase();

  const screenshot = /look|see|show|visual|image|screenshot|screen|what('s| is) (on|showing|displayed|visible)|describe.*layout|picture|colour|color|design|ui |logo|icon|chart|graph|photo|video|banner/i.test(lower);

  const forms = /form|input|field|submit|login|sign.?in|password|checkbox|dropdown|select|textarea|search.?box|fill/i.test(lower);

  const network = /api|network|request|fetch|xhr|endpoint|call.*server|data.*load/i.test(lower);

  return {
    screenshot,
    markdown: true,
    forms,
    network,
    intent: 'heuristic classification',
    source: 'heuristic',
  };
}

/**
 * Capture a screenshot of the active tab
 */
async function handleCaptureScreenshot({ tabId }) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 80,
    });
    // Return base64 without the data:image/jpeg;base64, prefix
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    return { screenshot: base64, dataUrl };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Handle AI question about the page (with optional screenshot)
 */
async function handleAskAI({ prompt, pageContent, pageUrl, pageTitle, screenshot }) {
  try {
    const config = await chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);

    if (!config.aiApiKey && config.aiProvider !== 'ollama') {
      return { error: 'No API key configured. Open extension settings to add one.' };
    }

    const provider = config.aiProvider || 'openai';
    const model = config.aiModel || PROVIDERS[provider]?.defaultModel || 'gpt-4o';
    const baseURL = config.aiBaseURL || PROVIDERS[provider]?.baseURL;
    const apiKey = config.aiApiKey || '';

    const systemPrompt = `You are LobsterCLI, a helpful web page analysis assistant. You analyze web pages and answer questions about their content.

Current page: ${pageTitle}
URL: ${pageUrl}

${pageContent ? `Page content (extracted as markdown):\n---\n${pageContent}\n---` : ''}

Answer the user's question about this page. Be concise and direct. If the information isn't on the page, say so.`;

    let answer;
    if (provider === 'anthropic') {
      answer = await callAnthropic(baseURL, apiKey, model, systemPrompt, prompt, screenshot);
    } else {
      answer = await callOpenAICompatible(baseURL, apiKey, model, systemPrompt, prompt, screenshot, provider);
    }

    return { answer };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * OpenAI-compatible API call with vision support (OpenAI, Gemini, Ollama)
 */
async function callOpenAICompatible(baseURL, apiKey, model, systemPrompt, userPrompt, screenshot, provider) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Build user message content — text + optional image
  const userContent = [];

  if (screenshot) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${screenshot}`,
      },
    });
    userContent.push({
      type: 'text',
      text: userPrompt,
    });
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    screenshot
      ? { role: 'user', content: userContent }
      : { role: 'user', content: userPrompt },
  ];

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API error (${resp.status}): ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || 'No response from AI';
}

/**
 * Anthropic Messages API call with vision support
 */
async function callAnthropic(baseURL, apiKey, model, systemPrompt, userPrompt, screenshot) {
  // Build user message content
  const userContent = [];

  if (screenshot) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: screenshot,
      },
    });
  }

  userContent.push({
    type: 'text',
    text: userPrompt,
  });

  const resp = await fetch(`${baseURL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API error (${resp.status}): ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.content?.[0]?.text || 'No response from AI';
}

/**
 * Extract text from a PDF URL.
 * Uses pdf.js (Mozilla) which works in service worker context.
 */
async function handleExtractPdf({ url }) {
  try {
    // Import pdf.js from CDN (works in service workers)
    const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

    // Fetch PDF
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    // Load PDF document
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const pages = [];
    let fullText = '';

    // Extract text from all pages
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push(pageText);
      fullText += pageText + '\n\n';
    }

    // Extract metadata
    const metadata = await pdf.getMetadata().catch(() => ({}));
    const info = metadata?.info || {};

    return {
      success: true,
      text: fullText.trim(),
      pages,
      metadata: {
        title: info.Title || 'untitled',
        author: info.Author || '',
        pages: numPages,
        creator: info.Creator || '',
      },
      wordCount: fullText.split(/\s+/).filter(Boolean).length,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Test API connection
 */
async function handleTestConnection({ provider, apiKey, model, baseURL }) {
  try {
    let answer;
    if (provider === 'anthropic') {
      answer = await callAnthropic(baseURL, apiKey, model, '', 'Say "connected" in one word.', null);
    } else {
      answer = await callOpenAICompatible(baseURL, apiKey, model, '', 'Say "connected" in one word.', null, provider);
    }
    return { success: true, response: answer };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
