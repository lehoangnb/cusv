// ============================================================
//  Parity helpers (ISO 14443-A)
// ============================================================
function oddParity(value) {
  let v = value;
  for (let i of [4, 2, 1]) v ^= v >> i;
  return (v & 1) ^ 1;
}

// ============================================================
//  Frame type detection (HF 14A) — ISO 14443-3 / MIFARE Classic / Magic
// ============================================================
function detectFrameType(data, isTx, prevFrame) {
  if (data.length === 0) return 'unknown';
  const d0 = data[0];

  // ── 1-byte frames ──
  if (data.length === 1) {
    if (!isTx && d0 === 0x26) return 'REQA';
    if (!isTx && d0 === 0x52) return 'WUPA';
    if (!isTx && (d0 === 0x40 || d0 === 0x20))
      return d0 === 0x40 ? 'MAGIC_WAKEUP_GEN1A' : 'MAGIC_WAKEUP_ALT';
    if (isTx) {
      // SAK: bit7 must be 0 (mirrored by card) — catches 0x00–0x7F
      if ((d0 & 0x80) === 0x00) return `SAK_0x${d0.toString(16).padStart(2,'0')}`;
      // SAK with bit7=1 (0x80–0xFF): not mirrored, but still a SAK
      return `SAK_0x${d0.toString(16).padStart(2,'0')}`;
    }
    return `CMD_0x${d0.toString(16).padStart(2,'0')}`;
  }

  // ── 2-byte tag → reader = ATQA ──
  if (data.length === 2 && isTx) return 'ATQA';

  // ── Anti-collision / Select (reader → tag) ──
  const selByte = d0;
  if (!isTx) {
    if (selByte === 0x93 || selByte === 0x92) {
      if (data.length >= 2) {
        const nvb = data[1];
        const nBytes = (nvb >> 4) & 0x0F;
        if (nBytes >= 5 && data.length >= 7) return 'SELECT_CL1';
        return 'ANTICOLL_CL1';
      }
    }
    if (selByte === 0x95 || selByte === 0x94) {
      if (data.length >= 2) {
        const nvb = data[1];
        const nBytes = (nvb >> 4) & 0x0F;
        if (nBytes >= 5 && data.length >= 7) return 'SELECT_CL2';
        return 'ANTICOLL_CL2';
      }
    }
    if (selByte === 0x97 || selByte === 0x96) {
      if (data.length >= 2) {
        const nvb = data[1];
        const nBytes = (nvb >> 4) & 0x0F;
        if (nBytes >= 5 && data.length >= 7) return 'SELECT_CL3';
        return 'ANTICOLL_CL3';
      }
    }

    // ── Magic access byte (43 after 40 wakeup, 23 after 20 wakeup) ──
    if (prevFrame && (prevFrame.frameType === 'MAGIC_WAKEUP_GEN1A' || prevFrame.frameType === 'MAGIC_WAKEUP_ALT')) {
      if (d0 === 0x43 || d0 === 0x23) return 'MAGIC_ACCESS';
    }

    // ── MIFARE Classic / Magic backdoor commands (reader → tag) ──
    if (d0 === 0x30) return 'MIFARE_READ';
    if (d0 === 0xA0) return 'MIFARE_WRITE';
    if (d0 === 0x38) return 'MAGIC_HIDDEN_READ';
    if (d0 === 0xA8) return 'MAGIC_HIDDEN_WRITE';
    if (d0 === 0xE0) return 'MAGIC_CONFIG_READ';
    if (d0 === 0xE1) return 'MAGIC_CONFIG_WRITE';
    if (d0 === 0x80) return 'MAGIC_AUTH';

    // Magic bulk danger commands — USCUID reset/set-all
    if ([0xF0, 0xF1, 0xF6].includes(d0)) return 'MAGIC_DANGER';
    if ([0xF8, 0xF9, 0xFE].includes(d0)) return 'MAGIC_DANGER';

    // Gen3 APDU commands
    if (d0 === 0x90 && data.length >= 2) {
      const apdu = data[1];
      if (apdu === 0xFB) return 'GEN3_SETUID';
      if (apdu === 0xF0) return 'GEN3_WRITE_UID';
      if (apdu === 0xFD) return 'GEN3_FREEZE';
    }
  }

  // ── UID responses (tag → reader) ──
  if (isTx && data.length >= 4) {
    if (data.length === 5 && (data[4] === (data[0] ^ data[1] ^ data[2] ^ data[3])))
      return 'UID_CL1';
    if (data.length === 4 && data[0] === 0x88) {
      const bcc = data[0] ^ data[1] ^ data[2];
      if (bcc === data[3]) return 'UID_CL2';
    }
    // Non-CT 5-byte UID (raw UID, not CL1 with BCC)
    if (data.length === 5 && data[0] !== 0x00 && data[0] < 0x88) return 'UID';
  }

  // ── Standard reader command frames ──
  if (!isTx && data.length >= 2 && d0 === 0x50 && data[1] === 0x00) return 'HALT';
  if (!isTx && d0 === 0xE0 && (data.length === 3 || data.length === 4)) return 'RATS';
  if (!isTx && (d0 & 0xF0) === 0xD0) return 'PPS';

  // ── ATS (tag → reader) ──
  if (isTx && data.length >= 2 && d0 <= 0x1F && d0 > 0x00) {
    if (d0 === data.length || d0 + 1 >= data.length) return 'ATS';
  }

  // ── MIFARE Classic Auth commands (reader → tag) ──
  if (!isTx && (d0 === 0x60 || d0 === 0x61) && data.length === 4) return 'AUTH';
  if (!isTx && data.length === 8 && prevFrame && prevFrame.frameType === 'AUTH') return 'AUTH_CHALLENGE';

  // ── ISO 14443-4 T=CL protocol blocks ──
  // Length heuristics: genuine T=CL frames are short (PCB + CID/NAD + data ≤ 18B).
  // MIFARE block data (16B) with d0 in 0x00–0x3F would falsely match I-BLOCK.
  // Limit I-BLOCK detection to ≤ 12B to avoid confusion with MIFARE block data.
  if (data.length >= 1) {
    const pcb = d0;
    if ((pcb & 0xC0) === 0x00 && data.length <= 12) return 'I-BLOCK';
    if ((pcb & 0xC6) === 0x82 && data.length <= 6) return 'R-BLOCK';
    if ((pcb & 0xC0) === 0xC0 && data.length <= 6) {
      if ((pcb & 0xF7) === 0xC2) return 'DESELECT';
      if ((pcb & 0xFC) === 0xF0 || (pcb & 0xFC) === 0xF2) return 'WTX';
      return 'S-BLOCK';
    }
  }

  return 'DATA';
}

// ============================================================
//  SAK (Select Acknowledge) value decoder
// ============================================================
function buildSAKDescription(hexVal) {
  const val = parseInt(hexVal, 16);
  const flags = [];

  if (val & 0x01) flags.push(t('sakFlagBit0'));
  if (val & 0x02) flags.push(t('sakFlagBit1'));
  if (val & 0x04) flags.push(t('sakFlagUidIncomplete'));
  else flags.push(t('sakFlagUidComplete'));
  if (val & 0x20) flags.push(t('sakFlagIsoYes'));
  else flags.push(t('sakFlagIsoNo'));
  if (val & 0x40) flags.push(t('sakFlagBit6'));
  if (val & 0x80) flags.push(t('sakFlagBit7'));

  const knownKey = 'sakKnown' + hexVal.toLowerCase().padStart(2, '0');
  const known = t(knownKey);
  const hasKnown = known !== knownKey;

  const title = t('sakTitle', hexVal.toUpperCase());
  let detail = t('sakDetail', hexVal.toUpperCase(), val, flags.join(' | '), '');
  if (hasKnown) detail = t('sakDetail', hexVal.toUpperCase(), val, flags.join(' | '), ' ' + known + '.');
  return { title, detail };
}

// ============================================================
//  Frame type detail descriptions (ISO 14443-A)
// ============================================================
function describeFrame(f) {
  const ft = f.frameType;
  const d = f.data;
  const hex = (b) => '0x' + (b != null ? b.toString(16).padStart(2,'0').toUpperCase() : '??');

  if (ft.startsWith('SAK_0x')) return buildSAKDescription(ft.slice(6));

  const titleKey = 'desc' + ft.replace(/[^a-zA-Z0-9]/g, '') + 'Title';
  let title = t(titleKey);
  if (title === titleKey) title = ft;

  let detail = '';
  switch (ft) {
    case 'REQA': case 'WUPA': case 'HALT':
    case 'CMD_0x26': case 'CMD_0x52':
    case 'DESELECT': case 'WTX':
    case 'SELECT_CL2': case 'SELECT_CL3':
    case 'UID_CL2': case 'AUTH_CHALLENGE': case 'AUTH_RESPONSE':
      detail = t('desc' + ft.replace(/[^a-zA-Z0-9]/g, '') + 'Detail');
      break;
    // Magic card descriptions
    case 'MAGIC_WAKEUP_GEN1A':
      detail = t('descMAGICWAKEUPGEN1ADetail');
      break;
    case 'MAGIC_WAKEUP_ALT':
      detail = t('descMAGICWAKEUPALTDetail');
      break;
    case 'MAGIC_ACCESS':
      detail = t('descMAGICACCESSDetail', '0x' + d[0].toString(16));
      break;
    case 'MIFARE_READ':
      detail = t('descMIFAREREADDetail', '0x' + (d[1] || 0).toString(16));
      break;
    case 'MIFARE_WRITE':
      detail = t('descMIFAREWRITEDetail', '0x' + (d[1] || 0).toString(16));
      break;
    case 'MAGIC_HIDDEN_READ':
      detail = t('descMAGICHIDDENREADDetail');
      break;
    case 'MAGIC_HIDDEN_WRITE':
      detail = t('descMAGICHIDDENWRITEDetail');
      break;
    case 'MAGIC_CONFIG_READ':
      detail = t('descMAGICCONFIGREADDetail');
      break;
    case 'MAGIC_CONFIG_WRITE':
      detail = t('descMAGICCONFIGWRITEDetail');
      break;
    case 'MAGIC_AUTH':
      detail = t('descMAGICAUTHDetail');
      break;
    case 'MAGIC_DANGER':
      detail = t('descMAGICDANGERDetail', '0x' + d[0].toString(16));
      break;
    case 'GEN3_SETUID':
      detail = t('descGEN3SETUIDDetail');
      break;
    case 'GEN3_WRITE_UID':
      detail = t('descGEN3WRITEUIDDetail');
      break;
    case 'GEN3_FREEZE':
      detail = t('descGEN3FREEZEDetail');
      break;
    case 'unknown':
      title = t('descUnknownTitle');
      detail = t('descUnknownDetail');
      break;
    case 'ANTICOLL_CL1': {
      const nvb = d[0] != null ? ((d[0] & 0x0F) < 7 ? (d[0] & 0x0F) * 8 : (d[0] & 0x0F) * 8 + 8) : '?';
      detail = t('descANTICOLLCL1Detail', hex(d[0]), nvb);
      break;
    }
    case 'ANTICOLL_CL2':
      detail = t('descANTICOLLCL2Detail', hex(d[0]));
      break;
    case 'ANTICOLL_CL3':
      detail = t('descANTICOLLCL3Detail', hex(d[0]));
      break;
    case 'SELECT_CL1':
      detail = t('descSELECTCL1Detail');
      break;
    case 'RATS':
      detail = t('descRATSDetail', hex(d[1]));
      break;
    case 'ATS':
      detail = t('descATSDetail', d.length);
      break;
    case 'PPS':
      detail = t('descPPSDetail', hex(d[0]));
      break;
    case 'AUTH':
      detail = t('descAUTHDetail',
        f.isTx ? t('descAuthDirTag') : t('descAuthDirReader'),
        d[0] === 0x60 ? t('descKeyA') : d[0] === 0x61 ? t('descKeyB') : hex(d[0]),
        hex(d[1]));
      break;
    case 'S-BLOCK':
      detail = t('descSBLOCKDetail', hex(d[0]));
      break;
    case 'I-BLOCK': {
      const cid = d.length > 1 ? t('descIBLOCKCid', hex(d[1])) : t('descIBLOCKNoCid');
      const nad = d.length > 2 ? t('descIBLOCKNad', hex(d[2])) : t('descIBLOCKNoNad');
      detail = t('descIBLOCKDetail', hex(d[0]), d[0] != null ? (d[0] & 0x01) : '?', cid, nad);
      break;
    }
    case 'R-BLOCK':
      detail = t('descRBLOCKDetail', hex(d[0]),
        (d[0] & 0x10) ? t('descRBLOCKNak') : t('descRBLOCKAck'),
        d[0] != null ? (d[0] & 0x01) : '?');
      break;
    case 'DATA':
      detail = t('descDATADetail', f.data.length);
      break;
    case 'ATQA':
      detail = t('descATQADetail', hex(d[0]), hex(d[1]));
      break;
    case 'UID_CL1':
      detail = t('descUIDCL1Detail', hex(d[0]), hex(d[1]), hex(d[2]), hex(d[3]), hex(d[4]));
      break;
    case 'UID':
      detail = t('descUIDDetail', d.length);
      break;
    default:
      if (ft.startsWith('CMD_0x')) {
        const val = ft.slice(6);
        title = t('descCMDTitle', val.toUpperCase());
        detail = t('descCMDDetail', val.toUpperCase());
      } else {
        detail = t('descFallbackDetail', f.data.length);
      }
      break;
  }
  return { title, detail };
}

// ============================================================
//  Byte -> ASCII helper
// ============================================================
function toAscii(b) {
  return b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.';
}

// ============================================================
//  Auto-detect file type
// ============================================================
function detectFileType(u8) {
  if (u8.length < 2) return 'lf';

  let hdr = (u8[0] << 8) | u8[1];
  let szBits = hdr & 0x7FFF;
  if (szBits > 0 && szBits < 10000) {
    let szBytes = Math.ceil(szBits / 8);
    if (2 + szBytes <= u8.length) return 'hf';
  }
  if (hdr === 0 && u8.length < 100) return 'hf';
  return 'lf';
}

// ============================================================
//  Parse HF sniff buffer
// ============================================================
function parseHFSniff(u8) {
  const frames = [];
  let prevFrame = null;
  let i = 0;
  while (i + 2 <= u8.length) {
    const hdr = (u8[i] << 8) | u8[i+1];
    i += 2;
    const isTx = Boolean(hdr & 0x8000);
    let szBits = hdr & 0x7FFF;

    if (szBits === 0) break;

    const szBytes = Math.ceil(szBits / 8);
    if (i + szBytes > u8.length) break;

    const raw = u8.slice(i, i + szBytes);
    i += szBytes;

    // Strip parity for ISO 14443-A frames (szBits % 9 === 0, szBits >= 9)
    let data = raw;
    let strippedBits = szBits;
    const parityBits = [];
    if (szBits >= 9 && szBits % 9 === 0) {
      const nBytes = szBits / 9;
      const allBits = [];
      for (const byte of raw) {
        for (let b = 0; b < 8; b++) {
          allBits.push((byte >> b) & 1);
        }
      }
      const stripped = [];
      for (let nb = 0; nb < nBytes; nb++) {
        let val = 0;
        for (let b = 0; b < 8; b++) {
          val |= allBits[nb * 9 + b] << b;
        }
        stripped.push(val);
        parityBits.push(allBits[nb * 9 + 8]);
      }
      data = new Uint8Array(stripped);
      strippedBits = nBytes * 8;
    }

    const frameType = detectFrameType(data, isTx, prevFrame);
    const hexStr = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asciiStr = Array.from(data).map(toAscii).join('');

    const frame = {
      index: frames.length,
      raw, data,
      szBits: strippedBits, rawSzBits: szBits,
      isTx, parityBits, frameType, hexStr, asciiStr,
    };
    frames.push(frame);
    prevFrame = frame;
  }
  return frames;
}

// ============================================================
//  Build hex string with parity error highlighting
// ============================================================
function buildHexStr(f) {
  let hexParts = [];
  if (f.parityBits.length > 0 && f.parityBits.length === f.data.length) {
    for (let bi = 0; bi < f.data.length; bi++) {
      const expected = oddParity(f.data[bi]);
      const actual = f.parityBits[bi];
      const hex = f.data[bi].toString(16).padStart(2, '0');
      if (expected !== actual) {
        hexParts.push(`<span class="parity-err" title="parity error: expected ${expected}, got ${actual}">${hex}</span>`);
      } else {
        hexParts.push(hex);
      }
    }
  } else {
    hexParts = Array.from(f.data).map(b => b.toString(16).padStart(2, '0'));
  }
  return hexParts.join(' ');
}

// ============================================================
//  Compute diff between two HF frame sets
// ============================================================
function computeFrameDiff(framesA, framesB) {
  const diffMap = {};
  const maxLen = Math.max(framesA.length, framesB.length);
  for (let i = 0; i < maxLen; i++) {
    const fa = framesA[i] || null;
    const fb = framesB[i] || null;
    let diffA = false, diffB = false;
    if (!fa) { diffB = true; }
    else if (!fb) { diffA = true; }
    else {
      if (fa.frameType !== fb.frameType || fa.data.length !== fb.data.length) {
        diffA = true; diffB = true;
      }
    }
    if (diffA) diffMap['A_' + i] = true;
    if (diffB) diffMap['B_' + i] = true;
  }
  return diffMap;
}

// ============================================================
//  Phase bucketing (single source of truth for message dividers)
// ============================================================
function phaseForFrameType(ft) {
  if (ft === 'REQA' || ft === 'WUPA' || ft === 'ATQA' ||
      ft.startsWith('ANTICOLL_') || ft.startsWith('UID') || ft.startsWith('SELECT_') || ft.startsWith('SAK_'))
    return t('phaseAnticoll');
  if (ft === 'RATS' || ft === 'ATS' || ft === 'PPS')
    return t('phaseActivate');
  if (ft === 'AUTH' || ft === 'AUTH_CHALLENGE' || ft === 'AUTH_RESPONSE')
    return t('phaseAuth');
  if (ft === 'I-BLOCK' || ft === 'R-BLOCK' || ft === 'S-BLOCK' || ft === 'DESELECT' || ft === 'WTX')
    return t('phaseData');
  if (ft === 'HALT')
    return t('phaseEnd');
  if (ft === 'DATA')
    return t('phaseEncrypted');
  if (ft.startsWith('MAGIC_') || ft.startsWith('GEN3_') || ft === 'MIFARE_READ' || ft === 'MIFARE_WRITE')
    return t('phaseMagic');
  return '';
}

// ============================================================
//  Generic tab switcher binder
//    tabBarEl: the .tab-bar element
//    onActivate(tabEl): called for the clicked tab
// ============================================================
