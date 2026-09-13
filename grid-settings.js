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

  function render() {
    const config = api.getConfig();
    bindings.forEach(sync => sync(config));
    const message = api.hostManaged
      ? 'For settings that survive a restart, use Lively > Customize wallpaper. Changes here are a preview.'
      : api.storageAvailable
        ? 'Settings save in this browser on this device.'
        : 'Browser storage is unavailable. Settings last until this page closes.';
    setText(document.getElementById('save-status'), message);
  }

  function placePanel() {
    const button = menu.getBoundingClientRect();
    const leftSide = button.left + button.width / 2 < window.innerWidth / 2;
    panel.style.left = leftSide ? '16px' : 'auto';
    panel.style.right = leftSide ? 'auto' : '16px';
    const top = button.top < window.innerHeight / 2 ? button.bottom + 12 : 16;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${Math.max(48, window.innerHeight - top - 16)}px`;
  }

  function closePanel(restoreFocus = true) {
    if (panel.hidden) return;
    if (restoreFocus || panel.contains(document.activeElement)) menu.focus();
    panel.hidden = true;
    panel.inert = true;
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open grid settings');
  }

  function openPanel() {
    render();
    placePanel();
    panel.hidden = false;
    panel.inert = false;
    menu.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-label', 'Close grid settings');
    closeButton.focus();
  }

  let suppressClick = false;
  menu.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      return;
    }
    suppressClick = false;
    if (panel.hidden) openPanel();
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
    if (!panel.hidden && !panel.contains(event.target) && !menu.contains(event.target)) closePanel(false);
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
    const maxLeft = Math.max(8, window.innerWidth - menu.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, Math.min(maxLeft, left))}px`;
    menu.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
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
      const bounds = menu.getBoundingClientRect();
      const leftSide = bounds.left + bounds.width / 2 < window.innerWidth / 2;
      moveMenu(leftSide ? 16 : window.innerWidth - bounds.width - 16, bounds.top);
    }
    drag = null;
    menu.classList.remove('dragging');
    if (menu.hasPointerCapture(event.pointerId)) menu.releasePointerCapture(event.pointerId);
  }
  menu.addEventListener('pointerup', finishDrag);
  menu.addEventListener('pointercancel', finishDrag);
  menu.addEventListener('lostpointercapture', finishDrag);
  window.addEventListener('resize', () => {
    const bounds = menu.getBoundingClientRect();
    moveMenu(bounds.left, bounds.top);
    if (!panel.hidden) placePanel();
  });

  api.subscribe(render);
  render();
})();
