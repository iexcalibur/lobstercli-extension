# LobsterCLI — Privacy Policy

**Last updated:** March 22, 2026

## Overview

LobsterCLI is a browser extension and CLI tool for web page analysis. We are committed to protecting your privacy. This policy explains what data the extension handles and how.

## Data Collection

### What we DO NOT collect
- We do not collect any personal information
- We do not track your browsing history
- We do not send any data to our servers
- We do not use analytics or tracking scripts
- We do not sell, share, or transfer any user data to third parties
- We do not use cookies or any tracking mechanisms

### What the extension processes (locally only)
- **Page content**: When you click a chip or ask a question, the extension reads the current page's DOM (text, headings, links, forms) to provide analysis. This data is processed entirely in your browser and is never stored or transmitted to us.
- **Screenshots**: When you ask a visual question (e.g., "what images are on this page"), the extension captures a screenshot of the visible tab. This screenshot is sent directly to your configured AI provider and is never stored or transmitted to us.

### What you optionally configure
- **AI Provider API Key**: If you choose to use AI features, you enter an API key for your chosen provider (OpenAI, Anthropic, Google Gemini, or Ollama). This key is stored locally in your browser's `chrome.storage.local` and is never transmitted to us. It is only sent to the AI provider you selected.

## Third-Party Services

The extension only communicates with external services when you explicitly ask a question that requires AI processing. In that case:

- Your question and the page content (text or screenshot) are sent directly from your browser to the AI provider you configured
- We do not proxy, intercept, or store this communication
- The AI providers have their own privacy policies:
  - [OpenAI Privacy Policy](https://openai.com/privacy)
  - [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
  - [Google Gemini Privacy Policy](https://ai.google.dev/terms)
  - [Ollama](https://ollama.ai) — runs locally, no external transmission

## Data Storage

All extension data is stored locally on your device using `chrome.storage.local`:
- AI provider selection
- API key (encrypted by Chrome's storage system)
- Model preference

No data is stored on any external server.

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `activeTab` | Read the content of the page you're currently viewing when you interact with the extension |
| `host_permissions` | Extract page content (DOM, text, forms) on any website you choose to analyze |
| `scripting` | Run DOM extraction scripts (markdown, forms, snapshot) in the page context |
| `sidePanel` | Display the chat interface as a side panel |
| `storage` | Save your AI provider settings locally |
| `tabs` | Detect when you switch tabs so the side panel updates its context |

## Children's Privacy

LobsterCLI is not directed at children under 13. We do not knowingly collect data from children.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be posted to this page with an updated date.

## Contact

If you have questions about this privacy policy:
- GitHub: [github.com/iexcalibur/lobstercli-extension](https://github.com/iexcalibur/lobstercli-extension)
- Email: shubhamkannojia10@gmail.com

## Open Source

LobsterCLI is fully open source. You can review the complete source code at [github.com/iexcalibur/lobstercli-extension](https://github.com/iexcalibur/lobstercli-extension) to verify these privacy claims.
