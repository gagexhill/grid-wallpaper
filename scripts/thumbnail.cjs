const { chromium } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
      let seed = 73;
      Math.random = () => ((seed = Math.imul(1664525, seed) + 1013904223 >>> 0) / 4294967296);
    });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../wallpaper/grid-wallpaper.html')).href);
    await page.evaluate(() => {
      GridWallpaper.update({ ...GridConfig.presets.find(preset => preset.name === 'Sage'), lineOpacity: 0.24, cellSize: 18 });
      document.querySelector('#hamburger').hidden = true;
    });
    await page.clock.runFor(2500);
    const frames = [];
    for (let frame = 0; frame < 40; frame++) {
      await page.clock.runFor(100);
      const pixels = await page.evaluate(() => {
        const preview = document.createElement('canvas');
        preview.width = 320; preview.height = 180;
        const context = preview.getContext('2d');
        context.drawImage(document.querySelector('#c'), 0, 0, 320, 180);
        const data = context.getImageData(0, 0, 320, 180).data;
        let bytes = '';
        for (let offset = 0; offset < data.length; offset += 8192) {
          bytes += String.fromCharCode(...data.subarray(offset, offset + 8192));
        }
        return btoa(bytes);
      });
      const rgba = Buffer.from(pixels, 'base64');
      const palette = quantize(rgba, 128);
      frames.push({ index: applyPalette(rgba, palette), palette });
    }
    const gif = GIFEncoder();
    // Reverse the captured motion for a seamless loop without changing the live runtime.
    for (const frame of [...frames, ...frames.slice(1, -1).reverse()]) {
      gif.writeFrame(frame.index, 320, 180, { palette: frame.palette, delay: 200, repeat: 0 });
    }
    gif.finish();
    fs.writeFileSync(path.resolve(__dirname, '../wallpaper/preview.gif'), gif.bytes());
    await page.evaluate(() => GridWallpaper.update({ snapshot: true }));
    await page.clock.runFor(50);
    await page.locator('#c').screenshot({ path: path.resolve(__dirname, '../wallpaper/thumbnail.jpg'), type: 'jpeg', quality: 90 });
    console.log('Rendered thumbnail.jpg and animated preview.gif from the wallpaper runtime.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
