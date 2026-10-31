const SERVICE_GROUPS = [
  {
    eyebrow: 'النقل والتراخيص', title: 'خدمات الهيئة العامة للنقل',
    description: 'إجراءات النقل والتراخيص وكروت التشغيل للمنشآت والسائقين.',
    services: [
      'إصدار وتجديد تراخيص النقل', 'كروت التشغيل', 'زيادة عدد كروت التشغيل حتى 100 سيارة',
      'تعديل التصنيفات', 'بطاقات السائقين', 'ربط المركبات', 'خدمات النقل لصالح المنشآت'
    ]
  },
  {
    eyebrow: 'حماية واطمئنان', title: 'خدمات التأمين',
    description: 'تأمين ضد الغير والتأمين الشامل للأفراد والشركات، مع نقل التأمين ومتابعة الاسترداد.',
    services: ['تأمين ضد الغير', 'التأمين الشامل للأفراد', 'التأمين الشامل للشركات', 'نقل التأمين', 'متابعة استرداد مبالغ التأمين']
  },
  {
    eyebrow: 'كل ما يخص مركبتك', title: 'خدمات المركبات',
    description: 'نقل الملكية والاستمارات واللوحات وكروت الجمرك ومطالبات الحوادث.',
    services: ['نقل ملكية السيارات', 'تجديد الاستمارات', 'تعديل اللون والموديل', 'اللوحات', 'كروت الجمرك', 'متابعة مطالبات الحوادث']
  },
  {
    eyebrow: 'خدماتك الإلكترونية', title: 'الخدمات الحكومية والإلكترونية',
    description: 'أبشر وناجز ونفاذ وتصاريح مكة وخدمات أمانة جدة والمنشآت.',
    services: ['خدمات أبشر', 'خدمات ناجز', 'خدمات نفاذ', 'تصاريح دخول مكة', 'خدمات أمانة جدة', 'خدمات المنشآت ومتابعة الطلبات']
  }
];

const SERVICE_COUNT = SERVICE_GROUPS.reduce((sum, group) => sum + group.services.length, 0);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function westernDigits(value) {
  return String(value || '').replace(/[٠-٩۰-۹]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) % 10));
}

export function normalizeWhatsappNumber(phone) {
  let digits = westernDigits(phone).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `966${digits.slice(1)}`;
  else if (digits.length === 9 && digits.startsWith('5')) digits = `966${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

export function buildOfficeWhatsappUrl(phone, officeName, serviceName = '') {
  const number = normalizeWhatsappNumber(phone);
  if (!number) return '';
  const message = serviceName
    ? `السلام عليكم، أرغب في خدمة: ${serviceName} من ${officeName}.`
    : `السلام عليكم، أود الاستفسار عن خدمات ${officeName}.`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function safeMapUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    const isGoogleMaps = host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co'
      || host === 'google.com' || host.endsWith('.google.com');
    return url.protocol === 'https:' && isGoogleMaps ? url.href : '';
  } catch { return ''; }
}

function renderHeroIllustration() {
  return `<svg class="public-hero-art" viewBox="0 0 560 340" role="img" aria-label="خدمات المركبات في مكان واحد">
    <defs><linearGradient id="public-art-bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#e9f1e9"/><stop offset="1" stop-color="#f5f2e6"/></linearGradient><linearGradient id="public-art-green" x1="0" x2="1"><stop stop-color="#0b684e"/><stop offset="1" stop-color="#148165"/></linearGradient></defs>
    <rect width="560" height="340" rx="28" fill="url(#public-art-bg)"/>
    <circle cx="115" cy="95" r="110" fill="#fff" opacity=".42"/><circle cx="115" cy="95" r="72" fill="#e2ebe1" opacity=".72"/>
    <path d="M56 254C133 238 117 168 199 167s100 47 169 17 72-91 135-85" fill="none" stroke="#b7c8b6" stroke-width="2" stroke-dasharray="5 8"/>
    <circle cx="60" cy="253" r="8" fill="#bd9b53"/><circle cx="197" cy="168" r="9" fill="#fff" stroke="#b7c8b6" stroke-width="3"/><circle cx="502" cy="99" r="10" fill="#0e7559"/>
    <g transform="translate(196 195) rotate(-10)"><rect width="112" height="112" rx="28" fill="url(#public-art-green)"/><path d="M30 67h52l-6-22a9 9 0 0 0-9-7H45a9 9 0 0 0-9 7l-6 22Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><path d="M27 67h58v14H27z" fill="none" stroke="#fff" stroke-width="5"/><circle cx="39" cy="83" r="6" fill="#fff"/><circle cx="73" cy="83" r="6" fill="#fff"/></g>
    <rect x="24" y="24" width="118" height="31" rx="15" fill="#fff" opacity=".8"/><circle cx="41" cy="39.5" r="4" fill="#148165"/><text x="128" y="44" text-anchor="end" fill="#557267" font-size="12" font-family="sans-serif">خدمة ومتابعة مباشرة</text>
  </svg>`;
}

function renderServiceGroup(group, index, phone, officeName) {
  const services = group.services.map((service) => {
    const href = buildOfficeWhatsappUrl(phone, officeName, service);
    return `<a class="public-service-link" href="${escapeHtml(href || '#contact')}" ${href ? 'target="_blank" rel="noopener noreferrer"' : ''} data-public-service="${escapeHtml(service)}"><span>${escapeHtml(service)}</span><span class="public-service-action">${href ? 'واتساب ↗' : 'اتصل بالمكتب'}</span></a>`;
  }).join('');
  return `<article class="public-service-group" data-public-group>
    <header class="public-service-group-head"><div><p class="public-eyebrow">${escapeHtml(group.eyebrow)}</p><h3>${escapeHtml(group.title)}</h3><p>${escapeHtml(group.description)}</p></div><span class="public-group-number">${String(index + 1).padStart(2, '0')}</span></header>
    <div class="public-service-list">${services}</div>
  </article>`;
}

export function renderPublicOfficePage(profile) {
  const officeName = String(profile?.officeName || 'مكتب الخدمات').trim();
  const phone = String(profile?.phone || '').trim();
  const phoneDigits = normalizeWhatsappNumber(phone);
  const whatsapp = buildOfficeWhatsappUrl(phone, officeName);
  const mapUrl = safeMapUrl(profile?.officeLocation);
  const groupMarkup = SERVICE_GROUPS.map((group, index) => renderServiceGroup(group, index, phone, officeName)).join('');
  const locationMarkup = mapUrl ? `<a class="public-location-link" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer"><span class="public-location-icon" aria-hidden="true">⌖</span><span><small>موقع المكتب</small><strong>افتح الموقع على خرائط Google</strong></span><span aria-hidden="true">↗</span></a>` : '';
  const phoneMarkup = phoneDigits ? `<a class="public-phone" href="tel:+${phoneDigits}" dir="ltr">${escapeHtml(phone)}</a>` : `<span class="public-phone">${escapeHtml(phone || 'رقم التواصل غير متاح')}</span>`;
  const whatsappButton = whatsapp ? `<a class="public-button public-button-light" href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener noreferrer">تواصل واتساب <span aria-hidden="true">↗</span></a>` : '';

  return `<div class="public-page" dir="rtl">
    <header class="public-header"><div class="public-wrap public-header-inner">
      <a class="public-brand" href="#top" aria-label="${escapeHtml(officeName)} — الصفحة الرئيسية"><span class="public-brand-symbol" aria-hidden="true">ب</span><span><strong>${escapeHtml(officeName)}</strong><small>خدماتك في مكان واحد</small></span></a>
      <nav class="public-nav" aria-label="التنقل"><a href="#services">الخدمات</a><a href="#why-us">عن المكتب</a>${mapUrl ? '<a href="#contact">موقع المكتب</a>' : ''}</nav>
      <div class="public-header-contact">${phoneMarkup}${whatsappButton}</div>
    </div></header>
    <main id="top" class="public-wrap">
      <section class="public-hero"><div class="public-hero-copy"><span class="public-office-pill"><i aria-hidden="true"></i>${escapeHtml(officeName)}</span><p class="public-eyebrow">خدمات الأفراد والمنشآت</p><h1>خدماتك الحكومية وخدمات النقل والتأمين <em>في مكان واحد.</em></h1><p class="public-hero-description">جميع خدمات النقل والتأمين والخدمات الإلكترونية — بإنجاز دقيق ومتابعة مستمرة، للأفراد والمنشآت.</p><div class="public-hero-actions"><a class="public-button public-button-primary" href="#services">اختر خدمتك <span aria-hidden="true">←</span></a>${whatsapp ? `<a class="public-text-link" href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener noreferrer">استفسر عبر واتساب</a>` : ''}</div><div class="public-response-note"><span class="public-shield" aria-hidden="true">✓</span><span><strong>خدمة ومتابعة في مكان واحد</strong><small>اختر الخدمة وسنفتح لك محادثة WhatsApp مباشرة.</small></span></div></div>
        <div class="public-hero-card">${renderHeroIllustration()}<div class="public-hero-card-caption"><span><small>قائمة الخدمات</small><strong>${SERVICE_COUNT} خدمة</strong></span><span class="public-hero-card-subtitle">نقل • تأمين • خدمات إلكترونية</span></div></div>
      </section>
      <section class="public-promise-row" aria-label="مميزات المكتب"><span>سرعة في الإنجاز</span><i></i><span>دقة في الإجراءات</span><i></i><span>أمانة في التعامل</span><i></i><span>متابعة حتى الإتمام</span></section>
      <section id="services" class="public-services-section"><div class="public-section-heading"><div><p class="public-eyebrow">قائمة الخدمات</p><h2>اختر الخدمة <em>وتواصل مباشرة.</em></h2></div><p>اضغط على اسم الخدمة لفتح محادثة WhatsApp تتضمن اختيارك.</p></div>
        <label class="public-service-search"><span aria-hidden="true">⌕</span><input id="publicServiceSearch" type="search" placeholder="ابحث عن خدمة مثل نقل الملكية أو التأمين" autocomplete="off"><span id="publicServiceCount">${SERVICE_COUNT} خدمة</span></label>
        <div class="public-service-groups">${groupMarkup}</div><p class="public-no-results" id="publicNoServices" hidden>لا توجد خدمات تطابق البحث.</p>
      </section>
      <section id="why-us" class="public-why-section"><div class="public-why-intro"><p class="public-eyebrow">لماذا ${escapeHtml(officeName)}؟</p><h2>خطوة واضحة، <em>ومتابعة مستمرة.</em></h2><p>نخدمك في خدمات النقل والتأمين والإجراءات الإلكترونية باحترافية واهتمام بالتفاصيل.</p>${whatsapp ? `<a class="public-button public-button-primary" href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener noreferrer">تواصل معنا الآن <span aria-hidden="true">←</span></a>` : ''}</div><div class="public-values-grid"><article><b>01</b><strong>سرعة في الإنجاز</strong><p>نبدأ معك الخطوات بوضوح.</p></article><article><b>02</b><strong>دقة في الإجراءات</strong><p>اهتمام بالتفاصيل ومراجعة لكل خطوة.</p></article><article><b>03</b><strong>أمانة في التعامل</strong><p>وضوح في التواصل معك.</p></article><article><b>04</b><strong>متابعة حتى الإتمام</strong><p>نبقى معك خلال خطوات الخدمة.</p></article></div></section>
      <section id="contact" class="public-contact-section"><div><p class="public-eyebrow">تواصل معنا</p><h2>${escapeHtml(officeName)} <em>نخدمك أينما كنت.</em></h2><p>جميع خدمات النقل والتأمين والخدمات الإلكترونية.</p></div><div class="public-contact-details">${phoneMarkup}${whatsappButton}${locationMarkup}</div></section>
    </main>
    <footer class="public-footer"><div class="public-wrap public-footer-inner"><a class="public-brand" href="#top"><span class="public-brand-symbol" aria-hidden="true">ب</span><span><strong>${escapeHtml(officeName)}</strong><small>خدماتك في مكان واحد</small></span></a><p>جميع خدمات النقل والتأمين والخدمات الإلكترونية.</p><div>${whatsapp ? `<a href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener noreferrer">تواصل على WhatsApp</a>` : ''}${locationMarkup}</div></div></footer>
  </div>`;
}

export function renderPublicPageLoading() {
  return '<main class="public-page public-page-state" dir="rtl"><p>جارٍ تحميل صفحة المكتب…</p></main>';
}

export function renderPublicPageUnavailable() {
  return '<main class="public-page public-page-state" dir="rtl"><div><span class="public-brand-symbol" aria-hidden="true">ب</span><h1>الصفحة غير متاحة</h1><p>تحقق من الرابط أو تواصل مع المكتب.</p><a class="public-button public-button-primary" href="/">العودة إلى الموقع</a></div></main>';
}

export function publicServiceCount() {
  return SERVICE_COUNT;
}
