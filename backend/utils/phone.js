'use strict';
// Phone normalization: Ghana-first, with international (E.164) support.
const GH_MOBILE_PREFIXES = new Set(['20', '23', '24', '25', '26', '27', '28', '29', '50', '53', '54', '55', '56', '57', '59']);

/**
 * @returns {{ok:true,e164:string,country:string}|{ok:false,error:string}}
 */
function normalizePhone(raw, defaultCountry = 'GH') {
  if (raw === null || raw === undefined) return { ok: false, error: 'Phone number is empty' };
  let s = String(raw).trim();
  if (!s) return { ok: false, error: 'Phone number is empty' };
  // Excel can export numbers in scientific notation (2.33241234567E+11)
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.round(n));
  }
  if (/[A-Za-z]/.test(s)) return { ok: false, error: 'Phone number contains letters' };
  const hasPlus = s.startsWith('+');
  let digits = s.replace(/[^\d]/g, '');
  if (!digits) return { ok: false, error: 'Phone number has no digits' };

  let international = hasPlus;
  if (!hasPlus && digits.startsWith('00')) { digits = digits.slice(2); international = true; }

  if (international) return validateInternational(digits);

  if (defaultCountry === 'GH') {
    if (digits.startsWith('233')) return validateGhana(digits.slice(3));
    if (digits.startsWith('0') && digits.length === 10) return validateGhana(digits.slice(1));
    if (digits.length === 9) return validateGhana(digits); // leading zero lost (common in Excel)
    return { ok: false, error: 'Not a valid Ghana number. Use 0XXXXXXXXX, 233XXXXXXXXX, or + and the country code for other countries' };
  }
  return { ok: false, error: 'Use the international format starting with + and the country code' };
}

function validateGhana(national) {
  if (!/^\d{9}$/.test(national)) return { ok: false, error: 'Ghana numbers must have 9 digits after 0 / 233' };
  if (!GH_MOBILE_PREFIXES.has(national.slice(0, 2))) return { ok: false, error: 'Unrecognised Ghana mobile prefix' };
  return { ok: true, e164: '+233' + national, country: 'GH' };
}

function validateInternational(digits) {
  if (digits.startsWith('233')) return validateGhana(digits.slice(3));
  if (digits.startsWith('0')) return { ok: false, error: 'International numbers cannot start with 0 after +' };
  if (digits.length < 8 || digits.length > 15) return { ok: false, error: 'International numbers must be 8-15 digits' };
  return { ok: true, e164: '+' + digits, country: 'INTL' };
}

/** Providers such as Arkesel expect digits only (233XXXXXXXXX). */
const toProviderFormat = (e164) => String(e164).replace(/^\+/, '');

module.exports = { normalizePhone, toProviderFormat, GH_MOBILE_PREFIXES };
