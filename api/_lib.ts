import { resolveLocation } from "../server/saudi";

export const dateValue = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
export const boundedInt = (value: unknown, fallback: number, min: number, max: number) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback; };
export const airportCode = (value: unknown) => typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim());
export const airportOrSearch = (value: unknown) => { const text = String(value || "").trim(); if (/^[A-Za-z]{3}$/.test(text)) return text.toUpperCase(); return resolveLocation(text)?.code || text.toUpperCase(); };
export const json = (res: any, status: number, body: unknown) => res.status(status).json(body);
export const flightInput = (body: any) => ({ origin: airportOrSearch(body?.originCode || body?.origin), destination: airportOrSearch(body?.destinationCode || body?.destination), departureDate: String(body?.departureDate || ""), returnDate: body?.roundTrip === false || !body?.returnDate ? undefined : String(body.returnDate), adults: boundedInt(body?.adults, 1, 1, 9), children: boundedInt(body?.children, 0, 0, 8), infants: boundedInt(body?.infants, 0, 0, 4), cabinClass: ["economy", "premium_economy", "business", "first"].includes(body?.cabinClass) ? body.cabinClass : "economy" } as const);
