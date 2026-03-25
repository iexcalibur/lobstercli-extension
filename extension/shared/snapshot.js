/**
 * DOM Snapshot — 12-stage pruned, LLM-optimized.
 * Ported from LobsterCLI src/browser/dom/snapshot.ts
 */
function lobsterSnapshot() {
  let idx = 0;
  const __prevHashes = window.__lobster_prev_hashes ? new Set(window.__lobster_prev_hashes) : null;
  const __currentHashes = [];

  const SKIP_TAGS = new Set([
    'script','style','noscript','svg','path','meta','link','head',
    'template','slot','colgroup','col',
  ]);

  const INTERACTIVE_TAGS = new Set([
    'a','button','input','select','textarea','details','summary','label',
  ]);

  const INTERACTIVE_ROLES = new Set([
    'button','link','textbox','checkbox','radio','combobox','listbox',
    'menu','menuitem','tab','switch','slider','searchbox','spinbutton',
    'option','menuitemcheckbox','menuitemradio','treeitem',
  ]);

  const ATTR_WHITELIST = [
    'type','role','aria-label','aria-expanded','aria-selected','aria-checked',
    'aria-disabled','aria-haspopup','aria-pressed','placeholder','title',
    'href','value','name','alt','src','action','method','for',
    'data-testid','data-id','contenteditable','tabindex',
  ];

  const AD_PATTERNS = /ad[-_]?banner|ad[-_]?container|google[-_]?ad|doubleclick|adsbygoogle|sponsored|^ad$/i;

  function isVisible(el) {
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.tagName !== 'INPUT') return false;
    const s = getComputedStyle(el);
    if (s.display === 'none') return false;
    if (s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    if (s.opacity === '0') return false;
    if (s.clipPath === 'inset(100%)') return false;
    const rect = el.getBoundingClientRect();
    if (rect.right < 0 || rect.bottom < 0) return false;
    return true;
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) {
      if (el.disabled) return false;
      if (tag === 'input' && el.type === 'hidden') return false;
      return true;
    }
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.contentEditable === 'true') return true;
    if (el.tabIndex >= 0 && el.getAttribute('tabindex') !== null) return true;
    if (el.onclick) return true;
    return false;
  }

  function getAttrs(el) {
    const parts = [];
    for (const name of ATTR_WHITELIST) {
      let v = el.getAttribute(name);
      if (v === null || v === '') continue;
      if (v.length > 80) v = v.slice(0, 77) + '...';
      if (name === 'href' && v.startsWith('javascript:')) continue;
      parts.push(name + '=' + v);
    }
    return parts.length ? ' ' + parts.join(' ') : '';
  }

  function isAd(el) {
    const id = el.id || '';
    const cls = el.className || '';
    if (typeof cls === 'string' && AD_PATTERNS.test(cls)) return true;
    if (AD_PATTERNS.test(id)) return true;
    if (el.tagName === 'IFRAME' && AD_PATTERNS.test(el.src || '')) return true;
    return false;
  }

  function getScrollInfo(el) {
    const s = getComputedStyle(el);
    const overflowY = s.overflowY;
    const overflowX = s.overflowX;
    const scrollableY = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    const scrollableX = (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth;
    if (!scrollableY && !scrollableX) return '';
    const parts = [];
    if (scrollableY) {
      const up = Math.round(el.scrollTop);
      const down = Math.round(el.scrollHeight - el.clientHeight - el.scrollTop);
      if (up > 0) parts.push(up + 'px up');
      if (down > 0) parts.push(down + 'px down');
    }
    if (scrollableX) {
      const left = Math.round(el.scrollLeft);
      const right = Math.round(el.scrollWidth - el.clientWidth - el.scrollLeft);
      if (left > 0) parts.push(left + 'px left');
      if (right > 0) parts.push(right + 'px right');
    }
    return parts.length ? ' |scroll: ' + parts.join(', ') + '|' : '';
  }

  function isWrappingInteractive(el) {
    if (!isInteractive(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    for (const child of el.children) {
      if (!isInteractive(child)) continue;
      const cr = child.getBoundingClientRect();
      const overlapX = Math.min(rect.right, cr.right) - Math.max(rect.left, cr.left);
      const overlapY = Math.min(rect.bottom, cr.bottom) - Math.max(rect.top, cr.top);
      const overlapArea = Math.max(0, overlapX) * Math.max(0, overlapY);
      const parentArea = rect.width * rect.height;
      if (parentArea > 0 && overlapArea / parentArea > 0.85) return true;
    }
    return false;
  }

  function isOccluded(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    if (!topEl) return false;
    if (topEl === el || el.contains(topEl) || topEl.contains(el)) return false;
    const topZ = parseInt(getComputedStyle(topEl).zIndex) || 0;
    const elZ = parseInt(getComputedStyle(el).zIndex) || 0;
    return topZ > elZ + 10;
  }

  function getIframeContent(iframe, depth, maxDepth) {
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) return '';
      return '\n' + walkNode(doc.body, depth, maxDepth);
    } catch { return ''; }
  }

  function getShadowContent(el, depth, maxDepth) {
    if (!el.shadowRoot) return '';
    let out = '';
    for (const child of el.shadowRoot.childNodes) {
      out += walkNode(child, depth, maxDepth);
    }
    return out;
  }

  function getInputHint(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = el.type || 'text';
      const val = el.value || '';
      if (type === 'checkbox' || type === 'radio') {
        return el.checked ? ' [checked]' : ' [unchecked]';
      }
      if (val) return ' value="' + val.slice(0, 50) + '"';
    }
    if (tag === 'textarea' && el.value) return ' value="' + el.value.slice(0, 50) + '"';
    if (tag === 'select' && el.selectedOptions?.length) {
      return ' selected="' + el.selectedOptions[0].text.slice(0, 40) + '"';
    }
    return '';
  }

  const MAX_DEPTH = 25;
  const MAX_TEXT = 150;

  function walkNode(node, depth, maxDepth) {
    if (depth > maxDepth) return '';
    if (!node) return '';
    if (node.nodeType === 3) {
      const t = node.textContent.trim();
      if (!t) return '';
      const text = t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '...' : t;
      return '  '.repeat(depth) + text + '\n';
    }
    if (node.nodeType === 8) return '';
    if (node.nodeType !== 1) return '';

    const el = node;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return '';
    if (!isVisible(el)) return '';
    if (isAd(el)) return '';

    const skipSelf = isWrappingInteractive(el);
    const indent = '  '.repeat(depth);
    const inter = !skipSelf && isInteractive(el);
    let prefix = '';
    if (inter) {
      const thisIdx = idx++;
      const hashText = tag + ':' + (el.textContent || '').trim().slice(0, 40) + ':' + (el.getAttribute('href') || '') + ':' + (el.getAttribute('aria-label') || '');
      __currentHashes.push(hashText);
      const isNew = __prevHashes && __prevHashes.size > 0 && !__prevHashes.has(hashText);
      prefix = isNew ? '*[' + thisIdx + ']' : '[' + thisIdx + ']';
    }

    if (inter) { try { el.dataset.ref = String(idx - 1); } catch {} }

    const a = getAttrs(el);
    const scrollInfo = getScrollInfo(el);
    const inputHint = inter ? getInputHint(el) : '';

    let leafText = '';
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      const t = el.childNodes[0].textContent.trim();
      if (t) leafText = t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '...' : t;
    }

    if (tag === 'iframe') {
      const iframeContent = getIframeContent(el, depth + 1, maxDepth);
      if (iframeContent) return indent + prefix + '<iframe' + a + '>\n' + iframeContent;
      return '';
    }

    let out = '';
    if (skipSelf) {
      for (const c of el.childNodes) out += walkNode(c, depth, maxDepth);
      out += getShadowContent(el, depth, maxDepth);
      return out;
    }

    if (inter || leafText || el.children.length === 0) {
      if (leafText) {
        out = indent + prefix + '<' + tag + a + scrollInfo + inputHint + '>' + leafText + '</' + tag + '>\n';
      } else {
        out = indent + prefix + '<' + tag + a + scrollInfo + inputHint + '>\n';
        for (const c of el.childNodes) out += walkNode(c, depth + 1, maxDepth);
        out += getShadowContent(el, depth + 1, maxDepth);
      }
    } else {
      if (scrollInfo) {
        out = indent + '<' + tag + scrollInfo + '>\n';
        for (const c of el.childNodes) out += walkNode(c, depth + 1, maxDepth);
        out += getShadowContent(el, depth + 1, maxDepth);
      } else {
        for (const c of el.childNodes) out += walkNode(c, depth, maxDepth);
        out += getShadowContent(el, depth, maxDepth);
      }
    }
    return out;
  }

  const scrollY = window.scrollY;
  const scrollMax = document.documentElement.scrollHeight - window.innerHeight;
  const scrollPct = scrollMax > 0 ? Math.round((scrollY / scrollMax) * 100) : 0;
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const pageH = document.documentElement.scrollHeight;

  let header = 'viewport: ' + vpW + 'x' + vpH + ' | page_height: ' + pageH + 'px';
  header += ' | scroll: ' + scrollPct + '%';
  if (scrollY > 50) header += ' (' + Math.round(scrollY) + 'px from top)';
  if (scrollMax - scrollY > 50) header += ' (' + Math.round(scrollMax - scrollY) + 'px more below)';
  header += '\n---\n';

  window.__lobster_prev_hashes = __currentHashes;

  return header + walkNode(document.body, 0, MAX_DEPTH);
}
