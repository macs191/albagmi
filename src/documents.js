import { openPrintWindow } from './reports.js';

const STORAGE_KEY = 'servicehub-documents-v1';

let data = loadData();
let activeTab = 'documents';
let selectedCategoryId = data.documentCategories[0]?.id || null;
let selectedPriceCategoryId = data.priceCategories[0]?.id || null;
let editingDocumentId = null;
let editingPriceId = null;
let editorHtml = '';
let editorTitle = '';
let editorCategoryId = '';

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const escapeAttribute = escapeHtml;

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      documentCategories: Array.isArray(saved.documentCategories) ? saved.documentCategories : [],
      documents: Array.isArray(saved.documents) ? saved.documents : [],
      priceCategories: Array.isArray(saved.priceCategories) ? saved.priceCategories : [],
      prices: Array.isArray(saved.prices) ? saved.prices : []
    };
  } catch { return { documentCategories: [], documents: [], priceCategories: [], prices: [] }; }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function notify(render, message, type = 'success') { saveData(); render(); window.dispatchEvent(new CustomEvent('servicehub-toast', { detail: { message, type } })); }
function currentDocumentCategory() { return data.documentCategories.find((item) => item.id === selectedCategoryId) || null; }
function currentPriceCategory() { return data.priceCategories.find((item) => item.id === selectedPriceCategoryId) || null; }
function defaultDocumentHtml() { return '<h2>عنوان الوثيقة</h2><p>اكتب نص الوثيقة هنا، ثم أضف الخانات الفارغة من شريط الأدوات لتعبئتها يدويًا بعد الطباعة.</p><p>أنا الموقع أدناه أقر بما ورد في هذه الوثيقة:</p><p>................................................................................................</p><p>التاريخ: <span class="document-field" contenteditable="false" draggable="true" data-field="التاريخ" data-width="150">التاريخ</span></p><p><br></p><p>توقيع الطرف الأول: <span class="document-field" contenteditable="false" draggable="true" data-field="التوقيع" data-width="190">التوقيع</span></p>'; }
function blankField(label = 'خانة فارغة', width = 180) { const safeWidth = Math.max(70, Math.min(700, Number(width) || 180)); return `<span class="document-field" contenteditable="false" draggable="true" data-field="${escapeAttribute(label)}" data-width="${safeWidth}" style="width:${safeWidth}px">${escapeHtml(label)}</span>`; }
function renderCategoryList(categories, selectedId, kind) {
  return categories.map((category) => `<button class="document-category-item ${category.id === selectedId ? 'active' : ''}" type="button" data-select-document-category="${escapeAttribute(category.id)}" data-category-kind="${kind}"><span>${escapeHtml(category.name)}</span><small>${kind === 'documents' ? data.documents.filter((item) => item.categoryId === category.id).length : data.prices.filter((item) => item.categoryId === category.id).length}</small></button>`).join('');
}
function renderDocumentList() {
  const category = currentDocumentCategory();
  const list = data.documents.filter((item) => !category || item.categoryId === category.id);
  return list.length ? list.map((item) => `<article class="document-list-row"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleString('ar-SA') : '')}</small></div><div class="document-row-actions"><button class="icon-btn" type="button" data-edit-document="${escapeAttribute(item.id)}">فتح وتعديل</button><button class="icon-btn" type="button" data-print-document="${escapeAttribute(item.id)}">طباعة</button><button class="icon-btn danger" type="button" data-delete-document="${escapeAttribute(item.id)}">حذف</button></div></article>`).join('') : '<div class="small-empty">لا توجد وثائق في هذا القسم بعد.</div>';
}
function renderPriceList() {
  const category = currentPriceCategory();
  const list = data.prices.filter((item) => !category || item.categoryId === category.id);
  return list.length ? list.map((item) => `<article class="price-list-row"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || 'بدون وصف')} · ${escapeHtml(item.price || 'السعر غير محدد')}</small></div><div class="document-row-actions"><button class="icon-btn" type="button" data-edit-price="${escapeAttribute(item.id)}">تعديل</button><button class="icon-btn danger" type="button" data-delete-price="${escapeAttribute(item.id)}">حذف</button></div></article>`).join('') : '<div class="small-empty">لا توجد أسعار أو خدمات في هذا القسم بعد.</div>';
}
function renderEditor() {
  const document = data.documents.find((item) => item.id === editingDocumentId);
  const title = document?.title || editorTitle || '';
  const categoryId = document?.categoryId || editorCategoryId || selectedCategoryId || '';
  const html = document?.html || editorHtml || defaultDocumentHtml();
  return `<section class="document-editor-card panel"><header class="document-editor-header"><div><p class="eyebrow">محرر الوثيقة</p><h2>${document ? 'تعديل الوثيقة' : 'وثيقة جديدة'}</h2></div><div class="document-row-actions"><button class="ghost-btn" type="button" data-close-document-editor>إغلاق</button><button class="primary-btn" type="button" data-save-document>حفظ الوثيقة</button></div></header><div class="form-grid document-meta-form"><label>اسم الوثيقة<input id="documentTitle" maxlength="160" value="${escapeAttribute(title)}" placeholder="مثال: عقد بيع سيارة"></label><label>القسم<select id="documentCategory">${data.documentCategories.map((item) => `<option value="${escapeAttribute(item.id)}" ${item.id === categoryId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label></div><div class="document-toolbar"><button type="button" data-doc-command="bold"><b>عريض</b></button><button type="button" data-doc-command="italic"><i>مائل</i></button><button type="button" data-doc-command="underline"><u>تحته خط</u></button><button type="button" data-doc-command="justifyRight">يمين</button><button type="button" data-doc-command="justifyCenter">وسط</button><span></span><button type="button" data-add-field="الاسم">+ خانة اسم</button><button type="button" data-add-field="رقم الهوية">+ خانة هوية</button><button type="button" data-add-field="التوقيع">+ خانة توقيع</button><button type="button" data-add-field="بيانات المركبة">+ خانة بيانات</button><button type="button" data-add-field="خانة فارغة">+ خانة فارغة</button></div><p class="document-editor-help">اكتب مثل Word، وضع المؤشر في المكان المطلوب ثم أضف خانة. اسحب الخانة لتحريكها، واسحب مقبض الزاوية لتكبيرها أو تصغيرها. الخانات ستطبع فارغة لتعبئتها يدويًا.</p><div id="documentEditor" class="document-paper" contenteditable="true" spellcheck="false">${html}</div></section>`;
}
function renderDocuments(render) {
  if (editingDocumentId || editorHtml) return renderEditor();
  const docCategory = currentDocumentCategory();
  const priceCategory = currentPriceCategory();
  return `<section class="documents-view"><div class="view-title-row"><div><p class="eyebrow">محفوظ محليًا على هذا الكمبيوتر</p><h1>الوثائق والأسعار</h1><p class="page-subtitle">أنشئ نماذجك وأسعار خدماتك بنفسك، ثم اطبع الوثائق على ورق A4.</p></div><div class="document-row-actions"><button class="primary-btn" type="button" data-new-document>إضافة وثيقة</button><button class="secondary-btn" type="button" data-new-price>إضافة سعر</button></div></div><div class="document-tabs"><button class="chip ${activeTab === 'documents' ? 'selected' : ''}" data-document-tab="documents">الوثائق (${data.documents.length})</button><button class="chip ${activeTab === 'prices' ? 'selected' : ''}" data-document-tab="prices">الأسعار والخدمات (${data.prices.length})</button></div>${activeTab === 'documents' ? `<div class="documents-layout"><aside class="panel document-categories"><div class="panel-heading"><div><p class="eyebrow">الأقسام</p><h2>أقسام الوثائق</h2></div><button class="icon-btn" type="button" data-add-category="documents" aria-label="إضافة قسم">+</button></div>${renderCategoryList(data.documentCategories, docCategory?.id, 'documents') || '<div class="small-empty">أضف أول قسم للوثائق.</div>'}<button class="ghost-btn category-add-btn" type="button" data-add-category="documents">إضافة قسم</button></aside><section class="panel document-list-panel"><div class="panel-heading"><div><p class="eyebrow">${escapeHtml(docCategory?.name || 'اختر قسمًا')}</p><h2>وثائقي</h2></div><span class="record-count">${data.documents.filter((item) => !docCategory || item.categoryId === docCategory.id).length}</span></div>${renderDocumentList()}</section></div>` : `<div class="documents-layout"><aside class="panel document-categories"><div class="panel-heading"><div><p class="eyebrow">الأقسام</p><h2>أقسام الأسعار</h2></div><button class="icon-btn" type="button" data-add-category="prices" aria-label="إضافة قسم">+</button></div>${renderCategoryList(data.priceCategories, priceCategory?.id, 'prices') || '<div class="small-empty">أضف أول قسم للأسعار.</div>'}<button class="ghost-btn category-add-btn" type="button" data-add-category="prices">إضافة قسم</button></aside><section class="panel document-list-panel"><div class="panel-heading"><div><p class="eyebrow">${escapeHtml(priceCategory?.name || 'اختر قسمًا')}</p><h2>الأسعار والخدمات</h2></div><span class="record-count">${data.prices.filter((item) => !priceCategory || item.categoryId === priceCategory.id).length}</span></div>${renderPriceList()}</section></div>`}</section>`;
}
function printDocument(document, officeName = 'المكتب', toast = () => {}) {
  const body = String(document.html || '').replaceAll('contenteditable="false"', '').replace(/<span class="document-field"[^>]*data-field="([^"]*)"[^>]*>.*?<\/span>/g, '<span class="print-field">&nbsp;</span>');
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{margin:0;color:#172f2c;font-family:Tahoma,Arial,sans-serif}.paper{min-height:267mm;padding:8mm;line-height:2.05;font-size:15px}.paper h1,.paper h2,.paper h3{text-align:center;color:#0b725e}.print-field{display:inline-block;min-width:150px;height:28px;margin:0 3px;border-bottom:1px solid #183c35;vertical-align:middle}.document-field{border:1px solid #183c35;padding:1px 8px}</style></head><body><main class="paper"><header><h1>${escapeHtml(document.title)}</h1><p style="text-align:left;color:#55706a">${escapeHtml(new Date(document.updatedAt || Date.now()).toLocaleDateString('ar-SA'))}</p></header>${body}</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250))</script></body></html>`;
  if (!openPrintWindow(html)) toast('اسمح بفتح نافذة الطباعة من إعدادات المتصفح.', 'error');
}
function startEditor(id = null, render) { editingDocumentId = id; editorHtml = id ? '' : defaultDocumentHtml(); editorTitle = ''; editorCategoryId = selectedCategoryId || data.documentCategories[0]?.id || ''; render(); }
function bindEditor(render, toast) {
  const editor = document.querySelector('#documentEditor');
  document.querySelectorAll('[data-doc-command]').forEach((button) => button.addEventListener('click', () => { editor?.focus(); document.execCommand(button.dataset.docCommand, false); }));
  document.querySelectorAll('[data-add-field]').forEach((button) => button.addEventListener('click', () => { editor?.focus(); document.execCommand('insertHTML', false, blankField(button.dataset.addField)); }));
  editor?.addEventListener('input', () => { editorHtml = editor.innerHTML; });
  editor?.addEventListener('dragstart', (event) => { const field = event.target.closest('.document-field'); if (field) { event.dataTransfer.setData('text/plain', field.dataset.field || 'خانة فارغة'); field.classList.add('dragging'); } });
  editor?.addEventListener('dragend', (event) => event.target.closest('.document-field')?.classList.remove('dragging'));
  editor?.addEventListener('dragover', (event) => { if (event.target.closest('.document-field') || event.target === editor) event.preventDefault(); });
  editor?.addEventListener('drop', (event) => { const field = editor.querySelector('.document-field.dragging'); if (!field) return; event.preventDefault(); const target = event.target.closest('.document-field'); if (target && target !== field) target.after(field); else editor.append(field); editorHtml = editor.innerHTML; });
  document.querySelector('[data-save-document]')?.addEventListener('click', () => { const title = String(document.querySelector('#documentTitle')?.value || '').trim(); const categoryId = document.querySelector('#documentCategory')?.value || selectedCategoryId; if (!title || !categoryId || !editor) return toast('أدخل اسم الوثيقة وأنشئ قسمًا أولًا.', 'error'); editor.querySelectorAll('.document-field').forEach((field) => { const width = Math.max(70, Math.min(700, Math.round(field.getBoundingClientRect().width))); field.dataset.width = String(width); field.style.width = `${width}px`; }); const record = { id: editingDocumentId || uid('document'), title, categoryId, html: editor.innerHTML, createdAt: data.documents.find((item) => item.id === editingDocumentId)?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }; data.documents = editingDocumentId ? data.documents.map((item) => item.id === editingDocumentId ? record : item) : [record, ...data.documents]; editingDocumentId = null; editorHtml = ''; notify(render, 'تم حفظ الوثيقة على هذا الكمبيوتر.'); });
  document.querySelector('[data-close-document-editor]')?.addEventListener('click', () => { editingDocumentId = null; editorHtml = ''; render(); });
}
function bindDocuments(render, toast) {
  bindEditor(render, toast);
  document.querySelectorAll('[data-document-tab]').forEach((button) => button.addEventListener('click', () => { activeTab = button.dataset.documentTab; render(); }));
  document.querySelectorAll('[data-select-document-category]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.categoryKind === 'documents') selectedCategoryId = button.dataset.selectDocumentCategory; else selectedPriceCategoryId = button.dataset.selectDocumentCategory; render(); }));
  document.querySelectorAll('[data-add-category]').forEach((button) => button.addEventListener('click', () => { const name = window.prompt('اكتب اسم القسم الجديد'); if (!name?.trim()) return; const category = { id: uid('category'), name: name.trim().slice(0, 80) }; if (button.dataset.addCategory === 'documents') { data.documentCategories.push(category); selectedCategoryId = category.id; } else { data.priceCategories.push(category); selectedPriceCategoryId = category.id; } notify(render, 'تمت إضافة القسم.'); }));
  document.querySelector('[data-new-document]')?.addEventListener('click', () => { if (!data.documentCategories.length) return toast('أضف قسمًا للوثائق أولًا.', 'error'); startEditor(null, render); });
  document.querySelector('[data-new-price]')?.addEventListener('click', () => { if (!data.priceCategories.length) return toast('أضف قسمًا للأسعار أولًا.', 'error'); const name = window.prompt('اسم الخدمة أو السعر'); if (!name?.trim()) return; const description = window.prompt('وصف الخدمة (اختياري)') || ''; const requirements = window.prompt('المتطلبات، افصل بينها بفواصل') || ''; const terms = window.prompt('البنود والشروط، افصل بينها بفواصل') || ''; const price = window.prompt('السعر') || ''; data.prices.unshift({ id: uid('price'), categoryId: selectedPriceCategoryId, name: name.trim(), description: description.trim(), requirements: requirements.split(',').map((item) => item.trim()).filter(Boolean), terms: terms.split(',').map((item) => item.trim()).filter(Boolean), price: price.trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); activeTab = 'prices'; notify(render, 'تم حفظ السعر والخدمة محليًا.'); });
  document.querySelectorAll('[data-edit-document]').forEach((button) => button.addEventListener('click', () => startEditor(button.dataset.editDocument, render)));
  document.querySelectorAll('[data-print-document]').forEach((button) => button.addEventListener('click', () => { const record = data.documents.find((item) => item.id === button.dataset.printDocument); if (record) printDocument(record, '', toast); }));
  document.querySelectorAll('[data-delete-document]').forEach((button) => button.addEventListener('click', () => { if (!window.confirm('حذف الوثيقة نهائيًا؟')) return; data.documents = data.documents.filter((item) => item.id !== button.dataset.deleteDocument); notify(render, 'تم حذف الوثيقة.'); }));
  document.querySelectorAll('[data-edit-price]').forEach((button) => button.addEventListener('click', () => { const item = data.prices.find((entry) => entry.id === button.dataset.editPrice); if (!item) return; const name = window.prompt('اسم الخدمة', item.name); if (!name?.trim()) return; item.name = name.trim(); item.description = window.prompt('وصف الخدمة', item.description) || ''; item.price = window.prompt('السعر', item.price) || ''; item.requirements = (window.prompt('المتطلبات مفصولة بفواصل', item.requirements.join(', ')) || '').split(',').map((value) => value.trim()).filter(Boolean); item.terms = (window.prompt('البنود مفصولة بفواصل', item.terms.join(', ')) || '').split(',').map((value) => value.trim()).filter(Boolean); item.updatedAt = new Date().toISOString(); notify(render, 'تم تحديث السعر.'); }));
  document.querySelectorAll('[data-delete-price]').forEach((button) => button.addEventListener('click', () => { if (!window.confirm('حذف السعر أو الخدمة؟')) return; data.prices = data.prices.filter((item) => item.id !== button.dataset.deletePrice); notify(render, 'تم حذف السعر.'); }));
}
export { renderDocuments, bindDocuments, printDocument };
