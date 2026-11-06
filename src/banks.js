const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const cents = (value) => Math.round(number(value) * 100);
const money = (value) => Math.round(value) / 100;
const transactionReceiptMethod = (transaction) => transaction.receiptMethod || (transaction.costPaymentMethod ? 'cash' : transaction.paymentMethod);
const transactionReceiptAccountId = (transaction) => transaction.receiptBankAccountId || (!transaction.costPaymentMethod ? transaction.bankAccountId : null);
const transactionCostMethod = (transaction) => transaction.costPaymentMethod || (!transaction.receiptMethod ? transaction.paymentMethod : 'cash');
const transactionCostAccountId = (transaction) => transaction.costBankAccountId || (!transaction.receiptMethod && transaction.paymentMethod === 'bank' && transaction.costPaymentMethod ? transaction.bankAccountId : null);

export function bankBalance(account, operations = [], transactions = [], expenses = []) {
  if (!account?.id) return 0;
  let total = cents(account.openingBalance);
  for (const operation of operations) {
    const amount = cents(operation.amount);
    if (operation.type === 'transfer') {
      if (operation.bankAccountId === account.id) total -= amount;
      if (operation.toBankAccountId === account.id) total += amount;
    } else if (operation.type === 'adjustment' && operation.bankAccountId === account.id) {
      total += cents(operation.delta);
    } else if (operation.bankAccountId === account.id) {
      total += operation.type === 'withdrawal' ? -amount : operation.type === 'deposit' ? amount : 0;
    }
  }
  for (const transaction of transactions) {
    if (transactionReceiptMethod(transaction) === 'bank' && transactionReceiptAccountId(transaction) === account.id) {
      total += cents(transaction.amount);
    }
    if (transactionCostMethod(transaction) === 'bank' && transactionCostAccountId(transaction) === account.id) total -= cents(transaction.costAmount);
  }
  for (const expense of expenses) {
    if (expense.paymentMethod === 'bank' && expense.bankAccountId === account.id) total -= cents(expense.amount);
  }
  return money(total);
}

export function bankLedger(accountId, accounts = [], operations = [], transactions = [], expenses = []) {
  const byId = new Map(accounts.map((account) => [account.id, account.name]));
  const entries = [];
  const account = accounts.find((item) => item.id === accountId);
  if (account && cents(account.openingBalance) !== 0) entries.push({ id: `opening:${account.id}`, dateKey: account.dateKey || account.createdAt?.slice(0, 10) || '', createdAt: account.createdAt || '', amount: money(cents(account.openingBalance)), title: 'الرصيد الافتتاحي', description: 'الرصيد عند إنشاء الحساب' });
  for (const operation of operations) {
    if (operation.type === 'transfer') {
      if (operation.bankAccountId === accountId) entries.push({ id: `${operation.id}:out`, dateKey: operation.dateKey, createdAt: operation.createdAt, amount: -number(operation.amount), title: `تحويل إلى ${byId.get(operation.toBankAccountId) || 'حساب آخر'}`, description: operation.description || '' });
      if (operation.toBankAccountId === accountId) entries.push({ id: `${operation.id}:in`, dateKey: operation.dateKey, createdAt: operation.createdAt, amount: number(operation.amount), title: `تحويل من ${byId.get(operation.bankAccountId) || 'حساب آخر'}`, description: operation.description || '' });
    } else if (operation.bankAccountId === accountId) {
      const amount = operation.type === 'adjustment' ? number(operation.delta) : operation.type === 'withdrawal' ? -number(operation.amount) : operation.type === 'deposit' ? number(operation.amount) : 0;
      const titles = { deposit: 'إضافة رصيد', withdrawal: 'سحب', adjustment: 'تسوية رصيد' };
      entries.push({ id: operation.id, dateKey: operation.dateKey, createdAt: operation.createdAt, amount, title: titles[operation.type] || 'حركة بنكية', description: operation.description || '' });
    }
  }
  for (const transaction of transactions) {
    if (transactionReceiptMethod(transaction) === 'bank' && transactionReceiptAccountId(transaction) === accountId) {
      entries.push({ id: `${transaction.id}:revenue`, dateKey: transaction.dateKey, createdAt: transaction.createdAt, amount: number(transaction.amount), title: 'قيمة البيع المحصلة', description: transaction.siteName || '' });
    }
    if (transactionCostMethod(transaction) === 'bank' && transactionCostAccountId(transaction) === accountId && number(transaction.costAmount) > 0) entries.push({ id: `${transaction.id}:cost`, dateKey: transaction.dateKey, createdAt: transaction.createdAt, amount: -number(transaction.costAmount), title: 'تكلفة تنفيذ الخدمة', description: transaction.siteName || '' });
  }
  for (const expense of expenses) {
    if (expense.paymentMethod === 'bank' && expense.bankAccountId === accountId) entries.push({ id: expense.id, dateKey: expense.dateKey, createdAt: expense.createdAt, amount: -number(expense.amount), title: `مصروف · ${expense.description || ''}`, description: '' });
  }
  return entries.sort((a, b) => `${b.dateKey || ''}${b.createdAt || ''}`.localeCompare(`${a.dateKey || ''}${a.createdAt || ''}`));
}

export function filterBankLedger(entries = [], mode = 'all', value = '') {
  if (mode === 'daily') return entries.filter((entry) => entry.dateKey === value);
  if (mode === 'monthly') return entries.filter((entry) => typeof entry.dateKey === 'string' && entry.dateKey.startsWith(`${value}-`));
  return [...entries];
}

export function bankMovementTotals(entries = []) {
  const centsTotal = entries.reduce((total, entry) => {
    const amount = cents(entry.amount);
    if (amount >= 0) total.incoming += amount;
    else total.outgoing -= amount;
    total.net += amount;
    total.count += 1;
    return total;
  }, { incoming: 0, outgoing: 0, net: 0, count: 0 });
  return { ...centsTotal, incoming: money(centsTotal.incoming), outgoing: money(centsTotal.outgoing), net: money(centsTotal.net) };
}
