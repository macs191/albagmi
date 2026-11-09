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

const DATE_PATTERN = /(?:\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}|\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+\d{4})/giu;
const BIRTH_LABEL = /(?:تاريخ\s*(?:الميلاد|الولادة)|الميلاد|تاريخ\s*الولادة|date\s*of\s*birth|birth\s*date|\bdob\b)/i;
const ID_LABEL = /(?:رقم\s*(?:الهوية|الإقامة|الاقامة)|رقم\s*الهوية\s*الوطنية|الهوية\s*رقم|national\s*id|identity\s*(?:no\.?|number)|id\s*(?:no\.?|number))/i;
const SERIAL_LABEL = /(?:الرقم\s*(?:التسلسلي|المتسلسل)|رقم\s*التسلسل|serial\s*(?:no\.?|number)|document\s*(?:no\.?|number)|card\s*(?:no\.?|number))/i;
const EXPIRY_LABEL = /(?:انتهاء|الانتهاء|الصلاحية|تاريخ\s*الانتهاء|expiry|expiration|valid\s*until)/i;

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidDate(value) {
  const parts = (value.match(/\d+/g) || []).map(Number);
  if (parts.length !== 3) return false;
  if (parts[0] >= 1000) return parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1 && parts[2] <= 31;
  return (parts[0] >= 1 && parts[0] <= 31 && parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 0 && parts[2] <= 9999)
    || (parts[0] >= 1 && parts[0] <= 12 && parts[1] >= 1 && parts[1] <= 31 && parts[2] >= 0 && parts[2] <= 9999);
}

function findDate(value) {
  DATE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(DATE_PATTERN)) {
    if (isValidDate(match[0])) return match[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}

function valueAfterLabel(line, labelPattern) {
  const match = labelPattern.exec(line);
  if (!match) return '';
  return line.slice(match.index + match[0].length).replace(/^[\s:：#؛،.\-]+/, '').trim();
}

function digitsIn(value) {
  return [...String(value || '').matchAll(/\d[\d\s-]{4,}\d/g)]
    .map(([candidate]) => digitsOnly(candidate))
    .filter(Boolean);
}

function labeledValue(lines, labelPattern, nextLine = true) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!labelPattern.test(lines[index])) continue;
    const sameLine = valueAfterLabel(lines[index], labelPattern);
    const candidates = digitsIn(sameLine);
    if (candidates.length) return candidates[0];
    if (nextLine && lines[index + 1]) {
      const nextCandidates = digitsIn(lines[index + 1]);
      if (nextCandidates.length) return nextCandidates[0];
    }
  }
  return '';
}

export function extractScannerFields(value) {
  const text = normalizeOcrText(value);
  const lines = text.split('\n').filter(Boolean);

  let identityNumber = labeledValue(lines, ID_LABEL, true);
  if (!/^\d{10}$/.test(identityNumber) || !/^[12]/.test(identityNumber)) {
    const match = text.match(/(?:^|\D)([12]\d{9})(?!\d)/);
    identityNumber = match?.[1] || (identityNumber.length >= 8 && identityNumber.length <= 15 ? identityNumber : '');
  }

  let birthDate = '';
  for (let index = 0; index < lines.length; index += 1) {
    if (!BIRTH_LABEL.test(lines[index])) continue;
    birthDate = findDate(valueAfterLabel(lines[index], BIRTH_LABEL))
      || findDate(lines[index + 1] || '');
    if (birthDate) break;
  }
  if (!birthDate) {
    for (let index = 0; index < lines.length; index += 1) {
      if (EXPIRY_LABEL.test(lines[index])) continue;
      birthDate = findDate(lines[index]);
      if (birthDate) break;
    }
  }

  let serialNumber = labeledValue(lines, SERIAL_LABEL, true);
  if (serialNumber && serialNumber === identityNumber) serialNumber = '';
  if (!serialNumber) {
    for (const candidate of text.matchAll(/(?:^|\D)(\d{6,15})(?!\d)/g)) {
      if (candidate[1] !== identityNumber) continue;
      const line = lines.find((item) => item.includes(candidate[1])) || '';
      if (SERIAL_LABEL.test(line)) {
        serialNumber = candidate[1];
        break;
      }
    }
  }

  return { identityNumber, birthDate, serialNumber };
}
