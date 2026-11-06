const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const totalOf = (records) => records.reduce((sum, record) => sum + Number(record.amount || 0), 0);
const transactionCostOf = (records) => records.reduce((sum, record) => sum + Number(record.costAmount || 0), 0);
const transactionProfitOf = (records) => records.reduce((sum, record) => sum + Number(record.amount || 0) - Number(record.costAmount || 0), 0);
const formatMoney = (value) => `${Number(value || 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س`;
const formatCount = (value) => Number(value || 0).toLocaleString('ar-SA');
const paymentMethodLabel = (item) => {
  if (item.receiptMethod || item.costPaymentMethod) {
    const receipt = item.receiptMethod === 'bank' ? `إيراد بنكي${item.receiptBankName ? ` · ${item.receiptBankName}` : ''}` : 'استلام نقدي';
    const cost = item.costPaymentMethod === 'bank' ? `تكلفة من البنك${item.costBankName ? ` · ${item.costBankName}` : ''}` : 'تكلفة نقدية';
    return `${receipt} · ${cost}`;
  }
  return item.paymentMethod === 'bank' ? `بنكي${item.bankName ? ` · ${item.bankName}` : ''}` : 'نقدي';
};
const formatDateKey = (key) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return String(key || '—');
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${key}T12:00:00`));
};
const formatMonthKey = (key) => {
  if (!/^\d{4}-\d{2}$/.test(String(key || ''))) return String(key || '—');
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { year: 'numeric', month: 'long' }).format(new Date(`${key}-01T12:00:00`));
};
const formatTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit' }).format(date);
};

export function aggregateDailyReport(dateKey, transactions = [], expenses = []) {
  const dayTransactions = transactions.filter((item) => item.dateKey === dateKey);
  const dayExpenses = expenses.filter((item) => item.dateKey === dateKey);
  const salesTotal = totalOf(dayTransactions);
  const transactionCostsTotal = transactionCostOf(dayTransactions);
  const transactionProfit = transactionProfitOf(dayTransactions);
  const expensesTotal = totalOf(dayExpenses);
  return {
    dateKey,
    transactions: dayTransactions,
    expenses: dayExpenses,
    salesTotal,
    transactionCostsTotal,
    transactionProfit,
    expensesTotal,
    net: transactionProfit - expensesTotal
  };
}

export function aggregateMonthlyReport(monthKey, transactions = [], expenses = []) {
  const dayMap = new Map();
  const getDay = (key) => {
    if (!dayMap.has(key)) dayMap.set(key, { dateKey: key, transactions: [], expenses: [] });
    return dayMap.get(key);
  };
  for (const item of transactions) {
    if (typeof item.dateKey === 'string' && item.dateKey.startsWith(`${monthKey}-`)) getDay(item.dateKey).transactions.push(item);
  }
  for (const item of expenses) {
    if (typeof item.dateKey === 'string' && item.dateKey.startsWith(`${monthKey}-`)) getDay(item.dateKey).expenses.push(item);
  }
  const monthParts = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (monthParts) {
    const year = Number(monthParts[1]);
    const month = Number(monthParts[2]);
    if (month >= 1 && month <= 12) {
      const dayCount = new Date(year, month, 0).getDate();
      for (let day = 1; day <= dayCount; day += 1) getDay(`${monthKey}-${String(day).padStart(2, '0')}`);
    }
  }
  const days = [...dayMap.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)).map((day) => {
    const salesTotal = totalOf(day.transactions);
    const transactionCostsTotal = transactionCostOf(day.transactions);
    const transactionProfit = transactionProfitOf(day.transactions);
    const expensesTotal = totalOf(day.expenses);
    return { ...day, salesTotal, transactionCostsTotal, transactionProfit, expensesTotal, net: transactionProfit - expensesTotal };
  });
  const salesTotal = days.reduce((sum, day) => sum + day.salesTotal, 0);
  const transactionCostsTotal = days.reduce((sum, day) => sum + day.transactionCostsTotal, 0);
  const transactionProfit = days.reduce((sum, day) => sum + day.transactionProfit, 0);
  const expensesTotal = days.reduce((sum, day) => sum + day.expensesTotal, 0);
  return {
    monthKey,
    days,
    salesTotal,
    transactionCostsTotal,
    transactionProfit,
    expensesTotal,
    net: transactionProfit - expensesTotal,
    transactionCount: days.reduce((sum, day) => sum + day.transactions.length, 0),
    expenseCount: days.reduce((sum, day) => sum + day.expenses.length, 0)
  };
}

export function aggregateRangeReport(startKey, endKey, transactions = [], expenses = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startKey || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endKey || '')) || startKey > endKey) throw new TypeError('invalid_report_range');
  const start = Date.parse(`${startKey}T12:00:00Z`);
  const end = Date.parse(`${endKey}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 3660 * 86400000) throw new RangeError('report_range_too_large');
  const byDay = new Map();
  const getDay = (key) => {
    if (!byDay.has(key)) byDay.set(key, { dateKey: key, transactions: [], expenses: [] });
    return byDay.get(key);
  };
  for (const item of transactions) if (item.dateKey >= startKey && item.dateKey <= endKey) getDay(item.dateKey).transactions.push(item);
  for (const item of expenses) if (item.dateKey >= startKey && item.dateKey <= endKey) getDay(item.dateKey).expenses.push(item);
  for (let timestamp = start; timestamp <= end; timestamp += 86400000) getDay(new Date(timestamp).toISOString().slice(0, 10));
  const days = [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)).map((day) => {
    const salesTotal = totalOf(day.transactions);
    const transactionCostsTotal = transactionCostOf(day.transactions);
    const transactionProfit = transactionProfitOf(day.transactions);
    const expensesTotal = totalOf(day.expenses);
    return { ...day, salesTotal, transactionCostsTotal, transactionProfit, expensesTotal, net: transactionProfit - expensesTotal };
  });
  const allTransactions = days.flatMap((day) => day.transactions);
  const allExpenses = days.flatMap((day) => day.expenses);
  const salesTotal = totalOf(allTransactions);
  const transactionCostsTotal = transactionCostOf(allTransactions);
  const transactionProfit = transactionProfitOf(allTransactions);
  const expensesTotal = totalOf(allExpenses);
  return { startKey, endKey, days, transactions: allTransactions, expenses: allExpenses, salesTotal, transactionCostsTotal, transactionProfit, expensesTotal, net: transactionProfit - expensesTotal };
}

function reportDocument({ title, officeName, subtitle, content, landscape = false }) {
  const printedAt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 13mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17212b; background: #eef2f4; font: 12px/1.6 Tahoma, Arial, sans-serif; }
    main { width: min(100%, 1050px); margin: 24px auto; padding: 28px; background: #fff; box-shadow: 0 6px 24px #0002; }
    header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 16px; border-bottom: 2px solid #194e58; }
    h1 { margin: 0 0 5px; color: #164751; font-size: 24px; }
    h2 { margin: 22px 0 10px; color: #164751; font-size: 15px; }
    p { margin: 0; }
    .office { font-size: 16px; font-weight: 700; }
    .muted { color: #596873; }
    .print-meta { min-width: 150px; text-align: left; color: #596873; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0 22px; }
    .metric { padding: 12px; border: 1px solid #d8e0e4; border-radius: 8px; }
    .metric span { display: block; color: #596873; font-size: 10px; }
    .metric strong { display: block; margin-top: 4px; color: #164751; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 18px; font-size: 11px; }
    thead { display: table-header-group; }
    th, td { padding: 7px 8px; border: 1px solid #cbd5da; text-align: right; }
    th { color: #173f48; background: #eaf2f3; font-weight: 700; }
    tfoot { font-weight: 700; background: #f3f6f7; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .amount { direction: ltr; text-align: left; white-space: nowrap; }
    .empty { padding: 14px; color: #596873; text-align: center; border: 1px dashed #cbd5da; }
    footer { margin-top: 25px; padding-top: 9px; color: #6b7880; border-top: 1px solid #d8e0e4; font-size: 9px; }
    @media screen { .hint { margin: 10px auto; color: #374b55; text-align: center; } }
    @media print { body { background: #fff; } main { width: auto; max-width: none; margin: 0; padding: 0; box-shadow: none; } .hint { display: none; } }
  </style></head><body><main><header><div><p class="office">${escapeHtml(officeName || 'المكتب')}</p><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(subtitle)}</p></div><div class="print-meta">تاريخ الطباعة<br>${escapeHtml(printedAt)}</div></header>${content}<footer>تم إنشاء هذا التقرير من نظام إدارة المكتب. يُرجى مراجعة السجلات قبل اعتماد التقرير.</footer></main><p class="hint">استخدم نافذة الطباعة لاختيار الطابعة أو الحفظ بصيغة PDF.</p></body></html>`;
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function emptyRow(colspan, text) {
  return `<tr><td class="empty" colspan="${colspan}">${escapeHtml(text)}</td></tr>`;
}

export function renderDailyReportHtml({ officeName, report }) {
  const transactionRows = report.transactions.length
    ? report.transactions.map((item, index) => `<tr><td>${formatCount(index + 1)}</td><td>${escapeHtml(item.siteName || '—')}</td><td>${escapeHtml(paymentMethodLabel(item))}</td><td class="amount">${escapeHtml(formatMoney(item.amount))}</td><td class="amount">${escapeHtml(formatMoney(item.costAmount || 0))}</td><td class="amount">${escapeHtml(formatMoney(Number(item.amount || 0) - Number(item.costAmount || 0)))}</td><td>${escapeHtml(formatTime(item.createdAt))}</td></tr>`).join('')
    : emptyRow(7, 'لا توجد معاملات مسجلة في هذا اليوم.');
  const expenseRows = report.expenses.length
    ? report.expenses.map((item, index) => `<tr><td>${formatCount(index + 1)}</td><td>${escapeHtml(item.description || '—')}</td><td>${escapeHtml(paymentMethodLabel(item))}</td><td>${escapeHtml(formatTime(item.createdAt))}</td><td class="amount">${escapeHtml(formatMoney(item.amount))}</td></tr>`).join('')
    : emptyRow(5, 'لا توجد مصروفات مسجلة في هذا اليوم.');
  const content = `<section class="metrics">${metric('إيراد البيع', formatMoney(report.salesTotal))}${metric('تكلفة المعاملات', formatMoney(report.transactionCostsTotal))}${metric('ربح المعاملات', formatMoney(report.transactionProfit))}${metric('مصروفات أخرى', formatMoney(report.expensesTotal))}${metric('صافي الربح', formatMoney(report.net))}</section><p class="muted">التاريخ: ${escapeHtml(formatDateKey(report.dateKey))} · عدد المعاملات: ${formatCount(report.transactions.length)} · عدد المصروفات الأخرى: ${formatCount(report.expenses.length)}</p><h2>تفاصيل المعاملات</h2><table><thead><tr><th>#</th><th>الخدمة</th><th>طرق الاستلام والتكلفة</th><th>المبلغ المحصل</th><th>تكلفة الخدمة</th><th>ربح المعاملة</th><th>الوقت</th></tr></thead><tbody>${transactionRows}</tbody><tfoot><tr><td colspan="3">إجمالي المعاملات</td><td class="amount">${escapeHtml(formatMoney(report.salesTotal))}</td><td class="amount">${escapeHtml(formatMoney(report.transactionCostsTotal))}</td><td class="amount">${escapeHtml(formatMoney(report.transactionProfit))}</td><td></td></tr></tfoot></table><h2>تفاصيل المصروفات الأخرى</h2><table><thead><tr><th>#</th><th>البيان</th><th>طريقة الدفع</th><th>الوقت</th><th>القيمة</th></tr></thead><tbody>${expenseRows}</tbody><tfoot><tr><td colspan="4">إجمالي المصروفات الأخرى</td><td class="amount">${escapeHtml(formatMoney(report.expensesTotal))}</td></tr></tfoot></table>`;
  return reportDocument({ title: 'تقرير المبيعات اليومي', officeName, subtitle: `تقرير يوم ${formatDateKey(report.dateKey)}`, content });
}

export function renderMonthlyReportHtml({ officeName, report }) {
  const rows = report.days.length
    ? report.days.map((day) => `<tr><td>${escapeHtml(formatDateKey(day.dateKey))}</td><td>${formatCount(day.transactions.length)}</td><td class="amount">${escapeHtml(formatMoney(day.salesTotal))}</td><td class="amount">${escapeHtml(formatMoney(day.transactionCostsTotal))}</td><td class="amount">${escapeHtml(formatMoney(day.transactionProfit))}</td><td>${formatCount(day.expenses.length)}</td><td class="amount">${escapeHtml(formatMoney(day.expensesTotal))}</td><td class="amount">${escapeHtml(formatMoney(day.net))}</td></tr>`).join('')
    : emptyRow(8, 'لا توجد مبيعات أو مصروفات مسجلة في هذا الشهر.');
  const content = `<section class="metrics">${metric('إيراد المبيعات', formatMoney(report.salesTotal))}${metric('تكلفة المعاملات', formatMoney(report.transactionCostsTotal))}${metric('ربح المعاملات', formatMoney(report.transactionProfit))}${metric('مصروفات أخرى', formatMoney(report.expensesTotal))}${metric('صافي الشهر', formatMoney(report.net))}</section><p class="muted">الشهر: ${escapeHtml(formatMonthKey(report.monthKey))} · عدد المعاملات: ${formatCount(report.transactionCount)} · عدد المصروفات الأخرى: ${formatCount(report.expenseCount)}</p><h2>ملخص كل يوم</h2><table><thead><tr><th>اليوم</th><th>عدد المعاملات</th><th>إيراد البيع</th><th>تكلفة المعاملات</th><th>الربح</th><th>عدد المصروفات</th><th>مصروفات أخرى</th><th>الصافي</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td>إجمالي الشهر</td><td>${formatCount(report.transactionCount)}</td><td class="amount">${escapeHtml(formatMoney(report.salesTotal))}</td><td class="amount">${escapeHtml(formatMoney(report.transactionCostsTotal))}</td><td class="amount">${escapeHtml(formatMoney(report.transactionProfit))}</td><td>${formatCount(report.expenseCount)}</td><td class="amount">${escapeHtml(formatMoney(report.expensesTotal))}</td><td class="amount">${escapeHtml(formatMoney(report.net))}</td></tr></tfoot></table>`;
  return reportDocument({ title: 'التقرير الشهري', officeName, subtitle: `ملخص شهر ${formatMonthKey(report.monthKey)}`, content, landscape: true });
}

export function renderRangeReportHtml({ officeName, report }) {
  const saleRows = report.transactions.length
    ? report.transactions.map((item, index) => `<tr><td>${formatCount(index + 1)}</td><td>${escapeHtml(item.siteName || '—')}</td><td>${escapeHtml(paymentMethodLabel(item))}</td><td class="amount">${escapeHtml(formatMoney(item.amount))}</td><td class="amount">${escapeHtml(formatMoney(item.costAmount || 0))}</td><td class="amount">${escapeHtml(formatMoney(Number(item.amount || 0) - Number(item.costAmount || 0)))}</td><td>${escapeHtml(formatDateKey(item.dateKey))}</td><td>${escapeHtml(formatTime(item.createdAt))}</td></tr>`).join('')
    : emptyRow(8, 'لا توجد معاملات في الفترة المحددة.');
  const expenseRows = report.expenses.length
    ? report.expenses.map((item, index) => `<tr><td>${formatCount(index + 1)}</td><td>${escapeHtml(item.description || '—')}</td><td>${escapeHtml(paymentMethodLabel(item))}</td><td>${escapeHtml(formatDateKey(item.dateKey))}</td><td>${escapeHtml(formatTime(item.createdAt))}</td><td class="amount">${escapeHtml(formatMoney(item.amount))}</td></tr>`).join('')
    : emptyRow(6, 'لا توجد مصروفات في الفترة المحددة.');
  const dayRows = report.days.map((day) => `<tr><td>${escapeHtml(formatDateKey(day.dateKey))}</td><td class="amount">${escapeHtml(formatMoney(day.salesTotal))}</td><td class="amount">${escapeHtml(formatMoney(day.transactionCostsTotal))}</td><td class="amount">${escapeHtml(formatMoney(day.transactionProfit))}</td><td class="amount">${escapeHtml(formatMoney(day.expensesTotal))}</td><td class="amount">${escapeHtml(formatMoney(day.net))}</td></tr>`).join('');
  const content = `<section class="metrics">${metric('إيراد البيع', formatMoney(report.salesTotal))}${metric('تكلفة المعاملات', formatMoney(report.transactionCostsTotal))}${metric('ربح المعاملات', formatMoney(report.transactionProfit))}${metric('مصروفات أخرى', formatMoney(report.expensesTotal))}${metric('صافي الفترة', formatMoney(report.net))}</section><p class="muted">من ${escapeHtml(formatDateKey(report.startKey))} إلى ${escapeHtml(formatDateKey(report.endKey))} · عدد المعاملات: ${formatCount(report.transactions.length)} · عدد المصروفات الأخرى: ${formatCount(report.expenses.length)}</p><h2>ملخص الأيام</h2><table><thead><tr><th>اليوم</th><th>إيراد البيع</th><th>التكلفة</th><th>الربح</th><th>مصروفات أخرى</th><th>الصافي</th></tr></thead><tbody>${dayRows}</tbody></table><h2>تفاصيل المعاملات</h2><table><thead><tr><th>#</th><th>الخدمة</th><th>الاستلام/التكلفة</th><th>المبلغ المقبوض</th><th>التكلفة</th><th>الربح</th><th>التاريخ</th><th>الوقت</th></tr></thead><tbody>${saleRows}</tbody><tfoot><tr><td colspan="3">إجمالي المعاملات</td><td class="amount">${escapeHtml(formatMoney(report.salesTotal))}</td><td class="amount">${escapeHtml(formatMoney(report.transactionCostsTotal))}</td><td class="amount">${escapeHtml(formatMoney(report.transactionProfit))}</td><td colspan="2"></td></tr></tfoot></table><h2>تفاصيل المصروفات الأخرى</h2><table><thead><tr><th>#</th><th>البيان</th><th>طريقة الدفع</th><th>التاريخ</th><th>الوقت</th><th>القيمة</th></tr></thead><tbody>${expenseRows}</tbody><tfoot><tr><td colspan="5">إجمالي المصروفات الأخرى</td><td class="amount">${escapeHtml(formatMoney(report.expensesTotal))}</td></tr></tfoot></table>`;
  return reportDocument({ title: 'تقرير المبيعات والمصروفات للفترة', officeName, subtitle: `من ${formatDateKey(report.startKey)} إلى ${formatDateKey(report.endKey)}`, content, landscape: true });
}

export function openPrintWindow(html) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 350);
  return true;
}
