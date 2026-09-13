(function () {
  'use strict';
  if (window.GridSettingsWindow !== true || !window.chrome?.webview) return;
  const api = window.GridWallpaper;
  const host = window.chrome.webview;
  const status = document.getElementById('save-status');
  let ready = false;
  let previous = {};
  let revision = 0;
  const setControlsEnabled = enabled => {
    document.querySelectorAll('#panel input, #panel select, #panel button:not(#close-settings)').forEach(control => { control.disabled = !enabled; });
  };

  function nativeProperties(config) {
    const properties = {};
    for (const [key, value] of Object.entries(config)) {
      if (key === 'domeSizes') value.forEach((size, index) => { properties[`domeSize${index}`] = size; });
      else if (key === 'fpsLimit') properties[key] = api.fpsOptions.indexOf(value);
      else if (key === 'mouseMode') properties[key] = api.mouseModes.indexOf(value);
      else properties[key] = value;
    }
    return properties;
  }
  function showStatus(message) { status.textContent = message; }
  window.GridSettingsHost = Object.freeze({
    close() { host.postMessage({ kind: 'close' }); }
  });
  api.subscribe(config => {
    if (!ready) return;
    const current = nativeProperties(config);
    const changed = Object.fromEntries(Object.entries(current).filter(([key, value]) => previous[key] !== value));
    if (Object.keys(changed).length === 0) return;
    previous = current;
    showStatus('Saving changes…');
    host.postMessage({ kind: 'change', properties: changed, revision: ++revision });
  });
  host.addEventListener('message', event => {
    const message = event.data;
    if (message?.kind === 'init' && message.properties && typeof message.properties === 'object') {
      ready = false;
      for (const [name, property] of Object.entries(message.properties)) {
        if (property && Object.hasOwn(property, 'value')) window.livelyPropertyListener(name, property.value);
      }
      previous = nativeProperties(api.getConfig());
      ready = true;
      setControlsEnabled(true);
      showStatus('Changes save automatically.');
    } else if (message?.kind === 'loading') {
      ready = false;
      setControlsEnabled(false);
      showStatus('Loading your settings…');
    } else if (message?.kind === 'closing') {
      ready = false;
      setControlsEnabled(false);
      showStatus('Saving before closing…');
    } else if (message?.kind === 'saved' && message.revision === revision) showStatus('Changes saved.');
    else if (message?.kind === 'error') {
      previous = {};
      ready = true;
      setControlsEnabled(true);
      showStatus(typeof message.message === 'string' ? message.message : 'Changes could not be saved. Keep Lively running and try again.');
    }
  });
  showStatus('Loading your settings…');
  window.addEventListener('DOMContentLoaded', () => {
    setControlsEnabled(ready);
    host.postMessage({ kind: 'ready', radius: Number.parseFloat(getComputedStyle(document.getElementById('panel')).borderTopRightRadius) });
  }, { once: true });
})();
