/**
 * LobsterCLI — Offscreen document for PDF extraction.
 *
 * MV3 service workers cannot spawn Web Workers, but pdf.js needs one.
 * This offscreen document runs in a DOM context where Workers are allowed.
 */

import * as pdfjsLib from '../shared/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('shared/pdfjs/pdf.worker.min.mjs');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen-pdf') return false;

  if (message.action === 'extractPdf') {
    extractPdf(message.url).then(sendResponse);
    return true;
  }
  return false;
});

async function extractPdf(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: `Failed to fetch PDF (${response.status})` };
    }
    const arrayBuffer = await response.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const pages = [];
    let fullText = '';

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
    return { success: false, error: err.message || String(err) };
  }
}
