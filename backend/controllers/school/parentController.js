'use strict';
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');
const env = require('../../config/env');
const { Parent, Student } = require('../../models');
const asyncHandler = require('../../utils/asyncHandler');
const { E } = require('../../utils/errors');
const v = require('../../utils/validate');
const { normalizePhone } = require('../../utils/phone');
const { parsePagination, pageResult } = require('../../utils/pagination');
const { toCsv, safeCell } = require('../../utils/csv');
const { audit } = require('../../utils/audit');

const dto = (p) => ({ id: p._id, fullName: p.fullName, phones: p.phones, status: p.status, notes: p.notes, createdAt: p.createdAt });

function parsePhones(raw) {
  if (!Array.isArray(raw) || !raw.length) throw E.badRequest('Add at least one phone number');
  if (raw.length > 3) throw E.badRequest('A parent can have at most 3 phone numbers');
  const out = []; const seen = new Set();
  for (const item of raw) {
    const n = normalizePhone(item && typeof item === 'object' ? item.number : item, env.defaultCountry);
    if (!n.ok) throw E.badRequest(`${item && item.number ? item.number : item}: ${n.error}`, undefined, 'INVALID_PHONE');
    if (seen.has(n.e164)) continue;
    seen.add(n.e164);
    out.push({ number: n.e164, label: v.str(item && item.label, { label: 'Label', max: 20 }) || 'mobile' });
  }
  return out;
}

function parseBody(body) {
  return {
    fullName: v.str(body.fullName, { label: 'Name', required: true, min: 2, max: 120 }),
    phones: parsePhones(body.phones),
    notes: v.str(body.notes, { label: 'Notes', max: 500 }),
    status: v.oneOf(body.status, ['active', 'inactive'], 'Status', 'active'),
  };
}

async function findDuplicates(schoolId, numbers, excludeId) {
  const q = { schoolId, 'phones.number': { $in: numbers } };
  if (excludeId) q._id = { $ne: excludeId };
  return Parent.find(q).select('fullName phones').limit(5).lean();
}

exports.list = asyncHandler(async (req, res) => {
  const page = parsePagination(req.query);
  const filter = { schoolId: req.tenantId };
  const q = v.str(req.query.q, { max: 80 });
  if (q) {
    const digits = q.replace(/[^\d+]/g, '');
    if (digits.length >= 4 && /^\+?\d+$/.test(digits)) filter['phones.number'] = { $regex: v.escapeRegex(digits.replace(/^\+/, '').replace(/^0/, '')) };
    else filter.fullNameLower = { $regex: v.escapeRegex(q.toLowerCase()) };
  }
  if (req.query.status === 'active' || req.query.status === 'inactive') filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Parent.find(filter).sort({ fullNameLower: 1, _id: 1 }).skip(page.skip).limit(page.limit).lean(),
    Parent.countDocuments(filter),
  ]);
  res.json(pageResult(items.map(dto), total, page));
});

exports.get = asyncHandler(async (req, res) => {
  const p = await Parent.findOne({ _id: v.toObjectId(req.params.id), schoolId: req.tenantId }).lean();
  if (!p) throw E.notFound('Parent not found');
  res.json({ parent: dto(p) });
});

exports.create = asyncHandler(async (req, res) => {
  const data = parseBody(req.body);
  if (!v.bool(req.body.allowDuplicate)) {
    const dups = await findDuplicates(req.tenantId, data.phones.map((p) => p.number));
    if (dups.length) throw E.conflict('This phone number already belongs to another parent', dups.map((d) => ({ id: d._id, fullName: d.fullName })), 'DUPLICATE_PHONE');
  }
  const p = await Parent.create({ ...data, schoolId: req.tenantId });
  await audit(req, { action: 'parent.create', targetType: 'Parent', targetId: p._id });
  res.status(201).json({ parent: dto(p) });
});

exports.update = asyncHandler(async (req, res) => {
  const id = v.toObjectId(req.params.id);
  const data = parseBody(req.body);
  if (!v.bool(req.body.allowDuplicate)) {
    const dups = await findDuplicates(req.tenantId, data.phones.map((p) => p.number), id);
    if (dups.length) throw E.conflict('This phone number already belongs to another parent', dups.map((d) => ({ id: d._id, fullName: d.fullName })), 'DUPLICATE_PHONE');
  }
  const p = await Parent.findOne({ _id: id, schoolId: req.tenantId });
  if (!p) throw E.notFound('Parent not found');
  Object.assign(p, data);
  await p.save();
  await audit(req, { action: 'parent.update', targetType: 'Parent', targetId: p._id });
  res.json({ parent: dto(p) });
});

async function removeParents(schoolId, ids) {
  const r = await Parent.deleteMany({ schoolId, _id: { $in: ids } });
  await Student.updateMany({ schoolId, parentIds: { $in: ids } }, { $pull: { parentIds: { $in: ids } } });
  return r.deletedCount;
}

exports.remove = asyncHandler(async (req, res) => {
  const n = await removeParents(req.tenantId, [v.toObjectId(req.params.id)]);
  if (!n) throw E.notFound('Parent not found');
  await audit(req, { action: 'parent.delete', targetType: 'Parent', targetId: req.params.id });
  res.json({ deleted: n });
});

exports.bulkRemove = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 1000).map((i) => v.toObjectId(i)) : [];
  if (!ids.length) throw E.badRequest('No parents selected');
  const n = await removeParents(req.tenantId, ids);
  await audit(req, { action: 'parent.bulk_delete', meta: { count: n } });
  res.json({ deleted: n });
});

exports.duplicates = asyncHandler(async (req, res) => {
  const rows = await Parent.aggregate([
    { $match: { schoolId: req.tenantId } },
    { $unwind: '$phones' },
    { $group: { _id: '$phones.number', count: { $sum: 1 }, parents: { $push: { id: '$_id', fullName: '$fullName' } } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 200 },
  ]);
  res.json({ duplicates: rows.map((r) => ({ phone: r._id, count: r.count, parents: r.parents })) });
});

// ---------- Import ----------
const ALIASES = {
  name: ['name', 'parent', 'parent name', 'parentname', 'full name', 'fullname', 'guardian', 'guardian name'],
  phone: ['phone', 'phone number', 'phonenumber', 'mobile', 'mobile number', 'contact', 'telephone', 'tel', 'phone 1', 'phone1', 'number'],
  phone2: ['phone 2', 'phone2', 'alternative phone', 'alt phone', 'secondary phone', 'mobile 2'],
  notes: ['notes', 'note', 'comment', 'comments'],
};
const norm = (h) => String(h || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
function mapHeaders(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [key, list] of Object.entries(ALIASES)) if (map[key] === undefined && list.includes(n)) map[key] = i;
  });
  return map;
}
const cellText = (c) => {
  if (c === null || c === undefined) return '';
  if (typeof c === 'object') { if (c.text) return String(c.text); if (c.result !== undefined) return String(c.result); if (c.richText) return c.richText.map((r) => r.text).join(''); return ''; }
  return typeof c === 'number' ? String(Math.round(c)) : String(c);
};

async function readRows(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const records = parse(file.buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
    return records;
  }
  if (name.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw E.badRequest('The Excel file has no sheets');
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => rows.push(row.values.slice(1).map(cellText)));
    return rows;
  }
  throw E.badRequest('Upload a .csv or .xlsx file');
}

exports.importFile = asyncHandler(async (req, res) => {
  if (!req.file) throw E.badRequest('Choose a file to upload');
  const rows = await readRows(req.file);
  if (rows.length < 2) throw E.badRequest('The file has no data rows');
  if (rows.length - 1 > env.imports.maxRows) throw E.badRequest(`Files can contain at most ${env.imports.maxRows} rows`);
  const cols = mapHeaders(rows[0]);
  if (cols.name === undefined || cols.phone === undefined) {
    throw E.badRequest('Could not find the required columns. The first row must have "Name" and "Phone" headers.', undefined, 'MISSING_COLUMNS');
  }

  const errors = []; const duplicatesInFile = []; const candidates = [];
  const seenInFile = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const line = i + 1;
    const fullName = String(r[cols.name] || '').trim();
    if (!fullName && !String(r[cols.phone] || '').trim()) continue; // blank line
    if (fullName.length < 2 || fullName.length > 120) { errors.push({ row: line, reason: 'Name must be 2-120 characters' }); continue; }
    const phones = [];
    let bad = null;
    for (const key of ['phone', 'phone2']) {
      if (cols[key] === undefined) continue;
      const raw = String(r[cols[key]] || '').trim();
      if (!raw) continue;
      const n = normalizePhone(raw, env.defaultCountry);
      if (!n.ok) { bad = `${raw}: ${n.error}`; break; }
      if (!phones.includes(n.e164)) phones.push(n.e164);
    }
    if (bad) { errors.push({ row: line, reason: bad }); continue; }
    if (!phones.length) { errors.push({ row: line, reason: 'Phone number is empty' }); continue; }
    if (phones.some((p) => seenInFile.has(p))) { duplicatesInFile.push({ row: line, reason: 'Duplicate phone number in this file' }); continue; }
    phones.forEach((p) => seenInFile.add(p));
    candidates.push({ line, fullName, phones, notes: cols.notes !== undefined ? String(r[cols.notes] || '').trim().slice(0, 500) : '' });
  }

  // Skip numbers that already exist for this school.
  const existing = new Set();
  const all = [...seenInFile];
  for (let i = 0; i < all.length; i += 1000) {
    const found = await Parent.find({ schoolId: req.tenantId, 'phones.number': { $in: all.slice(i, i + 1000) } }).select('phones.number').lean();
    found.forEach((p) => p.phones.forEach((ph) => existing.add(ph.number)));
  }
  const duplicatesInDb = []; const toInsert = [];
  for (const c of candidates) {
    if (c.phones.some((p) => existing.has(p))) { duplicatesInDb.push({ row: c.line, reason: 'Phone number already exists' }); continue; }
    toInsert.push({ schoolId: req.tenantId, fullName: c.fullName, fullNameLower: c.fullName.toLowerCase(), phones: c.phones.map((n) => ({ number: n, label: 'mobile' })), notes: c.notes, status: 'active' });
  }
  let imported = 0;
  for (let i = 0; i < toInsert.length; i += 1000) {
    const r = await Parent.insertMany(toInsert.slice(i, i + 1000), { ordered: false });
    imported += r.length;
  }
  await audit(req, { action: 'parent.import', meta: { file: req.file.originalname, imported, invalid: errors.length, duplicates: duplicatesInFile.length + duplicatesInDb.length } });
  res.json({
    totalRows: rows.length - 1, imported, invalid: errors.length,
    duplicates: duplicatesInFile.length + duplicatesInDb.length,
    errors: errors.slice(0, 200), duplicateRows: [...duplicatesInFile, ...duplicatesInDb].slice(0, 200),
  });
});

exports.template = (req, res) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="parents-template.csv"' });
  res.send(toCsv(['Name', 'Phone', 'Phone 2', 'Notes'], [['Ama Mensah', '0241234567', '0201234567', 'Class 3 parent'], ['John Smith', '+447700900123', '', '']]));
};

exports.exportAll = asyncHandler(async (req, res) => {
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const filter = { schoolId: req.tenantId };
  if (req.query.status === 'active' || req.query.status === 'inactive') filter.status = req.query.status;
  const headers = ['Name', 'Phone', 'Phone 2', 'Phone 3', 'Status', 'Notes'];
  const cursor = Parent.find(filter).sort({ fullNameLower: 1 }).lean().cursor();
  await audit(req, { action: 'parent.export', meta: { format } });
  if (format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="parents.csv"' });
    const { cell } = require('../../utils/csv');
    res.write('\uFEFF' + headers.join(',') + '\r\n');
    for await (const p of cursor) {
      const ph = p.phones.map((x) => x.number);
      res.write([p.fullName, ph[0], ph[1], ph[2], p.status, p.notes].map(cell).join(',') + '\r\n');
    }
    return res.end();
  }
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="parents.xlsx"' });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  const ws = wb.addWorksheet('Parents');
  ws.addRow(headers).commit();
  for await (const p of cursor) {
    const ph = p.phones.map((x) => x.number);
    ws.addRow([safeCell(p.fullName), ph[0], ph[1] || '', ph[2] || '', p.status, safeCell(p.notes)]).commit();
  }
  await ws.commit();
  await wb.commit();
  return undefined;
});
