/**
 * LobsterCLI Extension — Content Script
 *
 * Minimal — popup uses chrome.scripting.executeScript directly
 * to bypass CSP restrictions. This content script only handles
 * edge cases where direct execution isn't possible.
 */

// Signal that extension is active on this page
window.__lobster_extension__ = true;
