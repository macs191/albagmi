import { bankBalance, bankLedger, filterBankLedger, bankMovementTotals } from './banks.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const safeImageUrl = (value = '') => {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
};
const moneyValue = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function renderPaymentMethodFields(prefix, accounts = []) {
  const options = accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
  if (prefix === 'transaction') return `<div class="transaction-payment-block"><label>طريقة دفع التكلفة<select name="costPaymentMethod" id="transactionPaymentMethod"><option value="cash">نقدي</option><option value="bank" ${accounts.length ? 'selected' : ''}>من البنك</option></select></label><label id="transactionBankAccountField" ${accounts.length ? '' : 'hidden'}>حساب دفع التكلفة<select name="costBankAccountId"><option value="">${accounts.length ? 'اختر حساب البنك' : 'أضف حسابًا بنكيًا أولًا'}</option>${options}</select></label><label>طريقة استلام مبلغ العميل<select name="receiptMethod" id="transactionReceiptMethod"><option value="cash" selected>نقدي (افتراضي)</option><option value="bank">إيداع في البنك</option></select></label><label id="transactionReceiptBankField" hidden>حساب استلام الإيراد<select name="receiptBankAccountId"><option value="">اختر حساب البنك</option>${options}</select></label></div>`;
  return `<label>طريقة الدفع<select name="paymentMethod" id="${prefix}PaymentMethod"><option value="cash">نقدي</option><option value="bank">بنكي</option></select></label><label id="${prefix}BankAccountField" hidden>الحساب البنكي<select name="bankAccountId"><option value="">${accounts.length ? 'اختر الحساب البنكي' : 'أضف حسابًا بنكيًا أولًا'}</option>${options}</select></label>`;
}

function renderCard(account, index, balance, large = false) {
  const image = safeImageUrl(account.imageUrl);
  return `<div class="bank-card-wrap"><button type="button" class="bank-card-visual bank-card-tone-${index % 4} ${large ? 'bank-card-large' : ''}" ${large ? '' : `data-open-bank="${escapeHtml(account.id)}"`} aria-label="${large ? escapeHtml(account.name) : `فتح كشف ${escapeHtml(account.name)}`}" ${large ? '' : 'title="افتح كشف الحساب"'}><span class="bank-card-top"><span class="bank-network">SERVICE HUB · BANK</span>${image ? `<img data-bank-image src="${escapeHtml(image)}" alt="${escapeHtml(account.name)}" referrerpolicy="no-referrer">` : '<span class="bank-logo-fallback">BANK</span>'}</span><span class="bank-chip" aria-hidden="true"></span><strong class="bank-card-name">${escapeHtml(account.name)}</strong><span class="bank-balance-label">الرصيد الحالي</span><b class="bank-card-balance">${escapeHtml(balance.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} <small>ر.س</small></b><span class="bank-card-number">•••• &nbsp;•••• &nbsp;•••• &nbsp;${escapeHtml(String(account.id).replace(/[^0-9]/g, '').slice(-4).padStart(4, '0'))}</span></button></div>`;
}

function filterBar(mode, date, month) {
  return `<div class="bank-period-filter"><label>الفترة<select id="bankPeriodMode"><option value="daily" ${mode === 'daily' ? 'selected' : ''}>يومي</option><option value="monthly" ${mode === 'monthly' ? 'selected' : ''}>شهري</option><option value="all" ${mode === 'all' ? 'selected' : ''}>كل الفترات</option></select></label>${mode === 'daily' ? `<label>التاريخ<input id="bankPeriodDate" type="date" value="${escapeHtml(date)}"></label>` : mode === 'monthly' ? `<label>الشهر<input id="bankPeriodMonth" type="month" value="${escapeHtml(month)}"></label>` : '<span class="helper-text">كل الحركات</span>'}</div>`;
}

function filteredLedger(accountId, state, filters) {
  const accounts = accountId ? state.bankAccounts.filter((account) => account.id === accountId) : state.bankAccounts;
  const entries = accounts.flatMap((account) => bankLedger(account.id, state.bankAccounts, state.bankOperations, state.transactions, state.expenses).map((entry) => ({ ...entry, accountName: account.name })));
  return filterBankLedger(entries, filters.mode, filters.mode === 'daily' ? filters.date : filters.month);
}

function renderLedger(entries, formatMoney, formatDateTime) {
  if (!entries.length) return '<div class="small-empty">لا توجد حركات بنكية في الفترة المحددة.</div>';
  return `<div class="bank-ledger-table-wrap"><table class="bank-ledger-table"><thead><tr><th>التاريخ والوقت</th><th>الحساب</th><th>البيان</th><th>التفاصيل</th><th>المبلغ</th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${escapeHtml(entry.dateKey || '—')}<small>${escapeHtml(entry.createdAt ? formatDateTime(entry.createdAt) : '')}</small></td><td>${escapeHtml(entry.accountName || '—')}</td><td>${escapeHtml(entry.title)}</td><td>${escapeHtml(entry.description || '—')}</td><td class="${entry.amount >= 0 ? 'amount-positive' : 'amount-negative'}">${entry.amount >= 0 ? '+' : '−'} ${escapeHtml(formatMoney(Math.abs(entry.amount)))}</td></tr>`).join('')}</tbody></table></div>`;
}

function actionButton(action, label, style = 'secondary-btn') {
  return `<button type="button" class="${style} bank-action-button" data-bank-action="${action}">${label}</button>`;
}

function actionDialog(action, account, accounts) {
  if (!action) return '';
  const names = { add: 'إضافة حساب بنكي', edit: 'تعديل البطاقة', deposit: 'إيداع / إضافة رصيد', withdrawal: 'سحب من الحساب', adjust: 'تسوية الرصيد', transfer: 'تحويل إلى حساب آخر' };
  let form;
  if (action === 'add') {
    form = `<form id="bankCreateForm" class="form-grid"><label>اسم البنك أو الحساب<input name="name" required maxlength="80" placeholder="مثال: الراجحي · حساب المكتب"></label><label>الرصيد الافتتاحي<input name="openingBalance" type="number" min="0" step="0.01" value="0.00" required></label><label class="full-span">رابط صورة البنك (HTTPS)<input name="imageUrl" type="url" placeholder="https://example.com/logo.png"></label><button class="primary-btn" type="submit">إضافة الحساب</button></form>`;
  } else if (action === 'edit' && account) {
    form = `<form id="bankEditForm" class="form-grid"><label>اسم البنك<input name="name" required maxlength="80" value="${escapeHtml(account.name)}"></label><label class="full-span">رابط صورة البنك (HTTPS)<input name="imageUrl" type="url" value="${escapeHtml(account.imageUrl || '')}" placeholder="https://example.com/logo.png"></label><p class="helper-text full-span">اترك رابط الصورة فارغًا للعودة إلى البطاقة النصية.</p><button class="primary-btn" type="submit">حفظ التعديل</button></form>`;
  } else if (['deposit', 'withdrawal'].includes(action) && account) {
    form = `<form id="bankOperationForm" class="form-grid"><input type="hidden" name="type" value="${action}"><label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" required autofocus></label><label class="full-span">البيان<input name="description" required maxlength="160" placeholder="سبب الحركة"></label><button class="primary-btn" type="submit">حفظ الحركة</button></form>`;
  } else if (action === 'adjust' && account) {
    form = `<form id="bankAdjustForm" class="form-grid"><p class="helper-text full-span">الرصيد الحالي: ${escapeHtml(account.balanceText)} ر.س. ستُسجل التسوية كفرق جديد ولن تغيّر سجل الحركات السابق.</p><label>الرصيد الفعلي<input name="targetBalance" type="number" step="0.01" required value="${moneyValue(account.balance).toFixed(2)}"></label><label>سبب التسوية<input name="description" required maxlength="160" placeholder="مطابقة كشف البنك"></label><button class="primary-btn" type="submit">حفظ التسوية</button></form>`;
  } else if (action === 'transfer' && account) {
    const targets = accounts.filter((item) => item.id !== account.id);
    form = targets.length ? `<form id="bankTransferForm" class="form-grid"><label>إلى حساب<select name="toBankAccountId" required><option value="">اختر الحساب المستلم</option>${targets.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></label><label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" required></label><label class="full-span">البيان<input name="description" maxlength="160" placeholder="ملاحظة للتحويل"></label><button class="primary-btn" type="submit">تأكيد التحويل</button></form>` : '<div class="small-empty">أضف حسابًا بنكيًا آخر لإجراء تحويل.</div>';
  }
  if (!form) return '';
  return `<div class="modal-backdrop bank-modal-backdrop" data-bank-modal-backdrop><section class="modal-card bank-action-modal" role="dialog" aria-modal="true" aria-labelledby="bankActionTitle"><header class="modal-heading"><div><p class="eyebrow">${escapeHtml(account?.name || 'الحسابات البنكية')}</p><h2 id="bankActionTitle">${escapeHtml(names[action])}</h2></div><button type="button" class="icon-btn" data-close-bank-action aria-label="إغلاق">×</button></header>${form}<footer class="modal-actions"><button type="button" class="ghost-btn" data-close-bank-action>إلغاء</button></footer></section></div>`;
}

export function renderBankView(state, options) {
  const { selectedAccountId, periodMode, periodDate, periodMonth, formatMoney, formatDateTime, actionModal } = options;
  const filters = { mode: periodMode, date: periodDate, month: periodMonth };
  const accounts = state.bankAccounts || [];
  const selected = accounts.find((account) => account.id === selectedAccountId);
  const totalBalance = accounts.reduce((total, account) => total + bankBalance(account, state.bankOperations, state.transactions, state.expenses), 0);

  if (selected) {
    const balance = bankBalance(selected, state.bankOperations, state.transactions, state.expenses);
    const selectedForModal = { ...selected, balance, balanceText: balance.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };
    const ledger = filteredLedger(selected.id, state, filters);
    const summary = bankMovementTotals(ledger);
    const toolbar = `<div class="bank-toolbar"><button type="button" class="ghost-btn" data-back-banks>← الحسابات</button><div class="bank-toolbar-actions">${actionButton('edit', 'تعديل البطاقة')}${actionButton('deposit', 'إيداع')}${actionButton('withdrawal', 'سحب')}${actionButton('adjust', 'تسوية')}${accounts.length > 1 ? actionButton('transfer', 'تحويل') : ''}</div>${filterBar(periodMode, periodDate, periodMonth)}</div>`;
    return `<section class="banks-view">${toolbar}<div class="bank-detail-heading"><div><p class="eyebrow">كشف حساب بنكي</p><h1>${escapeHtml(selected.name)}</h1></div>${renderCard(selected, accounts.indexOf(selected), balance, true)}</div><div class="summary-grid bank-detail-metrics"><div class="summary-card sales"><small>الرصيد الحالي</small><strong>${escapeHtml(formatMoney(balance))}</strong></div><div class="summary-card net"><small>الوارد بالفترة</small><strong class="amount-positive">${escapeHtml(formatMoney(summary.incoming))}</strong></div><div class="summary-card expense"><small>الصادر بالفترة</small><strong class="amount-negative">${escapeHtml(formatMoney(summary.outgoing))}</strong></div><div class="summary-card net"><small>صافي الحركة</small><strong>${escapeHtml(formatMoney(summary.net))}</strong></div></div><div class="panel bank-ledger-panel"><div class="panel-heading"><div><p class="eyebrow">سجل الحركات</p><h2>كشف ${escapeHtml(selected.name)}</h2></div><span class="record-count">${ledger.length} حركة</span></div>${renderLedger(ledger, formatMoney, formatDateTime)}</div>${actionDialog(actionModal, selectedForModal, accounts)}</section>`;
  }

  const allLedger = filteredLedger(null, state, filters);
  const summary = bankMovementTotals(allLedger);
  return `<section class="banks-view"><div class="bank-toolbar"><div><p class="eyebrow">إدارة السيولة</p><h1>الحسابات البنكية</h1></div><div class="bank-toolbar-actions">${actionButton('add', '+ حساب بنكي', 'primary-btn')}</div>${filterBar(periodMode, periodDate, periodMonth)}</div><div class="summary-grid bank-summary-grid"><div class="summary-card sales"><small>إجمالي الأرصدة الحالية</small><strong>${escapeHtml(formatMoney(totalBalance))}</strong></div><div class="summary-card net"><small>صافي حركة الفترة</small><strong>${escapeHtml(formatMoney(summary.net))}</strong></div><div class="summary-card expense"><small>وارد / صادر</small><strong>${escapeHtml(formatMoney(summary.incoming))} / ${escapeHtml(formatMoney(summary.outgoing))}</strong></div></div><div class="bank-cards-grid">${accounts.map((account, index) => `<div class="bank-card-item">${renderCard(account, index, bankBalance(account, state.bankOperations, state.transactions, state.expenses))}</div>`).join('')}${!accounts.length ? '<div class="bank-empty">لا توجد حسابات بنكية؛ أضف حسابك الأول.</div>' : ''}</div><div class="panel bank-ledger-panel"><div class="panel-heading"><div><p class="eyebrow">كل الحسابات</p><h2>كشف الحركات</h2></div><span class="record-count">${allLedger.length} حركة</span></div>${renderLedger(allLedger, formatMoney, formatDateTime)}</div>${actionDialog(actionModal, null, accounts)}</section>`;
}
