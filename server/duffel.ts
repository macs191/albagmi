import crypto from "node:crypto";

type FlightSearchInput = {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  children: number;
  infants: number;
  cabinClass: "economy" | "premium_economy" | "business" | "first";
};

type NormalizedSegment = {
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  carrierCode: string;
  carrierName: string;
  flightNumber: string;
  durationMinutes: number;
};

export type NormalizedOffer = {
  id: string;
  provider: "duffel" | "demo";
  airline: string;
  airlineCode: string;
  totalAmount: string;
  currency: string;
  totalAmountSar: string;
  originalAmountSar: string;
  promotionCode?: string;
  promotionLabel?: string;
  cabinClass: string;
  slices: Array<{
    durationMinutes: number;
    segments: NormalizedSegment[];
  }>;
  bags: string;
  expiresAt: string;
  rawProviderOfferId?: string;
};

const DUFFEL_BASE_URL = "https://api.duffel.com";
const token = () => process.env.DUFFEL_API_TOKEN;

export function toSar(amount: string | number, currency: string) {
  const value = Number(amount) || 0;
  const rates: Record<string, number> = { SAR: 1, USD: 3.75, EUR: 4.05, GBP: 4.75, AED: 1.02, QAR: 1.03, KWD: 12.2 };
  return value * (rates[currency.toUpperCase()] || 3.75);
}

function durationToMinutes(value?: string) {
  if (!value) return 0;
  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

function getCarrier(segment: any) {
  return segment.operating_carrier || segment.marketing_carrier || {};
}

function normalizeOffer(raw: any, provider: "duffel" | "demo"): NormalizedOffer {
  const slices = (raw.slices || []).map((slice: any) => {
    const segments = (slice.segments || []).map((segment: any) => {
      const carrier = getCarrier(segment);
      const departureAt = segment.departing_at || segment.departure?.at || "";
      const arrivalAt = segment.arriving_at || segment.arrival?.at || "";
      const durationMinutes = durationToMinutes(segment.duration) || Math.max(0, (Date.parse(arrivalAt) - Date.parse(departureAt)) / 60000);
      return {
        origin: segment.origin?.iata_code || segment.origin?.iata || "---",
        destination: segment.destination?.iata_code || segment.destination?.iata || "---",
        departureAt,
        arrivalAt,
        carrierCode: carrier.iata_code || carrier.iata || "--",
        carrierName: carrier.name || "شركة طيران",
        flightNumber: `${carrier.iata_code || ""}${segment.marketing_carrier_flight_number || segment.flight_number || ""}`,
        durationMinutes: Math.round(durationMinutes),
      } satisfies NormalizedSegment;
    });
    const durationMinutes = durationToMinutes(slice.duration) || segments.reduce((total: number, segment: NormalizedSegment) => total + segment.durationMinutes, 0);
    return { durationMinutes: Math.round(durationMinutes), segments };
  });
  const firstCarrier = slices[0]?.segments[0];
  const price = raw.total_amount || raw.total_price || "0.00";
  const sourceCurrency = raw.total_currency || raw.currency || "USD";
  const amountSar = toSar(price, sourceCurrency);
  return {
    id: `${provider}:${raw.id}`,
    provider,
    airline: firstCarrier?.carrierName || "شركة طيران",
    airlineCode: firstCarrier?.carrierCode || "--",
    totalAmount: String(price),
    currency: sourceCurrency,
    totalAmountSar: amountSar.toFixed(2),
    originalAmountSar: amountSar.toFixed(2),
    cabinClass: raw.cabin_class || "economy",
    slices,
    bags: raw.available_services?.some((service: any) => service.type === "baggage") ? "متاح حسب التعرفة" : "حسب التعرفة",
    expiresAt: raw.expires_at || new Date(Date.now() + 8 * 60 * 1000).toISOString(),
    rawProviderOfferId: raw.id,
  };
}

function demoOffers(input: FlightSearchInput): NormalizedOffer[] {
  const departure = new Date(`${input.departureDate}T08:30:00Z`);
  const returnDate = input.returnDate ? new Date(`${input.returnDate}T15:45:00Z`) : null;
  const mkSegment = (origin: string, destination: string, at: Date, hours: number, code: string, name: string, flight: string): NormalizedSegment => ({
    origin,
    destination,
    departureAt: at.toISOString(),
    arrivalAt: new Date(at.getTime() + hours * 60 * 60 * 1000).toISOString(),
    carrierCode: code,
    carrierName: name,
    flightNumber: `${code}${flight}`,
    durationMinutes: hours * 60,
  });
  const onward = mkSegment(input.origin, input.destination, departure, 3, "AB", "البقمي للطيران", "214");
  const returnSegment = returnDate ? mkSegment(input.destination, input.origin, returnDate, 3.25, "AB", "البقمي للطيران", "215") : null;
  const alt = mkSegment(input.origin, input.destination, new Date(departure.getTime() + 3 * 60 * 60 * 1000), 5.5, "NX", "Northstar Airlines", "872");
  const altReturn = returnDate ? mkSegment(input.destination, input.origin, new Date(returnDate.getTime() + 2 * 60 * 60 * 1000), 5.75, "NX", "Northstar Airlines", "873") : null;
  const make = (id: string, amount: string, segments: NormalizedSegment[], returnSegments: NormalizedSegment[] = [], airline = segments[0].carrierName, code = segments[0].carrierCode): NormalizedOffer => ({
    id: `demo:${id}`,
    provider: "demo",
    airline,
    airlineCode: code,
    totalAmount: amount,
    currency: "SAR",
    totalAmountSar: amount,
    originalAmountSar: amount,
    promotionCode: id === "northstar-value" ? "SAUDI25" : "BQM10",
    promotionLabel: id === "northstar-value" ? "عرض الوجهات" : "عرض البقمي",
    cabinClass: input.cabinClass,
    slices: [
      { durationMinutes: segments.reduce((n, s) => n + s.durationMinutes, 0), segments },
      ...(returnSegments.length ? [{ durationMinutes: returnSegments.reduce((n, s) => n + s.durationMinutes, 0), segments: returnSegments }] : []),
    ],
    bags: "حقيبة يد + حقيبة شخصية",
    expiresAt: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
  });
  return [
    make("airbook-flex", input.children ? "1575.00" : "1420.00", [onward], returnSegment ? [returnSegment] : []),
    make("northstar-value", input.children ? "1432.00" : "1290.00", [alt], altReturn ? [altReturn] : [], "Northstar Airlines", "NX"),
  ];
}

async function duffelRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${DUFFEL_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Duffel-Version": "v2",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.errors?.[0]?.message || body?.message || `Duffel API error ${response.status}`);
  }
  return body?.data ?? body;
}

export async function searchFlights(input: FlightSearchInput) {
  if (!token()) return { demo: true, offers: demoOffers(input), notice: "وضع تجريبي: أضف مفتاح Duffel لاستخدام عروض حقيقية." };
  try {
    const passengers = [
      ...Array.from({ length: input.adults }, () => ({ type: "adult" })),
      ...Array.from({ length: input.children }, () => ({ age: 8 })),
      ...Array.from({ length: input.infants }, () => ({ age: 1 })),
    ];
    const slices = [{ origin: input.origin, destination: input.destination, departure_date: input.departureDate }];
    if (input.returnDate) slices.push({ origin: input.destination, destination: input.origin, departure_date: input.returnDate });
    const data = await duffelRequest("/air/offer_requests", {
      method: "POST",
      body: JSON.stringify({ data: { slices, passengers, cabin_class: input.cabinClass, return_offers: true } }),
    });
    const offers = (data?.offers || []).map((offer: any) => normalizeOffer(offer, "duffel")).sort((a: NormalizedOffer, b: NormalizedOffer) => Number(a.totalAmount) - Number(b.totalAmount)).slice(0, 40);
    return { demo: false, offers, notice: offers.length ? undefined : "لم يعثر مزوّد الطيران على عروض متاحة." };
  } catch (error) {
    console.warn("[Duffel] Search fallback:", error);
    return { demo: true, offers: demoOffers(input), notice: "تعذر الوصول إلى Duffel الآن، لذلك نعرض بيانات تدريبية فقط." };
  }
}

export async function repriceOffer(offerId: string, input: FlightSearchInput) {
  if (!offerId.startsWith("duffel:")) {
    const offer = demoOffers(input).find(item => item.id === offerId) || demoOffers(input)[0];
    return { demo: true, offer, notice: "السعر تجريبي ولن يتم خصم أي مبلغ." };
  }
  if (!token()) throw new Error("DUFFEL_API_TOKEN غير مهيأ");
  const providerOfferId = offerId.replace(/^duffel:/, "");
  const data = await duffelRequest(`/air/offers/${encodeURIComponent(providerOfferId)}`);
  return { demo: false, offer: normalizeOffer(data, "duffel") };
}

export async function bookOffer(offer: NormalizedOffer, passengers: Array<Record<string, unknown>>) {
  if (offer.provider === "demo" || process.env.DUFFEL_ENABLE_BOOKING !== "true") {
    return {
      demo: true,
      bookingReference: `AB-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      status: "pending_demo",
      notice: "تم إنشاء حجز تجريبي. لا توجد تذكرة أو عملية دفع حقيقية.",
    };
  }
  if (!token() || !offer.rawProviderOfferId) throw new Error("معلومات العرض أو مفتاح Duffel غير متاحة");
  const data = await duffelRequest("/air/orders", {
    method: "POST",
    body: JSON.stringify({ data: {
      selected_offers: [offer.rawProviderOfferId],
      payments: [{ type: "balance", currency: offer.currency, amount: offer.totalAmount }],
      passengers,
    } }),
  });
  return {
    demo: false,
    bookingReference: data?.booking_reference || data?.booking_reference_code,
    status: "booked",
    providerOrderId: data?.id,
    notice: "تم إنشاء الطلب عبر Duffel Sandbox.",
  };
}
