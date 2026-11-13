import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

let folderName = '';
let folderPath = '';
let files = [];
let selectedPath = '';
let pdfDocument = null;
let pageNumber = 1;
let pageText = '';
let editedText = '';
let searchQuery = '';
let loading = false;
let ocrLoading = false;
let savedNotes = loadNotes();

function loadNotes() {
  try { return JSON.parse(localStorage.getItem('servicehub-pdf-notes-v1') || '{}'); } catch { return {}; }
}
function saveNotes() { localStorage.setItem('servicehub-pdf-notes-v1', JSON.stringify(savedNotes)); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function escapeAttribute(value = '') { return escapeHtml(value); }
function formatSize(value) { const size = Number(value) || 0; return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`; }
function currentFile() { return files.find((file) => file.path === selectedPath); }
function showToast(message, type = 'success') { window.dispatchEvent(new CustomEvent('servicehub-toast', { detail: { message, type } })); }

function renderFileList() {
  const query = searchQuery.trim().toLocaleLowerCase('ar');
  const visible = files.filter((file) => !query || file.name.toLocaleLowerCase('ar').includes(query));
  return visible.length ? visible.map((file) => `<button type="button" class="pdf-file-row ${file.path === selectedPath ? 'active' : ''}" data-open-pdf="${escapeAttribute(file.path)}"><span class="pdf-file-icon">PDF</span><span><strong>${escapeHtml(file.name)}</strong><small>${formatSize(file.size)}</small></span></button>`).join('') : '<div class="small-empty">لا توجد ملفات PDF مطابقة.</div>';
}

export function renderPdfViewer() {
  const file = currentFile();
  const note = selectedPath ? (savedNotes[selectedPath] || '') : '';
  return `<section class="pdf-viewer-page"><div class="view-title-row"><div><p class="eyebrow">مكتبة المستندات</p><h1>عارض PDF</h1><p class="page-subtitle">اختر مجلدًا لعرض كل ملفات PDF الموجودة داخله، مع قراءة النص ونسخه وتشغيل OCR للصفحات المصورة.</p></div>${folderPath ? '<span class="pdf-fixed-path">المسار ثابت ومحفوظ على هذا الجهاز</span>' : '<button class="primary-btn" type="button" data-pdf-choose-folder>اختيار مجلد PDF</button>'}</div><div class="pdf-folder-bar"><strong>${folderName ? `المجلد: ${escapeHtml(folderName)}` : 'لم يتم اختيار مجلد بعد'}</strong><span>${files.length} ملف PDF</span></div><div class="pdf-layout"><aside class="pdf-library panel"><div class="panel-heading"><div><p class="eyebrow">الملفات</p><h2>قائمة PDF</h2></div><span class="record-count">${files.length}</span></div><input class="pdf-search" id="pdfSearch" type="search" value="${escapeAttribute(searchQuery)}" placeholder="ابحث باسم الملف..." autocomplete="off"><div class="pdf-file-list">${renderFileList()}</div></aside><section class="pdf-workspace panel">${file ? `<header class="pdf-workspace-header"><div><strong>${escapeHtml(file.name)}</strong><small>${formatSize(file.size)} · صفحة ${pageNumber}${pdfDocument ? ` من ${pdfDocument.numPages}` : ''}</small></div><div class="pdf-toolbar"><button class="ghost-btn" type="button" data-pdf-prev ${pageNumber <= 1 ? 'disabled' : ''}>السابق</button><button class="ghost-btn" type="button" data-pdf-next ${!pdfDocument || pageNumber >= pdfDocument.numPages ? 'disabled' : ''}>التالي</button><button class="secondary-btn" type="button" data-pdf-copy>نسخ النص</button><button class="secondary-btn" type="button" data-pdf-ocr ${ocrLoading ? 'disabled' : ''}>${ocrLoading ? 'جارٍ قراءة الصورة…' : 'قراءة الصفحة OCR'}</button></div></header><div class="pdf-page-stage"><canvas id="pdfCanvas"></canvas>${loading ? '<div class="pdf-loading">جارٍ تحميل الصفحة…</div>' : ''}</div><div class="pdf-text-editor"><div class="panel-heading"><div><p class="eyebrow">نسخ وتعديل النص</p><h3>نص الصفحة</h3></div><button class="primary-btn" type="button" data-pdf-save-note>حفظ النص محليًا</button></div><textarea id="pdfTextEditor" rows="9" placeholder="نص الصفحة سيظهر هنا، أو اضغط قراءة الصفحة OCR إذا كانت الصفحة صورة.">${escapeHtml(editedText || note || pageText)}</textarea><small class="helper-text">الزر OCR يقرأ الصفحات المصورة محليًا بالعربية والإنجليزية، ثم يمكنك تعديل النص ونسخه.</small></div>` : '<div class="pdf-empty-state"><strong>اختر ملف PDF من القائمة</strong><span>يمكنك فتح أكثر من 20 ملفًا، والبحث بينها، ثم نسخ نص الصفحة أو حفظ نسخة نصية معدلة محليًا.</span></div>'}</section></div></section>`;
}

async function extractPageText(page) {
  const content = await page.getTextContent();
  return content.items.map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
}
async function renderPage() {
  if (!pdfDocument) return;
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.35 });
  const canvas = document.querySelector('#pdfCanvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.min(viewport.width, 900)}px`;
  await page.render({ canvasContext: context, viewport }).promise;
  pageText = await extractPageText(page);
  const editor = document.querySelector('#pdfTextEditor');
  if (editor && !editor.matches(':focus')) editor.value = savedNotes[`${selectedPath}#${pageNumber}`] || pageText;
}
async function ocrCurrentPage(render) {
  if (!pdfDocument || ocrLoading) return;
  const canvas = document.querySelector('#pdfCanvas');
  if (!canvas) return;
  ocrLoading = true; render();
  try {
    const image = canvas.toDataURL('image/png');
    const result = await window.desktopBridge.ocrPdfPage(image, 'ara+eng');
    pageText = String(result?.text || '').trim();
    const editor = document.querySelector('#pdfTextEditor');
    if (editor) editor.value = pageText;
    showToast(pageText ? 'تم استخراج النص من صورة الصفحة ويمكنك نسخه أو تعديله.' : 'لم يظهر نص واضح في صورة الصفحة.', pageText ? 'success' : 'error');
  } catch (error) { showToast(error.message || 'تعذر قراءة الصفحة المصورة.', 'error'); }
  finally { ocrLoading = false; render(); }
}
async function openFile(path, render) {
  selectedPath = path; pageNumber = 1; pageText = ''; editedText = ''; pdfDocument = null; loading = true; render();
  try {
    const result = await window.desktopBridge.readPdfFile(path);
    const binary = atob(result.data.split(',')[1]);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    pdfDocument = await pdfjsLib.getDocument({ data: bytes }).promise;
    loading = false; render(); await renderPage();
  } catch (error) { loading = false; render(); showToast(error.message || 'تعذر فتح ملف PDF.', 'error'); }
}
export function bindPdfViewer(render) {
  document.querySelector('[data-pdf-choose-folder]')?.addEventListener('click', async () => {
    try { const result = await window.desktopBridge?.choosePdfFolder?.(); if (!result || result.cancelled) return; folderName = result.folderName || ''; folderPath = result.folder || ''; localStorage.setItem('servicehub-pdf-folder-v1', folderPath); files = result.files || []; selectedPath = ''; pdfDocument = null; pageText = ''; render(); } catch (error) { showToast(error.message || 'تعذر اختيار مجلد PDF.', 'error'); }
  });
  if (!folderPath) { const savedFolder = localStorage.getItem('servicehub-pdf-folder-v1') || ''; if (savedFolder) { window.desktopBridge?.loadPdfFolder?.(savedFolder).then((result) => { if (!result || result.cancelled) return; folderPath = result.folder || savedFolder; folderName = result.folderName || ''; files = result.files || []; render(); }).catch(() => localStorage.removeItem('servicehub-pdf-folder-v1')); } }
  document.querySelector('#pdfSearch')?.addEventListener('input', (event) => { searchQuery = event.target.value; render(); requestAnimationFrame(() => { const input = document.querySelector('#pdfSearch'); input?.focus(); input?.setSelectionRange(searchQuery.length, searchQuery.length); }); });
  document.querySelectorAll('[data-open-pdf]').forEach((button) => button.addEventListener('click', () => openFile(button.dataset.openPdf, render)));
  document.querySelector('[data-pdf-prev]')?.addEventListener('click', async () => { if (pageNumber <= 1) return; pageNumber -= 1; render(); await renderPage(); });
  document.querySelector('[data-pdf-next]')?.addEventListener('click', async () => { if (!pdfDocument || pageNumber >= pdfDocument.numPages) return; pageNumber += 1; render(); await renderPage(); });
  document.querySelector('[data-pdf-ocr]')?.addEventListener('click', () => ocrCurrentPage(render));
  document.querySelector('[data-pdf-copy]')?.addEventListener('click', async () => { const value = document.querySelector('#pdfTextEditor')?.value || pageText; if (!value) return showToast('لا يوجد نص قابل للنسخ في هذه الصفحة.', 'error'); try { await window.desktopBridge?.copyText?.(value); showToast('تم نسخ نص الصفحة.'); } catch { showToast('تعذر نسخ النص.', 'error'); } });
  document.querySelector('[data-pdf-save-note]')?.addEventListener('click', () => { const value = document.querySelector('#pdfTextEditor')?.value || ''; if (!selectedPath) return; savedNotes[`${selectedPath}#${pageNumber}`] = value; saveNotes(); showToast('تم حفظ النص المعدل كملاحظة محلية مرتبطة بالصفحة.'); });
}
