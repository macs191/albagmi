import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, BriefcaseBusiness, CalendarDays, Check, ChevronDown, Clock3, Download, Luggage, MapPin, Plane, RefreshCw, Search, ShieldCheck, Sparkles, Ticket, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Segment = {
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  carrierCode: string;
  carrierName: string;
  flightNumber: string;
  durationMinutes: number;
};

type Offer = {
  id: string;
  provider: "duffel" | "demo";
  airline: string;
  airlineCode: string;
  totalAmount: string;
  currency: string;
  cabinClass: string;
  slices: Array<{ durationMinutes: number; segments: Segment[] }>;
  bags: string;
  expiresAt: string;
  rawProviderOfferId?: string;
};

type SearchResult = { demo: boolean; offers: Offer[]; notice?: string };
type BookingResult = { demo: boolean; bookingReference?: string; status: string; notice: string };

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const today = new Date();
const plusDays = (days: number) => {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const initialSearch = { origin: "CAI", destination: "DXB", departureDate: plusDays(24), returnDate: plusDays(31), adults: 1, children: 0, infants: 0, cabinClass: "economy", roundTrip: true };

function time(value: string) { return value ? new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "--:--"; }
function shortDate(value: string) { return value ? new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short" }).format(new Date(value)) : ""; }
function duration(minutes: number) { const hours = Math.floor(minutes / 60); const mins = minutes % 60; return mins ? `${hours}س ${mins}د` : `${hours}س`; }
function stops(slice: Offer["slices"][number]) { return Math.max(0, slice.segments.length - 1); }
function currency(amount: string, code: string) { return new Intl.NumberFormat("ar-EG", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(Number(amount)); }

export default function Home() {
  const [form, setForm] = useState(initialSearch);
  const [results, setResults] = useState<Offer[]>([]);
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<Offer>();
  const [step, setStep] = useState<"search" | "passengers" | "done">("search");
  const [booking, setBooking] = useState<BookingResult>();
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent>();
  const [passenger, setPassenger] = useState({ firstName: "", lastName: "", email: "", phone: "", birthDate: "" });
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onInstall = (event: Event) => {
      const detail = (event as CustomEvent<InstallPromptEvent>).detail;
      if (detail) setInstallEvent(detail);
    };
    window.addEventListener("airbookinstallavailable", onInstall);
    return () => window.removeEventListener("airbookinstallavailable", onInstall);
  }, []);

  const searchLabel = useMemo(() => `${form.origin || "من"} إلى ${form.destination || "وجهتك"}`, [form.origin, form.destination]);
  const update = (key: string, value: string | number | boolean) => setForm(current => ({ ...current, [key]: value }));

  async function search() {
    setError(undefined);
    setLoading(true);
    setNotice(undefined);
    setSelectedOffer(undefined);
    setStep("search");
    try {
      const response = await fetch("/api/flights/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "تعذر تنفيذ البحث");
      const result = payload as SearchResult;
      setResults(result.offers || []);
      setNotice(result.notice || (result.demo ? "وضع تجريبي" : "أسعار محدثة من Duffel"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "حدث خطأ غير متوقع");
    } finally { setLoading(false); }
  }

  async function chooseOffer(offer: Offer) {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/flights/reprice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, offerId: offer.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "انتهت صلاحية السعر");
      setSelectedOffer(payload.offer);
      setNotice(payload.notice || "تم التحقق من السعر والتوفر");
      setStep("passengers");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر التحقق من العرض");
    } finally { setLoading(false); }
  }

  async function book() {
    if (!selectedOffer) return;
    if (!passenger.firstName || !passenger.lastName || !passenger.email || !passenger.phone) {
      setError("أكمل الاسم والبريد والهاتف قبل المتابعة.");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/flights/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, offerId: selectedOffer.id, passengers: [{ id: "passenger-1", given_name: passenger.firstName, family_name: passenger.lastName, email: passenger.email, phone_number: passenger.phone, born_on: passenger.birthDate || undefined }] }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "تعذر إنشاء الحجز");
      setBooking(payload as BookingResult);
      setStep("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء الحجز");
    } finally { setLoading(false); }
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(undefined);
  }

  return (
    <div className="min-h-screen bg-[#f7f8f5] text-[#0d3340]" dir="rtl">
      <header className="relative z-10 border-b border-[#0d3340]/10 bg-[#f7f8f5]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1380px] items-center justify-between px-5 py-4 sm:px-8 lg:px-12">
          <a href="/" className="flex items-center gap-3" aria-label="AirBook الرئيسية">
            <span className="grid size-10 place-items-center rounded-[14px] bg-[#0d3340] text-[#f3a34b] shadow-[0_7px_18px_rgba(13,51,64,.18)]"><Plane className="size-5 -rotate-45" /></span>
            <span><strong className="block text-lg leading-none tracking-tight">AirBook</strong><small className="mt-1 block text-[10px] font-semibold tracking-[.18em] text-[#0f9f9a]">رحلتك تبدأ هنا</small></span>
          </a>
          <nav className="hidden items-center gap-8 text-sm font-medium text-[#0d3340]/70 md:flex"><a href="#how" className="transition hover:text-[#0f9f9a]">كيف يعمل؟</a><a href="#support" className="transition hover:text-[#0f9f9a]">المساعدة</a><a href="/admin" className="transition hover:text-[#0f9f9a]">لوحة التشغيل</a></nav>
          <div className="flex items-center gap-2"><span className="hidden rounded-full bg-[#e7f4f1] px-3 py-1.5 text-xs font-bold text-[#0f756f] sm:inline-flex"><span className="ml-1.5 mt-0.5 size-1.5 rounded-full bg-[#0f9f9a]" />Sandbox</span>{installEvent && <Button onClick={install} variant="outline" size="sm" className="rounded-full border-[#0d3340]/15 bg-white"><Download className="size-4" />ثبّت التطبيق</Button>}</div>
        </div>
      </header>

      <main className="mx-auto max-w-[1380px] px-5 pb-20 sm:px-8 lg:px-12">
        <section className="grid items-start gap-10 pb-12 pt-12 lg:grid-cols-[.78fr_1.22fr] lg:gap-16 lg:pt-20">
          <div className="max-w-xl lg:pt-14">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#0f9f9a]/20 bg-[#e7f4f1] px-3 py-1.5 text-xs font-bold text-[#0f756f]"><Sparkles className="size-3.5" /> أسعار واضحة. طريق أقصر.</div>
            <h1 className="text-[clamp(2.6rem,6vw,5.5rem)] font-black leading-[.98] tracking-[-.07em]">رحلتك تبدأ<br /><span className="text-[#0f9f9a]">من هنا.</span></h1>
            <p className="mt-7 max-w-md text-lg leading-8 text-[#0d3340]/65">ابحث عن أفضل الرحلات، قارن التفاصيل، واعرف السعر قبل أن تقترب من بوابة الصعود.</p>
            <div className="mt-9 flex flex-wrap gap-5 text-sm font-semibold text-[#0d3340]/65"><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#0f9f9a]" /> سعر يعاد التحقق منه</span><span className="flex items-center gap-2"><BriefcaseBusiness className="size-4 text-[#0f9f9a]" /> أمتعة واضحة</span></div>
            <div className="mt-12 hidden border-r-2 border-dashed border-[#0f9f9a]/35 pr-5 lg:block"><div className="text-5xl font-black tracking-[-.06em]">01</div><p className="mt-2 text-sm text-[#0d3340]/55">ابحث الآن، وسنرتب لك النتائج الأقرب لوقتك وميزانيتك.</p></div>
          </div>

          <div className="relative overflow-hidden rounded-[30px] bg-[#0d3340] p-5 text-white shadow-[0_22px_80px_rgba(13,51,64,.22)] sm:p-8">
            <div className="absolute -left-20 -top-20 size-56 rounded-full bg-[#0f9f9a]/25 blur-3xl" /><div className="absolute -bottom-24 right-10 size-56 rounded-full bg-[#f3a34b]/15 blur-3xl" />
            <div className="relative">
              <div className="mb-7 flex items-start justify-between"><div><p className="text-xs font-bold tracking-[.2em] text-[#8ed8d0]">FLIGHT SEARCH</p><h2 className="mt-2 text-2xl font-bold">إلى أين ستذهب؟</h2></div><div className="grid size-12 place-items-center rounded-2xl bg-white/10"><MapPin className="size-5 text-[#f3a34b]" /></div></div>
              <div className="mb-5 flex gap-5 border-b border-white/15 pb-4 text-sm font-bold"><button onClick={() => setForm(current => ({ ...current, roundTrip: true }))} className={`border-b-2 pb-4 transition ${form.roundTrip ? "border-[#f3a34b] text-white" : "border-transparent text-white/50"}`}>ذهاب وعودة</button><button onClick={() => setForm(current => ({ ...current, roundTrip: false, returnDate: "" }))} className={`border-b-2 pb-4 transition ${!form.roundTrip ? "border-[#f3a34b] text-white" : "border-transparent text-white/50"}`}>ذهاب فقط</button></div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                <AirportField label="من" value={form.origin} hint="رمز المطار" onChange={value => update("origin", value)} />
                <button type="button" onClick={() => setForm(current => ({ ...current, origin: current.destination, destination: current.origin }))} className="mx-auto mb-1 grid size-10 place-items-center rounded-full border border-white/15 text-[#8ed8d0] transition hover:border-[#f3a34b] hover:text-[#f3a34b]" aria-label="تبديل المطارات"><ArrowLeftRight className="size-4" /></button>
                <AirportField label="إلى" value={form.destination} hint="رمز المطار" onChange={value => update("destination", value)} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DateField label="المغادرة" value={form.departureDate} onChange={value => update("departureDate", value)} />
                <DateField label="العودة" value={form.returnDate} disabled={!form.roundTrip} onChange={value => update("returnDate", value)} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2"><PeopleField form={form} onChange={update} /><label className="group block rounded-2xl border border-white/10 bg-white/[.07] px-4 py-3"><span className="block text-[10px] font-bold text-white/45">الدرجة</span><select value={form.cabinClass} onChange={event => update("cabinClass", event.target.value)} className="mt-1 w-full bg-transparent text-sm font-bold text-white outline-none"><option className="text-[#0d3340]" value="economy">اقتصادية</option><option className="text-[#0d3340]" value="premium_economy">اقتصادية مميزة</option><option className="text-[#0d3340]" value="business">رجال أعمال</option><option className="text-[#0d3340]" value="first">أولى</option></select></label></div>
              {error && <div className="mt-4 flex items-center gap-2 rounded-2xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-100"><X className="size-4 shrink-0" />{error}</div>}
              <Button onClick={search} disabled={loading} className="mt-5 h-14 w-full rounded-2xl bg-[#f3a34b] text-[#0d3340] hover:bg-[#ffc276]">{loading ? <RefreshCw className="size-5 animate-spin" /> : <Search className="size-5" />}<span className="font-black">{loading ? "نبحث لك..." : "ابحث عن الرحلات"}</span></Button>
              <p className="mt-4 flex items-center justify-center gap-2 text-center text-[11px] text-white/45"><ShieldCheck className="size-3.5" />بيئة Sandbox — لن يتم خصم أي مبلغ حقيقي</p>
            </div>
          </div>
        </section>

        {(results.length > 0 || loading) && <section id="results" className="scroll-mt-8 border-t border-[#0d3340]/10 py-12"><div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold tracking-[.2em] text-[#0f9f9a]">RESULTS / {results.length}</p><h2 className="mt-2 text-3xl font-black tracking-tight">رحلات إلى {form.destination}</h2><p className="mt-1 text-sm text-[#0d3340]/55">{searchLabel} · {shortDate(form.departureDate)} {form.roundTrip && `— ${shortDate(form.returnDate)}`}</p></div>{notice && <span className="max-w-md rounded-full bg-[#e7f4f1] px-4 py-2 text-xs font-bold text-[#0f756f]">{notice}</span>}</div><div className="space-y-4">{loading ? <div className="rounded-3xl border border-[#0d3340]/10 bg-white p-8 text-center text-[#0d3340]/55"><RefreshCw className="mx-auto size-6 animate-spin text-[#0f9f9a]" /><p className="mt-3">نراجع العروض المتاحة...</p></div> : results.map(offer => <OfferCard key={offer.id} offer={offer} loading={loading} onChoose={() => chooseOffer(offer)} />)}</div></section>}

        {step === "passengers" && selectedOffer && <section className="border-t border-[#0d3340]/10 py-12"><div className="grid gap-8 lg:grid-cols-[1.1fr_.9fr]"><div><div className="mb-7 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-[#0f9f9a] text-white"><Check className="size-5" /></span><div><p className="text-xs font-bold tracking-[.18em] text-[#0f9f9a]">STEP 02 / PASSENGER</p><h2 className="mt-1 text-3xl font-black">بيانات المسافر</h2></div></div><div className="rounded-3xl border border-[#0d3340]/10 bg-white p-5 shadow-sm sm:p-7"><div className="mb-6 flex items-center gap-2 text-sm font-bold"><Users className="size-4 text-[#0f9f9a]" />المسافر الرئيسي</div><div className="grid gap-4 sm:grid-cols-2"><TextField label="الاسم الأول" placeholder="كما في جواز السفر" value={passenger.firstName} onChange={value => setPassenger(current => ({ ...current, firstName: value }))} /><TextField label="اسم العائلة" placeholder="كما في جواز السفر" value={passenger.lastName} onChange={value => setPassenger(current => ({ ...current, lastName: value }))} /><TextField label="البريد الإلكتروني" type="email" placeholder="name@example.com" value={passenger.email} onChange={value => setPassenger(current => ({ ...current, email: value }))} /><TextField label="رقم الهاتف" type="tel" placeholder="+20 ..." value={passenger.phone} onChange={value => setPassenger(current => ({ ...current, phone: value }))} /><TextField label="تاريخ الميلاد (اختياري)" type="date" value={passenger.birthDate} onChange={value => setPassenger(current => ({ ...current, birthDate: value }))} /></div><div className="mt-6 flex items-start gap-3 rounded-2xl bg-[#f7f8f5] p-4 text-xs leading-6 text-[#0d3340]/60"><ShieldCheck className="mt-1 size-4 shrink-0 text-[#0f9f9a]" />لن نخزن بيانات البطاقة هنا. هذه النسخة متصلة بـDuffel Sandbox فقط.</div><Button onClick={book} disabled={loading} className="mt-6 h-13 w-full rounded-2xl bg-[#0d3340] text-white hover:bg-[#164a5b]">{loading ? <RefreshCw className="size-5 animate-spin" /> : <Ticket className="size-5" />}متابعة الحجز التجريبي</Button></div></div><OrderSummary offer={selectedOffer} /></div></section>}

        {step === "done" && booking && selectedOffer && <section className="border-t border-[#0d3340]/10 py-16"><div className="mx-auto max-w-2xl rounded-[32px] bg-[#0d3340] p-8 text-center text-white shadow-[0_22px_80px_rgba(13,51,64,.2)] sm:p-12"><span className="mx-auto grid size-16 place-items-center rounded-full bg-[#0f9f9a]"><Check className="size-8" /></span><p className="mt-6 text-xs font-bold tracking-[.2em] text-[#8ed8d0]">BOOKING CREATED</p><h2 className="mt-3 text-3xl font-black">تم إنشاء الحجز التجريبي</h2><p className="mx-auto mt-4 max-w-md leading-7 text-white/65">{booking.notice}</p><div className="mx-auto mt-7 max-w-xs rounded-2xl border border-white/15 bg-white/[.07] px-5 py-4"><span className="block text-xs text-white/45">رقم المرجع</span><strong className="mt-1 block text-2xl tracking-[.12em] text-[#f3a34b]">{booking.bookingReference || "معلّق"}</strong></div><Button onClick={() => { setStep("search"); setSelectedOffer(undefined); setResults([]); setBooking(undefined); window.scrollTo({ top: 0, behavior: "smooth" }); }} variant="outline" className="mt-8 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10">بحث عن رحلة أخرى</Button></div></section>}

        <section id="how" className="grid gap-5 border-t border-[#0d3340]/10 py-14 md:grid-cols-3"><InfoStep number="01" title="ابحث" text="أدخل مسارك وتاريخك، وسنبحث عن العروض المتاحة." /><InfoStep number="02" title="قارن" text="شاهد السعر والأمتعة والتوقفات قبل اتخاذ القرار." /><InfoStep number="03" title="احجز" text="أكمل بياناتك، وتأكد من السعر، ثم تابع الحجز." /></section>
      </main>
      <footer id="support" className="border-t border-[#0d3340]/10"><div className="mx-auto flex max-w-[1380px] flex-col gap-3 px-5 py-7 text-xs text-[#0d3340]/50 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12"><p>© 2026 AirBook · نموذج تجريبي متصل بـDuffel Sandbox</p><p>الدعم · الخصوصية · شروط الاستخدام</p></div></footer>
    </div>
  );
}

function AirportField({ label, value, hint, onChange }: { label: string; value: string; hint: string; onChange: (value: string) => void }) { return <label className="block rounded-2xl border border-white/10 bg-white/[.07] px-4 py-3"><span className="block text-[10px] font-bold text-white/45">{label}</span><input value={value} maxLength={3} onChange={event => onChange(event.target.value.toUpperCase())} className="mt-1 w-full bg-transparent text-xl font-black uppercase tracking-wider text-white outline-none placeholder:text-white/20" placeholder="CAI" /><span className="block text-[10px] text-white/35">{hint}</span></label>; }
function DateField({ label, value, disabled, onChange }: { label: string; value?: string; disabled?: boolean; onChange: (value: string) => void }) { return <label className={`block rounded-2xl border border-white/10 bg-white/[.07] px-4 py-3 ${disabled ? "opacity-40" : ""}`}><span className="flex items-center gap-2 text-[10px] font-bold text-white/45"><CalendarDays className="size-3" />{label}</span><input type="date" value={value || ""} disabled={disabled} onChange={event => onChange(event.target.value)} className="mt-1 w-full bg-transparent text-sm font-bold text-white outline-none [color-scheme:dark]" /></label>; }
function PeopleField({ form, onChange }: { form: typeof initialSearch; onChange: (key: string, value: string | number | boolean) => void }) { return <label className="block rounded-2xl border border-white/10 bg-white/[.07] px-4 py-3"><span className="flex items-center gap-2 text-[10px] font-bold text-white/45"><Users className="size-3" />المسافرون</span><select value={`${form.adults}-${form.children}-${form.infants}`} onChange={event => { const [adults, children, infants] = event.target.value.split("-").map(Number); onChange("adults", adults); onChange("children", children); onChange("infants", infants); }} className="mt-1 w-full bg-transparent text-sm font-bold text-white outline-none"><option className="text-[#0d3340]" value="1-0-0">مسافر واحد</option><option className="text-[#0d3340]" value="2-0-0">مسافران</option><option className="text-[#0d3340]" value="2-1-0">بالغون وطفل</option><option className="text-[#0d3340]" value="1-0-1">بالغ ورضيع</option></select></label>; }
function TextField({ label, placeholder, type = "text", value, onChange }: { label: string; placeholder?: string; type?: string; value: string; onChange: (value: string) => void }) { return <label className="block"><span className="mb-2 block text-xs font-bold text-[#0d3340]/65">{label}</span><input required={label !== "تاريخ الميلاد (اختياري)"} type={type} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} className="h-12 w-full rounded-xl border border-[#0d3340]/12 bg-[#f7f8f5] px-4 text-sm font-medium text-[#0d3340] outline-none transition placeholder:text-[#0d3340]/30 focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#0f9f9a]/10" /></label>; }
function OfferCard({ offer, loading, onChoose }: { offer: Offer; loading: boolean; onChoose: () => void }) { return <article className="group grid gap-5 rounded-3xl border border-[#0d3340]/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#0f9f9a]/40 hover:shadow-lg sm:grid-cols-[1.3fr_1fr_auto] sm:items-center sm:p-6"><div className="flex items-center gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#e7f4f1] font-black text-[#0f756f]">{offer.airlineCode}</span><div><div className="font-bold">{offer.airline}</div><div className="mt-1 text-xs text-[#0d3340]/50">{offer.provider === "demo" ? "عرض تجريبي" : "Duffel"} · {offer.bags}</div></div></div><div className="space-y-3">{offer.slices.map((slice, index) => { const first = slice.segments[0]; const last = slice.segments[slice.segments.length - 1]; return <div key={`${offer.id}-${index}`} className="flex items-center gap-3 text-sm"><strong className="w-12 text-lg tracking-tight">{time(first?.departureAt)}</strong><div className="flex min-w-24 flex-1 items-center gap-2 text-[#0d3340]/35"><span className="h-px flex-1 bg-[#0d3340]/15" /><Plane className="size-3.5 shrink-0 text-[#0f9f9a]" /><span className="h-px flex-1 bg-[#0d3340]/15" /></div><strong className="w-12 text-lg tracking-tight">{time(last?.arrivalAt)}</strong><span className="min-w-14 text-left text-[11px] text-[#0d3340]/50">{duration(slice.durationMinutes)}<br />{stops(slice) ? `${stops(slice)} توقف` : "مباشرة"}</span></div>; })}</div><div className="flex items-center justify-between gap-4 border-t border-[#0d3340]/10 pt-4 sm:block sm:border-0 sm:pt-0 sm:text-left"><div><span className="block text-[11px] text-[#0d3340]/45">الإجمالي</span><strong className="text-2xl font-black tracking-tight">{currency(offer.totalAmount, offer.currency)}</strong></div><Button onClick={onChoose} disabled={loading} className="rounded-xl bg-[#0d3340] px-5 text-white hover:bg-[#164a5b]">اختيار</Button></div></article>; }
function OrderSummary({ offer }: { offer: Offer }) { return <aside className="h-fit rounded-3xl bg-[#e7f4f1] p-6"><p className="text-xs font-bold tracking-[.2em] text-[#0f756f]">YOUR ITINERARY</p><h3 className="mt-2 text-xl font-black">ملخص الرحلة</h3><div className="mt-5 space-y-4">{offer.slices.map((slice, index) => { const first = slice.segments[0]; const last = slice.segments[slice.segments.length - 1]; return <div key={index} className="border-b border-[#0d3340]/10 pb-4 last:border-0 last:pb-0"><div className="flex items-center justify-between text-xs font-bold text-[#0d3340]/55"><span>{index === 0 ? "الذهاب" : "العودة"}</span><span>{duration(slice.durationMinutes)}</span></div><div className="mt-2 flex items-center justify-between text-lg font-black"><span>{first?.origin}</span><Plane className="size-4 -rotate-45 text-[#0f9f9a]" /><span>{last?.destination}</span></div></div>; })}</div><div className="mt-5 flex items-center justify-between border-t border-[#0d3340]/10 pt-5"><span className="font-bold">الإجمالي</span><strong className="text-2xl font-black">{currency(offer.totalAmount, offer.currency)}</strong></div></aside>; }
function InfoStep({ number, title, text }: { number: string; title: string; text: string }) { return <div className="rounded-3xl border border-[#0d3340]/10 bg-white p-6"><span className="text-4xl font-black tracking-[-.08em] text-[#f3a34b]">{number}</span><h3 className="mt-5 text-xl font-black">{title}</h3><p className="mt-2 text-sm leading-6 text-[#0d3340]/55">{text}</p></div>; }
