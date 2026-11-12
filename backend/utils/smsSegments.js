'use strict';
// Estimate SMS encoding and number of segments (GSM-7 vs UCS-2).
const GSM_BASIC = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const GSM_EXT = new Set(Array.from('^{}\\[~]|€'));

function analyzeSms(text) {
  const chars = Array.from(String(text || ''));
  let gsm = true;
  let units = 0;
  for (const ch of chars) {
    if (GSM_BASIC.has(ch)) units += 1;
    else if (GSM_EXT.has(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) {
    const segments = units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153);
    return { encoding: 'GSM-7', characters: chars.length, units, segments, perSegment: units <= 160 ? 160 : 153 };
  }
  // UCS-2 counts UTF-16 code units (emoji = 2)
  const u = String(text).length;
  const segments = u === 0 ? 0 : u <= 70 ? 1 : Math.ceil(u / 67);
  return { encoding: 'UCS-2', characters: chars.length, units: u, segments, perSegment: u <= 70 ? 70 : 67 };
}

/** Build the text that is really sent: body + optional signature. */
function composeFinalText(body, signature, includeSignature) {
  const b = String(body || '').trim();
  const sig = String(signature || '').trim();
  if (!includeSignature || !sig) return b;
  // avoid duplicating the signature if the admin already typed it
  if (b.toLowerCase().endsWith(sig.toLowerCase())) return b;
  return `${b} ${sig}`;
}

module.exports = { analyzeSms, composeFinalText };
