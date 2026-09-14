'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { defaults, schema, fpsOptions, mouseModes, hostSettings, domePulse } = require('../wallpaper/grid-config.js');
// Lively requires this native JSON; generate it from the browser's canonical configuration.
const properties = {
  instructions: { type: 'label', value: 'Changes to these controls are saved automatically by Lively.' }
};
const labels = {
  bgColor: 'Background color', lineColor: 'Grid line color', autoColor: 'Automatic line color',
  autoSize: 'Automatic dome size', vignette: 'Vignette', snapshot: 'Freeze frame', gradientLines: 'Grid ripple'
};
for (const [key, value] of Object.entries(defaults)) {
  if (key === 'domeSizes') {
    value.forEach((size, i) => {
      const { min, max, step } = schema.domeSize;
      properties['domeSize' + i] = { type: 'slider', text: 'Dome ' + (i + 1) + ' size', min, max, step, value: size };
    });
  } else if (schema[key]) {
    const { label, min, max, step } = schema[key];
    properties[key] = { type: 'slider', text: label, min, max, step, value };
  } else if (key === 'fpsLimit') properties[key] = { type: 'dropdown', text: 'Frame rate', items: fpsOptions.map(fps => fps + ' fps'), value: fpsOptions.indexOf(value) };
  else if (key === 'mouseMode') properties[key] = { type: 'dropdown', text: 'Mouse interaction', items: mouseModes, value: mouseModes.indexOf(value) };
  else properties[key] = { type: typeof value === 'boolean' ? 'checkbox' : 'color', text: labels[key], value };
}
const integration = { ...hostSettings, domeTelemetry: { domeSize: schema.domeSize, pulse: domePulse, maximumCount: schema.count.max } };
for (const [name, value] of Object.entries({ 'LivelyProperties.json': properties, 'windows-integration.json': integration })) {
  const target = path.join(__dirname, '..', 'wallpaper', name);
  const output = JSON.stringify(value, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) {
      console.error(`${name} is out of date. Run npm run generate.`); process.exitCode = 1;
    }
  } else fs.writeFileSync(target, output);
}
