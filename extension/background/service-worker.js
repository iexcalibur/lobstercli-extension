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

  if (message.action === 'extractYoutubeTranscript') {
    handleExtractYoutubeTranscript(message).then(sendResponse);
    return true;
  }

  if (message.action === 'extractYoutubeTranscriptById') {
    handleExtractYoutubeTranscriptById(message).then(sendResponse);
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
async function handleAskAI({ prompt, pageContent, pageUrl, pageTitle, screenshot, isTranscript }) {
  try {
    const config = await chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);

    if (!config.aiApiKey && config.aiProvider !== 'ollama') {
      return { error: 'No API key configured. Open extension settings to add one.' };
    }

    const provider = config.aiProvider || 'openai';
    const model = config.aiModel || PROVIDERS[provider]?.defaultModel || 'gpt-4o';
    const baseURL = config.aiBaseURL || PROVIDERS[provider]?.baseURL;
    const apiKey = config.aiApiKey || '';

    let systemPrompt;

    if (isTranscript) {
      // YouTube transcript — the user explicitly requested this data, so the AI should share it freely
      systemPrompt = `You are LobsterCLI, a helpful assistant. The user is viewing a YouTube video and has asked a question about it. Below is the video's transcript that was extracted from YouTube's own captions/subtitles.

Video: ${pageTitle}
URL: ${pageUrl}

${pageContent}

IMPORTANT: This transcript data was extracted from YouTube's public captions at the user's explicit request. When the user asks for the transcript, share it fully. When they ask questions about the video, answer using the transcript. You are a transcript tool — your job is to provide this data.`;
    } else {
      systemPrompt = `You are LobsterCLI, a helpful web page analysis assistant. You analyze web pages and answer questions about their content.

Current page: ${pageTitle}
URL: ${pageUrl}

${pageContent ? `Page content (extracted as markdown):\n---\n${pageContent}\n---` : ''}

Answer the user's question about this page. Be concise and direct. If the information isn't on the page, say so.`;
    }

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
 * Extract transcript from a YouTube video.
 * Uses YouTube's innertube API to get caption tracks, then fetches
 * and parses the caption XML into plain text.
 */
async function handleExtractYoutubeTranscript({ captionUrl, metadata }) {
  try {
    // Fetch caption XML (URL already contains auth tokens from the page)
    const captionResponse = await fetch(captionUrl);
    const captionXml = await captionResponse.text();

    // Parse <text> elements from the XML (no DOMParser in service workers)
    const segments = [];
    const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    while ((match = textRegex.exec(captionXml)) !== null) {
      const text = decodeHtmlEntities(match[1]).replace(/\n/g, ' ').trim();
      if (text) segments.push(text);
    }

    const fullText = segments.join(' ').replace(/\s+/g, ' ').trim();

    if (!fullText) {
      return { success: false, error: 'Transcript was empty' };
    }

    const lengthSeconds = parseInt(metadata.lengthSeconds || '0', 10);
    const mins = Math.floor(lengthSeconds / 60);
    const secs = lengthSeconds % 60;

    return {
      success: true,
      text: fullText,
      metadata: {
        title: metadata.title || 'Unknown',
        channel: metadata.channel || 'Unknown',
        duration: `${mins}:${String(secs).padStart(2, '0')}`,
        language: metadata.language || 'unknown',
        captionType: metadata.captionType || 'unknown',
      },
      wordCount: fullText.split(/\s+/).filter(Boolean).length,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Extract YouTube transcript by video ID.
 * Fetches the YouTube watch page HTML from the service worker (bypasses SPA issues),
 * parses the embedded ytInitialPlayerResponse, then fetches captions.
 * This is the same approach server-side tools like NoteGPT use.
 */
async function handleExtractYoutubeTranscriptById({ videoId }) {
  // Strategy A: Parse ytInitialPlayerResponse from page HTML
  try {
    const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    if (pageResponse.ok) {
      const html = await pageResponse.text();

      // Try multiple markers — YouTube changes variable names across page versions
      const markers = ['ytInitialPlayerResponse', 'var ytInitialPlayerResponse'];
      let playerData = null;
      let details = {};
      let tracks = [];

      for (const startMarker of markers) {
        const markerIdx = html.indexOf(startMarker);
        if (markerIdx === -1) continue;

        const jsonStart = html.indexOf('{', markerIdx + startMarker.length);
        if (jsonStart === -1) continue;

        let depth = 0;
        let jsonEnd = -1;
        for (let i = jsonStart; i < html.length; i++) {
          const ch = html[i];
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }

        if (jsonEnd === -1) continue;

        try {
          playerData = JSON.parse(html.slice(jsonStart, jsonEnd));
          details = playerData.videoDetails || {};
          tracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          if (tracks.length > 0) break;
        } catch { playerData = null; }
      }

      if (tracks.length > 0) {
        const result = await fetchCaptionTrack(tracks, details);
        if (result.success) return result;
      }
    }
  } catch (err) {
    console.log('[LobsterCLI] Strategy A (page HTML) failed:', err.message);
  }

  // Strategy B: YouTube innertube API — more reliable, doesn't depend on HTML parsing
  try {
    const innertubeResponse = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20241126.01.00',
            hl: 'en',
          },
        },
      }),
    });

    if (innertubeResponse.ok) {
      const data = await innertubeResponse.json();
      const details = data.videoDetails || {};
      const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

      if (tracks.length > 0) {
        const result = await fetchCaptionTrack(tracks, details);
        if (result.success) return result;
      }

      return { success: false, error: tracks.length === 0 ? 'No caption tracks available for this video' : 'Caption fetch failed' };
    }
  } catch (err) {
    console.log('[LobsterCLI] Strategy B (innertube API) failed:', err.message);
  }

  return { success: false, error: 'All transcript extraction strategies failed' };
}

/**
 * Given caption tracks and video details, pick the best track and fetch its text.
 */
async function fetchCaptionTrack(tracks, details) {
  const bestTrack =
    tracks.find(t => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
    tracks.find(t => t.languageCode?.startsWith('en')) ||
    tracks.find(t => t.kind !== 'asr') ||
    tracks[0];

  if (!bestTrack?.baseUrl) {
    return { success: false, error: 'No valid caption URL found' };
  }

  const captionResponse = await fetch(bestTrack.baseUrl);
  const captionXml = await captionResponse.text();

  const segments = [];
  const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = textRegex.exec(captionXml)) !== null) {
    const text = decodeHtmlEntities(match[1]).replace(/\n/g, ' ').trim();
    if (text) segments.push(text);
  }

  const fullText = segments.join(' ').replace(/\s+/g, ' ').trim();

  if (!fullText) {
    return { success: false, error: 'Transcript was empty' };
  }

  const lengthSeconds = parseInt(details.lengthSeconds || '0', 10);
  const mins = Math.floor(lengthSeconds / 60);
  const secs = lengthSeconds % 60;

  return {
    success: true,
    text: fullText,
    metadata: {
      title: details.title || 'Unknown',
      channel: details.author || 'Unknown',
      duration: `${mins}:${String(secs).padStart(2, '0')}`,
      language: bestTrack.languageCode || 'unknown',
      captionType: bestTrack.kind === 'asr' ? 'auto-generated' : 'manual',
    },
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Decode HTML entities found in YouTube caption XML.
 */
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
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
