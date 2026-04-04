# LobsterCLI Extension

A Chrome extension for AI-powered web page analysis, YouTube transcript extraction, smart Q&A, and content summaries.

Works without AI for built-in analysis. Add an API key to unlock AI-powered features.

## Features

### Smart Suggestions

Quick-action buttons available on every page:

- **Summarize this page** - Get a structured overview with metadata, headings, and content preview
- **What are the key points?** - AI identifies the main takeaways as concise bullet points
- **Explain this simply** - AI breaks down complex content into plain language
- **What's happening in this video?** - AI summarizes YouTube videos using extracted transcripts
- **Help me draft a reply** - AI suggests a response based on the page content
- **What's on screen?** - AI describes visible elements using a screenshot of the page

### YouTube Transcript Extraction

When you open the extension on a YouTube video, it automatically extracts the video's transcript and uses it to answer your questions. Supports manual and auto-generated captions, with preference for English.

Ask anything about the video: summaries, key moments, topics discussed, or specific details.

### PDF Analysis

Automatically detects PDF pages, extracts the full document text, and lets you ask questions about the content. Works with any publicly accessible PDF.

### Built-in Tools (No AI Required)

These work immediately without any API key:

- **Page Summary** - Page type detection, word/link/image counts, heading structure, framework detection (React, Vue, Angular, Next.js), and content preview
- **Markdown Extraction** - Converts the full page into clean Markdown with a copy button
- **Form Detection** - Lists all forms and input fields with their types, labels, values, and required status
- **Link Extraction** - Shows the top meaningful links on the page with full URLs
- **Network Monitoring** - Captures all fetch/XHR API calls with method, URL, and JSON export
- **DOM Snapshot** - Captures the page's DOM tree structure

### Smart Q&A

Type any question about the current page. The extension's Brain classifier automatically determines what data to gather (page text, screenshot, form data, or network requests) and sends only what's needed to the AI.

### Vision

For visual questions about layout, colors, images, charts, or UI elements, the extension captures a screenshot and sends it to the AI alongside your question.

## Supported AI Providers

| Provider | Free Option | Models |
|----------|------------|--------|
| **OpenAI** | No | GPT-4o, GPT-4o Mini, GPT-4 Turbo, o1, o3-mini |
| **Anthropic** | No | Claude Opus, Claude Sonnet, Claude Haiku |
| **Google Gemini** | Yes (free tier) | Gemini 2.5 Flash, Gemini 2.5 Pro |
| **Ollama** | Yes (local) | Llama 3.1, Mistral, Qwen, DeepSeek, and more |

All providers support custom base URLs for self-hosted or proxy setups.

## Setup

1. Install the extension from the Chrome Web Store
2. Click the LobsterCLI icon to open the side panel
3. Built-in tools work immediately - no setup needed
4. For AI features: click the gear icon, select a provider, enter your API key, and test the connection

## Privacy Policy

See [privacy-policy.md](privacy-policy.md) for our full privacy policy.
