// ─────────────────────────────────────────────────────
//  DEFAULTS
// ─────────────────────────────────────────────────────
var DEFAULTS = Object.freeze({
  count:       5,
  sizeScale:   1.0,
  speedScale:  1.0,
  forceScale:  1.0,
  lerpSpeed:   0.06,
  cellSize:    14,
  bgColor:     '#1b1b17',
  lineColor:   '#fffff2',
  lineOpacity: 0.050,
  autoColor:   false,
  mouseMode:   'repel',
  autoSize:    false,
  vignette:    false,
  snapshot:    false,
  fpsLimit:    60,
  gradientLines: false,
  domeSizes: Object.freeze([1.0, 0.42, 1.7, 0.28, 0.9, 1.3, 0.38, 0.65, 2.1, 0.22])
});
var C = JSON.parse(JSON.stringify(DEFAULTS));

// ─────────────────────────────────────────────────────
//  BASE TEMPLATES
// ─────────────────────────────────────────────────────
var BASE = [
  { r:200, baseForce:44, baseSpd:1.2, dAngle:0.040 },
  { r:200, baseForce:30, baseSpd:1.6, dAngle:0.060 },
  { r:200, baseForce:52, baseSpd:0.7, dAngle:0.025 },
  { r:200, baseForce:22, baseSpd:2.0, dAngle:0.080 },
  { r:200, baseForce:38, baseSpd:1.0, dAngle:0.050 },
  { r:200, baseForce:48, baseSpd:0.9, dAngle:0.030 },
  { r:200, baseForce:26, baseSpd:1.8, dAngle:0.070 },
  { r:200, baseForce:35, baseSpd:1.3, dAngle:0.045 },
  { r:200, baseForce:58, baseSpd:0.5, dAngle:0.020 },
  { r:200, baseForce:18, baseSpd:2.4, dAngle:0.090 }
];

// ─────────────────────────────────────────────────────
//  AUTO-COLOR STATE — dramatic random hue jumps
// ─────────────────────────────────────────────────────
var _autoHue = Math.random() * 360;
var _autoHueTgt = _autoHue;
var _autoHueHold = 0;
var _autoHueTransSpeed = 0.04;
var _gradHue = 0;

function autoColorHex(hue) {
  var s = 60 + 20 * Math.sin(hue * Math.PI / 90);
  var l = 68 + 15 * Math.cos(hue * Math.PI / 120);
  return hslToHex(hue, s, l);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  var a = s * Math.min(l, 1 - l);
  var f = function(n) {
    var k = (n + h / 30) % 12;
    var c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function hexToHsl(hex) {
  var r = parseInt(hex.slice(1,3),16)/255;
  var g = parseInt(hex.slice(3,5),16)/255;
  var b = parseInt(hex.slice(5,7),16)/255;
  var max = Math.max(r,g,b), min = Math.min(r,g,b);
  var h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    var d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return [h*360, s*100, l*100];
}

function hsvToHex(h,s,v){s/=100;v/=100;var f=function(n){var k=(n+h/60)%6;return v-v*s*Math.max(0,Math.min(k,4-k,1));};return'#'+[f(5),f(3),f(1)].map(function(x){return Math.round(x*255).toString(16).padStart(2,'0');}).join('');}
function hexToHsv(hex){var r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,h=0,s=max===0?0:d/max,v=max;if(d!==0){switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}}return[h*360,s*100,v*100];}

var _domePhases = (function() {
  var p = [];
  for (var i = 0; i < 10; i++) p.push(Math.random() * Math.PI * 2);
  return p;
})();
var _domeSzMult = [1,1,1,1,1,1,1,1,1,1];

var _mx = -9999, _my = -9999;
window.addEventListener('mousemove', function(e) { _mx = e.clientX; _my = e.clientY; });


// ─────────────────────────────────────────────────────
//  CANVAS + ANIMATION
// ─────────────────────────────────────────────────────
(function () {
  var cv  = document.getElementById('c');
  var ctx = cv.getContext('2d');
  var W, H;
  function resize() { W = cv.width = window.innerWidth; H = cv.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  var ws = [];
  function spawn(i) {
    return {
      idx: i, angle: Math.random()*Math.PI*2, av: 0, spd: BASE[i].baseSpd,
      cx: W*0.1+Math.random()*W*0.8, cy: H*0.1+Math.random()*H*0.8,
      tx: W*0.1+Math.random()*W*0.8, ty: H*0.1+Math.random()*H*0.8
    };
  }
  function syncCount() {
    var n = Math.min(C.count, BASE.length);
    while (ws.length < n) ws.push(spawn(ws.length));
    ws.length = n;
  }
  syncCount();
  window.syncCount = syncCount;

  function hexRgb(h) {
    return parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16);
  }

  function updateWanderer(w) {
    var b = BASE[w.idx], spd = b.baseSpd * C.speedScale;
    w.av += (Math.random()-0.5)*b.dAngle; w.av *= 0.92; w.angle += w.av;
    w.spd += (Math.random()-0.5)*0.08;
    w.spd = Math.max(spd*0.4, Math.min(spd*2.5, w.spd));
    w.tx += Math.cos(w.angle)*w.spd;
    w.ty += Math.sin(w.angle)*w.spd;
    if (C.mouseMode !== 'off') {
      var sz = C.domeSizes[w.idx] * C.sizeScale;
      var r  = Math.min(b.r * sz, Math.min(W,H)*0.38);
      var proximityR = r * 0.85;
      var mdx = w.cx - _mx, mdy = w.cy - _my;
      var md  = Math.sqrt(mdx*mdx + mdy*mdy);
      if (md < proximityR && md > 0.1) {
        var t = 1 - md / proximityR;
        var bounce = t * t * spd * 18;
        var sign = C.mouseMode === 'repel' ? 1 : -1;
        var nx = (mdx / md) * sign, ny = (mdy / md) * sign;
        w.cx += nx * bounce * 0.4;
        w.cy += ny * bounce * 0.4;
        w.tx += nx * bounce;
        w.ty += ny * bounce;
        var targetAngle = Math.atan2(ny, nx);
        var angleDiff = targetAngle - w.angle;
        while (angleDiff >  Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        w.angle += angleDiff * t * 0.5;
      }
    }
    var M = 60;
    if (w.tx < M)   { w.angle=Math.atan2( Math.sin(w.angle),-Math.cos(w.angle))+(Math.random()-0.5)*0.3; w.tx=M; }
    if (w.tx > W-M) { w.angle=Math.atan2( Math.sin(w.angle),-Math.cos(w.angle))+(Math.random()-0.5)*0.3; w.tx=W-M; }
    if (w.ty < M)   { w.angle=Math.atan2(-Math.sin(w.angle), Math.cos(w.angle))+(Math.random()-0.5)*0.3; w.ty=M; }
    if (w.ty > H-M) { w.angle=Math.atan2(-Math.sin(w.angle), Math.cos(w.angle))+(Math.random()-0.5)*0.3; w.ty=H-M; }
    w.cx += (w.tx-w.cx)*C.lerpSpeed;
    w.cy += (w.ty-w.cy)*C.lerpSpeed;
  }

  function displace(gx, gy) {
    var ox=0, oy=0;
    for (var i=0; i<ws.length; i++) {
      var w=ws[i], b=BASE[w.idx];
      var sz=C.domeSizes[w.idx]*C.sizeScale*_domeSzMult[w.idx];
      var r=Math.min(b.r*sz, Math.min(W,H)*0.38);
      var szEff=r/b.r;
      var force=b.baseForce*C.forceScale*szEff;
      var dx=gx-w.cx, dy=gy-w.cy, d=Math.sqrt(dx*dx+dy*dy);
      if (d<0.01||d>r) continue;
      var t=d/r;
      var push=force*Math.sin(Math.PI*t)*0.5*(1+Math.cos(Math.PI*Math.max(0,(t-0.4)/0.6)));
      ox+=(dx/d)*push; oy+=(dy/d)*push;
    }
    return [gx+ox, gy+oy];
  }

  var _waves   = [];
  var _emitCD  = [];
  var RIPPLE_BAND = 40;

  function spawnWave(x, y, r0, maxR, peakOp, life) {
    if (_waves.length >= 15) return;
    _waves.push({x:x, y:y, r0:r0, r:r0, maxR:maxR, peakOp:peakOp, age:0, life:life});
  }

  var _running = false; window._running = false;
  var _lastFrameTime = 0;
  function frame(now) {
    if (!now) now = performance.now();
    var interval = 1000 / C.fpsLimit;
    var elapsed  = now - _lastFrameTime;
    if (elapsed < interval) { requestAnimationFrame(frame); return; }
    _lastFrameTime = now - (elapsed % interval);
    _running = true; window._running = true;
    if (!C.snapshot) {
      for (var i=0; i<ws.length; i++) updateWanderer(ws[i]);
    }

    if (C.autoSize) {
      var rate = 0.008;
      for (var i=0; i<10; i++) {
        _domePhases[i] += rate * (0.6 + i * 0.08);
        _domeSzMult[i] = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(_domePhases[i]));
      }
    } else {
      for (var i=0; i<10; i++) _domeSzMult[i] = 1.0;
    }

    var lineColor = C.lineColor;
    if (C.autoColor) {
      _autoHueHold--;
      if (_autoHueHold <= 0) {
        var jump = 90 + Math.random() * 180;
        _autoHueTgt = (_autoHue + jump) % 360;
        _autoHueHold = 900 + Math.round(Math.random() * 1800);
      }
      var diff = _autoHueTgt - _autoHue;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      _autoHue = (_autoHue + diff * _autoHueTransSpeed + 360) % 360;
      lineColor = autoColorHex(_autoHue);
      C.lineColor = lineColor;
    }

    ctx.fillStyle=C.bgColor; ctx.fillRect(0,0,W,H);
    var cell=C.cellSize, cols=Math.ceil(W/cell)+3, rows=Math.ceil(H/cell)+3;
    ctx.strokeStyle = 'rgba('+hexRgb(lineColor)+','+C.lineOpacity+')';
    ctx.lineWidth=1;
    for (var r=0; r<=rows; r++) {
      var gy=r*cell; ctx.beginPath();
      for (var c=0; c<=cols; c++) { var p=displace(c*cell,gy); c===0?ctx.moveTo(p[0],p[1]):ctx.lineTo(p[0],p[1]); }
      ctx.stroke();
    }
    for (var c=0; c<=cols; c++) {
      var gx=c*cell; ctx.beginPath();
      for (var r=0; r<=rows; r++) { var p=displace(gx,r*cell); r===0?ctx.moveTo(p[0],p[1]):ctx.lineTo(p[0],p[1]); }
      ctx.stroke();
    }

    if (C.gradientLines) {
      var n = ws.length;
      if (C.gradientLines) {
        for (var i = 0; i < n; i++) {
          if (_emitCD[i] === undefined) _emitCD[i] = Math.round(i * 20 + Math.random() * 40);
          _emitCD[i]--;
          if (_emitCD[i] <= 0) {
            var w = ws[i], b = BASE[w.idx];
            var sz = C.domeSizes[w.idx]*C.sizeScale*_domeSzMult[w.idx];
            var r  = Math.min(b.r*sz, Math.min(W,H)*0.38);
            spawnWave(w.cx, w.cy, r*0.3, r*3.0, 0.45, 360);
            _emitCD[i] = 140 + Math.round(Math.random() * 80);
          }
        }
      }
      var alive = [];
      for (var k = 0; k < _waves.length; k++) {
        var sw = _waves[k];
        sw.age++;
        var t  = sw.age / sw.life;
        var tE = 1 - Math.pow(1-t, 2.0);
        sw.r   = sw.r0 + (sw.maxR - sw.r0) * tE;
        if (sw.age < sw.life) alive.push(sw);
      }
      _waves = alive;
      if (_waves.length > 0) {
        var rgb = hexRgb(lineColor);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 1;
        var band = RIPPLE_BAND;
        function domeEdgeAmp(gx, gy) {
          var amp = 1.0;
          for (var di=0; di<ws.length; di++) {
            var dw=ws[di], db=BASE[dw.idx];
            var dsz=C.domeSizes[dw.idx]*C.sizeScale*_domeSzMult[dw.idx];
            var dr=Math.min(db.r*dsz, Math.min(W,H)*0.38);
            var ddx=gx-dw.cx, ddy=gy-dw.cy;
            var dDist=Math.sqrt(ddx*ddx+ddy*ddy);
            var edgeDist=Math.abs(dDist-dr);
            if (edgeDist < band) {
              var edgeProx = 1 - edgeDist / band;
              amp += edgeProx * 1.2;
            }
          }
          return amp;
        }
        for (var rr = 0; rr <= rows; rr++) {
          var gy = rr * cell;
          var prevGlow = 0, prevP = null;
          for (var cc = 0; cc <= cols; cc++) {
            var gx = cc * cell;
            var glow = 0;
            for (var k = 0; k < _waves.length; k++) {
              var sw = _waves[k];
              var wt = sw.age / sw.life;
              var dx = gx - sw.x, dy = gy - sw.y;
              var dist = Math.sqrt(dx*dx + dy*dy);
              var ringDist = Math.abs(dist - sw.r);
              if (ringDist < band) {
                var fade = 1 - ringDist / band;
                var ageFade = Math.pow(1 - wt, 1.4);
                glow += sw.peakOp * fade * fade * ageFade;
              }
            }
            if (glow > 0.005) glow *= domeEdgeAmp(gx, gy);
            glow = Math.min(glow, 0.8);
            var p = displace(gx, gy);
            if (cc > 0 && (glow > 0.01 || prevGlow > 0.01)) {
              var segGlow = (glow + prevGlow) * 0.5;
              ctx.strokeStyle = 'rgba(' + rgb + ',' + segGlow.toFixed(3) + ')';
              ctx.beginPath();
              ctx.moveTo(prevP[0], prevP[1]);
              ctx.lineTo(p[0], p[1]);
              ctx.stroke();
            }
            prevGlow = glow;
            prevP = p;
          }
        }
        for (var cc = 0; cc <= cols; cc++) {
          var gx = cc * cell;
          var prevGlow = 0, prevP = null;
          for (var rr = 0; rr <= rows; rr++) {
            var gy = rr * cell;
            var glow = 0;
            for (var k = 0; k < _waves.length; k++) {
              var sw = _waves[k];
              var wt = sw.age / sw.life;
              var dx = gx - sw.x, dy = gy - sw.y;
              var dist = Math.sqrt(dx*dx + dy*dy);
              var ringDist = Math.abs(dist - sw.r);
              if (ringDist < band) {
                var fade = 1 - ringDist / band;
                var ageFade = Math.pow(1 - wt, 1.4);
                glow += sw.peakOp * fade * fade * ageFade;
              }
            }
            if (glow > 0.005) glow *= domeEdgeAmp(gx, gy);
            glow = Math.min(glow, 0.8);
            var p = displace(gx, gy);
            if (rr > 0 && (glow > 0.01 || prevGlow > 0.01)) {
              var segGlow = (glow + prevGlow) * 0.5;
              ctx.strokeStyle = 'rgba(' + rgb + ',' + segGlow.toFixed(3) + ')';
              ctx.beginPath();
              ctx.moveTo(prevP[0], prevP[1]);
              ctx.lineTo(p[0], p[1]);
              ctx.stroke();
            }
            prevGlow = glow;
            prevP = p;
          }
        }
        ctx.restore();
      }
    }

    if (document.hidden) { _running = false; window._running = false; return; }
    if (C.snapshot) { _running = false; window._running = false; return; }

    if (panelOpen) {
      if (!frame._tick) frame._tick = 0;
      frame._tick = (frame._tick + 1) % 3;
      if (frame._tick === 0) {
        if (C.autoSize) {
          for (var i = 0; i < C.count; i++) {
            var el = document.getElementById('sb-'+i);
            var vl = document.getElementById('vb-'+i);
            if (el && vl) {
              var eff = (C.domeSizes[i] * _domeSzMult[i]);
              el.value = eff;
              vl.textContent = eff.toFixed(2)+'x';
              setSliderPct(el);
            }
          }
        }
        if (C.autoColor) {
          var lc = autoColorHex(_autoHue);
          C.lineColor = lc;
          var sw = document.getElementById('line-swatch');
          var hf = document.getElementById('s-line-hex');
          if (sw) sw.style.background = lc;
          if (hf) hf.value = lc;
          if (_cpkTarget === 'line') {
            cpkFromHex(lc);
            var ht = document.getElementById('cpk-hue-thumb');
            if (ht) ht.style.left = (_cpkHue / 360 * 100) + '%';
            drawSL(_cpkHue);
            cpkSyncFields(lc);
          }
        }
      }
    }

    requestAnimationFrame(frame);
  }
  frame();
  window._frameRef = frame;

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && !window._running) requestAnimationFrame(frame);
  });
})();


// ─────────────────────────────────────────────────────
//  PRESETS
// ─────────────────────────────────────────────────────
var PRESETS = [
  { name:'Dusk',   bgColor:'#2a1f1f', lineColor:'#e8b89a', lineOpacity:0.07, cellSize:18, count:4, sizeScale:1.1, speedScale:0.6, forceScale:1.2, vignette:true  },
  { name:'Slate',  bgColor:'#1a1f2e', lineColor:'#b8c4e8', lineOpacity:0.06, cellSize:16, count:5, sizeScale:1.0, speedScale:0.9, forceScale:0.9, vignette:false },
  { name:'Sage',   bgColor:'#1a2420', lineColor:'#9ecdb8', lineOpacity:0.06, cellSize:20, count:4, sizeScale:1.2, speedScale:0.5, forceScale:0.8, vignette:false },
  { name:'Ash',    bgColor:'#1c1c1a', lineColor:'#e8e8d8', lineOpacity:0.04, cellSize:12, count:5, sizeScale:0.9, speedScale:1.0, forceScale:1.0, vignette:false },
  { name:'Plum',   bgColor:'#1e1525', lineColor:'#d4a8c8', lineOpacity:0.07, cellSize:18, count:5, sizeScale:1.2, speedScale:0.5, forceScale:1.4, vignette:true  },
  { name:'Sand',   bgColor:'#221e15', lineColor:'#d4c08a', lineOpacity:0.07, cellSize:16, count:4, sizeScale:1.0, speedScale:0.8, forceScale:1.1, vignette:false },
  { name:'Frost',  bgColor:'#151a20', lineColor:'#c0d8e8', lineOpacity:0.06, cellSize:12, count:6, sizeScale:0.9, speedScale:1.4, forceScale:0.8, vignette:false },
  { name:'Ember',  bgColor:'#1a1510', lineColor:'#d4784a', lineOpacity:0.08, cellSize:18, count:5, sizeScale:1.1, speedScale:0.5, forceScale:1.6, vignette:true  }
];

var _activePreset = -1;

function applyPreset(idx) {
  var p = PRESETS[idx];
  _activePreset = idx;
  C.bgColor      = p.bgColor;
  C.lineColor    = p.lineColor;
  C.lineOpacity  = p.lineOpacity;
  C.cellSize     = p.cellSize;
  C.count        = p.count;
  C.sizeScale    = p.sizeScale;
  C.speedScale   = p.speedScale;
  C.forceScale   = p.forceScale;
  C.vignette     = p.vignette;
  window.syncCount();
  applyToPanel();
  document.querySelectorAll('.preset-pill').forEach(function(b, i) {
    b.classList.toggle('preset-active', i === idx);
  });
}

function clearPresetHighlight() {
  _activePreset = -1;
  document.querySelectorAll('.preset-pill').forEach(function(b) {
    b.classList.remove('preset-active');
  });
}

// ─────────────────────────────────────────────────────
//  EXPAND / COLLAPSE ALL
// ─────────────────────────────────────────────────────
function toggleAllSections() {
  if (window._allAnimating) return;
  var allOpen = globalOpen && domesOpen && perfOpen && presetsOpen && appearanceOpen;
  var target = !allOpen;
  var p = document.getElementById('panel');
  var hrs = p.querySelectorAll(':scope > hr');
  var SECTIONS = [
    { header:'toggleGlobal',     panelId:'global-panel',     sel:':scope > .row, :scope > .toggle-row' },
    { header:'toggleDomes',      panelId:'dome-sliders',     sel:':scope > .row, :scope > .toggle-row' },
    { header:'togglePerf',       panelId:'perf-panel',       sel:':scope > .toggle-row' },
    { header:'togglePresets',    panelId:'presets-panel',     sel:':scope > .preset-grid > .preset-pill' },
    { header:'toggleAppearance', panelId:'appearance-panel', sel:':scope > .row, :scope > .toggle-row' }
  ];
  var seq = [];
  for (var s = 0; s < SECTIONS.length; s++) {
    var sec = SECTIONS[s];
    var headerEl = p.querySelector('.section-header[onclick*="'+sec.header+'"]');
    var panelEl  = document.getElementById(sec.panelId);
    if (headerEl) seq.push({el:headerEl, type:'row'});
    if (panelEl) {
      var div = panelEl.querySelector(':scope > .section-divider');
      if (div) seq.push({el:div, type:'fade'});
      seq.push({el:panelEl, type:'fade'});
      var items = panelEl.querySelectorAll(sec.sel);
      for (var j = 0; j < items.length; j++) seq.push({el:items[j], type:'row'});
    }
    if (hrs[s]) seq.push({el:hrs[s], type:'fade'});
  }
  var brow = p.querySelector('.brow');
  if (brow) seq.push({el:brow, type:'row'});
  var step = 15;
  window._allAnimating = true;
  if (!target) {
    ['global-chevron','dome-chevron','perf-chevron','presets-chevron','appearance-chevron']
      .forEach(function(id){ document.getElementById(id).classList.remove('open'); });
    var reversed = seq.slice().reverse();
    requestAnimationFrame(function(){
      for (var i = 0; i < reversed.length; i++) {
        var s = reversed[i];
        var animName = s.type === 'row' ? 'collapseRow' : 'collapseFade';
        s.el.style.animation = animName + ' 0.22s cubic-bezier(0.55,0,1,0.45) both';
        s.el.style.animationDelay = (i * step) + 'ms';
      }
    });
    var totalDelay = reversed.length * step + 280;
    setTimeout(function(){
      var panelIds = ['global-panel','dome-sliders','perf-panel','presets-panel','appearance-panel'];
      panelIds.forEach(function(id){
        var el = document.getElementById(id);
        el.style.transition = 'none';
        el.classList.add('collapsed');
        void el.offsetWidth;
        el.style.transition = '';
      });
      globalOpen = false; domesOpen = false; perfOpen = false;
      presetsOpen = false; appearanceOpen = false;
      for (var i = 0; i < reversed.length; i++) {
        reversed[i].el.style.animation = '';
        reversed[i].el.style.animationDelay = '';
        reversed[i].el.style.opacity = '';
      }
      updateExpandAllIcon();
      window._allAnimating = false;
    }, totalDelay);
    return;
  }
  if (!globalOpen)     { globalOpen=true;     document.getElementById('global-panel').classList.remove('collapsed');     document.getElementById('global-chevron').classList.add('open'); }
  if (!domesOpen)      { domesOpen=true;      document.getElementById('dome-sliders').classList.remove('collapsed');    document.getElementById('dome-chevron').classList.add('open'); buildDomeSliders(); }
  if (!perfOpen)       { perfOpen=true;       document.getElementById('perf-panel').classList.remove('collapsed');      document.getElementById('perf-chevron').classList.add('open'); }
  if (!presetsOpen)    { presetsOpen=true;    document.getElementById('presets-panel').classList.remove('collapsed');   document.getElementById('presets-chevron').classList.add('open'); }
  if (!appearanceOpen) { appearanceOpen=true; document.getElementById('appearance-panel').classList.remove('collapsed');document.getElementById('appearance-chevron').classList.add('open'); }
  updateExpandAllIcon();
  seq = [];
  for (var s = 0; s < SECTIONS.length; s++) {
    var sec = SECTIONS[s];
    var headerEl = p.querySelector('.section-header[onclick*="'+sec.header+'"]');
    var panelEl  = document.getElementById(sec.panelId);
    if (headerEl) seq.push({el:headerEl, type:'row'});
    if (panelEl) {
      var div = panelEl.querySelector(':scope > .section-divider');
      if (div) seq.push({el:div, type:'fade'});
      seq.push({el:panelEl, type:'fade'});
      var items = panelEl.querySelectorAll(sec.sel);
      for (var j = 0; j < items.length; j++) seq.push({el:items[j], type:'row'});
    }
    if (hrs[s]) seq.push({el:hrs[s], type:'fade'});
  }
  brow = p.querySelector('.brow');
  if (brow) seq.push({el:brow, type:'row'});
  requestAnimationFrame(function(){
    for (var i = 0; i < seq.length; i++) {
      var s = seq[i];
      var animName = s.type === 'row' ? 'revealRow' : 'revealFade';
      s.el.style.animation = animName + ' 0.22s cubic-bezier(0.22,1,0.36,1) both';
      s.el.style.animationDelay = (i * step) + 'ms';
    }
  });
  var totalDelay = seq.length * step + 280;
  setTimeout(function(){
    for (var i = 0; i < seq.length; i++) {
      seq[i].el.style.animation = '';
      seq[i].el.style.animationDelay = '';
    }
    window._allAnimating = false;
  }, totalDelay);
}

function updateExpandAllIcon() {
  var allOpen = globalOpen && domesOpen && perfOpen && presetsOpen && appearanceOpen;
  var exp = document.querySelector('#expand-all-icon .expand-icon');
  var col = document.querySelector('#expand-all-icon .collapse-icon');
  if (exp) exp.style.display = allOpen ? 'none' : '';
  if (col) col.style.display = allOpen ? ''     : 'none';
}

var panelOpen = false;
function togglePanel() { panelOpen ? closePanel() : openPanel(); }
function setAnim(el, animStr, delay) {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = animStr;
  el.style.animationDelay = delay + 'ms';
}

var ANIM = {
  reveal:      'revealRow    0.22s cubic-bezier(0.22,1,0.36,1) both',
  revealFade:  'revealFade   0.22s cubic-bezier(0.22,1,0.36,1) both',
  collapse:    'collapseRow  0.22s cubic-bezier(0.55,0,1,0.45) both',
  collapseFade:'collapseFade 0.22s cubic-bezier(0.55,0,1,0.45) both',
  revealStep:  20,
  collapseStep:20
};

function cascadeReveal(panelEl, childSelector) {
  var items = panelEl.querySelectorAll(childSelector);
  var divider = panelEl.querySelector(':scope > .section-divider');
  var step = ANIM.revealStep;
  var delay = 0;
  var tracked = [];
  if (divider) { setAnim(divider, ANIM.revealFade, delay); tracked.push(divider); delay += step; }
  for (var i = 0; i < items.length; i++) {
    setAnim(items[i], ANIM.reveal, delay); tracked.push(items[i]);
    delay += step;
  }
  var sliders = panelEl.querySelectorAll('input[type=range]');
  for (var i = 0; i < sliders.length; i++) {
    var sl = sliders[i];
    var row = sl.closest('.row');
    var rowIdx = Array.from(items).indexOf(row);
    var slDelay = (rowIdx >= 0 ? (rowIdx + 1) * step : delay) + 80;
    tweenSliderIn(sl, slDelay);
  }
  var cleanup = delay + 500;
  setTimeout(function(){
    for (var i = 0; i < tracked.length; i++) {
      tracked[i].style.animation = '';
      tracked[i].style.animationDelay = '';
    }
  }, cleanup);
}

function tweenSliderIn(inputEl, delayMs) {
  var targetVal = parseFloat(inputEl.value);
  var minVal = parseFloat(inputEl.min);
  var startVal = minVal;
  var row = inputEl.closest('.row');
  var valueSpan = row ? row.querySelector('.row-top > span[id]') : null;
  var fmt = null;
  if (valueSpan) {
    var sid = valueSpan.id;
    if (sid === 'v-count') fmt = function(v){ return Math.round(v); };
    else if (sid === 'v-cell') fmt = function(v){ return Math.round(v) + 'px'; };
    else if (sid === 'v-lerp') fmt = function(v){ return v.toFixed(2); };
    else if (sid === 'v-opacity') fmt = function(v){ return v.toFixed(3); };
    else if (sid.indexOf('vb-') === 0) fmt = function(v){ return v.toFixed(2) + 'x'; };
    else fmt = function(v){ return v.toFixed(2) + 'x'; };
  }
  inputEl.value = startVal;
  setSliderPct(inputEl);
  if (valueSpan && fmt) valueSpan.textContent = fmt(startVal);
  setTimeout(function(){
    var duration = 400;
    var startTime = null;
    function tick(now) {
      if (!startTime) startTime = now;
      var t = Math.min((now - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      var current = startVal + (targetVal - startVal) * eased;
      inputEl.value = current;
      setSliderPct(inputEl);
      if (valueSpan && fmt) valueSpan.textContent = fmt(current);
      if (t < 1) requestAnimationFrame(tick);
      else {
        inputEl.value = targetVal;
        setSliderPct(inputEl);
        if (valueSpan && fmt) valueSpan.textContent = fmt(targetVal);
      }
    }
    requestAnimationFrame(tick);
  }, delayMs);
}

function cascadeCollapse(panelEl, childSelector, onDone) {
  var items = Array.from(panelEl.querySelectorAll(childSelector));
  var divider = panelEl.querySelector(':scope > .section-divider');
  var step = ANIM.collapseStep;
  var delay = 0;
  var tracked = [];
  for (var i = items.length - 1; i >= 0; i--) {
    setAnim(items[i], ANIM.collapse, delay); tracked.push(items[i]);
    delay += step;
  }
  if (divider) { setAnim(divider, ANIM.collapseFade, delay); tracked.push(divider); delay += step; }
  var totalDelay = delay + 280;
  setTimeout(function(){
    panelEl.style.transition = 'none';
    if (onDone) onDone();
    void panelEl.offsetWidth;
    panelEl.style.transition = '';
    for (var i = 0; i < tracked.length; i++) {
      tracked[i].style.animation = '';
      tracked[i].style.animationDelay = '';
      tracked[i].style.opacity = '';
    }
  }, totalDelay);
}

function createToggle(wrapId, labelId, configKey, onChange) {
  var wrap = document.getElementById(wrapId);
  if (!wrap) return function(){};
  var startX = 0, dragging = false, dragMoved = false, wasOn = false;
  function setToggle(on) {
    C[configKey] = on;
    wrap.classList.toggle('on', on);
    wrap.setAttribute('aria-checked', on ? 'true' : 'false');
    if (onChange) onChange(on);
  }
  wrap.addEventListener('pointerdown', function(e) {
    e.preventDefault(); wrap.setPointerCapture(e.pointerId);
    startX = e.clientX; dragging = true; dragMoved = false; wasOn = C[configKey];
  });
  wrap.addEventListener('pointermove', function(e) {
    if (!dragging) return;
    var dx = e.clientX - startX;
    if (Math.abs(dx) > 4) { dragMoved = true; setToggle(wasOn ? dx > -10 : dx > 10); }
  });
  wrap.addEventListener('pointerup', function() {
    if (!dragging) return; dragging = false;
    if (!dragMoved) setToggle(!C[configKey]);
  });
  if (labelId) {
    var lbl = document.getElementById(labelId);
    if (lbl) lbl.addEventListener('click', function() { setToggle(!C[configKey]); });
  }
  wrap.addEventListener('keydown', function(e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setToggle(!C[configKey]); }
  });
  return setToggle;
}

function openPanel() {
  var p = document.getElementById('panel');
  p.classList.add('loading','open'); panelOpen = true;
  if (domesOpen) {
    var cont = document.getElementById('dome-sliders');
    cont.innerHTML = '';
    for (var i = 0; i < C.count; i++) {
      var sk = document.createElement('div');
      sk.className = 'row sk-dome-placeholder';
      sk.innerHTML = '<div class="row-top"><div class="sk-left"><div class="sk-lbl" style="width:80px;margin-bottom:0;"></div><div class="sk-icon"></div></div><div class="sk-val"></div></div><div class="sk-bar"></div>';
      cont.appendChild(sk);
    }
  }
  if (presetsOpen) {
    var pgrid = document.getElementById('preset-grid');
    if (pgrid) {
      pgrid._pills = pgrid.innerHTML;
      pgrid.innerHTML = '';
      for (var i = 0; i < PRESETS.length; i++) {
        var sk = document.createElement('div');
        sk.className = 'sk-block';
        sk.style.cssText = 'height:36px;border-radius:5px;';
        pgrid.appendChild(sk);
      }
    }
  }
  setTimeout(function(){
    var h2Span = p.querySelector('h2 > span');
    if (h2Span) h2Span.style.visibility = 'hidden';
    p.classList.remove('loading');
    if (domesOpen) buildDomeSliders();
    if (presetsOpen) {
      var pgrid = document.getElementById('preset-grid');
      if (pgrid && pgrid._pills !== undefined) {
        pgrid.innerHTML = pgrid._pills;
        delete pgrid._pills;
        var pills = pgrid.querySelectorAll('.preset-pill');
        pills.forEach(function(btn, i) { btn.addEventListener('click', function(){ applyPreset(i); }); });
      }
    }
    var step = ANIM.revealStep;
    var titleDuration = 180;
    var anim     = ANIM.reveal;
    var animFade = ANIM.revealFade;
    if (h2Span) { setAnim(h2Span, anim, 0); h2Span.style.visibility = ''; }
    var runningDelay = titleDuration;
    var OPEN_PANELS = {
      'global-panel':     globalOpen,
      'perf-panel':       perfOpen,
      'presets-panel':    presetsOpen,
      'appearance-panel': appearanceOpen,
      'dome-sliders':     domesOpen
    };
    var PANEL_IDS = Object.keys(OPEN_PANELS);
    var children = p.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.tagName === 'H2') continue;
      var cid = child.id;
      var isPanelEl = PANEL_IDS.indexOf(cid) > -1;
      if (isPanelEl && !OPEN_PANELS[cid]) continue;
      if (isPanelEl && OPEN_PANELS[cid]) {
        setAnim(child, animFade, runningDelay);
        runningDelay += step;
        var divEl = child.querySelector(':scope > .section-divider');
        if (divEl) setAnim(divEl, animFade, runningDelay - step);
        var items = child.querySelectorAll(':scope > .row, :scope > .toggle-row, :scope > .fps-row, :scope > .preset-grid > .preset-pill');
        for (var j = 0; j < items.length; j++) {
          setAnim(items[j], anim, runningDelay + j * step);
        }
        runningDelay += items.length * step;
      } else {
        setAnim(child, anim, runningDelay);
        runningDelay += step;
      }
    }
    var totalDelay = runningDelay;
    setTimeout(function(){
      if (h2Span) { h2Span.style.animation=''; h2Span.style.animationDelay=''; }
      var allChildren = p.querySelectorAll('h2 > span, .row, .toggle-row, .fps-row, .section-header, hr, .brow, .preset-pill, .section-divider, #dome-sliders, #perf-panel, #presets-panel, #appearance-panel, #global-panel');
      for (var i=0; i<allChildren.length; i++) {
        var el = allChildren[i];
        var elId = el.id || '';
        var isCollapsed = (elId==='perf-panel' && !perfOpen) || (elId==='dome-sliders' && !domesOpen) || (elId==='presets-panel' && !presetsOpen) || (elId==='appearance-panel' && !appearanceOpen) || (elId==='global-panel' && !globalOpen);
        if (isCollapsed) continue;
        el.style.animation=''; el.style.animationDelay='';
      }
    }, totalDelay + 400);
  }, 650);
}
function closePanel() {
  document.getElementById('panel').classList.remove('open');
  panelOpen = false; closePicker();
}
document.addEventListener('pointerdown', function(e) {
  if (!panelOpen) return;
  var p = document.getElementById('panel');
  var h = document.getElementById('hamburger');
  var cpk = document.getElementById('cpk');
  if (!p.contains(e.target) && !h.contains(e.target) && !cpk.contains(e.target)) {
    closePanel();
  } else if (p.contains(e.target) && !cpk.contains(e.target)) {
    if (!e.target.closest('.clr-preview')) closePicker();
  }
}, { passive: true });

(function(){
  var ham = document.getElementById('hamburger');
  var panel = document.getElementById('panel');
  var EDGE_MARGIN = 20;
  var DRAG_THRESHOLD = 5;
  var _hamSide = 'right';
  var _dragging = false;
  var _dragMoved = false;
  var _startX = 0, _startY = 0;
  var _offsetX = 0, _offsetY = 0;
  function initPosition() {
    var rect = ham.getBoundingClientRect();
    ham.style.left = rect.left + 'px';
    ham.style.top  = rect.top + 'px';
    ham.style.right = 'auto';
  }
  function syncPanelSide() {
    var hamRect = ham.getBoundingClientRect();
    if (_hamSide === 'left') {
      panel.classList.add('panel-left');
      panel.style.right = 'auto';
      panel.style.left = EDGE_MARGIN + 'px';
    } else {
      panel.classList.remove('panel-left');
      panel.style.left = '';
      panel.style.right = EDGE_MARGIN + 'px';
    }
    panel.style.top = (hamRect.bottom + 8) + 'px';
    panel.style.maxHeight = 'calc(100vh - ' + (hamRect.bottom + 16) + 'px)';
  }
  ham.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    ham.setPointerCapture(e.pointerId);
    _dragging = true; _dragMoved = false;
    _startX = e.clientX; _startY = e.clientY;
    if (ham.style.left === '' || ham.style.left === 'auto') initPosition();
    var rect = ham.getBoundingClientRect();
    _offsetX = e.clientX - rect.left;
    _offsetY = e.clientY - rect.top;
    ham.classList.remove('snapping');
    ham.classList.add('dragging');
  });
  ham.addEventListener('pointermove', function(e) {
    if (!_dragging) return;
    var dx = e.clientX - _startX;
    var dy = e.clientY - _startY;
    if (!_dragMoved && Math.sqrt(dx*dx + dy*dy) > DRAG_THRESHOLD) {
      _dragMoved = true;
      if (panelOpen) closePanel();
    }
    if (!_dragMoved) return;
    var x = Math.max(EDGE_MARGIN, Math.min(window.innerWidth - ham.offsetWidth - EDGE_MARGIN, e.clientX - _offsetX));
    var y = Math.max(EDGE_MARGIN, Math.min(window.innerHeight - ham.offsetHeight - EDGE_MARGIN, e.clientY - _offsetY));
    ham.style.left = x + 'px';
    ham.style.top  = y + 'px';
  });
  ham.addEventListener('pointerup', function(e) {
    if (!_dragging) return;
    _dragging = false;
    ham.classList.remove('dragging');
    if (!_dragMoved) { togglePanel(); return; }
    var rect = ham.getBoundingClientRect();
    var centerX = rect.left + rect.width / 2;
    var snapLeft = centerX < window.innerWidth / 2;
    _hamSide = snapLeft ? 'left' : 'right';
    var targetX = snapLeft ? EDGE_MARGIN : (window.innerWidth - ham.offsetWidth - EDGE_MARGIN);
    var clampedY = Math.max(EDGE_MARGIN, Math.min(window.innerHeight - ham.offsetHeight - EDGE_MARGIN, rect.top));
    ham.classList.add('snapping');
    ham.style.left = targetX + 'px';
    ham.style.top  = clampedY + 'px';
    setTimeout(function(){ ham.classList.remove('snapping'); syncPanelSide(); }, 320);
  });
  window.addEventListener('resize', function(){
    if (_dragging) return;
    var targetX = _hamSide === 'left' ? EDGE_MARGIN : (window.innerWidth - ham.offsetWidth - EDGE_MARGIN);
    var currentY = parseFloat(ham.style.top) || EDGE_MARGIN;
    var clampedY = Math.max(EDGE_MARGIN, Math.min(window.innerHeight - ham.offsetHeight - EDGE_MARGIN, currentY));
    ham.style.left = targetX + 'px';
    ham.style.top  = clampedY + 'px';
    if (ham.style.right !== 'auto') { ham.style.right = 'auto'; }
    syncPanelSide();
  });
  window._getHamburgerSide = function(){ return _hamSide; };
  var _origOpen = openPanel;
  openPanel = function() {
    if (ham.style.left === '' || ham.style.left === 'auto') initPosition();
    syncPanelSide();
    _origOpen();
  };
})();

var perfOpen = false;
function togglePerf() {
  var panel = document.getElementById('perf-panel');
  var chevron = document.getElementById('perf-chevron');
  if (perfOpen) {
    chevron.classList.remove('open');
    cascadeCollapse(panel, ':scope > .toggle-row', function(){ perfOpen = false; panel.classList.add('collapsed'); updateExpandAllIcon(); });
  } else {
    perfOpen = true; panel.classList.remove('collapsed'); chevron.classList.add('open');
    cascadeReveal(panel, ':scope > .toggle-row');
  }
  updateExpandAllIcon();
}
var domesOpen = false;
function toggleDomes() {
  var panel = document.getElementById('dome-sliders');
  var chevron = document.getElementById('dome-chevron');
  if (domesOpen) {
    chevron.classList.remove('open');
    cascadeCollapse(panel, ':scope > .row, :scope > .toggle-row', function(){ domesOpen = false; panel.classList.add('collapsed'); updateExpandAllIcon(); });
  } else {
    domesOpen = true; panel.classList.remove('collapsed'); chevron.classList.add('open');
    cascadeReveal(panel, ':scope > .row, :scope > .toggle-row');
  }
  updateExpandAllIcon();
}

var globalOpen = false;
function toggleGlobal() {
  var panel = document.getElementById('global-panel');
  var chevron = document.getElementById('global-chevron');
  if (globalOpen) {
    chevron.classList.remove('open');
    cascadeCollapse(panel, ':scope > .row, :scope > .toggle-row', function(){ globalOpen = false; panel.classList.add('collapsed'); updateExpandAllIcon(); });
  } else {
    globalOpen = true; panel.classList.remove('collapsed'); chevron.classList.add('open');
    cascadeReveal(panel, ':scope > .row, :scope > .toggle-row');
  }
  updateExpandAllIcon();
}
var appearanceOpen = false;
function toggleAppearance() {
  var panel = document.getElementById('appearance-panel');
  var chevron = document.getElementById('appearance-chevron');
  if (appearanceOpen) {
    chevron.classList.remove('open');
    cascadeCollapse(panel, ':scope > .row, :scope > .toggle-row', function(){ appearanceOpen = false; panel.classList.add('collapsed'); updateExpandAllIcon(); });
  } else {
    appearanceOpen = true; panel.classList.remove('collapsed'); chevron.classList.add('open');
    cascadeReveal(panel, ':scope > .row, :scope > .toggle-row');
  }
  updateExpandAllIcon();
}
var presetsOpen = false;
function togglePresets() {
  var panel = document.getElementById('presets-panel');
  var chevron = document.getElementById('presets-chevron');
  if (presetsOpen) {
    chevron.classList.remove('open');
    cascadeCollapse(panel, ':scope > .preset-grid > .preset-pill', function(){ presetsOpen = false; panel.classList.add('collapsed'); updateExpandAllIcon(); });
  } else {
    presetsOpen = true; panel.classList.remove('collapsed'); chevron.classList.add('open');
    cascadeReveal(panel, ':scope > .preset-grid > .preset-pill');
  }
  updateExpandAllIcon();
}

(function(){
  var grid = document.getElementById('preset-grid');
  PRESETS.forEach(function(p, i) {
    var btn = document.createElement('button');
    btn.className = 'preset-pill';
    btn.style.background = 'linear-gradient(135deg, '+p.bgColor+' 50%, '+p.lineColor+' 50%)';
    btn.style.borderColor = p.bgColor;
    var span = document.createElement('span');
    span.className = 'preset-pill-label';
    span.textContent = p.name;
    btn.appendChild(span);
    btn.addEventListener('click', function(){ applyPreset(i); });
    grid.appendChild(btn);
  });
})();

function buildDomeSliders() {
  var cont = document.getElementById('dome-sliders');
  cont.innerHTML = '';
  var sdiv = document.createElement('hr');
  sdiv.className = 'section-divider';
  cont.appendChild(sdiv);
  var ad = document.createElement('div');
  ad.className = 'toggle-row'; ad.style.marginBottom = '14px';
  ad.innerHTML = '<div class="sk-left"><div class="sk-lbl" style="width:110px;margin-bottom:0;"></div><div class="sk-icon"></div></div>'
    + '<div class="label-group"><label id="autosize-label">Auto-Change Dome Size</label><span class="info-btn" data-tip="autosize">i</span></div>'
    + '<div class="sk-block" style="width:36px;height:20px;border-radius:10px;flex-shrink:0;"></div>'
    + '<div class="toggle-wrap'+(C.autoSize?' on':'')+'" id="toggle-autosize" role="switch" aria-checked="'+(C.autoSize?'true':'false')+'" tabindex="0"><div class="toggle-track"></div><div class="toggle-thumb"></div></div>';
  cont.appendChild(ad);
  var aw=ad.querySelector('#toggle-autosize'),sx=0,dg=false,mv=false,wo=false;
  function setAS(on){C.autoSize=on;aw.classList.toggle('on',on);aw.setAttribute('aria-checked',on?'true':'false');}
  aw.addEventListener('pointerdown',function(e){e.preventDefault();aw.setPointerCapture(e.pointerId);sx=e.clientX;dg=true;mv=false;wo=C.autoSize;});
  aw.addEventListener('pointermove',function(e){if(!dg)return;var dx=e.clientX-sx;if(Math.abs(dx)>4){mv=true;setAS(wo?dx>-10:dx>10);}});
  aw.addEventListener('pointerup',function(){if(!dg)return;dg=false;if(!mv)setAS(!C.autoSize);});
  var al=ad.querySelector('#autosize-label');if(al)al.addEventListener('click',function(){setAS(!C.autoSize);});
  aw.addEventListener('keydown',function(e){if(e.key===' '||e.key==='Enter'){e.preventDefault();setAS(!C.autoSize);}});
  window._setAutoSizeToggle=setAS;
  for (var i=0; i<C.count; i++) {
    (function(idx) {
      var sz = C.domeSizes[idx], div = document.createElement('div');
      div.className = 'row';
      div.innerHTML = '<div class="row-top">'
        + '<div class="sk-left"><div class="sk-lbl" style="width:80px;margin-bottom:0;"></div><div class="sk-icon"></div></div>'
        + '<div class="label-group"><label>Dome '+(idx+1)+'</label></div>'
        + '<div class="sk-val"></div>'
        + '<span id="vb-'+idx+'">'+sz.toFixed(2)+'x</span></div>'
        + '<div class="sk-bar"></div>'
        + '<input type="range" id="sb-'+idx+'" min="0.1" max="3.0" step="0.05" value="'+sz+'">';
      cont.appendChild(div);
      div.querySelector('input').addEventListener('input', function() {
        var v = parseFloat(this.value);
        C.domeSizes[idx] = v;
        document.getElementById('vb-'+idx).textContent = v.toFixed(2)+'x';
        setSliderPct(this);
      });
      setSliderPct(div.querySelector('input'));
    })(i);
  }
}
buildDomeSliders();

function setSliderPct(el) {
  if (!el) return;
  var min = parseFloat(el.min), max = parseFloat(el.max), val = parseFloat(el.value);
  var pct = ((val - min) / (max - min) * 100).toFixed(2) + '%';
  el.style.setProperty('--pct', pct);
}

function sl(id, vid, key, fmt, cb) {
  var el = document.getElementById(id), vl = document.getElementById(vid);
  if (!el) return;
  setSliderPct(el);
  el.addEventListener('input', function() {
    var v = parseFloat(el.value);
    C[key] = v;
    if (vl) vl.textContent = fmt ? fmt(v) : v;
    setSliderPct(el);
    if (cb) cb(v);
  });
}
sl('s-count',   'v-count',   'count',       function(v){ return Math.round(v); },      function(){ window.syncCount(); buildDomeSliders(); });
sl('s-size',    'v-size',    'sizeScale',   function(v){ return v.toFixed(2)+'x'; },   null);
sl('s-speed',   'v-speed',   'speedScale',  function(v){ return v.toFixed(2)+'x'; },   null);
sl('s-force',   'v-force',   'forceScale',  function(v){ return v.toFixed(2)+'x'; },   null);
sl('s-lerp',    'v-lerp',    'lerpSpeed',   function(v){ return v.toFixed(2); },        null);
sl('s-cell',    'v-cell',    'cellSize',    function(v){ return Math.round(v)+'px'; },  null);
sl('s-opacity', 'v-opacity', 'lineOpacity', function(v){ return v.toFixed(3); },        null);

var _cpkTarget = null;
var _cpkHue = 0, _cpkSat = 0, _cpkVal = 0;

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
function rgbToHex(r,g,b) {
  return '#'+[r,g,b].map(function(v){
    return Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
  }).join('');
}
function cpkSyncFields(hex) {
  document.getElementById('cpk-hex').value = hex;
  var rgb = hexToRgb(hex);
  document.getElementById('cpk-r').value = rgb[0];
  document.getElementById('cpk-g').value = rgb[1];
  document.getElementById('cpk-b').value = rgb[2];
}

function drawSL(hue) {
  var cv = document.getElementById('cpk-sl');
  var ctx = cv.getContext('2d');
  var W = cv.width, H = cv.height;
  var gH = ctx.createLinearGradient(0,0,W,0);
  gH.addColorStop(0,'#fff');
  gH.addColorStop(1,'hsl('+hue+',100%,50%)');
  ctx.fillStyle = gH; ctx.fillRect(0,0,W,H);
  var gV = ctx.createLinearGradient(0,0,0,H);
  gV.addColorStop(0,'rgba(0,0,0,0)');
  gV.addColorStop(1,'rgba(0,0,0,1)');
  ctx.fillStyle = gV; ctx.fillRect(0,0,W,H);
  var x = (_cpkSat/100)*W;
  var y = (1 - _cpkVal/100)*H;
  x = Math.max(0,Math.min(W,x)); y = Math.max(0,Math.min(H,y));
  ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2);
  ctx.strokeStyle = _cpkVal > 50 ? '#000' : '#fff';
  ctx.lineWidth = 2; ctx.stroke();
}

function cpkFromHex(hex) {
  var hsv = hexToHsv(hex);
  _cpkHue = hsv[0]; _cpkSat = hsv[1]; _cpkVal = hsv[2];
}
function cpkToHex() { return hsvToHex(_cpkHue, _cpkSat, _cpkVal); }

function openPicker(target) {
  if (_cpkTarget === target) { closePicker(); return; }
  _cpkTarget = target;
  var hex = target === 'bg' ? C.bgColor : C.lineColor;
  cpkFromHex(hex);
  var cpk = document.getElementById('cpk');
  var preview = document.getElementById(target+'-preview');
  var rect = preview.getBoundingClientRect();
  cpk.style.visibility = 'hidden';
  cpk.classList.add('open');
  var pkH = cpk.offsetHeight;
  var pkW = cpk.offsetWidth;
  cpk.classList.remove('open');
  cpk.style.visibility = '';
  var gap = 8;
  var topPos = rect.top - pkH - gap;
  if (topPos < 8) topPos = rect.bottom + gap;
  var leftPos = rect.left;
  if (leftPos + pkW > window.innerWidth - 8) leftPos = window.innerWidth - pkW - 8;
  if (leftPos < 8) leftPos = 8;
  cpk.style.top  = topPos + 'px';
  cpk.style.left = leftPos + 'px';
  cpkSyncFields(hex);
  document.getElementById('cpk-hue-thumb').style.left = (_cpkHue/360*100)+'%';
  drawSL(_cpkHue);
  cpk.style.animation = 'none';
  void cpk.offsetWidth;
  cpk.style.animation = '';
  cpk.classList.add('open');
}

function closePicker() {
  document.getElementById('cpk').classList.remove('open');
  _cpkTarget = null;
}

function cpkApplyColor(hex) {
  if (!_cpkTarget) return;
  C[_cpkTarget==='bg'?'bgColor':'lineColor'] = hex;
  document.getElementById(_cpkTarget+'-swatch').style.background = hex;
  document.getElementById('s-'+_cpkTarget+'-hex').value = hex;
  cpkSyncFields(hex);
}

(function(){
  var cv = document.getElementById('cpk-sl');
  var drag = false;
  function pickSL(e) {
    var rect = cv.getBoundingClientRect();
    var x = Math.max(0, Math.min(1, (e.clientX-rect.left)/rect.width));
    var y = Math.max(0, Math.min(1, (e.clientY-rect.top)/rect.height));
    _cpkSat = x * 100;
    _cpkVal = (1-y) * 100;
    drawSL(_cpkHue);
    cpkApplyColor(cpkToHex());
  }
  cv.addEventListener('pointerdown', function(e){ drag=true; cv.setPointerCapture(e.pointerId); pickSL(e); });
  cv.addEventListener('pointermove', function(e){ if(drag) pickSL(e); });
  cv.addEventListener('pointerup',   function(){ drag=false; });
})();

(function(){
  var bar = document.getElementById('cpk-hue');
  var drag = false;
  function pickHue(e) {
    var rect = bar.getBoundingClientRect();
    var t = Math.max(0, Math.min(1, (e.clientX-rect.left)/rect.width));
    _cpkHue = t * 360;
    document.getElementById('cpk-hue-thumb').style.left = (t*100)+'%';
    drawSL(_cpkHue);
    cpkApplyColor(cpkToHex());
  }
  bar.addEventListener('pointerdown', function(e){ drag=true; bar.setPointerCapture(e.pointerId); pickHue(e); });
  bar.addEventListener('pointermove', function(e){ if(drag) pickHue(e); });
  bar.addEventListener('pointerup',   function(){ drag=false; });
})();

document.getElementById('cpk-hex').addEventListener('input', function(){
  var v = this.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    cpkFromHex(v);
    document.getElementById('cpk-hue-thumb').style.left=(_cpkHue/360*100)+'%';
    drawSL(_cpkHue);
    cpkApplyColor(v);
  }
});
document.getElementById('cpk-hex').addEventListener('blur', function(){
  if (!/^#[0-9a-fA-F]{6}$/.test(this.value))
    this.value = _cpkTarget==='bg' ? C.bgColor : C.lineColor;
});

['cpk-r','cpk-g','cpk-b'].forEach(function(id){
  document.getElementById(id).addEventListener('input', function(){
    var r = parseInt(document.getElementById('cpk-r').value)||0;
    var g = parseInt(document.getElementById('cpk-g').value)||0;
    var b = parseInt(document.getElementById('cpk-b').value)||0;
    var hex = rgbToHex(r,g,b);
    cpkFromHex(hex);
    document.getElementById('cpk-hue-thumb').style.left=(_cpkHue/360*100)+'%';
    drawSL(_cpkHue);
    cpkApplyColor(hex);
    document.getElementById('cpk-hex').value = hex;
  });
});

function syncHexField(hid, key, swatchId) {
  var h = document.getElementById(hid);
  h.addEventListener('input', function(){
    var v = this.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      C[key] = v;
      document.getElementById(swatchId).style.background = v;
    }
  });
  h.addEventListener('blur', function(){
    if (!/^#[0-9a-fA-F]{6}$/.test(this.value)) this.value = C[key];
  });
}
syncHexField('s-bg-hex',   'bgColor',   'bg-swatch');
syncHexField('s-line-hex', 'lineColor', 'line-swatch');

function applyToPanel() {
  var set = function(id,v){ var e=document.getElementById(id); if(e){ e.value=v; setSliderPct(e); } };
  var txt = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
  set('s-count',   C.count);       txt('v-count',   C.count);
  set('s-size',    C.sizeScale);   txt('v-size',    C.sizeScale.toFixed(2)+'x');
  set('s-speed',   C.speedScale);  txt('v-speed',   C.speedScale.toFixed(2)+'x');
  set('s-force',   C.forceScale);  txt('v-force',   C.forceScale.toFixed(2)+'x');
  set('s-lerp',    C.lerpSpeed);   txt('v-lerp',    C.lerpSpeed.toFixed(2));
  set('s-cell',    C.cellSize);    txt('v-cell',    C.cellSize+'px');
  set('s-opacity', C.lineOpacity); txt('v-opacity', C.lineOpacity.toFixed(3));
  set('s-bg-hex',  C.bgColor);     set('s-line-hex', C.lineColor);
  var bgSw=document.getElementById('bg-swatch');   if(bgSw) bgSw.style.background=C.bgColor;
  var lnSw=document.getElementById('line-swatch'); if(lnSw) lnSw.style.background=C.lineColor;
  var tog=document.getElementById('toggle-autocolor');
  if(tog && window._setAutoColorToggle) window._setAutoColorToggle(!!C.autoColor);
  if(window._setMouseMode) window._setMouseMode(C.mouseMode||'repel');
  var togS=document.getElementById('toggle-autosize');
  if(togS && window._setAutoSizeToggle) window._setAutoSizeToggle(!!C.autoSize);
  var togGL=document.getElementById('toggle-gradientlines');
  if(togGL && window._setGradientLinesToggle) window._setGradientLinesToggle(!!C.gradientLines);
  var togV=document.getElementById('toggle-vignette');
  if(togV && window._setVignetteToggle) window._setVignetteToggle(!!C.vignette);
  var togSn=document.getElementById('toggle-snapshot');
  if(togSn && window._setSnapshotToggle) window._setSnapshotToggle(!!C.snapshot);
  if(window._setFps) window._setFps(C.fpsLimit);
  buildDomeSliders();
}

function resetDefaults() {
  C = JSON.parse(JSON.stringify(DEFAULTS));
  applyToPanel(); window.syncCount();
}
function randomizeAll() {
  var rnd = function(a,b){ return +(a+(b-a)*Math.random()).toFixed(2); };
  C.sizeScale=rnd(0.4,2.0); C.speedScale=rnd(0.3,2.5);
  C.forceScale=rnd(0.4,2.0); C.lerpSpeed=rnd(0.02,0.20);
  C.cellSize=Math.round(rnd(12,40));
  applyToPanel();
}

window._setAutoColorToggle = createToggle('toggle-autocolor', 'autocolor-label', 'autoColor');

(function(){
  var wrap = document.getElementById('toggle-mousemode');
  function setMode(repel) {
    C.mouseMode = repel ? 'repel' : 'attract';
    wrap.classList.toggle('on', repel);
    wrap.setAttribute('aria-checked', repel ? 'true' : 'false');
    var lbl = document.getElementById('mousemode-label');
    if (lbl) lbl.textContent = repel ? 'Mouse Repel Dome' : 'Mouse Attract Dome';
  }
  var sx=0, dg=false, mv=false, wo=false;
  wrap.addEventListener('pointerdown', function(e){ e.preventDefault(); wrap.setPointerCapture(e.pointerId); sx=e.clientX; dg=true; mv=false; wo=C.mouseMode==='repel'; });
  wrap.addEventListener('pointermove', function(e){ if(!dg) return; var dx=e.clientX-sx; if(Math.abs(dx)>4){ mv=true; setMode(wo?dx>-10:dx>10); } });
  wrap.addEventListener('pointerup', function(){ if(!dg) return; dg=false; if(!mv) setMode(C.mouseMode!=='repel'); });
  var lbl = document.getElementById('mousemode-label');
  if(lbl) lbl.addEventListener('click', function(){ setMode(C.mouseMode!=='repel'); });
  wrap.addEventListener('keydown', function(e){ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); setMode(C.mouseMode!=='repel'); } });
  setMode(C.mouseMode === 'repel');
  window._setMouseMode = function(mode){ setMode(mode === 'repel'); };
})();

window._setVignetteToggle = createToggle('toggle-vignette', 'vignette-label', 'vignette', function(on) {
  document.getElementById('vignette').classList.toggle('on', on);
});

(function(){
  var presets = [15, 24, 30, 60];
  var idx = presets.indexOf(C.fpsLimit);
  if (idx < 0) idx = presets.length - 1;
  function setFps(newIdx) {
    idx = Math.max(0, Math.min(presets.length - 1, newIdx));
    C.fpsLimit = presets[idx];
    document.getElementById('fps-val').textContent = presets[idx];
    var fp=document.getElementById('fps-prev'); if(fp) fp.style.opacity = idx === 0 ? '0.25' : '';
    var fn=document.getElementById('fps-next'); if(fn) fn.style.opacity = idx === presets.length - 1 ? '0.25' : '';
  }
  document.getElementById('fps-prev').addEventListener('click', function(){ setFps(idx - 1); });
  document.getElementById('fps-next').addEventListener('click', function(){ setFps(idx + 1); });
  setFps(idx);
  window._setFps = function(fps) {
    var i = presets.indexOf(fps);
    setFps(i >= 0 ? i : presets.length - 1);
  };
})();

window._setGradientLinesToggle = createToggle('toggle-gradientlines', 'gradientlines-label', 'gradientLines', function() {
  clearPresetHighlight();
});

window._setSnapshotToggle = createToggle('toggle-snapshot', 'snapshot-label', 'snapshot', function(on) {
  if (!on && !window._running) requestAnimationFrame(window._frameRef);
});

(function(){
  var TIPS = {
    domes:     'Controls how many dome distortions are active on the grid. More domes create a busier, more layered wave effect.',
    size:      'Scales all domes uniformly. Higher values make every dome\'s influence zone larger, producing broader grid distortions.',
    speed:     'Sets how fast all domes wander across the screen. Higher values make movement feel more restless and energetic.',
    force:     'Controls how strongly each dome bends the grid lines within its radius. Higher values produce sharper, more dramatic curves.',
    lerp:      'Controls how smoothly dome movement tracks its target path. Low values feel floaty and cinematic; high values feel snappy and direct.',
    cell:      'Sets the spacing between grid lines in pixels. Smaller values produce a fine, dense grid; larger values produce a coarser, open grid.',
    opacity:   'Controls how visible the grid lines are. Very low values create a subtle, ghostly effect; higher values make the grid bold and defined.',
    mousemode: 'Switches between Repel and Attract modes. Repel (on): domes push away from your cursor. Attract (off): domes drift toward your cursor.',
    autosize:  'When on, each dome\'s size automatically pulses in and out on its own rhythm, creating an organic breathing effect across the grid.',
    domesizes: 'Set the size of each dome individually. Each slider scales one dome relative to the Global Size setting.',
    bgcolor:   'Sets the background fill color of the entire wallpaper. Click the color swatch to open the color picker.',
    linecolor: 'Sets the color of the grid lines. Click the color swatch to open the color picker.',
    vignette:  'Cinematic edge darkening \u2014 grid lines fade to invisible at the corners while the center stays clear.',
    gradientlines: 'When on, subtle ripples emanate from each dome and brighten the grid lines as they pass through.',
    autocolor: 'When on, the grid line color cycles through dramatic random hue shifts every 15\u201345 seconds.',
    snapshot:  'Freezes the animation on the current frame \u2014 no movement, no CPU cost. Toggle off to resume.',
    fpslimit:  '\u2022 Eco (15) \u2014 minimal CPU use\n\u2022 Film (24) \u2014 cinematic feel\n\u2022 Standard (30) \u2014 balanced\n\u2022 Full (60) \u2014 default',
    perf:      'Performance settings \u2014 expand to control frame rate and freeze the animation on demand.',
    global:     'Dome count, size, speed, displacement, smoothness, and mouse interaction \u2014 everything that drives how the grid moves.',
    appearance: 'Expand to control grid density, line opacity, colors, and vignette \u2014 everything that affects how the grid looks.',
    presets:   'One-click visual themes. Each preset sets the color palette, grid density, dome count, and motion energy together.'
  };
  var tip = document.getElementById('tooltip');
  var hideTimer = null;
  function showTip(el, key) {
    clearTimeout(hideTimer);
    var text = TIPS[key];
    if (!text) return;
    tip.textContent = text;
    tip.classList.add('visible');
    var rect = el.getBoundingClientRect();
    var tipW = 210, tipH = tip.offsetHeight || 80, gap = 8;
    var top = rect.top - tipH - gap;
    if (top < 8) top = rect.bottom + gap;
    var left = rect.left - tipW + rect.width;
    if (left < 8) left = 8;
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
    tip.style.top  = top  + 'px';
    tip.style.left = left + 'px';
  }
  function hideTip() {
    hideTimer = setTimeout(function(){ tip.classList.remove('visible'); }, 120);
  }
  tip.addEventListener('mouseenter', function(){ clearTimeout(hideTimer); });
  tip.addEventListener('mouseleave', hideTip);
  document.addEventListener('mouseover', function(e){
    if (!e.target || !e.target.matches) return;
    var btn = e.target.matches('.info-btn') ? e.target : e.target.closest && e.target.closest('.info-btn');
    if (btn && btn.dataset && btn.dataset.tip) showTip(btn, btn.dataset.tip);
  });
  document.addEventListener('mouseout', function(e){
    if (!e.target || !e.target.matches) return;
    var btn = e.target.matches('.info-btn') ? e.target : e.target.closest && e.target.closest('.info-btn');
    if (btn) hideTip();
  });
})();
