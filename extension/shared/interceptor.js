/**
 * Network interceptor — patches fetch/XHR to capture API calls.
 * Ported from LobsterCLI src/browser/interceptor.ts
 */
function lobsterInstallInterceptor() {
  if (window.__lobster_interceptor__) return;
  window.__lobster_interceptor__ = { requests: [] };
  const store = window.__lobster_interceptor__;

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const method = (typeof args[0] === 'string' ? args[1]?.method : args[0]?.method) || 'GET';
    const resp = await origFetch.apply(this, args);
    try {
      const clone = resp.clone();
      const contentType = clone.headers.get('content-type') || '';
      let body = null;
      if (contentType.includes('json')) {
        body = await clone.json();
      }
      store.requests.push({
        url, method: method.toUpperCase(), status: resp.status,
        contentType, body, timestamp: Date.now(),
      });
    } catch {}
    return resp;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__url = url;
    this.__method = method;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        let body = null;
        const ct = this.getResponseHeader('content-type') || '';
        if (ct.includes('json')) body = JSON.parse(this.responseText);
        store.requests.push({
          url: this.__url, method: this.__method?.toUpperCase() || 'GET',
          status: this.status, contentType: ct, body, timestamp: Date.now(),
        });
      } catch {}
    });
    return origSend.apply(this, args);
  };
}

function lobsterGetIntercepted() {
  const store = window.__lobster_interceptor__;
  if (!store) return [];
  const reqs = [...store.requests];
  store.requests = [];
  return reqs;
}
