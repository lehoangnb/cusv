// ============================================================
//  Reader — ChameleonUltra via SDK (taichunmin/chameleon-ultra.js)
// ============================================================
let ultraBle, ultraSerial, readerLogs = [], readerLastSentHex = null;

function readerInit() {
  if (typeof ChameleonUltraJS === 'undefined') {
    // SDK not loaded yet
    setTimeout(readerInit, 500);
    return;
  }
  const { ChameleonUltra, Debug, WebbleAdapter, WebserialAdapter } = ChameleonUltraJS;
  ultraSerial = new ChameleonUltra();
  ultraSerial.use(new Debug());
  ultraSerial.use(new WebserialAdapter());
  ultraBle = new ChameleonUltra();
  ultraBle.use(new Debug());
  ultraBle.use(new WebbleAdapter());
}

function readerUltra() {
  return document.querySelector('input[name="connType"]:checked').value === 'serial' ? ultraSerial : ultraBle;
}

function readerBuf(bytes) {
  // SDK uses @taichunmin/buffer, not native Uint8Array
  const B = ChameleonUltraJS.Buffer;
  if (bytes instanceof B) return bytes;
  if (bytes.buffer) return B.fromView(bytes);
  return B.from(bytes);
}

function readerLog(dir, dataOrMsg, desc) {
  const t = new Date();
  const ts = t.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(t.getMilliseconds()).padStart(3, '0');
  let hex = '', ascii = '';
  if (dataOrMsg && typeof dataOrMsg === 'object' && dataOrMsg.buffer) {
    const u = new Uint8Array(dataOrMsg.byteLength || dataOrMsg.length);
    try { u.set(typeof dataOrMsg === 'string' ? new TextEncoder().encode(dataOrMsg) : new Uint8Array(dataOrMsg.buffer || dataOrMsg)); } catch {}
    hex = Array.from(u).map(b => b.toString(16).padStart(2, '0')).join(' ');
    ascii = Array.from(u).map(b => b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.').join('');
  } else if (typeof dataOrMsg === 'string') {
    hex = dataOrMsg;
  }
  readerLogs.push({ dir, ts, hex, ascii, desc: desc || '' });
  readerRenderLog();
}

function readerRenderLog() {
  const wrap = document.getElementById('readerLogWrap');
  const empty = document.getElementById('readerLogEmpty');
  if (!wrap) return;
  if (!readerLogs.length) { empty.classList.remove('hidden'); wrap.classList.add('hidden'); return; }
  empty.classList.add('hidden'); wrap.classList.remove('hidden');
  wrap.innerHTML = readerLogs.map(e =>
    `<div class="reader-log-entry ${e.dir}">
      <span class="reader-log-dir">${e.dir === 'tx' ? 'TX' : e.dir === 'rx' ? 'RX' : 'INF'}</span>
      <span class="reader-log-time">${e.ts}</span>
      <span class="reader-log-data">${e.dir === 'inf' ? e.hex : escapeHtml(e.hex)}</span>
      ${e.ascii ? `<span class="reader-log-ascii">${escapeHtml(e.ascii)}</span>` : ''}
      ${e.desc ? `<span class="reader-log-desc">${e.dir === 'inf' ? e.desc : escapeHtml(e.desc)}</span>` : ''}
    </div>`
  ).join('');
  wrap.scrollTop = wrap.scrollHeight;
}

function readerSetStatus(text, connected) {
  document.getElementById('readerStatusText').textContent = text;
  document.querySelector('#readerStatus .dot').classList.toggle('connected', connected);
}

function readerUpdateSniffList() {
  var nameEl = document.getElementById('readerSniffName');
  var countEl = document.getElementById('readerFrameCount');
  var body = document.getElementById('readerChatBody');
  var empty = document.getElementById('readerChatEmpty');
  var data = slotData(state.currentView);
  if (!data || data.type !== 'hf' || !data.frames) {
    if (nameEl) nameEl.textContent = '---';
    if (countEl) countEl.textContent = '';
    if (body) body.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (nameEl) nameEl.textContent = data.name;
  if (empty) empty.classList.add('hidden');

  var cmds = data.frames.filter(function(f) { return !f.isTx; });
  if (countEl) countEl.textContent = '(' + cmds.length + ' reader cmds)';

  var html = '';
  for (var i = 0; i < cmds.length; i++) {
    var f = cmds[i];
    var hexStr = Array.from(f.data).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(' ');
    var asciiStr = Array.from(f.data).map(function(b) { return b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.'; }).join('');
    var desc = describeFrame(f);
    var msgTypeClass = 'frame-' + f.frameType.toLowerCase().replace(/[^a-z0-9]/g, '');
    html += '<div class="message reader" data-hex="' + hexStr + '" data-idx="' + f.index + '">'
      + '<div class="msg-avatar">&#x1F4E1;</div>'
      + '<div class="msg-bubble">'
      + '<div class="msg-header">'
      + '<span class="msg-sender">Reader</span>'
      + '<span class="msg-type ' + msgTypeClass + '">' + f.frameType + '</span>'
      + '<span class="msg-number">#' + f.index + '</span>'
      + '</div>'
      + '<div class="msg-hex">' + hexStr + '</div>'
      + '<div class="msg-ascii">' + escapeHtml(asciiStr) + '</div>'
      + '<div class="msg-desc">' + escapeHtml(desc.title + ' — ' + desc.detail) + '</div>'
      + '</div>'
      + '</div>';
  }
  if (!html) { body.innerHTML = '<div class="reader-chat-empty">No reader commands</div>'; return; }
  body.innerHTML = html;

  body.querySelectorAll('.message.reader').forEach(function(el) {
    el.addEventListener('click', function() {
      body.querySelectorAll('.message').forEach(function(x) { x.classList.remove('active'); });
      this.classList.add('active');
      var hex = this.dataset.hex;
      var idx = parseInt(this.dataset.idx);
      document.getElementById('readerCmdInput').value = hex;
      readerParseAndSend(hex);
      readerShowRef(idx, hex);
    });
  });
}
function readerShowRef(cmdIdx, cmdHex) {
  var refBody = document.getElementById('readerRefBody');
  var refCount = document.getElementById('readerRefCount');
  var data = slotData(state.currentView);
  if (!data || !data.frames) return;
  // Find the first tag response after this cmd
  var refMsg = null;
  for (var i = cmdIdx + 1; i < data.frames.length; i++) {
    if (data.frames[i].isTx) { refMsg = data.frames[i]; break; }
  }
  if (!refMsg) {
    refBody.innerHTML = '<div class="reader-chat-empty" style="padding:8px">No sniff response for this command</div>';
    refCount.textContent = '(0)';
    return;
  }
  var hexStr = Array.from(refMsg.data).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(' ');
  var asciiStr = Array.from(refMsg.data).map(function(b) { return b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.'; }).join('');
  var desc = describeFrame(refMsg);
  var msgTypeClass = 'frame-' + refMsg.frameType.toLowerCase().replace(/[^a-z0-9]/g, '');
  refBody.innerHTML = '<div class="message tag" data-hex="' + hexStr + '">'
    + '<div class="msg-avatar">&#x1F4F6;</div>'
    + '<div class="msg-bubble">'
    + '<div class="msg-header"><span class="msg-sender">Tag</span>'
    + '<span class="msg-type ' + msgTypeClass + '">' + refMsg.frameType + '</span>'
    + '<span class="msg-number">#' + refMsg.index + '</span></div>'
    + '<div class="msg-hex">' + hexStr + '</div>'
    + '<div class="msg-ascii">' + escapeHtml(asciiStr) + '</div>'
    + '<div class="msg-desc">' + escapeHtml(desc.title + ' — ' + desc.detail) + '</div>'
    + '</div>'
    + '</div>';
  refCount.textContent = '(1)';
}
async function readerScanAll() {
  var ultra = readerUltra();
  if (!ultra.isConnected()) {
    readerLog('inf', 'Auto-connecting...');
    await readerConnect();
    await new Promise(function(r) { setTimeout(r, 200); });
    ultra = readerUltra();
    if (!ultra.isConnected()) { readerLog('inf', 'Not connected'); return; }
  }
  var btns = document.querySelectorAll('.reader-scan-btn');
  btns.forEach(function(b) { b.disabled = true; });
  readerClearReal();
  try {
    // 1. Try HF scan first
    var tags = null;
    try { tags = await ultra.cmdHf14aScan(); } catch(e) {}
    if (tags && tags.length) {
      var tag = tags[0];
      var uidHex = Array.from(tag.uid).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(' ');
      var info = 'UID: ' + uidHex;
      // SAK + card type
      if (tag.sak) {
        info += ' SAK:0x' + tag.sak[0].toString(16).padStart(2, '0');
        var sakKey = 'sakKnown' + tag.sak[0].toString(16).padStart(2, '0');
        var sakName = window.t(sakKey);
        if (sakName !== sakKey) info += ' <span style="color:var(--accent)">(' + sakName + ')</span>';
      }
      if (tag.atqa) info += ' ATQA:' + Array.from(tag.atqa).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

      // ===== Phase 2: Basic magic mode checks =====
      var isGen1a = false, isGen2 = false, isNtagMagic = false, isMf = false;
      try { isMf = await ultra.cmdMf1IsSupport(); } catch(e) {}
      try { isGen1a = await ultra.cmdMf1GetGen1aMode(); } catch(e) {}
      try { isGen2 = await ultra.cmdMf1GetGen2Mode(); } catch(e) {}
      try { isNtagMagic = await ultra.cmdMf0NtagGetUidMagicMode(); } catch(e) {}

      var badges = [];
      if (isMf) badges.push('MIFARE:yes'); else badges.push('MIFARE:no');
      if (isGen1a) badges.push('<span style="color:var(--orange)">🔓 Gen1A</span>');
      if (isGen2) badges.push('<span style="color:var(--orange)">🔓 Gen2</span>');
      if (isNtagMagic) badges.push('<span style="color:var(--orange)">NTAG_magic</span>');
      info += ' ' + badges.join(' ');

      // ===== Phase 3: Active backdoor probes =====
      var wakeupType = '';      // gen1a | alt | gdm
      var configBytes = null;   // 16-byte config if readable
      var isUFUID = false, isFUID = false, isZUID = false, isGDM = false, isSealed = false;
      var hasSigSector = false, hasStaticNonce = false, hasShadowMode = false;
      var configSAK = null;

      // Probe Gen1A wakeup (40→43→E000 read config)
      if (isGen1a) {
        try {
          await ultra.cmdHf14aRaw({ data: cloneHexToBuf('40'), dataBitLength: 7, activateRfField: true, keepRfField: true, timeout: 2000, autoSelect: false });
          await new Promise(function(r) { setTimeout(r, 60); });
          await ultra.cmdHf14aRaw({ data: cloneHexToBuf('43'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
          // Try read config
          try {
            var cfgResp = await ultra.cmdHf14aRaw({ data: cloneHexToBuf('E000'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
            if (cfgResp && cfgResp.length >= 16) {
              configBytes = new Uint8Array(cfgResp.slice(0, 16));
              wakeupType = 'gen1a';
            }
          } catch(e) { /* config not readable */ }
        } catch(e) { /* wakeup failed */ }
      }

      // Probe Alt wakeup (20→23→E000) if Gen1A didn't work
      if (!wakeupType) {
        try {
          await ultra.cmdHf14aRaw({ data: cloneHexToBuf('20'), dataBitLength: 7, activateRfField: true, keepRfField: true, timeout: 2000, autoSelect: false });
          await new Promise(function(r) { setTimeout(r, 60); });
          await ultra.cmdHf14aRaw({ data: cloneHexToBuf('23'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
          try {
            var cfgResp2 = await ultra.cmdHf14aRaw({ data: cloneHexToBuf('E000'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
            if (cfgResp2 && cfgResp2.length >= 16) {
              configBytes = new Uint8Array(cfgResp2.slice(0, 16));
              wakeupType = 'alt';
            }
          } catch(e) { /* config not readable via alt */ }
        } catch(e) { /* alt wakeup failed */ }
      }

      // Probe Magic Auth (80 after SELECT) for GDM
      if (!wakeupType && isMf) {
        try {
          await ultra.cmdHf14aRaw({ data: cloneHexToBuf('80'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
          // If we get here without error, magic auth works
          wakeupType = 'gdm';
        } catch(e) { /* magic auth failed */ }
      }

      // ===== Phase 4: Parse config bytes =====
      if (configBytes && configBytes.length >= 16) {
        var c0 = configBytes[0], c1 = configBytes[1];
        var cw = (c0 << 8) | c1;
        // 0x8500 = GDM/USCUID mode (Gen1A disabled by bitflip)
        // 0x7AFF = FUID/UFUID/ZUID variant
        if (cw === 0x8500) {
          isGDM = true;
          var wakeupCmd = configBytes[2];
          var cuidMode = configBytes[7] === 0x5A;
          var ev1Mode = configBytes[9];
          hasShadowMode = configBytes[10] === 0x5A;
          var magicAuth = configBytes[11] === 0x5A;
          hasStaticNonce = configBytes[12] === 0x5A;
          hasSigSector = configBytes[13] === 0x5A;
          configSAK = configBytes[15];

          info += ' <span style="color:#c084fc">[GDM/USCUID]</span>';
          if (cuidMode) info += ' <span style="color:var(--green)">+CUID</span>';
          if (magicAuth) info += ' <span style="color:var(--accent)">+MagicAuth</span>';
          if (hasShadowMode) info += ' <span style="color:var(--orange)">+Shadow</span>';
          if (hasStaticNonce) info += ' <span style="color:var(--red)">+StaticNonce</span>';
          if (hasSigSector) info += ' <span style="color:var(--blue)">+SigSector</span>';
          if (configSAK && configSAK !== 0x08) info += ' SAK_conf:0x' + configSAK.toString(16).padStart(2, '0');
          if (wakeupCmd === 0x85) info += ' AltWake:20→23';
          else info += ' AltWake:40→43';
        } else if (cw === 0x7AFF) {
          // FUID/UFUID/ZUID family
          var configByte2 = configBytes[2];
          var configByte7 = configBytes[7]; // CUID mode
          var configByte11 = configBytes[11]; // magic auth
          var configByte15 = configBytes[15]; // SAK

          if (wakeupType === 'alt') {
            if (configByte7 === 0x5A) { isFUID = true; info += ' <span style="color:#c084fc">[FUID]</span>'; }
            else { info += ' <span style="color:#c084fc">[USCUID/Alt]</span>'; }
          } else {
            if (configByte2 === 0x00 && configByte7 === 0x00) { isZUID = true; info += ' <span style="color:#c084fc">[ZUID]</span>'; }
            else if (configByte2 === 0x00) { isUFUID = true; info += ' <span style="color:#c084fc">[UFUID]</span>'; }
            else { info += ' <span style="color:#c084fc">[USCUID/Gen1A]</span>'; }
          }
          if (configByte11 === 0x5A) info += ' <span style="color:var(--accent)">+MagicAuth</span>';
          if (configSAK) configSAK = configBytes[15];
          if (configSAK && configSAK !== 0x08) info += ' SAK_conf:0x' + configSAK.toString(16).padStart(2, '0');
        }
        // Check if sealed: config byte0=0x85 with GDM mode means Gen1A disabled
        if (c0 === 0x85 && !isGen1a) isSealed = true;
      }

      // ===== Phase 5: Gen3 APDU probe =====
      if (!wakeupType && !isGen1a && !isGen2 && isMf) {
        try {
          await ultra.cmdHf14aRaw({ data: cloneHexToBuf('90FBCCCC07' + uidHex.replace(/ /g, '')), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
          info += ' <span style="color:#c084fc">[Gen3 APDU]</span>';
          wakeupType = 'gen3';
        } catch(e) { /* not Gen3 */ }
      }

      // ===== Phase 6: Seal status =====
      if (isUFUID) info += ' <span style="color:var(--orange)">⚠ Sealable</span>';
      if (isZUID) info += ' <span style="color:var(--text-dim)">(ZUID, Gen1A always on)</span>';
      if (isFUID) info += ' <span style="color:var(--text-dim)">(FUID, auto-seals on write)</span>';
      if (isSealed) info += ' <span style="color:var(--red)">🔒 SEALED</span>';
      if (wakeupType && !isSealed && !isFUID && !isZUID) info += ' <span style="color:var(--green)">🔓 Unsealed</span>';

      // ===== Phase 7: Read block 0 =====
      try {
        var block0 = null;
        try { block0 = await ultra.cmdMf1ReadBlock(0); } catch(e) {}
        if (!block0) {
          var defaultKeys = ['FFFFFFFFFFFF', 'A0A1A2A3A4A5', 'D3F7D3F7D3F7'];
          var keyBufs = defaultKeys.map(function(k) {
            var b = new Uint8Array(6);
            for (var j = 0; j < 6; j++) b[j] = parseInt(k.substr(j*2, 2), 16);
            return readerBuf(b);
          });
          try { var result = await ultra.mf1ReadSectorByKeys(0, keyBufs); if (result && result.data) block0 = result.data.slice(0, 16); } catch(e2) {}
        }
        if (block0 && block0.length) {
          // Parse block0: uid4 + BCC + SAK + ATQA + mfr
          var b0UID = Array.from(block0.slice(0, 4)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(' ');
          var b0BCC = block0[4];
          var b0SAK = block0[5];
          var b0ATQA = (block0[6] << 8) | block0[7];
          var b0Mfr = Array.from(block0.slice(8, 16)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(' ');

          info += ' Block0:' + b0UID + '...';

          // UID mismatch detection
          if (tag.uid && block0[0] !== tag.uid[0]) {
            info += ' <span style="color:var(--orange)">⚠ UID_mismatch→magic</span>';
          }
          // SAK comparison (anticoll vs block0)
          if (tag.sak && b0SAK !== tag.sak[0]) {
            var sakFromBlock = b0SAK;
            var sakKey2 = 'sakKnown' + sakFromBlock.toString(16).padStart(2, '0');
            var sakName2 = window.t(sakKey2);
            if (sakName2 !== sakKey2) info += ' <span style="color:var(--accent)">SAK_block0→' + sakName2 + '</span>';
            else info += ' <span style="color:var(--accent)">SAK_block0:0x' + sakFromBlock.toString(16) + '</span>';
          }
          // ATQA comparison
          if (tag.atqa) {
            var atqaOrig = (tag.atqa[0] << 8) | tag.atqa[1];
            if (b0ATQA !== atqaOrig) {
              info += ' <span style="color:var(--accent)">ATQA_block0:0x' + b0ATQA.toString(16).padStart(4,'0') + '</span>';
            }
          }
          // MFR data
          if (b0Mfr !== '00 00 00 00 00 00 00 00') {
            info += ' Mfr:' + b0Mfr;
          }
        } else { info += ' <span style="color:var(--text-faint)">Block0:locked</span>'; }
      } catch(e) { info += ' <span style="color:var(--text-faint)">Block0:nonMIFARE</span>'; }

      readerAddRealResponse(tag.uid, info);
    } else {
      readerLog('inf', 'No HF tag - trying LF...');
      // 2. Try LF scans
      try {
        var em = await ultra.cmdEm410xScan();
        if (em && em.length) { readerLog('inf', 'EM410x tag found'); readerAddRealResponse(em[0].uid, 'EM410x UID'); btns.forEach(function(b) { b.disabled = false; }); return; }
      } catch(e) {}
      try {
        var hp = await ultra.cmdHidProxScan();
        if (hp && hp.length) { readerLog('inf', 'HID Prox tag found'); readerAddRealResponse(hp[0].uid, 'HID Prox UID'); btns.forEach(function(b) { b.disabled = false; }); return; }
      } catch(e) {}
      try {
        var vk = await ultra.cmdVikingScan();
        if (vk && vk.length) { readerLog('inf', 'Viking tag found'); readerAddRealResponse(vk[0].uid, 'Viking UID'); btns.forEach(function(b) { b.disabled = false; }); return; }
      } catch(e) {}
      readerLog('inf', 'No tag found on any frequency');
    }
  } catch(err) {
    readerLog('inf', 'Scan error: ' + err.message);
  }
  btns.forEach(function(b) { b.disabled = false; });
}

async function readerScan(type) {
  var ultra = readerUltra();
  if (!ultra.isConnected()) { readerLog('inf', 'Not connected'); return; }
  var btns = document.querySelectorAll('.reader-scan-btn');
  btns.forEach(function(b) { b.disabled = true; });
  try {
    var result;
    switch(type) {
      case 'hf': result = await ultra.cmdHf14aScan(); break;
      case 'em410x': result = await ultra.cmdEm410xScan(); break;
      case 'hidprox': result = await ultra.cmdHidProxScan(); break;
      case 'viking': result = await ultra.cmdVikingScan(); break;
    }
    if (result && result.length) {
      readerLog('inf', type + ' scan: found ' + result.length + ' tag(s)');
      for (var i = 0; i < result.length; i++) {
        var r = result[i];
        var hex = Array.from(r.uid).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(' ');
        var extra = '';
        if (r.sak) {
          var sakVal = r.sak[0];
          var proto = (sakVal & 0x20) ? 'ISO 14443-4 (T=CL)' : 'ISO 14443-3';
          var uidSize = (sakVal & 0x04) ? 'UID 7B' : 'UID 4B';
          extra = proto + ' ' + uidSize;
        }
        if (r.atqa) extra += ' ATQA:' + Array.from(r.atqa).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
        if (r.ats) extra += ' ATS:' + Array.from(r.ats).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
        readerAddRealResponse(r.uid, type.toUpperCase() + ' ' + (extra || 'UID: ' + hex));
        if (r.rawData) readerAddRealResponse(r.rawData, 'raw response');
      }
    } else {
      readerLog('inf', type + ' scan: no tag found');
    }
  } catch(err) {
    readerLog('inf', type + ' scan error: ' + err.message);
  }
  btns.forEach(function(b) { b.disabled = false; });
}

// ============================================================
//  Clone & Seal — MIFARE Classic tag cloning
// ============================================================
const CLONE_DEFAULT_KEYS = [
  'FFFFFFFFFFFF','A0A1A2A3A4A5','D3F7D3F7D3F7','000000000000',
  'B0B1B2B3B4B5','AABBCCDDEEFF','A1B2C3D4E5F6',
];
const MF1_BLOCKS = 64, MF1_SECTORS = 16;

const cloneState = { uid: null, sak: null, atqa: null, type: null, blocks: [], keys: [], scanned: false };

function cloneHexToBuf(h) {
  var b = new Uint8Array(h.length / 2);
  for (var i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
  return readerBuf(b);
}

function cloneStatus(msg) { var e = document.getElementById('readerCloneStatus'); if (e) e.textContent = msg || ''; }

function readerRenderCloneGrid() {
  var grid = document.getElementById('readerCloneGrid');
  if (!grid) return;
  var s = cloneState;
  var html = '';
  for (var b = 0; b < MF1_BLOCKS; b++) {
    var cls = 'reader-clone-block';
    var title = 'Block ' + b;
    var label = b < 10 ? '0' + b : '' + b;
    var data = s.blocks[b];
    if (data) {
      if (b === 0) { cls += ' ok sector0'; title += ' (Manufacturer Block)'; }
      else if (b % 4 === 3) { cls += ' trailer'; title += ' (Sector Trailer)'; }
      else { cls += ' ok'; }
    } else {
      cls += ' locked';
      title += ' (Locked / No Auth)';
    }
    var hex = data ? Array.from(data).map(function(x) { return x.toString(16).padStart(2,'0'); }).join(' ') : '—';
    html += '<div class="' + cls + '" title="' + title + '\n' + hex + '" data-block="' + b + '">' + label + '</div>';
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.reader-clone-block').forEach(function(el) {
    el.addEventListener('click', function() {
      var bn = parseInt(this.dataset.block);
      var blk = s.blocks[bn];
      var dump = document.getElementById('readerCloneDump');
      var pre = dump.querySelector('pre');
      if (blk) {
        var h = Array.from(blk).map(function(x) { return x.toString(16).padStart(2,'0'); }).join(' ');
        pre.textContent = 'Block ' + bn + ': ' + h;
        dump.style.display = 'block';
      } else {
        pre.textContent = 'Block ' + bn + ': LOCKED';
        dump.style.display = 'block';
      }
    });
  });
}

function readerUpdateCloneBtns() {
  var slotBtn = document.getElementById('readerCloneSlotBtn');
  var tagBtn = document.getElementById('readerCloneTagBtn');
  var sealBtn = document.getElementById('readerSealBtn');
  if (!slotBtn) return;
  var ok = cloneState.scanned && cloneState.blocks[0];
  slotBtn.disabled = !ok;
  tagBtn.disabled = !ok;
  sealBtn.disabled = !cloneState.scanned || (cloneState.type !== 'gen1a' && cloneState.type !== 'alt');
}

async function readerReadAllBlocks() {
  var ultra = readerUltra();
  if (!ultra || !ultra.isConnected()) {
    cloneStatus(t('cloneNotConnected'));
    return;
  }
  var btns = document.getElementById('readerCloneReadBtn');
  if (btns) btns.disabled = true;
  cloneStatus('Scanning for tag...');
  readerLog('inf', 'Clone: scanning HF tag...');

  // 1. Scan
  var tags;
  try { tags = await ultra.cmdHf14aScan(); } catch(e) { cloneStatus(t('cloneScanFailed')); readerLog('inf', 'Clone: scan error: ' + e.message); if (btns) btns.disabled = false; return; }
  if (!tags || !tags.length) { cloneStatus(t('cloneNoTag')); readerLog('inf', 'Clone: no tag found'); if (btns) btns.disabled = false; return; }

  var tag = tags[0];
  cloneState.uid = tag.uid;
  cloneState.sak = tag.sak;
  cloneState.atqa = tag.atqa;
  cloneState.blocks = [];
  cloneState.keys = [];
  cloneState.scanned = false;
  cloneState.type = null;

  var uidHex = Array.from(tag.uid).map(function(b) { return b.toString(16).padStart(2,'0'); }).join(' ');
  readerLog('inf', 'Clone: found tag UID=' + uidHex);

  // 2. Detect card type
  var isGen1a = false, isGen2 = false;
  try { isGen1a = await ultra.cmdMf1GetGen1aMode(); } catch(e) {}
  try { isGen2 = await ultra.cmdMf1GetGen2Mode(); } catch(e) {}
  var isMagic = isGen1a || isGen2;

  if (isMagic) {
    cloneState.type = isGen1a ? 'gen1a' : 'gen2';
    cloneStatus('Magic card (Gen' + (isGen1a ? '1a' : '2') + '). Reading via backdoor...');
    readerLog('inf', 'Clone: magic card detected — ' + cloneState.type + ', using backdoor reads');

    // Wakeup sequence — try Gen1A first, then Alt
    var woken = false;
    try {
      await ultra.cmdHf14aRaw({ data: cloneHexToBuf('40'), dataBitLength: 7, activateRfField: true, keepRfField: true, timeout: 2000, autoSelect: false });
      await new Promise(function(r) { setTimeout(r, 80); });
      await ultra.cmdHf14aRaw({ data: cloneHexToBuf('43'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
      woken = true;
    } catch(e) { /* ignore */ }

    if (!woken) {
      try {
        await ultra.cmdHf14aRaw({ data: cloneHexToBuf('20'), dataBitLength: 7, activateRfField: true, keepRfField: true, timeout: 2000, autoSelect: false });
        await new Promise(function(r) { setTimeout(r, 80); });
        await ultra.cmdHf14aRaw({ data: cloneHexToBuf('23'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
        woken = true;
        cloneState.type = 'alt';
      } catch(e) { /* ignore */ }
    }

    if (!woken) { cloneStatus('Magic wakeup failed'); if (btns) btns.disabled = false; return; }

    // Read all blocks via backdoor
    for (var b = 0; b < MF1_BLOCKS; b++) {
      try {
        var blockHex = b.toString(16).padStart(2, '0');
        var resp = await ultra.cmdHf14aRaw({ data: cloneHexToBuf('30' + blockHex), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
        if (resp && resp.length >= 16) {
          cloneState.blocks[b] = new Uint8Array(resp.slice(0, 16));
          cloneState.keys[b] = 'magic';
        }
      } catch(e) { /* block locked */ }
      if (b % 8 === 0) cloneStatus('Reading magic blocks... ' + b + '/' + MF1_BLOCKS);
    }
  } else {
    cloneState.type = 'normal';
    cloneStatus('Standard MIFARE. Trying default keys per sector...');
    readerLog('inf', 'Clone: normal card, trying ' + CLONE_DEFAULT_KEYS.length + ' default keys');

    // Try each sector with default keys
    for (var s = 0; s < MF1_SECTORS; s++) {
      var firstBlock = s * 4;
      var sectorRead = false;
      for (var ki = 0; ki < CLONE_DEFAULT_KEYS.length; ki++) {
        try {
          var keyBuf = cloneHexToBuf(CLONE_DEFAULT_KEYS[ki]);
          var result = await ultra.mf1ReadSectorByKeys(s, [keyBuf]);
          if (result && result.data && result.data.length >= 64) {
            for (var i = 0; i < 4; i++) {
              cloneState.blocks[firstBlock + i] = result.data.slice(i * 16, i * 16 + 16);
              cloneState.keys[firstBlock + i] = CLONE_DEFAULT_KEYS[ki];
            }
            sectorRead = true;
            break;
          }
        } catch(e) { /* try next key */ }
      }
      if (!sectorRead) readerLog('inf', 'Clone: sector ' + s + ' locked (no known key)');
      cloneStatus('Reading sectors... ' + (s + 1) + '/' + MF1_SECTORS + (sectorRead ? '' : ' (locked)'));
    }
  }

  cloneState.scanned = true;
  var readCount = cloneState.blocks.filter(function(b) { return b; }).length;
  cloneStatus(t('cloneDone', readCount, MF1_BLOCKS));
  readerRenderCloneGrid();
  readerUpdateCloneBtns();
  if (btns) btns.disabled = false;

  readerAddRealResponse(tag.uid, '📖 Tag UID: ' + uidHex + ' | ' + readCount + '/' + MF1_BLOCKS + ' blocks | ' + cloneState.type);
}

async function readerCloneToSlot() {
  var ultra = readerUltra();
  if (!ultra || !ultra.isConnected()) { cloneStatus(t('cloneNotConnected')); return; }
  if (!cloneState.scanned || !cloneState.blocks[0]) { cloneStatus(t('cloneReadFirst')); return; }

  var slotBtn = document.getElementById('readerCloneSlotBtn');
  var tagBtn = document.getElementById('readerCloneTagBtn');
  var readBtn = document.getElementById('readerCloneReadBtn');
  var sealBtn = document.getElementById('readerSealBtn');
  function disableBtns(v) { if(slotBtn)slotBtn.disabled=v; if(tagBtn)tagBtn.disabled=v; if(readBtn)readBtn.disabled=v; if(sealBtn)sealBtn.disabled=v; }
  disableBtns(true);

  // Confirm
  var readCount = cloneState.blocks.filter(function(b){return b;}).length;
  var uidHex = cloneState.uid ? Array.from(cloneState.uid).map(function(b){return b.toString(16).padStart(2,'0');}).join(' ') : '?';
  if (!confirm('Write to ChameleonUltra Slot\n\nSource UID: ' + uidHex + '\nBlocks: ' + readCount + '/' + MF1_BLOCKS + '\nSlot: emulator mode\n\nProceed?')) {
    cloneStatus('Slot write cancelled');
    disableBtns(false);
    return;
  }

  var writeCount = 0;
  try {
    // Note: the SDK may expose cmdMf1WriteEmuBlockData or a different API.
    // Fall back to raw backdoor writes if the SDK method isn't available.
    for (var b = 0; b < MF1_BLOCKS; b++) {
      var data = cloneState.blocks[b];
      if (!data) continue;
      try {
        if (typeof ultra.cmdMf1WriteEmuBlockData === 'function') {
          await ultra.cmdMf1WriteEmuBlockData(b, readerBuf(data));
        } else {
          // Fallback: write via raw command on a magic card in field
          var blockHex = b.toString(16).padStart(2, '0');
          var rawData = readerBuf(new Uint8Array([0xA0, b].concat(Array.from(data))));
          await ultra.cmdHf14aRaw({ data: rawData, activateRfField: b === 0, keepRfField: true, timeout: 2000, autoSelect: false });
        }
        writeCount++;
      } catch(e) { /* block write failed */ }
      if (b % 8 === 0) cloneStatus('Writing to slot... ' + b + '/' + MF1_BLOCKS + ' (' + writeCount + ' written)');
    }
    cloneStatus('Written ' + writeCount + '/' + MF1_BLOCKS + ' blocks to slot');
    readerLog('inf', 'Clone: wrote ' + writeCount + ' blocks to emulator slot');
  } catch(e) {
    cloneStatus('Write error: ' + e.message);
    readerLog('inf', 'Clone: slot write error: ' + e.message);
  }
  disableBtns(false);
}

async function readerCloneToTag() {
  var ultra = readerUltra();
  if (!ultra || !ultra.isConnected()) { cloneStatus(t('cloneNotConnected')); return; }
  if (!cloneState.scanned || !cloneState.blocks[0]) { cloneStatus(t('cloneReadFirst')); return; }

  var slotBtn = document.getElementById('readerCloneSlotBtn');
  var tagBtn = document.getElementById('readerCloneTagBtn');
  var readBtn = document.getElementById('readerCloneReadBtn');
  var sealBtn = document.getElementById('readerSealBtn');
  function disableBtns(v) { if(slotBtn)slotBtn.disabled=v; if(tagBtn)tagBtn.disabled=v; if(readBtn)readBtn.disabled=v; if(sealBtn)sealBtn.disabled=v; }
  disableBtns(true);

  // 1. Detect target tag type
  cloneStatus('Place target magic card on reader...');
  readerLog('inf', 'Clone: scanning target tag...');

  var tags;
  try { tags = await ultra.cmdHf14aScan(); } catch(e) { cloneStatus(t('cloneScanFailed')); readerLog('inf', 'Clone: scan error: ' + e.message); disableBtns(false); return; }
  if (!tags || !tags.length) { cloneStatus(t('cloneNoTag')); readerLog('inf', 'Clone: no tag on reader'); disableBtns(false); return; }

  var tag = tags[0];
  var uidHex = Array.from(tag.uid).map(function(b) { return b.toString(16).padStart(2,'0'); }).join(' ');

  // Detect magic type
  var magicType = 'unknown';
  try { // Gen1A wakeup
    await ultra.cmdHf14aRaw({ data: cloneHexToBuf('40'), dataBitLength: 7, activateRfField: true, keepRfField: true, timeout: 2000, autoSelect: false });
    await new Promise(function(r) { setTimeout(r, 80); });
    await ultra.cmdHf14aRaw({ data: cloneHexToBuf('43'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
    magicType = 'Gen1A / UFUID / ZUID';
  } catch(e) {
    try { // Alt wakeup (FUID/USCUID)
      await ultra.cmdHf14aRaw({ data: cloneHexToBuf('20'), dataBitLength: 7, activateRfField: true, keepRfField: true, timeout: 2000, autoSelect: false });
      await new Promise(function(r) { setTimeout(r, 80); });
      await ultra.cmdHf14aRaw({ data: cloneHexToBuf('23'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
      magicType = 'USCUID / FUID (Alt wakeup)';
    } catch(e2) {
      var isGen2 = false;
      try { isGen2 = await ultra.cmdMf1GetGen2Mode(); } catch(e3) {}
      if (isGen2) magicType = 'Gen2 / CUID (direct write)';
    }
  }

  if (magicType === 'unknown') {
    cloneStatus('No magic card detected. Place a writable magic card.');
    readerLog('inf', 'Clone: no magic tag detected');
    disableBtns(false);
    return;
  }

  // 2. Confirm
  var readCount = cloneState.blocks.filter(function(b) { return b; }).length;
  var msg = 'Clone to Magic Tag\n\n' +
    'Target UID: ' + uidHex + '\n' +
    'Magic type: ' + magicType + '\n' +
    'Source blocks: ' + readCount + '/' + MF1_BLOCKS + '\n\n' +
    '⚠ This will overwrite the target tag.\n' +
    'Proceed with clone?';
  if (!confirm(msg)) { cloneStatus('Clone cancelled'); disableBtns(false); return; }

  // 3. Write — already woke up, just write blocks
  cloneStatus('Writing blocks...');
  readerLog('inf', 'Clone: writing to ' + magicType + ' tag UID=' + uidHex);

  var writeCount = 0;
  if (magicType === 'Gen2 / CUID (direct write)') {
    // Gen2: direct write to block 0 via standard write
    for (var b = 0; b < MF1_BLOCKS; b++) {
      var data = cloneState.blocks[b];
      if (!data) continue;
      try {
        if (typeof ultra.cmdMf1WriteOneBlock === 'function') {
          await ultra.cmdMf1WriteOneBlock(b, readerBuf(data));
        } else {
          var rawData = new Uint8Array(2 + 16);
          rawData[0] = 0xA0; rawData[1] = b;
          rawData.set(data, 2);
          await ultra.cmdHf14aRaw({ data: readerBuf(rawData), activateRfField: false, keepRfField: true, timeout: 3000, autoSelect: false });
        }
        writeCount++;
      } catch(e) {}
      if (b % 8 === 0) cloneStatus(t('cloneWriting', b, MF1_BLOCKS, writeCount));
    }
  } else {
    // Already woken via Gen1A or Alt — use backdoor A0 writes
    for (var b2 = 0; b2 < MF1_BLOCKS; b2++) {
      var d2 = cloneState.blocks[b2];
      if (!d2) continue;
      try {
        var rawData = new Uint8Array(2 + 16);
        rawData[0] = 0xA0; rawData[1] = b2;
        rawData.set(d2, 2);
        await ultra.cmdHf14aRaw({ data: readerBuf(rawData), activateRfField: false, keepRfField: true, timeout: 3000, autoSelect: false });
        writeCount++;
      } catch(e) {}
      if (b2 % 8 === 0) cloneStatus(t('cloneWriting', b2, MF1_BLOCKS, writeCount));
    }
  }
  cloneStatus(t('cloneWritten', writeCount, MF1_BLOCKS));
  readerLog('inf', 'Clone: wrote ' + writeCount + ' blocks to ' + magicType + ' tag');
  disableBtns(false);
}

async function readerSeal() {
  var ultra = readerUltra();
  if (!ultra || !ultra.isConnected()) { cloneStatus(t('cloneNotConnected')); return; }

  var sealBtn = document.getElementById('readerSealBtn');
  var slotBtn = document.getElementById('readerCloneSlotBtn');
  var tagBtn = document.getElementById('readerCloneTagBtn');
  var readBtn = document.getElementById('readerCloneReadBtn');
  function disableBtns(v) { if(sealBtn)sealBtn.disabled=v; if(slotBtn)slotBtn.disabled=v; if(tagBtn)tagBtn.disabled=v; if(readBtn)readBtn.disabled=v; }
  disableBtns(true);

  // 1. Detect tag type
  cloneStatus('Place magic card on reader...');
  readerLog('inf', 'Seal: scanning for magic card...');

  var tags;
  try { tags = await ultra.cmdHf14aScan(); } catch(e) { cloneStatus(t('cloneScanFailed')); readerLog('inf', 'Seal: scan error'); disableBtns(false); return; }
  if (!tags || !tags.length) { cloneStatus(t('cloneNoTag')); readerLog('inf', 'Seal: no tag found'); disableBtns(false); return; }

  var tag = tags[0];
  var uidHex = Array.from(tag.uid).map(function(b) { return b.toString(16).padStart(2,'0'); }).join(' ');

  // 2. Detect magic type
  var magicType = 'none';
  try { // Try Alt wakeup first (FUID detection)
    await ultra.cmdHf14aRaw({ data: cloneHexToBuf('20'), dataBitLength: 7, activateRfField: true, keepRfField: true, timeout: 2000, autoSelect: false });
    await new Promise(function(r) { setTimeout(r, 80); });
    await ultra.cmdHf14aRaw({ data: cloneHexToBuf('23'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
    magicType = 'alt';
  } catch(e) { /* try Gen1A */ }

  if (magicType === 'alt') {
    alert('⚠ FUID Tag Detected\n\nUID: ' + uidHex + '\nWakeup: Alt (20→23)\n\nFUID auto-seals after the first write to block 0. Manual sealing is not needed. If the tag has already been written, it may already be sealed.');
    readerLog('inf', 'Seal: FUID detected — manual seal not needed (auto-seals on first write)');
    cloneStatus('FUID — manual seal not needed');
    disableBtns(false);
    return;
  }

  if (magicType === 'none') {
    try { // Try Gen1A wakeup (UFUID)
      await ultra.cmdHf14aRaw({ data: cloneHexToBuf('40'), dataBitLength: 7, activateRfField: true, keepRfField: true, timeout: 2000, autoSelect: false });
      await new Promise(function(r) { setTimeout(r, 80); });
      await ultra.cmdHf14aRaw({ data: cloneHexToBuf('43'), activateRfField: false, keepRfField: true, timeout: 2000, autoSelect: false });
      magicType = 'gen1a';
    } catch(e) {
      // Try Gen2
      var isGen2 = false;
      try { isGen2 = await ultra.cmdMf1GetGen2Mode(); } catch(e2) {}
      if (isGen2) magicType = 'gen2';
    }
  }

  if (magicType === 'gen2') {
    alert('⚠ Gen2/CUID Tag Detected\n\nUID: ' + uidHex + '\n\nGen2/CUID tags use direct write to block 0. They do not have a sealable backdoor. No seal needed.');
    readerLog('inf', 'Seal: Gen2 detected — no backdoor to seal');
    cloneStatus('Gen2/CUID — no seal needed');
    disableBtns(false);
    return;
  }

  if (magicType === 'none') {
    alert('⚠ No Magic Card Detected\n\nNo magic wakeup (40 or 20) succeeded. This tag may be a normal MIFARE Classic or unresponsive. Seal only works on UFUID/ZUID magic cards.');
    readerLog('inf', 'Seal: no magic card detected');
    cloneStatus('No magic card detected');
    disableBtns(false);
    return;
  }

  // 3. Confirm seal
  var confirmed = confirm(
    '🔒 Seal UFUID Magic Tag\n\n' +
    'UID: ' + uidHex + '\n' +
    'Wakeup: Gen1A (40→43)\n\n' +
    '⚠ WARNING: This will permanently disable the Gen1A backdoor.\n' +
    'The tag will become a normal MIFARE Classic card.\n' +
    'This CANNOT be undone.\n\n' +
    'Proceed with seal?'
  );
  if (!confirmed) { cloneStatus('Seal cancelled'); disableBtns(false); return; }

  // 4. Write seal config
  cloneStatus('Sealing...');
  readerLog('inf', 'Seal: writing seal config to UFUID UID=' + uidHex);

  try {
    // Write seal config: 85000000000000000000000000000008
    var sealData = new Uint8Array(18);
    sealData[0] = 0xE1; sealData[1] = 0x00;
    var config = [0x85,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x08];
    for (var i = 0; i < 16; i++) sealData[i + 2] = config[i];

    await ultra.cmdHf14aRaw({ data: readerBuf(sealData), activateRfField: false, keepRfField: true, timeout: 3000, autoSelect: false });
    cloneStatus(t('cloneSealed'));
    readerLog('inf', 'Seal: config written — backdoor permanently disabled');
  } catch(e) {
    cloneStatus(t('cloneSealFailed', e.message));
    readerLog('inf', 'Seal: write error: ' + e.message);
  }

  disableBtns(false);
}

function readerClearReal() { var b = document.getElementById("readerRealBody"); if(b) { b.innerHTML = '<div class="reader-chat-empty" style="padding:12px">' + t('readerNoResp') + '</div>'; var cnt = document.getElementById("readerRespCount"); if(cnt) cnt.textContent = ""; } }

function readerAddRealResponse(data, desc, afterHex) {
  var body = document.getElementById('readerRealBody');
  if (!body) return;
  var empty = body.querySelector('.reader-chat-empty');
  if (empty) empty.style.display = 'none';
  var hexStr = Array.from(data).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(' ');
  var asciiStr = Array.from(data).map(function(b) { return b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.'; }).join('');
  var frameType = desc && desc.indexOf('SCAN') >= 0 ? 'SCAN' : 'RESP';
  var frameDesc = desc || '';
  if (!desc) try {
    frameType = detectFrameType(data, true, null);
    if (frameType === 'S-BLOCK' && data.length <= 6 && data.length >= 4) frameType = 'UID';
    var d = describeFrame({ frameType: frameType, data: data, isTx: true });
    frameDesc = d.title + ' — ' + d.detail;
  } catch(e) {}
  var ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  var el = document.createElement('div');
  el.className = 'message tag';
  el.innerHTML = '<div class="msg-avatar">&#x1F4F6;</div>'
    + '<div class="msg-bubble">'
    + '<div class="msg-header"><span class="msg-sender">Tag</span>'
    + '<span class="msg-type frame-' + frameType.toLowerCase().replace(/[^a-z0-9]/g, '') + '">' + frameType + '</span>'
    + '<span class="msg-number">' + ts + '</span></div>'
    + '<div class="msg-hex">' + hexStr + '</div>'
    + '<div class="msg-ascii">' + escapeHtml(asciiStr) + '</div>'
    + '<div class="msg-desc">' + (desc && desc.indexOf('<span') >= 0 ? frameDesc : escapeHtml(frameDesc)) + '</div>'
    + '</div>';
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
}

function readerTogglePanel() {
  const panel = document.getElementById('readerPanel');
  panel.classList.toggle('hidden');
  const nowOpen = !panel.classList.contains('hidden');
  document.querySelectorAll('.reader-toggle-btn').forEach(function(b) { b.classList.toggle('active', nowOpen); });
  var tt = document.getElementById('readerToggleText');
  if (tt) tt.textContent = nowOpen ? 'Close' : 'Reader';
  var hasFile = state.fileA || state.fileB;
  if (nowOpen) {
    // Reader opened → hide main UI unconditionally
    document.getElementById('tabs').classList.add('hidden');
    document.getElementById('slotBar').classList.add('hidden');
    document.getElementById('fileInfo').classList.add('hidden');
    document.querySelector('.subtitle').classList.add('hidden');
    document.querySelector('.drop-zone').classList.add('hidden');
  } else {
    // Reader closed → restore main UI
    document.querySelector('.subtitle').classList.remove('hidden');
    document.querySelector('.drop-zone').classList.remove('hidden');
    document.querySelector('.subtitle').style.display = '';
    document.querySelector('.drop-zone').style.display = '';
    if (hasFile) {
      document.getElementById('tabs').style.display = 'block';
      document.getElementById('slotBar').style.display = 'flex';
      document.getElementById('fileInfo').style.display = 'flex';
      document.getElementById('tabs').classList.remove('hidden');
      document.getElementById('slotBar').classList.remove('hidden');
      document.getElementById('fileInfo').classList.remove('hidden');
    }
  }
  document.getElementById('errorBox').classList.add('hidden');
  if (!panel.classList.contains('hidden')) {
    panel.querySelectorAll('[data-i18n-t]').forEach(function(el) { el.innerHTML = t(el.dataset.i18nT); });
    readerUpdateCloneBtns();
  }
}

async function readerConnect() {
  const ultra = readerUltra();
  try {
    ultra.emitter.on('error', err => {
      readerLog('inf', `ERR: ${err.message}`);
    });
    ultra.emitter.on('debug', (ns, ...args) => {
      if (ns === 'webserial' || ns === 'webble') {
        args.forEach(a => {
          if (typeof a === 'string' && a.length < 200) readerLog('inf', a);
        });
      }
    });
    await ultra.connect();
    readerSetStatus('Connected', true);
    readerLog('inf', 'Connected to ChameleonUltra');
    document.getElementById('readerConnectBtn').classList.add('hidden');
    document.getElementById('readerDisconnectBtn').classList.remove('hidden');
    document.getElementById('readerSendBtn').disabled = false;
  } catch (err) {
    readerLog('inf', `Connect failed: ${err.message}`);
    readerSetStatus('Connection failed', false);
  }
}

async function readerDisconnect() {
  try {
    const ultra = readerUltra();
    if (ultra.isConnected()) await ultra.disconnect();
  } catch {}
  readerSetStatus('Disconnected', false);
  document.getElementById('readerConnectBtn').classList.remove('hidden');
  document.getElementById('readerDisconnectBtn').classList.add('hidden');
  document.getElementById('readerSendBtn').disabled = true;
  readerLog('inf', 'Disconnected');
}

const RAW_OPTS = { activateRfField: true, keepRfField: true, timeout: 2000, autoSelect: false };

async function readerSend(data) {
  if (!data || !data.length) return;
  try {
    let ultra = readerUltra();
    if (!ultra.isConnected()) {
      await readerConnect();
      await new Promise(function(r) { setTimeout(r, 200); });
      ultra = readerUltra();
      if (!ultra.isConnected()) throw new Error('Connect failed');
    }
    const buf = readerBuf(data);
    // Auto-detect 7-bit short frames
    const opts = data.length === 1 && (data[0] === 0x26 || data[0] === 0x52)
      ? { ...RAW_OPTS, dataBitLength: 7 }
      : RAW_OPTS;
    const resp = await ultra.cmdHf14aRaw({ data: buf, ...opts });
    readerLastSentHex = Array.from(data).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(' ');
    readerLog('tx', data);
    if (resp && resp.length) {
      readerLog('rx', resp, `${resp.length} byte${resp.length > 1 ? 's' : ''}`);
      readerAddRealResponse(resp, null, readerLastSentHex);
    } else {
      readerLog('inf', 'no response');
    }
  } catch (err) {
    readerLog('inf', `send error: ${err.message}`);
  }
}

function readerParseAndSend(input) {
  input = input.trim();
  if (!input) return;
  const hexClean = input.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length > 0 && hexClean.length % 2 === 0) {
    const bytes = [];
    for (let i = 0; i < hexClean.length; i += 2) bytes.push(parseInt(hexClean.substr(i, 2), 16));
    readerSend(Uint8Array.from(bytes));
  } else {
    readerLog('inf', 'enter hex bytes (e.g. 26, 93 20, 50 00 57 cd)');
  }
}

// Wire reader UI
readerInit();
document.getElementById('readerConnectBtn').addEventListener('click', readerConnect);
document.getElementById('readerToggle').addEventListener('click', readerTogglePanel);
document.getElementById('readerCloneReadBtn').addEventListener('click', readerReadAllBlocks);
document.getElementById('readerCloneSlotBtn').addEventListener('click', readerCloneToSlot);
document.getElementById('readerCloneTagBtn').addEventListener('click', readerCloneToTag);
document.getElementById('readerSealBtn').addEventListener('click', readerSeal);

// Reader sub-tab switching
document.getElementById('readerTabBar').querySelectorAll('.reader-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.getElementById('readerTabBar').querySelectorAll('.reader-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    var rtab = tab.dataset.rtab;
    document.getElementById('readerTabSniff').classList.toggle('active', rtab === 'sniff');
    document.getElementById('readerTabClone').classList.toggle('active', rtab === 'clone');
  });
});
document.getElementById('readerDisconnectBtn').addEventListener('click', readerDisconnect);
document.getElementById('readerSendBtn').addEventListener('click', () => {
  readerParseAndSend(document.getElementById('readerCmdInput').value);
});
document.getElementById('readerCmdInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') readerParseAndSend(e.target.value);
});
document.getElementById('readerClearLogBtn').addEventListener('click', () => {
  readerLogs = []; readerRenderLog();
});
