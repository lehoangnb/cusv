const state = {
  fileA: null, // { name, u8, type, frames, extra }
  fileB: null,
  activeSlot: 'A',   // next drop / explicit load goes here
  currentView: 'A',  // which file is shown in single-file tabs
  lang: 'en',
};
function setLang(lang) {
  state.lang = lang;
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.innerHTML = t(el.dataset.i18n);
  });
  updateStatus();
  showFileInfo();
  renderSlotBar();
  renderCurrentView();
  readerUpdateSniffList();
  // Respect reader panel state
  var rp = document.getElementById('readerPanel');
  if (rp && !rp.classList.contains('hidden')) {
    var tabs = document.getElementById('tabs');
    var slotBar = document.getElementById('slotBar');
    var fileInfo = document.getElementById('fileInfo');
    tabs.classList.add('hidden');
    slotBar.classList.add('hidden');
    slotBar.style.display = 'none';
    fileInfo.classList.add('hidden');
    fileInfo.style.display = 'none';
    document.querySelector('.subtitle').classList.add('hidden');
    document.querySelector('.drop-zone').classList.add('hidden');
  }
  // Refresh reader panel language
  var rp = document.getElementById('readerPanel');
  if (rp && !rp.classList.contains('hidden')) {
    rp.querySelectorAll('[data-i18n-t]').forEach(function(el) {
      if (el.children.length === 0) el.textContent = t(el.dataset.i18nT);
    });
    rp.querySelectorAll('[data-i18n-p]').forEach(function(el) {
      el.placeholder = t(el.dataset.i18nP);
    });
  }
  if (typeof readerUltra === 'function') {
    var u2 = readerUltra();
    if (u2 && typeof u2.isConnected === 'function' && u2.isConnected()) {
      readerSetStatus(t('readerConnected'), true);
    }
  }
  // Update toggle button texts based on actual panel state
  var rp2 = document.getElementById('readerPanel');
  if (rp2) {
    var isOpen = !rp2.classList.contains('hidden');

  }
}

function slotData(slot) { return slot === 'A' ? state.fileA : state.fileB; }
function setSlot(slot, data) { slot === 'A' ? (state.fileA = data) : (state.fileB = data); }
function clearSlot(slot) { slot === 'A' ? (state.fileA = null) : (state.fileB = null); }
function bothLoaded() { return state.fileA && state.fileB; }
function slotCount() { return (state.fileA ? 1 : 0) + (state.fileB ? 1 : 0); }
function nextEmptySlot() { return state.fileA ? 'B' : 'A'; }
function bindTabSwitcher(tabBarEl, onActivate) {
  const tabs = tabBarEl.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabBarEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      onActivate(tab);
    });
  });
}

// ============================================================
//  Waveform helpers (shared between single LF + LF compare)
// ============================================================
function getViewRange(u8, zoomVal, autoFit) {
  let zoom = zoomVal / 100;
  let viewLen;
  if (autoFit) {
    viewLen = u8.length;
  } else {
    viewLen = Math.floor(u8.length / zoom);
  }
  viewLen = Math.max(viewLen, 1);
  viewLen = Math.min(viewLen, u8.length);
  const start = Math.max(0, u8.length - viewLen);
  const end = u8.length;
  return { start, end };
}

function valueRange(u8, start, end) {
  let yMin = 255, yMax = 0;
  for (let j = start; j < end; j++) { const v = u8[j]; if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
  return { yMin, yMax, yRange: Math.max(yMax - yMin, 1) };
}

// Draw a single waveform into a context, fitting within [offsetY, offsetY+drawH].
function drawWaveform(ctx, u8, color, fillStops, opts) {
  const { w, h, dpr, offsetY, drawH, zoomVal, autoFit, drawGrid, label } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, offsetY, w, drawH);

  if (u8.length === 0) return;

  const { start, end } = getViewRange(u8, zoomVal, autoFit);
  const { yMin, yMax, yRange } = valueRange(u8, start, end);
  const pad = 6;
  const innerH = drawH - pad * 2;
  const step = w / (end - start - 1 || 1);

  // Grid
  if (drawGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    for (let y = 0; y <= 4; y++) {
      const yy = offsetY + pad + (innerH / 4) * y;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    const centerY = offsetY + pad + innerH * 0.5;
    ctx.beginPath(); ctx.moveTo(0, centerY); ctx.lineTo(w, centerY); ctx.stroke();
  }

  // Points
  const pts = [];
  for (let j = start; j < end; j++) {
    const x = (j - start) * step;
    const norm = (u8[j] - yMin) / yRange;
    const y = offsetY + pad + innerH * (1 - norm);
    pts.push([x, y]);
  }

  // Fill under line
  if (fillStops && pts.length > 1) {
    const grad = ctx.createLinearGradient(0, offsetY, 0, offsetY + drawH);
    grad.addColorStop(0, fillStops[0]);
    grad.addColorStop(1, fillStops[1]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], offsetY + drawH);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1][0], offsetY + drawH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Line
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
    else ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();

  // Labels
  ctx.fillStyle = 'rgba(154,160,184,0.85)';
  ctx.font = '11px monospace';
  ctx.fillText(`max=${yMax} (0x${yMax.toString(16).padStart(2,'0')})`, 6, offsetY + 14);
  ctx.fillText(`min=${yMin} (0x${yMin.toString(16).padStart(2,'0')})`, 6, offsetY + drawH - 5);
  if (label) ctx.fillText(label, w - 130, offsetY + drawH - 5);
}

// ============================================================
//  UI: status pill + file info + slot bar
// ============================================================
function updateStatus() {
  const pill = document.getElementById('statusPill');
  const text = document.getElementById('statusText');
  const n = slotCount();
  if (n === 0) { pill.classList.remove('live'); text.textContent = t('noFileLoaded'); }
  else if (n === 1) { pill.classList.add('live'); text.textContent = t('oneFileLoaded'); }
  else { pill.classList.add('live'); text.textContent = t('twoFilesLoaded'); }
}

function showFileInfo() {
  const el = document.getElementById('fileInfo');
  const slots = [
    { label: 'A', data: state.fileA, cls: 'slot-a' },
    { label: 'B', data: state.fileB, cls: 'slot-b' },
  ];
  let html = '';
  for (const s of slots) {
    if (!s.data) {
      html += `<div class="info-block ${s.cls} info-empty" style="min-width:200px">
        <dt>${t('fileSlot', s.label)}</dt>
        <dd style="color:var(--text-dim);font-style:italic">${t('notLoaded')}</dd>
      </div>`;
      continue;
    }
    const d = s.data;
    const typeLabel = d.type === 'hf' ? t('hfType') : t('lfType');
    let extras = '';
    if (d.extra) {
      extras = Object.entries(d.extra)
        .map(([k, v]) => `<span class="info-extras">${k}: <strong>${v}</strong></span>`)
        .join('');
    }
    html += `<div class="info-block ${s.cls}" style="min-width:200px">
      <dt>${t('fileSlot', s.label)} <span class="info-fname">${d.name}</span></dt>
      <dd>${typeLabel} &middot; ${d.u8.length.toLocaleString()} bytes${extras}</dd>
    </div>`;
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
  el.style.display = 'flex';
}

function renderSlotBar() {
  const el = document.getElementById('slotBar');
  const slots = [
    { label: 'A', data: state.fileA, cls: 'slot-a' },
    { label: 'B', data: state.fileB, cls: 'slot-b' },
  ];
  let html = '';
  for (const s of slots) {
    if (s.data) {
      const status = s.data.type === 'hf'
        ? t('slotStatusFrames', s.data.frames.length)
        : t('slotStatus', s.data.u8.length);
      html += `<div class="slot-pill${state.currentView === s.label ? ' active' : ''}" data-slot="${s.label}">
        <span class="slot-badge ${s.cls}">${s.label}</span>
        <span class="slot-fname">${s.data.name}</span>
        <span class="slot-status">${status}</span>
      </div>`;
    } else {
      html += `<div class="slot-load-btn" data-load="${s.label}">${t('loadFileBtn', s.label)}</div>`;
    }
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
  el.style.display = 'flex';

  el.querySelectorAll('.slot-pill').forEach(p => p.addEventListener('click', () => switchView(p.dataset.slot)));
  el.querySelectorAll('.slot-load-btn').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    loadFileSlot(b.dataset.load);
  }));
  document.getElementById('readerFileBtn')?.classList.remove('hidden');
  readerUpdateSniffList();
}

function loadFileSlot(slot) {
  state.activeSlot = slot;
  document.getElementById('fileInputB').click();
}

function switchView(slot) {
  state.currentView = slot;
  renderSlotBar();
  renderCurrentView();
  readerUpdateSniffList();
  // Respect reader panel state
  var rp = document.getElementById('readerPanel');
  if (rp && !rp.classList.contains('hidden')) {
    var tabs = document.getElementById('tabs');
    var slotBar = document.getElementById('slotBar');
    var fileInfo = document.getElementById('fileInfo');
    tabs.classList.add('hidden');
    slotBar.classList.add('hidden');
    slotBar.style.display = 'none';
    fileInfo.classList.add('hidden');
    fileInfo.style.display = 'none';
    document.querySelector('.subtitle').classList.add('hidden');
    document.querySelector('.drop-zone').classList.add('hidden');
  }
  // Refresh reader panel language
  var rp = document.getElementById('readerPanel');
  if (rp && !rp.classList.contains('hidden')) {
    rp.querySelectorAll('[data-i18n-t]').forEach(function(el) {
      if (el.children.length === 0) el.textContent = t(el.dataset.i18nT);
    });
    rp.querySelectorAll('[data-i18n-p]').forEach(function(el) {
      el.placeholder = t(el.dataset.i18nP);
    });
  }
  if (typeof readerUltra === 'function') {
    var u2 = readerUltra();
    if (u2 && typeof u2.isConnected === 'function' && u2.isConnected()) {
      readerSetStatus(t('readerConnected'), true);
    }
  }
  // Update toggle button texts based on actual panel state
  var rp2 = document.getElementById('readerPanel');
  if (rp2) {
    var isOpen = !rp2.classList.contains('hidden');

  }
}

// ============================================================
//  Render: Frames table
// ============================================================
function buildFrameTable(container, frames, detailPrefix) {
  if (frames.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x1F50D;</div>' + t('noFrames') + '</div>';
    return;
  }
  let html = `<table class="frame-table">
    <thead><tr>
      <th>#</th><th>${t('colDir')}</th><th>${t('colType')}</th><th>${t('colBits')}</th><th>${t('colBytes')}</th><th>${t('colDataHex')}</th><th>${t('colAscii')}</th><th></th>
    </tr></thead><tbody>`;
  for (const f of frames) {
    const dirClass = f.isTx ? 'dir-tx' : 'dir-rx';
    const dirLabel = f.isTx ? t('dirTagToReader') : t('dirReaderToTag');
    const hexStr = buildHexStr(f);
    const asciiStr = Array.from(f.data).map(toAscii).join('');
    const typeClass = 'frame-' + f.frameType.toLowerCase().replace(/[^a-z0-9]/g, '');
    const desc = describeFrame(f);
    const did = detailPrefix + '-' + f.index;
    const hexSend = Array.from(f.data).map(b => b.toString(16).padStart(2,'0')).join(' ');
    html += `<tr class="frame-row" data-idx="${f.index}" data-detail="${did}">
      <td>${f.index}</td>
      <td><span class="${dirClass}">${dirLabel}</span></td>
      <td class="${typeClass}">${f.frameType}</td>
      <td>${f.szBits}</td>
      <td>${f.data.length}</td>
      <td class="hex-bytes"><span class="byte-val">${hexStr}</span></td>
      <td class="ascii-col">${asciiStr}</td>
      <td>${!f.isTx ? `<button class="frame-send-btn" data-hex="${hexSend}" title="Replay via Reader">▶</button>` : ''}</td>
    </tr>
    <tr class="detail-row hidden" id="${did}">
      <td colspan="8">
        <div class="detail-card">
          <div class="detail-title">${desc.title}</div>
          <div class="detail-body">${desc.detail}</div>
        </div>
      </td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
  container.querySelectorAll('.frame-row').forEach(row => {
    row.addEventListener('click', () => {
      const did = row.dataset.detail;
      const detailRow = document.getElementById(did);
      if (detailRow) detailRow.classList.toggle('hidden');
    });
  });
  container.querySelectorAll('.frame-send-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const hex = btn.dataset.hex;
      if (hex && typeof readerParseAndSend === 'function') {
        if (document.getElementById('readerPanel').classList.contains('hidden'))
          readerTogglePanel();
        document.getElementById('readerCmdInput').value = hex;
        readerParseAndSend(hex);
      }
    });
  });
}

// ============================================================
//  Render: Messages (chat-style) view
//    withDesc: include the italic description block (used in single view)
// ============================================================
function renderMessages(frames, withDesc) {
  if (frames.length === 0) {
    return '<div class="empty-state"><div class="empty-state-icon">&#x1F4AC;</div>' + t('noMessages') + '</div>';
  }
  let phase = '';
  let html = '<div class="messages-container">';
  for (const f of frames) {
    const newPhase = phaseForFrameType(f.frameType);
    if (newPhase && newPhase !== phase) {
      phase = newPhase;
      html += `<div class="msg-divider"><span>${phase}</span></div>`;
    }
    const isTag = f.isTx;
    const side = isTag ? 'tag' : 'reader';
    const senderLabel = isTag ? t('senderTag') : t('senderReader');
    const avatar = isTag ? '&#x1F4F6;' : '&#x1F4E1;';
    const hexStr = buildHexStr(f);
    const asciiStr = Array.from(f.data).map(toAscii).join('');
    const desc = withDesc ? describeFrame(f) : null;
    const msgTypeClass = 'frame-' + f.frameType.toLowerCase().replace(/[^a-z0-9]/g, '');
    html += `<div class="message ${side}">
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-bubble">
        <div class="msg-header">
          <span class="msg-sender">${senderLabel}</span>
          <span class="msg-type ${msgTypeClass}">${f.frameType}</span>
          <span class="msg-number">${withDesc ? t('msgNumber', f.index, f.szBits) : '#' + f.index}</span>
        </div>
        <div class="msg-hex">${hexStr}</div>
        <div class="msg-ascii">${asciiStr}</div>
        ${desc ? `<div class="msg-desc">${desc.detail}</div>` : ''}
      </div>
    </div>`;
  }
  html += '</div>';
  return html;
}

// ============================================================
//  Render: LF single waveform into a container
// ============================================================
function renderSingleLF(u8, containerId, slotLabel) {
  const container = document.getElementById(containerId);
  container.innerHTML = `<div class="waveform-container">
    <canvas id="wf-${containerId}"></canvas>
  </div>
  <div class="waveform-controls">
    <label>${t('zoom')} <input type="range" id="zoom-${containerId}" min="1" max="200" value="100"></label>
    <label class="spacer"><input type="checkbox" id="fit-${containerId}" checked> ${t('autoFit')}</label>
  </div>
  <div class="waveform-stats" id="stats-${containerId}"></div>`;

  const canvas = document.getElementById('wf-' + containerId);
  const ctx = canvas.getContext('2d');
  const zoomSlider = document.getElementById('zoom-' + containerId);
  const autoFitCheck = document.getElementById('fit-' + containerId);

  function draw() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    drawWaveform(ctx, u8, '#7c9cff',
      ['rgba(124,156,255,0.28)', 'rgba(124,156,255,0)'],
      { w, h, dpr, offsetY: 0, drawH: h, zoomVal: parseInt(zoomSlider.value), autoFit: autoFitCheck.checked,
        drawGrid: true, label: `${getViewRange(u8, parseInt(zoomSlider.value), autoFitCheck.checked).end - getViewRange(u8, parseInt(zoomSlider.value), autoFitCheck.checked).start} ${t('samples')}` });

    const { start, end } = getViewRange(u8, parseInt(zoomSlider.value), autoFitCheck.checked);
    // stats
    const { yMin, yMax } = valueRange(u8, start, end);
    const viewSamples = end - start;
    const totalMs = (u8.length * 8 / 1000).toFixed(1);
    const viewMs = ((end - start) * 8 / 1000).toFixed(1);
    const yMinHex = yMin.toString(16).padStart(2,'0');
    const yMaxHex = yMax.toString(16).padStart(2,'0');
    document.getElementById('stats-' + containerId).textContent =
      t('fileTotal', slotLabel || '', u8.length) + ' | ' +
      t('viewSamples', viewSamples) + ' | ' +
      t('range', yMinHex, yMaxHex) + ' | ' +
      t('freq') + ' | ' +
      t('duration', viewMs, totalMs);
  }

  zoomSlider.addEventListener('input', draw);
  autoFitCheck.addEventListener('change', () => { if (autoFitCheck.checked) draw(); });
  window.addEventListener('resize', draw);
  requestAnimationFrame(draw);
}

// ============================================================
//  Render: HF Compare (frames + messages side by side)
// ============================================================
function renderHFCompare(containerId) {
  const container = document.getElementById(containerId);
  const framesA = state.fileA.frames;
  const framesB = state.fileB.frames;
  const diffMap = computeFrameDiff(framesA, framesB);
  const diffCount = Object.keys(diffMap).length;

  container.innerHTML = `
    <div class="compare-toolbar">
      <div class="tab-bar">
        <div class="tab active" data-cmp-tab="frames">${t('frames')}</div>
        <div class="tab" data-cmp-tab="messages">${t('messages')}</div>
      </div>
      ${diffCount > 0
        ? `<span class="diff-count">${t('diffCountPlural', diffCount)}</span>`
        : `<span class="diff-identical">${t('identicalStructure')}</span>`}
    </div>
    <div id="cmp-frames" class="compare-layout"></div>
    <div id="cmp-messages" class="compare-msgs hidden"></div>
  `;

  document.getElementById('cmp-frames').innerHTML =
    buildCompareTable('A', framesA, diffMap, 'ca') +
    buildCompareTable('B', framesB, diffMap, 'cb');

  document.getElementById('cmp-messages').innerHTML =
    `<div class="compare-col"><div class="col-header"><span class="col-badge ca">A</span><span class="col-name">${escapeHtml(state.fileA.name)}</span></div>${renderMessages(framesA, false)}</div>` +
    `<div class="compare-col"><div class="col-header"><span class="col-badge cb">B</span><span class="col-name">${escapeHtml(state.fileB.name)}</span></div>${renderMessages(framesB, false)}</div>`;

  // Sync scroll on frames
  const scrolls = document.getElementById('cmp-frames').querySelectorAll('.compare-sync-scroll');
  if (scrolls.length === 2) {
    let lock = false;
    const sync = (src, dst) => { if (lock) return; lock = true; dst.scrollTop = src.scrollTop; dst.scrollLeft = src.scrollLeft; lock = false; };
    scrolls[0].addEventListener('scroll', () => sync(scrolls[0], scrolls[1]));
    scrolls[1].addEventListener('scroll', () => sync(scrolls[1], scrolls[0]));
  }

  // Compare sub-tab switcher
  const subBar = container.querySelector('.tab-bar');
  bindTabSwitcher(subBar, (tab) => {
    const which = tab.dataset.cmpTab;
    document.getElementById('cmp-frames').classList.toggle('hidden', which !== 'frames');
    document.getElementById('cmp-messages').classList.toggle('hidden', which !== 'messages');
  });
}

function buildCompareTable(label, frames, diffMap, badgeCls) {
  const file = label === 'A' ? state.fileA : state.fileB;
  let html = `<div class="compare-col">
    <div class="col-header"><span class="col-badge ${badgeCls}">${label}</span><span class="col-name">${escapeHtml(file.name)}</span></div>
    <div class="compare-sync-scroll">
    <table class="frame-table">
      <thead><tr><th>#</th><th>${t('colDir')}</th><th>${t('colType')}</th><th>${t('colDataHex')}</th></tr></thead><tbody>`;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f) {
      html += `<tr><td>${i}</td><td colspan="3" style="color:var(--text-dim);opacity:0.5">—</td></tr>`;
      continue;
    }
    const diffKey = label + '_' + i;
    const isDiff = diffMap[diffKey];
    const dirClass = f.isTx ? 'dir-tx' : 'dir-rx';
    const dirLabel = f.isTx ? t('dirTagToReader') : t('dirReaderToTag');
    const hexStr = buildHexStr(f);
    const typeClass = 'frame-' + f.frameType.toLowerCase().replace(/[^a-z0-9]/g, '');
    html += `<tr class="${isDiff ? 'frame-diff' : ''}">
      <td>${f.index}</td>
      <td><span class="${dirClass}">${dirLabel}</span></td>
      <td class="${typeClass}">${f.frameType}</td>
      <td class="hex-bytes"><span class="byte-val">${hexStr}</span></td>
    </tr>`;
  }
  html += `</tbody></table></div></div>`;
  return html;
}

// ============================================================
//  Render: LF Compare (overlaid / stacked waveform)
// ============================================================
function renderLFCompare(containerId) {
  const container = document.getElementById(containerId);
  const u8a = state.fileA.u8;
  const u8b = state.fileB.u8;
  container.innerHTML = `<div class="compare-toolbar">
    <span class="compare-legend"><span class="swatch" style="background:var(--accent)"></span> ${t('fileALabel')}</span>
    <span class="compare-legend"><span class="swatch" style="background:var(--green)"></span> ${t('fileBLabel')}</span>
    <label class="ml-auto">${t('zoom')} <input type="range" id="cmp-zoom" min="1" max="200" value="100" style="width:120px;accent-color:var(--accent)"></label>
    <label><input type="checkbox" id="cmp-fit" checked> ${t('autoFit')}</label>
    <label><input type="checkbox" id="cmp-stacked"> ${t('stacked')}</label>
  </div>
  <div class="waveform-compare" id="cmp-wave-box">
    <canvas id="cmp-canvas-a"></canvas>
    <canvas id="cmp-canvas-b" class="hidden"></canvas>
  </div>
  <div class="waveform-stats" id="cmp-stats"></div>`;

  const box = document.getElementById('cmp-wave-box');
  const canvasA = document.getElementById('cmp-canvas-a');
  const canvasB = document.getElementById('cmp-canvas-b');
  const zoomSlider = document.getElementById('cmp-zoom');
  const fitCheck = document.getElementById('cmp-fit');
  const stackedCheck = document.getElementById('cmp-stacked');

  function draw() {
    const rect = box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const fullH = rect.height;

    const stacked = stackedCheck.checked;
    const halfH = Math.floor(fullH / 2);
    const aH = stacked ? halfH : fullH;
    const bH = stacked ? halfH : fullH;

    canvasA.width = w * dpr; canvasA.height = aH * dpr;
    canvasA.style.width = w + 'px'; canvasA.style.height = aH + 'px';
    canvasB.width = w * dpr; canvasB.height = bH * dpr;
    canvasB.style.width = w + 'px'; canvasB.style.height = bH + 'px';
    canvasB.classList.toggle('hidden', !stacked);
    canvasB.style.top = stacked ? halfH + 'px' : '0px';

    const ctxA = canvasA.getContext('2d');
    const ctxB = canvasB.getContext('2d');
    const zoomVal = parseInt(zoomSlider.value);
    const autoFit = fitCheck.checked;

    if (stacked) {
      drawWaveform(ctxA, u8a, '#7c9cff',
        ['rgba(124,156,255,0.28)', 'rgba(124,156,255,0)'],
        { w, h: aH, dpr, offsetY: 0, drawH: aH, zoomVal, autoFit, drawGrid: true, label: t('fileALabel') });
      drawWaveform(ctxB, u8b, '#4ade80',
        ['rgba(74,222,128,0.26)', 'rgba(74,222,128,0)'],
        { w, h: bH, dpr, offsetY: 0, drawH: bH, zoomVal, autoFit, drawGrid: true, label: t('fileBLabel') });
    } else {
      // Overlay: draw A then B onto the same canvas
      ctxA.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxA.clearRect(0, 0, w, fullH);
      // light grid
      ctxA.strokeStyle = 'rgba(255,255,255,0.04)'; ctxA.lineWidth = 0.5;
      for (let y = 0; y <= 4; y++) { const yy = 6 + ((fullH - 12) / 4) * y; ctxA.beginPath(); ctxA.moveTo(0, yy); ctxA.lineTo(w, yy); ctxA.stroke(); }
      const overlay = (u8, color, fill, labelAtBottom) => {
        if (u8.length === 0) return;
        const { start, end } = getViewRange(u8, zoomVal, autoFit);
        const { yMin, yMax, yRange } = valueRange(u8, start, end);
        const pad = 6, innerH = fullH - pad * 2;
        const step = w / (end - start - 1 || 1);
        const pts = [];
        for (let j = start; j < end; j++) {
          const x = (j - start) * step;
          const norm = (u8[j] - yMin) / yRange;
          pts.push([x, pad + innerH * (1 - norm)]);
        }
        // fill
        if (pts.length > 1) {
          const grad = ctxA.createLinearGradient(0, 0, 0, fullH);
          grad.addColorStop(0, fill[0]); grad.addColorStop(1, fill[1]);
          ctxA.beginPath(); ctxA.moveTo(pts[0][0], fullH);
          for (const [x, y] of pts) ctxA.lineTo(x, y);
          ctxA.lineTo(pts[pts.length - 1][0], fullH); ctxA.closePath();
          ctxA.fillStyle = grad; ctxA.fill();
        }
        ctxA.beginPath(); ctxA.strokeStyle = color; ctxA.lineWidth = 1.1;
        for (let i = 0; i < pts.length; i++) i === 0 ? ctxA.moveTo(pts[i][0], pts[i][1]) : ctxA.lineTo(pts[i][0], pts[i][1]);
        ctxA.stroke();
        ctxA.fillStyle = 'rgba(154,160,184,0.85)'; ctxA.font = '11px monospace';
        ctxA.fillText(labelAtBottom ? t('fileBLabel') : t('fileALabel'), 6, labelAtBottom ? fullH - 5 : 14);
      };
      overlay(u8a, 'rgba(124,156,255,0.85)', ['rgba(124,156,255,0.16)', 'rgba(124,156,255,0)'], false);
      overlay(u8b, 'rgba(74,222,128,0.85)', ['rgba(74,222,128,0.14)', 'rgba(74,222,128,0)'], true);
    }

    const viewLabel = stacked ? t('stackedView') : t('overlaidView');
    document.getElementById('cmp-stats').textContent =
      t('fileALabel') + ': ' + u8a.length + ' ' + t('samples') + ' | ' +
      t('fileBLabel') + ': ' + u8b.length + ' ' + t('samples') + ' | ' + viewLabel;
  }

  zoomSlider.addEventListener('input', draw);
  fitCheck.addEventListener('change', draw);
  stackedCheck.addEventListener('change', draw);
  window.addEventListener('resize', draw);
  requestAnimationFrame(draw);
}

// ============================================================
//  Main orchestrator: decide tab set based on loaded files
// ============================================================
function renderCurrentView() {
  const data = slotData(state.currentView);
  if (!data) {
    document.getElementById('tabs').classList.add('hidden');
    return;
  }
  const tabsEl = document.getElementById('tabs');
  tabsEl.classList.remove('hidden');
  tabsEl.style.display = 'block';

  const bothHF = state.fileA && state.fileB && state.fileA.type === 'hf' && state.fileB.type === 'hf';
  const bothLF = state.fileA && state.fileB && state.fileA.type === 'lf' && state.fileB.type === 'lf';
  const canCompare = bothHF || bothLF;

  const tabBar = document.getElementById('tabBar');
  const panels = document.getElementById('panels');

  if (canCompare) {
    tabBar.innerHTML = `
      <div class="tab active" data-panel="single">${t('fileSlot', state.currentView)}</div>
      <div class="tab" data-panel="compare">${t('compare')}</div>`;
    panels.innerHTML = `
      <div class="panel active" id="panel-single"></div>
      <div class="panel" id="panel-compare"></div>`;

    if (data.type === 'hf') renderSingleHFInto('panel-single', data.frames);
    else renderSingleLF(data.u8, 'panel-single', state.currentView);

    if (bothHF) renderHFCompare('panel-compare');
    else if (bothLF) renderLFCompare('panel-compare');

    bindTabSwitcher(tabBar, (tab) => {
      const panelId = 'panel-' + tab.dataset.panel;
      panels.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.getElementById(panelId).classList.add('active');
    });
  } else {
    if (data.type === 'hf') {
      tabBar.innerHTML = `
        <div class="tab active" data-panel="frames">${t('frames')}</div>
        <div class="tab" data-panel="messages">${t('messages')}</div>`;
      panels.innerHTML = `
        <div class="panel active" id="panel-frames"></div>
        <div class="panel" id="panel-messages"></div>`;
      renderSingleHFInto('panel-frames', data.frames, { messagesInto: 'panel-messages' });
      bindTabSwitcher(tabBar, (tab) => {
        const panelId = 'panel-' + tab.dataset.panel;
        panels.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById(panelId).classList.add('active');
      });
    } else {
      tabBar.innerHTML = '<div class="tab active" data-panel="waveform">' + t('waveform') + '</div>';
      panels.innerHTML = `<div class="panel active" id="panel-waveform"></div>`;
      renderSingleLF(data.u8, 'panel-waveform', state.currentView);
    }
  }
}

// Render the HF single-file content. If opts.messagesInto is given, render
// the messages view into that container too; otherwise build internal sub-tabs.
function renderSingleHFInto(containerId, frames, opts) {
  const container = document.getElementById(containerId);
  if (opts && opts.messagesInto) {
    buildFrameTable(container, frames, 'detail');
    document.getElementById(opts.messagesInto).innerHTML = renderMessages(frames, true);
    return;
  }
  // Sub-tab layout (used inside compare's "single" panel)
  const uid = 's' + Math.random().toString(36).slice(2, 9);
  container.innerHTML = `
    <div class="tab-bar" id="stb-${uid}">
      <div class="tab active" data-sp="frames-${uid}">${t('frames')}</div>
      <div class="tab" data-sp="messages-${uid}">${t('messages')}</div>
    </div>
    <div class="panel active" id="frames-${uid}"></div>
    <div class="panel" id="messages-${uid}"></div>`;
  buildFrameTable(document.getElementById('frames-' + uid), frames, 'detail-' + uid);
  document.getElementById('messages-' + uid).innerHTML = renderMessages(frames, true);
  bindTabSwitcher(document.getElementById('stb-' + uid), (tab) => {
    container.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(tab.dataset.sp).classList.add('active');
  });
}

// ============================================================
//  Small util
// ============================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// ============================================================
//  Process & render file into a slot
// ============================================================
function processFile(file, slot) {
  hideError();
  slot = slot || nextEmptySlot();

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const u8 = new Uint8Array(e.target.result);
      if (u8.length === 0) throw new Error(t('errorEmpty'));
      const type = detectFileType(u8);
      let frames = null;
      let extra = null;
      if (type === 'hf') {
        frames = parseHFSniff(u8);
        extra = { [t('extraFrames')]: frames.length };
      } else {
        extra = { [t('extraSamples')]: u8.length, [t('extraDuration')]: `${(u8.length * 8 / 1000).toFixed(1)} ms` };
      }
      setSlot(slot, { name: file.name, u8, type, frames, extra });
      state.currentView = slot;
      renderSlotBar();
      showFileInfo();
      renderCurrentView();
      updateStatus();
    } catch (err) {
      showError(t('errorPrefix') + err.message);
    }
  };
  reader.onerror = function() { showError(t('errorReading')); };
  reader.readAsArrayBuffer(file);
}

function showError(msg) {
  const el = document.getElementById('errorBox');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.display = 'block';
}
function hideError() {
  const el = document.getElementById('errorBox');
  el.classList.add('hidden');
  el.style.display = 'none';
}
// ============================================================
//  Drag & drop + click wiring
// ============================================================
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInputB = document.getElementById('fileInputB');

dropZone.addEventListener('click', (e) => {
  if (e.target.closest('.slot-load-btn')) return;
  if (slotCount() >= 2) { loadFileSlot('A'); return; }
  fileInput.click();
});
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length === 0) return;
  if (files.length >= 2) {
    processFile(files[0], 'A');
    setTimeout(() => processFile(files[1], 'B'), 50);
  } else {
    processFile(files[0], nextEmptySlot() || 'A');
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    const files = fileInput.files;
    if (files.length >= 2) {
      processFile(files[0], 'A');
      setTimeout(() => processFile(files[1], 'B'), 50);
    } else {
      processFile(files[0], nextEmptySlot() || 'A');
    }
    fileInput.value = '';
  }
});

fileInputB.addEventListener('change', () => {
  if (fileInputB.files.length > 0) {
    processFile(fileInputB.files[0], state.activeSlot);
    fileInputB.value = '';
  }
});

document.getElementById('langBtnEn').addEventListener('click', () => setLang('en'));
document.getElementById('langBtnVi').addEventListener('click', () => setLang('vi'));
setLang(state.lang);
