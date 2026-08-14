import { validationError } from '../../errors/AppError.js';

const VALID_TYPES = ['income', 'expense'];
const VALID_REPORT_GROUPS = ['tithe', 'offering', 'other'];

function validateReportGroup(value, fields) {
  if (value === undefined || value === null) return null;
  if (!VALID_REPORT_GROUPS.includes(value)) {
    fields.reportGroup = `must be one of: ${VALID_REPORT_GROUPS.join(', ')}`;
    return null;
  }
  return value;
}

export function validateCreateCategory(body) {
  const fields = {};
  if (!VALID_TYPES.includes(body.type)) {
    fields.type = `type must be one of: ${VALID_TYPES.join(', ')}`;
  }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    fields.name = 'name is required';
  }
  const reportGroup = validateReportGroup(body.reportGroup, fields);
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid category payload', fields);
  }
  return { type: body.type, name: body.name.trim(), reportGroup };
}

// Only report_group is editable after creation — type/name changes would
// ripple into every existing contribution/expense/report referencing this
// category, which is out of scope for this minimal update endpoint.
export function validateUpdateCategory(body) {
  const fields = {};
  const reportGroup = validateReportGroup(body.reportGroup, fields);
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid category update payload', fields);
  }
  return { report_group: reportGroup };
}
