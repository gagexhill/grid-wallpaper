(function () {
  'use strict';
  if (window.GridSettingsWindow !== true || !window.chrome?.webview) return;
  const api = window.GridWallpaper;
  const host = window.chrome.webview;
  const status = document.getElementById('save-status');
  let ready = false;
  let previous = {};
  let revision = 0;
  let shownSequence = 0;
  let interactiveFrame = 0;
  let telemetryAvailable = null;
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
  function clearShown() {
    shownSequence = 0;
    cancelAnimationFrame(interactiveFrame);
    interactiveFrame = 0;
  }
  function reportInteractive() {
    if (!ready || !shownSequence || interactiveFrame) return;
    const sequence = shownSequence;
    interactiveFrame = requestAnimationFrame(() => {
      interactiveFrame = 0;
      if (ready && sequence === shownSequence && !document.hidden) host.postMessage({ kind: 'interactive', sequence });
    });
  }

  function launcherAppearance() {
    const button = document.getElementById('hamburger');
    const style = getComputedStyle(button);
    const svg = button.querySelector('svg');
    const view = svg.viewBox.baseVal;
    const width = Number.parseFloat(style.width), height = Number.parseFloat(style.height);
    const radius = Number.parseFloat(style.borderTopLeftRadius);
    const border = Number.parseFloat(style.borderTopWidth);
    const gap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--settings-gap'));
    const pressed = Number.parseFloat(style.getPropertyValue('--settings-press-scale'));
    const svgWidth = svg.width.baseVal.value, svgHeight = svg.height.baseVal.value;
    const frames = [];
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * window.devicePixelRatio);
    canvas.height = Math.round(height * window.devicePixelRatio);
    const context = canvas.getContext('2d');
    for (let frame = 0; frame < 6; frame++) {
      context.resetTransform();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(canvas.width / width, canvas.height / height);
      context.beginPath();
      context.roundRect(border / 2, border / 2, width - border, height - border, Math.max(0, radius - border / 2));
      context.fillStyle = style.backgroundColor;
      context.fill();
      context.lineWidth = border;
      context.strokeStyle = style.borderTopColor;
      context.stroke();
      context.translate(width / 2, height / 2);
      const scale = 1 + (pressed - 1) * frame / 5;
      context.scale(scale, scale);
      context.translate(-svgWidth / 2, -svgHeight / 2);
      context.scale(svgWidth / view.width, svgHeight / view.height);
      context.translate(-view.x, -view.y);
      for (const element of svg.querySelectorAll('path')) {
        const pathStyle = getComputedStyle(element);
        const path = new Path2D(element.getAttribute('d'));
        context.save();
        for (let index = 0; index < element.transform.baseVal.numberOfItems; index++) {
          const matrix = element.transform.baseVal.getItem(index).matrix;
          context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
        }
        context.globalAlpha = Number.parseFloat(pathStyle.opacity);
        if (pathStyle.fill !== 'none') {
          context.fillStyle = pathStyle.fill;
          context.fill(path, pathStyle.fillRule);
        }
        if (pathStyle.stroke !== 'none') {
          context.strokeStyle = pathStyle.stroke;
          context.lineWidth = Number.parseFloat(pathStyle.strokeWidth);
          context.lineCap = pathStyle.strokeLinecap;
          context.lineJoin = pathStyle.strokeLinejoin;
          context.miterLimit = Number.parseFloat(pathStyle.strokeMiterlimit);
          context.stroke(path);
        }
        context.restore();
      }
      context.restore();
      frames.push(canvas.toDataURL('image/png').split(',')[1]);
    }
    return { width, height, gap, radius, frames };
  }
  window.GridSettingsHost = Object.freeze({
    get telemetryAvailable() { return telemetryAvailable; },
    close() { host.postMessage({ kind: 'close' }); },
    observeDomes(active) { host.postMessage({ kind: 'observe-domes', active: active === true }); }
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
      if (typeof message.telemetryAvailable === 'boolean') telemetryAvailable = message.telemetryAvailable;
      ready = false;
      for (const [name, property] of Object.entries(message.properties)) {
        if (property && Object.hasOwn(property, 'value')) window.livelyPropertyListener(name, property.value);
      }
      previous = nativeProperties(api.getConfig());
      ready = true;
      setControlsEnabled(true);
      showStatus('Changes save automatically.');
      reportInteractive();
    } else if (message?.kind === 'shown' && Number.isSafeInteger(message.sequence) && message.sequence > 0) {
      clearShown();
      shownSequence = message.sequence;
      window.dispatchEvent(new Event('grid-settings-shown'));
      reportInteractive();
    } else if (message?.kind === 'hidden') {
      clearShown();
      api.setDomeState(null);
      window.dispatchEvent(new Event('grid-settings-hidden'));
    } else if (message?.kind === 'dome-state') {
      api.setDomeState(message.state);
    } else if (message?.kind === 'loading') {
      ready = false;
      setControlsEnabled(false);
      showStatus('Loading your settings…');
    } else if (message?.kind === 'closing') {
      clearShown();
      api.setDomeState(null);
      window.dispatchEvent(new Event('grid-settings-hidden'));
      ready = false;
      setControlsEnabled(false);
      showStatus('Saving before closing…');
    } else if (message?.kind === 'saved' && message.revision === revision) showStatus('Changes saved.');
    else if (message?.kind === 'error') {
      previous = {};
      ready = true;
      setControlsEnabled(true);
      showStatus(typeof message.message === 'string' ? message.message : 'Changes could not be saved. Keep Lively running and try again.');
      reportInteractive();
    }
  });
  showStatus('Loading your settings…');
  window.addEventListener('DOMContentLoaded', () => {
    setControlsEnabled(ready);
    const message = { kind: 'ready', radius: Number.parseFloat(getComputedStyle(document.getElementById('panel')).borderTopRightRadius), launcher: launcherAppearance() };
    if (new TextEncoder().encode(JSON.stringify(message)).length > 65536) {
      showStatus('The settings appearance is too large to load at this display scale.');
      return;
    }
    host.postMessage(message);
  }, { once: true });
})();
