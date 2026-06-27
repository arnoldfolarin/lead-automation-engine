/**
 * Deterministic Apollo CSV / Excel contact parser (no LLM).
 */
const XLSX = require("xlsx");

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

const HEADER_MAP = {
  "first name": "firstName",
  first_name: "firstName",
  firstname: "firstName",
  "last name": "lastName",
  last_name: "lastName",
  lastname: "lastName",
  title: "title",
  "job title": "title",
  "company name": "companyName",
  company: "companyName",
  organization: "companyName",
  "company name for emails": "companyName",
  email: "email",
  "contact email": "email",
  "work email": "email",
};

/**
 * @param {unknown} v
 * @returns {string}
 */
function normEmail(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}

/**
 * @param {string} header
 * @returns {string}
 */
function mapHeader(header) {
  const key = String(header || "").trim().toLowerCase();
  return HEADER_MAP[key] || "";
}

/**
 * Parse one CSV line respecting double-quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
function rowsFromCsvText(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((ln) => ln.trim());
  if (!lines.length) return [];

  const headerCells = parseCsvLine(lines[0]);
  const mapped = headerCells.map(mapHeader);
  const hasHeader = mapped.some(Boolean);
  const start = hasHeader ? 1 : 0;

  if (!hasHeader) {
    return lines.map((line) => {
      const parts = parseCsvLine(line);
      return {
        email: parts[0] || "",
        firstName: parts[1] || "",
        lastName: parts[2] || "",
        companyName: parts[3] || "",
        title: parts[4] || "",
      };
    });
  }

  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (!cells.some((c) => c)) continue;
    /** @type {Record<string, string>} */
    const row = {};
    for (let j = 0; j < mapped.length; j++) {
      const field = mapped[j];
      if (field && cells[j]) row[field] = cells[j];
    }
    rows.push(row);
  }
  return rows;
}

/**
 * @param {Buffer} buf
 * @returns {Record<string, string>[]}
 */
function rowsFromXlsxBuffer(buf) {
  const wb = XLSX.read(buf, {type: "buffer", cellDates: false});
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: "", raw: false});
  if (!matrix.length) return [];

  const headerRow = matrix[0].map((h) => String(h || "").trim());
  const mapped = headerRow.map(mapHeader);
  const hasHeader = mapped.some(Boolean);
  const start = hasHeader ? 1 : 0;
  const rows = [];

  for (let i = start; i < matrix.length; i++) {
    const cells = matrix[i].map((c) => String(c == null ? "" : c).trim());
    if (!cells.some((c) => c)) continue;
    /** @type {Record<string, string>} */
    const row = {};
    if (hasHeader) {
      for (let j = 0; j < mapped.length; j++) {
        const field = mapped[j];
        if (field && cells[j]) row[field] = cells[j];
      }
    } else {
      row.email = cells[0] || "";
      row.firstName = cells[1] || "";
      row.lastName = cells[2] || "";
      row.companyName = cells[3] || "";
      row.title = cells[4] || "";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * @param {Record<string, string>} row
 * @returns {{ firstName: string, lastName: string, title: string, companyName: string, email: string, warnings: string[] } | null}
 */
function normalizeContactRow(row) {
  const email = normEmail(row.email || row.contactEmail || row.Email);
  if (!email || !EMAIL_RE.test(email)) return null;

  const firstName = String(row.firstName || "").trim().slice(0, 80);
  const lastName = String(row.lastName || "").trim().slice(0, 80);
  const title = String(row.title || "").trim().slice(0, 120);
  let companyName = String(row.companyName || row.company || "").trim().slice(0, 200);
  const warnings = [];
  if (!companyName) {
    const dom = email.split("@")[1] || "";
    companyName = dom.split(".")[0] || "Imported";
    warnings.push("Company derived from email domain");
  }
  return {firstName, lastName, title, companyName, email, warnings};
}

/**
 * @param {string} fileName
 * @returns {boolean}
 */
function isXlsxFileName(fileName) {
  return /\.xlsx$/i.test(String(fileName || "").trim());
}

/**
 * @param {Buffer} buf
 * @returns {boolean}
 */
function isZipBuffer(buf) {
  return !!buf && buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
}

/**
 * @param {unknown} b64Raw
 * @returns {Buffer}
 */
function decodeBase64Field(b64Raw) {
  let b64 = String(b64Raw || "");
  const comma = b64.indexOf(",");
  if (comma >= 0) b64 = b64.slice(comma + 1);
  return Buffer.from(b64, "base64");
}

/**
 * @param {{ kind?: string, text?: string, base64?: string, fileName?: string }} payload
 * @returns {Buffer | null}
 */
function resolveExcelBuffer(payload) {
  if (payload.base64) {
    const buf = decodeBase64Field(payload.base64);
    if (isZipBuffer(buf)) return buf;
  }
  const text = String(payload.text || "");
  if (text.length >= 2 && text.charCodeAt(0) === 0x50 && text.charCodeAt(1) === 0x4b) {
    return Buffer.from(text, "binary");
  }
  if (text.startsWith("PK")) {
    return Buffer.from(text, "latin1");
  }
  return null;
}

/**
 * @param {{ kind?: string, text?: string, base64?: string, fileName?: string }} payload
 * @param {string} kind
 * @returns {boolean}
 */
function shouldParseAsExcel(payload, kind) {
  if (kind === "excel") return true;
  if (isXlsxFileName(payload.fileName)) return true;
  const buf = resolveExcelBuffer(payload);
  if (buf && isZipBuffer(buf)) return true;
  return String(payload.text || "").startsWith("PK");
}

/**
 * @param {{ kind?: string, text?: string, base64?: string, fileName?: string }} payload
 * @returns {{ contacts: object[], count: number, parseNote: string, fileName: string, skipped: number }}
 */
function parseContactsPayload(payload) {
  const kind = String(payload.kind || "csv").trim().toLowerCase();
  const fileName = String(payload.fileName || "import").trim() || "import";
  let rawRows = [];
  let parseNote = "";
  const autoDetected = kind !== "excel" && shouldParseAsExcel(payload, kind);

  if (shouldParseAsExcel(payload, kind)) {
    const excelBuf = resolveExcelBuffer(payload) || (payload.base64 ? decodeBase64Field(payload.base64) : null);
    if (excelBuf && isZipBuffer(excelBuf)) {
      rawRows = rowsFromXlsxBuffer(excelBuf);
      parseNote = "Parsed Excel (.xlsx) — Apollo column mapping";
      if (autoDetected) parseNote += " (auto-detected)";
    } else if (isXlsxFileName(fileName)) {
      parseNote =
        "Excel file detected (.xlsx) but content was read as CSV text — hard-refresh (Ctrl+Shift+R) and drop the file again";
    }
  }

  if (!rawRows.length && !parseNote) {
    const text = String(payload.text || "");
    rawRows = rowsFromCsvText(text);
    parseNote =
      kind === "text"
        ? "Parsed pasted text — Apollo column mapping when headers present"
        : "Parsed CSV — Apollo column mapping";
  }

  const contacts = [];
  let skipped = 0;
  for (let i = 0; i < rawRows.length; i++) {
    const c = normalizeContactRow(rawRows[i]);
    if (!c) {
      skipped++;
      continue;
    }
    contacts.push(c);
  }

  if (!rawRows.length) {
    if (!parseNote) {
      parseNote = "No rows found — check file format (Apollo export with Email column)";
    }
  } else if (contacts.length) {
    parseNote += " · " + contacts.length + " contact(s) with valid email";
    if (skipped) parseNote += " · " + skipped + " row(s) skipped";
  } else {
    parseNote += " · No valid emails found (need an Email column)";
  }

  return {contacts, count: contacts.length, parseNote, fileName, skipped};
}

module.exports = {
  parseContactsPayload,
  rowsFromCsvText,
  rowsFromXlsxBuffer,
  normalizeContactRow,
};
