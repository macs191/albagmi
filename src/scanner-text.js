export function normalizeOcrText(value) {
  return String(value || '')
    .replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) >= 0x06f0 ? digit.charCodeAt(0) - 0x06f0 : digit.charCodeAt(0) - 0x0660))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t\u00a0 ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractScannerFields(value) {
  const text = normalizeOcrText(value);
  const dates = [];
  const dateSpans = [];
  const monthNames = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)';
  const datePattern = new RegExp(`(?:\\d{4}\\s*[./-]\\s*\\d{1,2}\\s*[./-]\\s*\\d{1,2}|\\d{1,2}\\s*[./-]\\s*\\d{1,2}\\s*[./-]\\s*\\d{2,4}|\\d{1,2}\\s+${monthNames}\\s+\\d{4})`, 'giu');
  for (const match of text.matchAll(datePattern)) {
    const numbers = (match[0].match(/\d+/g) || []).map(Number);
    const namedMonth = new RegExp(monthNames, 'iu').test(match[0]);
    const datePartsLookValid = namedMonth || (numbers.length === 3 && (
      (numbers[0] >= 1000 && numbers[1] >= 1 && numbers[1] <= 12 && numbers[2] >= 1 && numbers[2] <= 31)
      || (numbers[0] >= 1 && numbers[0] <= 31 && numbers[1] >= 1 && numbers[1] <= 12)
      || (numbers[0] >= 1 && numbers[0] <= 12 && numbers[1] >= 1 && numbers[1] <= 31)
    ));
    if (!datePartsLookValid) continue;
    const date = match[0].replace(/\s+/g, ' ').trim();
    if (!dates.includes(date)) dates.push(date);
    dateSpans.push([match.index, match.index + match[0].length]);
  }

  const numbers = [];
  const numberPattern = /\+?\d+(?:[ \t]*[.,/-][ \t]*\d+|\s+\d+)*/g;
  for (const match of text.matchAll(numberPattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (dateSpans.some(([dateStart, dateEnd]) => start < dateEnd && end > dateStart)) continue;
    const number = match[0].replace(/\s+/g, ' ').trim();
    if (number && !numbers.includes(number)) numbers.push(number);
  }
  return { dates, numbers };
}
