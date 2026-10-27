import { demoOffer, flightInput } from "./_demo";
function validCode(value: string) { return /^[A-Z]{3}$/.test(value); }
export default async function handler(req: any, res: any) {
  const input = flightInput(req.body || {});
  if (!validCode(input.origin) || !validCode(input.destination) || input.origin === input.destination || !/^\d{4}-\d{2}-\d{2}$/.test(input.departureDate)) return res.status(400).json({ message: "أدخل مطاري المغادرة والوصول والتاريخ بشكل صحيح." });
  const fallback = () => res.status(200).json({ demo: true, offers: [demoOffer(input.origin, input.destination, input.departureDate, input.returnDate)], notice: "عرض تجريبي آمن: سيتم إظهار العروض الحية بعد تفعيل صلاحية Duffel التجارية." });
  const token = process.env.DUFFEL_API_TOKEN;
  if (!token) return fallback();
  try {
    const passengers = [...Array.from({ length: Math.max(1, input.adults) }, () => ({ type: "adult" })), ...Array.from({ length: input.children }, () => ({ age: 8 })), ...Array.from({ length: input.infants }, () => ({ age: 1 }))];
    const slices = [{ origin: input.origin, destination: input.destination, departure_date: input.departureDate }, ...(input.returnDate ? [{ origin: input.destination, destination: input.origin, departure_date: input.returnDate }] : [])];
    const response = await fetch("https://api.duffel.com/air/offer_requests", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Duffel-Version": "v2", "Content-Type": "application/json" }, body: JSON.stringify({ data: { slices, passengers, cabin_class: input.cabinClass, return_offers: true } }) });
    if (!response.ok) return fallback();
    const payload = await response.json();
    const offers = (payload?.data?.offers || []).slice(0, 30).map((offer: any) => ({ id: `duffel:${offer.id}`, provider: "duffel", airline: offer.slices?.[0]?.segments?.[0]?.operating_carrier?.name || offer.slices?.[0]?.segments?.[0]?.marketing_carrier?.name || "شركة طيران", airlineCode: offer.slices?.[0]?.segments?.[0]?.operating_carrier?.iata_code || "--", totalAmount: String(offer.total_amount || "0"), currency: offer.total_currency || "USD", totalAmountSar: String(Number(offer.total_amount || 0) * (offer.total_currency === "SAR" ? 1 : offer.total_currency === "USD" ? 3.75 : 4)), originalAmountSar: String(Number(offer.total_amount || 0) * (offer.total_currency === "SAR" ? 1 : offer.total_currency === "USD" ? 3.75 : 4)), cabinClass: input.cabinClass, slices: (offer.slices || []).map((slice: any) => ({ durationMinutes: 0, segments: (slice.segments || []).map((segment: any) => ({ origin: segment.origin?.iata_code, destination: segment.destination?.iata_code, departureAt: segment.departing_at, arrivalAt: segment.arriving_at, carrierCode: segment.operating_carrier?.iata_code || segment.marketing_carrier?.iata_code, carrierName: segment.operating_carrier?.name || segment.marketing_carrier?.name, flightNumber: segment.marketing_carrier_flight_number || "", durationMinutes: 0 })) })), bags: "حسب التعرفة", expiresAt: offer.expires_at || new Date(Date.now() + 8 * 60 * 1000).toISOString(), rawProviderOfferId: offer.id }));
    if (!offers.length) return fallback();
    return res.status(200).json({ demo: false, offers });
  } catch { return fallback(); }
}
