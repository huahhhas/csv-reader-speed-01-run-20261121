// A fast drop-in for csv-reader 1.0.0: readCsv's reading of {text, header}, the
// JSON value {columns, rows, errors}, answered by a single left-to-right pass
// that jumps between field ends instead of reading one character at a time.
//
// The reading policy (csv-reader 1.0.0, make.fun's own): a U+FEFF at the very
// start is dropped; a record ends at LF or CRLF, and a line left with no
// characters is no record; outside quotes a CR not followed by LF is dropped
// (stray_cr); a field that opens with a quote runs to the next quote that is
// not doubled, "" inside it is one quote, and each CRLF or lone CR inside it
// is read as LF; what follows its closing quote, up to the next comma or line
// break, is appended as it stands (quote_junk, when the field ends); a quote
// that never closes is a literal character and the text after it is read again
// as unquoted (unterminated_quote); a quote inside an unquoted field is a
// literal character; fields stay strings, never trimmed or converted. columns
// is the first record when header is true, else null; rows holds the records
// after it (every record when header is false), each padded with "" (short_row,
// with fields: its count) or cut (long_row, with extra: the cut fields) to the
// first record's width. Each error is {code, line, row}, in the order met: line
// the 1-based line its record starts on, row its record's index in rows (null
// for the header).
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the
// next. Each case is answered alone.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 'comma';
const LINE_BREAK = 'line break';
const END = 'end';

/** The next comma, CR or LF at or after a position (shared; lastIndex is set before every use). */
const NEXT_UNQUOTED_END = /[,\r\n]/g;
/** The next quote, CR or LF at or after a position (shared; lastIndex is set before every use). */
const NEXT_QUOTED_END = /["\r\n]/g;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text[0] === '\uFEFF') pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `start` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns the field and how
  // it ended; `added` counts the characters kept after `start`.
  function readUnquoted(start) {
    let value = start;
    let seg = pos; // the start of the slice not yet appended
    for (;;) {
      NEXT_UNQUOTED_END.lastIndex = pos;
      const hit = NEXT_UNQUOTED_END.exec(text);
      if (hit === null) {
        value += text.slice(seg);
        pos = text.length;
        return { value, ended: END, added: value.length - start.length };
      }
      const i = hit.index;
      const c = text[i];
      if (c === ',') {
        value += text.slice(seg, i);
        pos = i + 1;
        return { value, ended: COMMA, added: value.length - start.length };
      }
      if (c === '\n') {
        value += text.slice(seg, i);
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added: value.length - start.length };
      }
      if (text[i + 1] === '\n') {
        value += text.slice(seg, i);
        pos = i + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added: value.length - start.length };
      }
      // A lone CR: dropped, and the field goes on after it.
      error('stray_cr');
      value += text.slice(seg, i);
      pos = i + 1;
      seg = pos;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    let seg = pos;
    for (;;) {
      NEXT_QUOTED_END.lastIndex = pos;
      const hit = NEXT_QUOTED_END.exec(text);
      if (hit === null) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      const i = hit.index;
      const c = text[i];
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += text.slice(seg, i) + '"';
          pos = i + 2;
          seg = pos;
          continue;
        }
        value += text.slice(seg, i);
        pos = i + 1;
        break;
      }
      // A line break inside quotes is one LF, and counts a line.
      value += text.slice(seg, i) + '\n';
      line += 1;
      pos = c === '\r' && text[i + 1] === '\n' ? i + 2 : i + 1;
      seg = pos;
    }
    if (pos >= text.length) return { value, ended: END };
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === '\r' && text[pos + 1] === '\n') {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < text.length) {
      if (text[pos] === '\n') {
        pos += 1;
        line += 1;
      } else if (text[pos] === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= text.length) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text[pos] === '"';
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
