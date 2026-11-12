'use strict';
function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}
const pageResult = (items, total, { page, limit }) => ({
  items,
  pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
});
module.exports = { parsePagination, pageResult };
