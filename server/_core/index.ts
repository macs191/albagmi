import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { bookOffer, repriceOffer, searchFlights, type NormalizedOffer } from "../duffel";

const airportCode = (value: unknown) => typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim());
const dateValue = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const boundedInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
};
const searchInput = (body: any) => ({
  origin: String(body?.origin || "").trim().toUpperCase(),
  destination: String(body?.destination || "").trim().toUpperCase(),
  departureDate: String(body?.departureDate || ""),
  returnDate: body?.roundTrip === false || !body?.returnDate ? undefined : String(body.returnDate),
  adults: boundedInt(body?.adults, 1, 1, 9),
  children: boundedInt(body?.children, 0, 0, 8),
  infants: boundedInt(body?.infants, 0, 0, 4),
  cabinClass: ["economy", "premium_economy", "business", "first"].includes(body?.cabinClass) ? body.cabinClass : "economy",
} as const);

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  app.post("/api/flights/search", async (req, res) => {
    const input = searchInput(req.body);
    if (!airportCode(input.origin) || !airportCode(input.destination) || input.origin === input.destination || !dateValue(input.departureDate) || new Date(`${input.departureDate}T00:00:00Z`) < new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z") || (input.returnDate && (!dateValue(input.returnDate) || input.returnDate < input.departureDate))) {
      return res.status(400).json({ message: "أدخل رموز مطارات صحيحة وتواريخ بصيغة صحيحة." });
    }
    try {
      const result = await searchFlights(input);
      return res.json(result);
    } catch (error) {
      console.error("[Flights] search failed", error);
      return res.status(502).json({ message: "تعذر الحصول على الرحلات الآن." });
    }
  });
  app.post("/api/flights/reprice", async (req, res) => {
    const input = searchInput(req.body);
    const offerId = typeof req.body?.offerId === "string" ? req.body.offerId : "";
    if (!offerId || !airportCode(input.origin) || !airportCode(input.destination) || !dateValue(input.departureDate)) {
      return res.status(400).json({ message: "بيانات العرض غير مكتملة." });
    }
    try {
      return res.json(await repriceOffer(offerId, input));
    } catch (error) {
      console.error("[Flights] reprice failed", error);
      return res.status(502).json({ message: "انتهت صلاحية العرض أو تعذر التحقق من سعره." });
    }
  });
  app.post("/api/flights/book", async (req, res) => {
    const input = searchInput(req.body);
    const offerId = typeof req.body?.offerId === "string" ? req.body.offerId : "";
    const passengers = Array.isArray(req.body?.passengers) ? req.body.passengers : [];
    if (!offerId || !passengers.length || !airportCode(input.origin) || !airportCode(input.destination) || !dateValue(input.departureDate)) return res.status(400).json({ message: "اختر عرضًا وأدخل بيانات مسافر واحدة على الأقل." });
    if (passengers.some((item: any) => !item || typeof item.given_name !== "string" || typeof item.family_name !== "string" || typeof item.email !== "string" || typeof item.phone_number !== "string")) return res.status(400).json({ message: "بيانات المسافر غير مكتملة." });
    try {
      const repriced = await repriceOffer(offerId, input);
      return res.json(await bookOffer(repriced.offer as NormalizedOffer, passengers));
    } catch (error) {
      console.error("[Flights] booking failed", error);
      return res.status(502).json({ message: "تعذر إنشاء الحجز. لم يتم تأكيد التذكرة." });
    }
  });
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
