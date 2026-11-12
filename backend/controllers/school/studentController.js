'use strict';
const { Student, Parent } = require('../../models');
const asyncHandler = require('../../utils/asyncHandler');
const { E } = require('../../utils/errors');
const v = require('../../utils/validate');
const { parsePagination, pageResult } = require('../../utils/pagination');
const { audit } = require('../../utils/audit');

const dto = (s, parents) => ({
  id: s._id, fullName: s.fullName, className: s.className, studentNumber: s.studentNumber,
  parents: (s.parentIds || []).map((id) => ({ id, fullName: parents ? (parents.get(String(id)) || 'Unknown') : undefined })),
});

async function parentNames(schoolId, students) {
  const ids = [...new Set(students.flatMap((s) => (s.parentIds || []).map(String)))];
  const rows = ids.length ? await Parent.find({ schoolId, _id: { $in: ids } }).select('fullName').lean() : [];
  return new Map(rows.map((p) => [String(p._id), p.fullName]));
}

async function parseBody(req) {
  const parentIds = Array.isArray(req.body.parentIds) ? [...new Set(req.body.parentIds.slice(0, 5).map((i) => v.toObjectId(i, 'parent id').toString()))] : [];
  if (parentIds.length) {
    const n = await Parent.countDocuments({ schoolId: req.tenantId, _id: { $in: parentIds } });
    if (n !== parentIds.length) throw E.badRequest('Some linked parents were not found');
  }
  return {
    fullName: v.str(req.body.fullName, { label: 'Student name', required: true, min: 2, max: 120 }),
    className: v.str(req.body.className, { label: 'Class', max: 60 }),
    studentNumber: v.str(req.body.studentNumber, { label: 'Student number', max: 40 }),
    parentIds,
  };
}

exports.list = asyncHandler(async (req, res) => {
  const page = parsePagination(req.query);
  const filter = { schoolId: req.tenantId };
  const q = v.str(req.query.q, { max: 80 });
  if (q) filter.fullNameLower = { $regex: v.escapeRegex(q.toLowerCase()) };
  const cls = v.str(req.query.className, { max: 60 });
  if (cls) filter.className = cls;
  const [items, total] = await Promise.all([
    Student.find(filter).sort({ fullNameLower: 1 }).skip(page.skip).limit(page.limit).lean(),
    Student.countDocuments(filter),
  ]);
  const names = await parentNames(req.tenantId, items);
  res.json(pageResult(items.map((s) => dto(s, names)), total, page));
});

exports.create = asyncHandler(async (req, res) => {
  const s = await Student.create({ ...(await parseBody(req)), schoolId: req.tenantId });
  await audit(req, { action: 'student.create', targetType: 'Student', targetId: s._id });
  res.status(201).json({ student: dto(s) });
});

exports.update = asyncHandler(async (req, res) => {
  const s = await Student.findOne({ _id: v.toObjectId(req.params.id), schoolId: req.tenantId });
  if (!s) throw E.notFound('Student not found');
  Object.assign(s, await parseBody(req));
  await s.save();
  await audit(req, { action: 'student.update', targetType: 'Student', targetId: s._id });
  res.json({ student: dto(s) });
});

exports.remove = asyncHandler(async (req, res) => {
  const r = await Student.deleteOne({ _id: v.toObjectId(req.params.id), schoolId: req.tenantId });
  if (!r.deletedCount) throw E.notFound('Student not found');
  await audit(req, { action: 'student.delete', targetType: 'Student', targetId: req.params.id });
  res.json({ deleted: 1 });
});
