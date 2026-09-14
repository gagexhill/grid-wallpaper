(function () {
  'use strict';
  if (window.GridSettingsWindow === true || !window.chrome?.webview) return;
  const api = window.GridWallpaper;
  if (!api || typeof window.WebSocket !== 'function') return;
  let socket = null, script = null, timer = null, sendTimer = null, unsubscribe = null, disposed = false;
  let lastSent = -Infinity, lastSourceSequence = -1, transportSequence = -1;
  const interval = 1000 / 15;
  const eligible = () => !disposed && api.hostManaged && !document.hidden;
  const stopStream = () => {
    unsubscribe?.(); unsubscribe = null;
    if (sendTimer !== null) clearTimeout(sendTimer);
    sendTimer = null;
  };
  const clearTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const removeScript = () => {
    if (!script) return;
    script.onload = script.onerror = null;
    script.remove(); script = null;
  };
  function retry() {
    if (!eligible() || timer !== null) return;
    timer = setTimeout(() => { timer = null; loadBootstrap(); }, 3000);
  }
  function disconnect() {
    stopStream(); clearTimer(); removeScript();
    if (!socket) return;
    const previous = socket; socket = null;
    previous.onopen = previous.onmessage = previous.onclose = previous.onerror = null;
    previous.close();
  }
  function publish(state) {
    if (!state || !eligible() || !socket || socket.readyState !== window.WebSocket.OPEN) return;
    if (state.sequence === lastSourceSequence) return;
    const now = performance.now();
    if (socket.bufferedAmount || now - lastSent < interval) {
      if (sendTimer === null) sendTimer = setTimeout(() => {
        sendTimer = null;
        publish(api.getDomeState());
      }, socket.bufferedAmount ? interval : interval - (now - lastSent));
      return;
    }
    try {
      if (transportSequence >= Number.MAX_SAFE_INTEGER) { disconnect(); retry(); return; }
      socket.send(JSON.stringify({ ...state, sequence: ++transportSequence }));
      lastSourceSequence = state.sequence; lastSent = now;
    }
    catch { disconnect(); retry(); }
  }
  function connect(options) {
    if (!eligible() || socket || !script || !options || typeof options.url !== 'string' ||
      typeof options.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(options.token)) return false;
    const match = /^ws:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/grid-wallpaper\/$/.exec(options.url);
    if (!match || Number(match[1]) > 65535) return false;
    let next;
    try { next = new window.WebSocket(options.url, ['grid-wallpaper-v1', 'grid-wallpaper-token.' + options.token]); }
    catch { return false; }
    socket = next; lastSent = -Infinity; lastSourceSequence = transportSequence = -1;
    next.onopen = () => {
      if (socket !== next || !eligible()) return;
      clearTimer();
      const screen = window.screen;
      try {
        next.send(JSON.stringify({ kind: 'hello', screen: { left: screen.availLeft, top: screen.availTop,
          width: screen.availWidth, height: screen.availHeight, scale: window.devicePixelRatio } }));
      } catch { disconnect(); retry(); }
    };
    next.onmessage = event => {
      if (socket !== next || typeof event.data !== 'string' || event.data.length > 128) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || message.kind !== 'stream' || typeof message.active !== 'boolean' ||
        Object.keys(message).length !== 2) return;
      if (!message.active || !eligible()) { stopStream(); return; }
      if (!unsubscribe) {
        lastSent = -Infinity; lastSourceSequence = -1;
        const remove = api.subscribeDomeState(publish);
        if (socket !== next || !eligible()) remove();
        else unsubscribe = remove;
      }
    };
    next.onclose = next.onerror = () => {
      if (socket !== next) return;
      disconnect(); retry();
    };
    return true;
  }
  function loadBootstrap() {
    if (!eligible() || socket || script) return;
    clearTimer();
    const bootstrap = document.createElement('script');
    const url = new URL('windows-telemetry.js', document.baseURI);
    url.searchParams.set('v', String(Date.now()));
    bootstrap.src = url.href; bootstrap.async = true;
    script = bootstrap;
    bootstrap.onload = bootstrap.onerror = () => {
      if (script !== bootstrap) return;
      removeScript();
      if (!socket) { clearTimer(); retry(); }
    };
    // One bounded watchdog also covers a bootstrap that never loads or a stalled handshake.
    timer = setTimeout(() => { timer = null; disconnect(); retry(); }, 3000);
    document.head.appendChild(bootstrap);
  }
  window.GridLiveTelemetry = Object.freeze({ connect });
  const unsubscribeConfig = api.subscribe(() => { if (eligible() && timer === null) loadBootstrap(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) disconnect(); else loadBootstrap();
  });
  window.addEventListener('pagehide', () => { disposed = true; disconnect(); });
  window.addEventListener('pageshow', () => { disposed = false; loadBootstrap(); });
  window.addEventListener('unload', () => { disposed = true; disconnect(); unsubscribeConfig(); });
  loadBootstrap();
})();
