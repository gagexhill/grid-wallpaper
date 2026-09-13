(function () {
  'use strict';

  const api = window.GridWallpaper;
  const menu = document.getElementById('hamburger');
  const panel = document.getElementById('panel');
  const closeButton = document.getElementById('close-settings');
  const sections = Array.from(panel.querySelectorAll('details'));
  const expandButton = document.getElementById('expand-sections');
  const status = document.getElementById('action-status');
  const bindings = [];
  const colorBindings = [];
  const isSettingsWindow = window.GridSettingsWindow === true;
  document.documentElement.classList.toggle('settings-window', isSettingsWindow);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  if (!api) {
    menu.disabled = true;
    document.body.append(element('p', 'startup-error',
      'Grid Wallpaper could not load. Keep all wallpaper files together, then reopen grid-wallpaper.html.'));
    return;
  }

  const edgeGap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--settings-gap'));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let layoutHostManaged = api.hostManaged;
  let pressAnimation;

  function pressFeedback() {
    if (isSettingsWindow) return;
    pressAnimation?.cancel();
    if (!reducedMotion.matches) {
      pressAnimation = menu.querySelector('svg').animate([
        { transform: 'scale(1)' },
        { transform: 'scale(.78)', offset: .35 },
        { transform: 'scale(1)' }
      ], { duration: 180, easing: 'ease-out' });
    }
  }
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) pressAnimation?.cancel(); });

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function range(container, key, format, index) {
    const isDome = index !== undefined;
    const spec = api.schema[isDome ? 'domeSize' : key];
    const row = element('div', 'control');
    const heading = element('div', 'control-heading');
    const input = element('input');
    input.type = 'range';
    input.id = isDome ? `dome-size-${index}` : `setting-${key}`;
    input.min = spec.min;
    input.max = spec.max;
    input.step = spec.step;
    const label = element('label', '', isDome ? `Dome ${index + 1}` : spec.label);
    label.htmlFor = input.id;
    const output = element('output');
    output.htmlFor = input.id;
    output.setAttribute('aria-live', 'off');
    heading.append(label, output);
    row.append(heading, input);
    container.append(row);
    input.addEventListener('input', () => {
      if (isDome) {
        const sizes = api.getConfig().domeSizes;
        sizes[index] = Number(input.value);
        api.update({ domeSizes: sizes });
      } else {
        api.update({ [key]: Number(input.value) });
      }
    });
    bindings.push(config => {
      const value = isDome ? config.domeSizes[index] : config[key];
      input.value = value;
      const formatted = format(value);
      setText(output, formatted);
      input.setAttribute('aria-valuetext', formatted);
      if (isDome) {
        const hidden = index >= config.count;
        if (hidden && row.contains(document.activeElement)) {
          row.closest('details').querySelector('summary').focus();
        }
        row.hidden = hidden;
      }
    });
  }

  function checkbox(container, key, title) {
    const label = element('label', 'check-control');
    const input = element('input');
    input.type = 'checkbox';
    input.id = `setting-${key}`;
    label.append(element('span', '', title), input);
    container.append(label);
    input.addEventListener('change', () => api.update({ [key]: input.checked }));
    bindings.push(config => { input.checked = config[key]; });
  }

  function select(container, key, title, values, describe) {
    const row = element('div', 'control select-control');
    const input = element('select');
    input.id = `setting-${key}`;
    const label = element('label', '', title);
    label.htmlFor = input.id;
    values.forEach(value => {
      const option = element('option', '', describe(value));
      option.value = value;
      input.append(option);
    });
    row.append(label, input);
    container.append(row);
    input.addEventListener('change', () => {
      const value = typeof values[0] === 'number' ? Number(input.value) : input.value;
      api.update({ [key]: value });
    });
    bindings.push(config => { input.value = config[key]; });
  }

  function color(container, key, title) {
    const fieldset = element('fieldset');
    const group = element('div', 'color-inputs');
    const picker = element('input');
    picker.type = 'color';
    picker.id = `setting-${key}`;
    picker.setAttribute('aria-label', `${title} color picker`);
    const label = element('label', 'hex-label', 'Hex color');
    const hex = element('input');
    hex.type = 'text';
    hex.id = `hex-${key}`;
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.autocomplete = 'off';
    hex.setAttribute('autocapitalize', 'off');
    hex.setAttribute('aria-label', `${title} hexadecimal color`);
    hex.setAttribute('aria-describedby', `error-${key}`);
    const error = element('p', 'hint color-error', 'Use # followed by six hexadecimal digits. The current color is unchanged.');
    error.id = `error-${key}`;
    error.hidden = true;
    label.htmlFor = hex.id;
    label.append(hex);
    group.append(picker, label);
    fieldset.append(element('legend', '', title), group, error);
    container.append(fieldset);
    let dirty = false;

    function clearError() {
      dirty = false;
      hex.removeAttribute('aria-invalid');
      hex.setCustomValidity('');
      error.hidden = true;
    }

    hex.addEventListener('input', () => {
      const value = hex.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) {
        clearError();
        api.update({ [key]: value.toLowerCase() });
      } else {
        dirty = true;
        hex.setAttribute('aria-invalid', 'true');
        hex.setCustomValidity('Enter a color in #RRGGBB format.');
        error.hidden = false;
      }
    });
    hex.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        hex.reportValidity();
      }
    });
    picker.addEventListener('input', () => {
      clearError();
      api.update({ [key]: picker.value });
    });
    bindings.push(config => {
      picker.value = config[key];
      if (!dirty) hex.value = config[key];
    });
    colorBindings.push(clearError);
  }

  const multiplier = value => `${value.toFixed(2)}×`;
  const motion = document.getElementById('motion-controls');
  select(motion, 'mouseMode', 'Pointer interaction', api.mouseModes,
    value => ({ repel: 'Repel', attract: 'Attract', off: 'Off' })[value]);
  range(motion, 'count', String);
  ['sizeScale', 'speedScale', 'forceScale'].forEach(key => range(motion, key, multiplier));
  range(motion, 'lerpSpeed', value => value.toFixed(2));
  motion.append(element('p', 'hint', 'Lower smoothness values make changes more gradual.'));

  const domes = document.getElementById('dome-controls');
  checkbox(domes, 'autoSize', 'Auto-change dome sizes');
  domes.append(element('p', 'hint', 'Set each dome’s base size. Auto-change gently varies these sizes.'));
  api.defaults.domeSizes.forEach((_, index) => range(domes, 'domeSize', multiplier, index));

  const performance = document.getElementById('performance-controls');
  checkbox(performance, 'snapshot', 'Freeze frame');
  select(performance, 'fpsLimit', 'Frame rate', api.fpsOptions, value => `${value} fps`);

  const appearance = document.getElementById('appearance-controls');
  checkbox(appearance, 'autoColor', 'Auto-change line color');
  checkbox(appearance, 'gradientLines', 'Grid ripple');
  checkbox(appearance, 'vignette', 'Vignette');
  range(appearance, 'cellSize', value => `${value} px`);
  range(appearance, 'lineOpacity', value => `${Math.round(value * 100)}%`);
  color(appearance, 'bgColor', 'Background');
  color(appearance, 'lineColor', 'Grid lines');
  appearance.append(element('p', 'hint', 'Turn off auto-change line color to use your selected line color.'));

  api.presets.forEach(preset => {
    const button = element('button', 'preset');
    button.type = 'button';
    const swatch = element('span', 'preset-swatch');
    swatch.style.background = preset.bgColor;
    swatch.style.color = preset.lineColor;
    swatch.setAttribute('aria-hidden', 'true');
    button.append(swatch, element('span', '', preset.name));
    button.addEventListener('click', () => {
      colorBindings.forEach(clearError => clearError());
      const { name, ...patch } = preset;
      api.update({ ...patch, autoColor: false });
      setText(status, `${name} preset applied.`);
    });
    bindings.push(config => {
      const selected = !config.autoColor && Object.entries(preset).every(([key, value]) => key === 'name' || config[key] === value);
      button.setAttribute('aria-pressed', String(selected));
    });
    document.getElementById('preset-grid').append(button);
  });

  document.getElementById('randomize').addEventListener('click', () => {
    api.randomize();
    setText(status, 'Motion and grid spacing randomized.');
  });
  document.getElementById('reset').addEventListener('click', () => {
    colorBindings.forEach(clearError => clearError());
    api.reset();
    setText(status, 'All settings reset to defaults.');
  });

  function canOpenSettingsWindow() {
    return !isSettingsWindow && api.hostManaged && Boolean(window.chrome?.webview);
  }

  function render() {
    const config = api.getConfig();
    bindings.forEach(sync => sync(config));
    if (!isSettingsWindow) {
      const message = api.hostManaged
        ? 'For settings that survive a restart, use Lively > Customize wallpaper. Changes here are a preview.'
        : api.storageAvailable
          ? 'Settings save in this browser on this device.'
          : 'Browser storage is unavailable. Settings last until this page closes.';
      setText(document.getElementById('save-status'), message);
      if (canOpenSettingsWindow() && !panel.hidden) closePanel(false);
    }
    syncMenuAction();
    if (layoutHostManaged !== api.hostManaged) {
      layoutHostManaged = api.hostManaged;
      refreshLayout();
    }
  }

  function syncMenuAction() {
    if (canOpenSettingsWindow()) {
      menu.setAttribute('aria-label', 'Open grid settings');
      menu.title = 'Settings · drag to move';
      menu.removeAttribute('aria-expanded');
      menu.removeAttribute('aria-controls');
    } else {
      menu.setAttribute('aria-label', panel.hidden ? 'Open grid settings' : 'Close grid settings');
      menu.title = 'Settings · drag to move';
      menu.setAttribute('aria-expanded', String(!panel.hidden));
      menu.setAttribute('aria-controls', panel.id);
    }
  }

  function availableBounds() {
    const viewport = window.visualViewport;
    const bounds = {
      left: Math.max(0, viewport?.offsetLeft || 0),
      top: Math.max(0, viewport?.offsetTop || 0),
      right: window.innerWidth,
      bottom: window.innerHeight
    };
    if (viewport) {
      bounds.right = Math.min(bounds.right, bounds.left + viewport.width);
      bounds.bottom = Math.min(bounds.bottom, bounds.top + viewport.height);
    }
    if (!api.hostManaged) return bounds;

    const screen = window.screen;
    const scaleX = window.outerWidth > 0 ? window.innerWidth / window.outerWidth : 1;
    const scaleY = window.outerHeight > 0 ? window.innerHeight / window.outerHeight : 1;
    // Borderless host coordinates and the screen work area share screen CSS pixels.
    // Convert to content pixels; monitor origins may be negative and page scale may differ.
    const work = {
      left: (screen.availLeft - window.screenX) * scaleX,
      top: (screen.availTop - window.screenY) * scaleY,
      right: (screen.availLeft + screen.availWidth - window.screenX) * scaleX,
      bottom: (screen.availTop + screen.availHeight - window.screenY) * scaleY
    };
    const intersect = {
      left: Math.max(bounds.left, work.left),
      top: Math.max(bounds.top, work.top),
      right: Math.min(bounds.right, work.right),
      bottom: Math.min(bounds.bottom, work.bottom)
    };
    if (Object.values(intersect).every(Number.isFinite)
      && intersect.right - intersect.left >= Math.min(240, bounds.right - bounds.left)
      && intersect.bottom - intersect.top >= Math.min(192, bounds.bottom - bounds.top)) return intersect;

    // Some embedded players omit window origins. Reserve unavailable screen extents
    // at both edges rather than mistake a different monitor's origin for usable space.
    const reserve = (total, available, size) => Number.isFinite(total) && total > 0
      && Number.isFinite(available) && available > 0 && available <= total
      ? Math.min(size / 4, (total - available) * size / total) : 0;
    const horizontal = reserve(screen.width, screen.availWidth, window.innerWidth);
    const vertical = reserve(screen.height, screen.availHeight, window.innerHeight);
    return {
      left: bounds.left + horizontal, top: bounds.top + vertical,
      right: bounds.right - horizontal, bottom: bounds.bottom - vertical
    };
  }

  function placePanel() {
    if (isSettingsWindow) return;
    const button = menu.getBoundingClientRect();
    const bounds = availableBounds();
    const leftSide = button.left + button.width / 2 < (bounds.left + bounds.right) / 2;
    panel.style.left = leftSide ? `${bounds.left + edgeGap}px` : 'auto';
    panel.style.right = leftSide ? 'auto' : `${window.innerWidth - bounds.right + edgeGap}px`;
    panel.style.maxWidth = `${Math.max(48, bounds.right - bounds.left - edgeGap * 2)}px`;
    const below = button.top + button.height / 2 < (bounds.top + bounds.bottom) / 2;
    const top = below ? button.bottom + 12 : bounds.top + edgeGap;
    const bottom = below ? bounds.bottom - edgeGap : button.top - 12;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${Math.max(48, bottom - top)}px`;
  }

  function closePanel(restoreFocus = true) {
    if (isSettingsWindow) {
      window.GridSettingsHost.close();
      return;
    }
    if (panel.hidden) return;
    if (restoreFocus || panel.contains(document.activeElement)) menu.focus();
    panel.hidden = true;
    panel.inert = true;
    syncMenuAction();
    pressFeedback();
  }

  function openPanel() {
    render();
    refreshLayout();
    placePanel();
    panel.hidden = false;
    panel.inert = false;
    syncMenuAction();
    pressFeedback();
    closeButton.focus();
  }

  let suppressClick = false;
  menu.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      return;
    }
    suppressClick = false;
    if (canOpenSettingsWindow()) {
      pressFeedback();
      window.open(api.hostSettings.settingsUri, '_blank');
    } else if (panel.hidden) openPanel();
    else closePanel();
  });
  closeButton.addEventListener('click', () => closePanel());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      closePanel();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!isSettingsWindow && !panel.hidden && !panel.contains(event.target) && !menu.contains(event.target)) closePanel(false);
  });
  panel.querySelector('.panel-header').addEventListener('pointerdown', event => {
    if (!isSettingsWindow || !event.isPrimary || event.button !== 0
      || event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    event.preventDefault();
    window.GridSettingsHost.drag();
  });

  function syncExpandButton() {
    setText(expandButton, sections.every(section => section.open) ? 'Collapse all sections' : 'Expand all sections');
  }
  expandButton.addEventListener('click', () => {
    const open = !sections.every(section => section.open);
    sections.forEach(section => { section.open = open; });
    syncExpandButton();
  });
  sections.forEach(section => section.addEventListener('toggle', syncExpandButton));

  let drag = null;
  function moveMenu(left, top) {
    const bounds = availableBounds();
    const minLeft = bounds.left + edgeGap, minTop = bounds.top + edgeGap;
    const maxLeft = Math.max(minLeft, bounds.right - menu.offsetWidth - edgeGap);
    const maxTop = Math.max(minTop, bounds.bottom - menu.offsetHeight - edgeGap);
    menu.style.left = `${Math.max(minLeft, Math.min(maxLeft, left))}px`;
    menu.style.top = `${Math.max(minTop, Math.min(maxTop, top))}px`;
    menu.style.right = 'auto';
  }
  menu.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    const bounds = menu.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top, moved: false };
    menu.setPointerCapture(event.pointerId);
  });
  menu.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    closePanel(false);
    menu.classList.add('dragging');
    moveMenu(drag.left + dx, drag.top + dy);
  });
  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    suppressClick = drag.moved;
    if (drag.moved) {
      const button = menu.getBoundingClientRect();
      const bounds = availableBounds();
      const leftSide = button.left + button.width / 2 < (bounds.left + bounds.right) / 2;
      moveMenu(leftSide ? bounds.left + edgeGap : bounds.right - button.width - edgeGap, button.top);
    }
    drag = null;
    menu.classList.remove('dragging');
    if (menu.hasPointerCapture(event.pointerId)) menu.releasePointerCapture(event.pointerId);
  }
  menu.addEventListener('pointerup', finishDrag);
  menu.addEventListener('pointercancel', finishDrag);
  menu.addEventListener('lostpointercapture', finishDrag);
  function refreshLayout() {
    if (isSettingsWindow) return;
    const bounds = menu.getBoundingClientRect();
    moveMenu(bounds.left, bounds.top);
    if (!panel.hidden) placePanel();
  }
  window.addEventListener('resize', refreshLayout);
  window.addEventListener('focus', refreshLayout);
  window.visualViewport?.addEventListener('resize', refreshLayout);
  window.visualViewport?.addEventListener('scroll', refreshLayout);
  window.screen.addEventListener?.('change', refreshLayout);

  api.subscribe(render);
  render();
  if (isSettingsWindow) openPanel();
  else refreshLayout();
})();
