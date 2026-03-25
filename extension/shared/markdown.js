/**
 * DOM-to-Markdown converter.
 * Ported from LobsterCLI src/browser/dom/markdown.ts
 */
function lobsterMarkdown() {
  const SKIP = new Set(['script','style','noscript','svg','head','template']);
  const baseUrl = location.href;

  function resolveUrl(href) {
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return href;
    try { return new URL(href, baseUrl).href; } catch { return href; }
  }

  let listDepth = 0;
  let orderedCounters = [];
  let inPre = false;
  let inTable = false;

  function listIndent() { return '  '.repeat(listDepth); }

  function walk(el) {
    if (!el) return '';
    if (el.nodeType === 3) {
      const text = el.textContent || '';
      if (inPre) return text;
      const collapsed = text.replace(/\s+/g, ' ');
      return collapsed === ' ' && !el.previousSibling && !el.nextSibling ? '' : collapsed;
    }
    if (el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return '';

    try {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return '';
    } catch {}

    function childContent() {
      let out = '';
      for (const c of el.childNodes) out += walk(c);
      return out;
    }

    switch (tag) {
      case 'h1': return '\n\n# ' + childContent().trim() + '\n\n';
      case 'h2': return '\n\n## ' + childContent().trim() + '\n\n';
      case 'h3': return '\n\n### ' + childContent().trim() + '\n\n';
      case 'h4': return '\n\n#### ' + childContent().trim() + '\n\n';
      case 'h5': return '\n\n##### ' + childContent().trim() + '\n\n';
      case 'h6': return '\n\n###### ' + childContent().trim() + '\n\n';
      case 'p': return '\n\n' + childContent().trim() + '\n\n';
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'strong': case 'b': {
        const inner = childContent().trim();
        return inner ? '**' + inner + '**' : '';
      }
      case 'em': case 'i': {
        const inner = childContent().trim();
        return inner ? '*' + inner + '*' : '';
      }
      case 's': case 'del': case 'strike': {
        const inner = childContent().trim();
        return inner ? '~~' + inner + '~~' : '';
      }
      case 'code': {
        if (inPre) return childContent();
        const inner = childContent();
        return inner ? '`' + inner + '`' : '';
      }
      case 'pre': {
        inPre = true;
        const inner = childContent();
        inPre = false;
        const lang = el.querySelector('code')?.className?.match(/language-(\w+)/)?.[1] || '';
        return '\n\n```' + lang + '\n' + inner.trim() + '\n```\n\n';
      }
      case 'a': {
        const href = resolveUrl(el.getAttribute('href') || '');
        const inner = childContent().trim();
        const name = inner || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (!name) return '';
        if (!href || href === '#' || href.startsWith('javascript:')) return name;
        return '[' + name + '](' + href + ')';
      }
      case 'img': {
        const alt = el.getAttribute('alt') || '';
        const src = resolveUrl(el.getAttribute('src') || '');
        return src ? '![' + alt + '](' + src + ')' : '';
      }
      case 'ul': {
        listDepth++;
        orderedCounters.push(0);
        const inner = childContent();
        listDepth--;
        orderedCounters.pop();
        return '\n' + inner;
      }
      case 'ol': {
        listDepth++;
        orderedCounters.push(0);
        const inner = childContent();
        listDepth--;
        orderedCounters.pop();
        return '\n' + inner;
      }
      case 'li': {
        const parent = el.parentElement?.tagName?.toLowerCase();
        const isOrdered = parent === 'ol';
        const inner = childContent().trim();
        if (!inner) return '';
        if (isOrdered) {
          const counter = orderedCounters.length > 0 ? ++orderedCounters[orderedCounters.length - 1] : 1;
          return listIndent() + counter + '. ' + inner + '\n';
        }
        return listIndent() + '- ' + inner + '\n';
      }
      case 'blockquote': {
        const inner = childContent().trim();
        if (!inner) return '';
        return '\n\n' + inner.split('\n').map(line => '> ' + line).join('\n') + '\n\n';
      }
      case 'table': {
        inTable = true;
        let out = '\n\n';
        const rows = el.querySelectorAll('tr');
        let headerDone = false;
        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll('th, td');
          const isHeader = rows[i].querySelector('th') !== null;
          const cellTexts = [];
          for (const cell of cells) {
            let cellText = '';
            for (const c of cell.childNodes) cellText += walk(c);
            cellTexts.push(cellText.trim().replace(/\|/g, '\\|').replace(/\n/g, ' '));
          }
          out += '| ' + cellTexts.join(' | ') + ' |\n';
          if (isHeader && !headerDone) {
            out += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\n';
            headerDone = true;
          }
          if (i === 0 && !isHeader && !headerDone) {
            out += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\n';
            headerDone = true;
          }
        }
        inTable = false;
        return out + '\n';
      }
      case 'thead': case 'tbody': case 'tfoot': return childContent();
      case 'tr': case 'td': case 'th': return childContent();
      case 'dl': return '\n\n' + childContent() + '\n\n';
      case 'dt': return '\n**' + childContent().trim() + '**\n';
      case 'dd': return ': ' + childContent().trim() + '\n';
      case 'figure': return '\n\n' + childContent().trim() + '\n\n';
      case 'figcaption': return '\n*' + childContent().trim() + '*\n';
      case 'details': return '\n\n' + childContent() + '\n\n';
      case 'summary': return '**' + childContent().trim() + '**\n\n';
      case 'div': case 'section': case 'article': case 'main': case 'aside':
      case 'header': case 'footer': case 'nav':
        return '\n' + childContent() + '\n';
      case 'span': case 'small': case 'sub': case 'sup': case 'abbr':
      case 'time': case 'mark': case 'cite': case 'q':
        return childContent();
      default:
        return childContent();
    }
  }

  const raw = walk(document.body);
  return raw.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '').trim();
}
