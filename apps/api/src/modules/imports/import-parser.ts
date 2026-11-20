import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { ErrorCode } from '@ucrams/shared';
import { BusinessRuleError } from '../../common/exceptions/app-error.js';

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const normaliseHeader = (h: unknown) =>
  String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const fail = (message: string) => new BusinessRuleError(ErrorCode.VALIDATION_ERROR, message);

function cellValue(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text; // hyperlinks (e.g. emails)
    if ('result' in v) return String(v.result ?? ''); // formulas
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
  }
  return String(v);
}

/**
 * Parses a CSV or XLSX upload into header-keyed rows (headers normalised to
 * snake_case). Blank rows are dropped; row numbers refer to the spreadsheet.
 */
export async function parseImportFile(
  fileName: string,
  buffer: Buffer,
  expectedColumns: readonly string[],
): Promise<Array<{ rowNumber: number; values: Record<string, string> }>> {
  const lower = fileName.toLowerCase();
  let rows: Array<{ rowNumber: number; values: Record<string, string> }> = [];
  let headers: string[] = [];

  if (lower.endsWith('.csv')) {
    let records: string[][];
    try {
      records = parse(buffer, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      });
    } catch {
      throw fail('The CSV file could not be read');
    }
    headers = (records[0] ?? []).map(normaliseHeader);
    rows = records.slice(1).map((r, i) => ({
      rowNumber: i + 2,
      values: Object.fromEntries(headers.map((h, c) => [h, r[c] ?? ''])),
    }));
  } else if (lower.endsWith('.xlsx')) {
    // XLSX files are ZIP archives ("PK" magic); refuse anything else before parsing.
    if (buffer.subarray(0, 2).toString('latin1') !== 'PK')
      throw fail('The file is not a valid .xlsx workbook');
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw fail('The workbook could not be read');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw fail('The workbook has no sheets');
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
      if (rowNumber === 1 || headers.length === 0) {
        headers = cells.map(normaliseHeader);
        return;
      }
      rows.push({
        rowNumber,
        values: Object.fromEntries(headers.map((h, c) => [h, (cells[c] ?? '').trim()])),
      });
    });
  } else {
    throw new BusinessRuleError(ErrorCode.FILE_TYPE_NOT_ALLOWED, 'Upload a .csv or .xlsx file');
  }

  const missing = expectedColumns.filter(
    (c) => ['email', 'first_name', 'last_name'].includes(c) && !headers.includes(c),
  );
  if (missing.length > 0) throw fail(`Missing required columns: ${missing.join(', ')}`);
  const unknown = headers.filter((h) => h && !expectedColumns.includes(h));
  if (unknown.length > 0) throw fail(`Unknown columns: ${unknown.join(', ')}. Use the template.`);

  rows = rows.filter((r) => Object.values(r.values).some((v) => v !== ''));
  if (rows.length === 0) throw fail('The file has no data rows');
  if (rows.length > MAX_IMPORT_ROWS) throw fail(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
  return rows;
}

/** CSV template with headers and one example row. */
export function templateCsv(columns: readonly string[], example: Record<string, string>): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${columns.join(',')}\n${columns.map((c) => escape(example[c] ?? '')).join(',')}\n`;
}
