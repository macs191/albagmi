export type Location = {
  code: string;
  city: string;
  airport: string;
  country: string;
  aliases: string[];
  popular?: boolean;
};

export const locations: Location[] = [
  { code: "RUH", city: "الرياض", airport: "مطار الملك خالد الدولي", country: "السعودية", aliases: ["رياض", "الملك خالد", "riyadh"], popular: true },
  { code: "JED", city: "جدة", airport: "مطار الملك عبدالعزيز الدولي", country: "السعودية", aliases: ["جده", "مكة", "جدة مكة", "jeddah"], popular: true },
  { code: "DMM", city: "الدمام", airport: "مطار الملك فهد الدولي", country: "السعودية", aliases: ["دمام", "الخبر", "الظهران", "dammam"], popular: true },
  { code: "MED", city: "المدينة المنورة", airport: "مطار الأمير محمد بن عبدالعزيز", country: "السعودية", aliases: ["المدينة", "مدينه", "المدينة المنورة", "madinah"], popular: true },
  { code: "AHB", city: "أبها", airport: "مطار أبها الدولي", country: "السعودية", aliases: ["ابها", "عسير", "abha"], popular: true },
  { code: "TIF", city: "الطائف", airport: "مطار الطائف الدولي", country: "السعودية", aliases: ["taif"], popular: true },
  { code: "GIZ", city: "جازان", airport: "مطار الملك عبدالله", country: "السعودية", aliases: ["جيزان", "jazan"] },
  { code: "TUU", city: "تبوك", airport: "مطار الأمير سلطان بن عبدالعزيز", country: "السعودية", aliases: ["tabuk"] },
  { code: "ELQ", city: "القصيم", airport: "مطار الأمير نايف بن عبدالعزيز", country: "السعودية", aliases: ["بريدة", "buraydah", "qassim"] },
  { code: "YNB", city: "ينبع", airport: "مطار ينبع الدولي", country: "السعودية", aliases: ["yanbu"] },
  { code: "ULH", city: "العلا", airport: "مطار العلا الدولي", country: "السعودية", aliases: ["alula", "العلا"] },
  { code: "HAS", city: "حائل", airport: "مطار حائل الدولي", country: "السعودية", aliases: ["hail"] },
  { code: "DXB", city: "دبي", airport: "مطار دبي الدولي", country: "الإمارات", aliases: ["دبى", "dubai"], popular: true },
  { code: "AUH", city: "أبوظبي", airport: "مطار زايد الدولي", country: "الإمارات", aliases: ["ابوظبي", "أبو ظبي", "abu dhabi"] },
  { code: "DOH", city: "الدوحة", airport: "مطار حمد الدولي", country: "قطر", aliases: ["دوحه", "doha"], popular: true },
  { code: "BAH", city: "المنامة", airport: "مطار البحرين الدولي", country: "البحرين", aliases: ["البحرين", "manama"] },
  { code: "CAI", city: "القاهرة", airport: "مطار القاهرة الدولي", country: "مصر", aliases: ["قاهره", "cairo"], popular: true },
  { code: "IST", city: "إسطنبول", airport: "مطار إسطنبول", country: "تركيا", aliases: ["اسطنبول", "استانبول", "istanbul"], popular: true },
  { code: "LHR", city: "لندن", airport: "مطار هيثرو", country: "المملكة المتحدة", aliases: ["لندن", "london"], popular: true },
  { code: "KUL", city: "كوالالمبور", airport: "مطار كوالالمبور الدولي", country: "ماليزيا", aliases: ["كوالا", "malaysia"] },
];

export const promotions = [
  { id: "ramadan", code: "BQM10", title: "خصم البقمي", subtitle: "خصم يصل إلى 10% على رسوم الخدمة", value: "10%", tone: "teal", active: true },
  { id: "saudi", code: "SAUDI25", title: "وجهات السعودية", subtitle: "عرض خاص على الرحلات الداخلية", value: "25 ر.س", tone: "orange", active: true },
  { id: "welcome", code: "WELCOME", title: "أول حجز", subtitle: "خصم ترحيبي للمستخدم الجديد", value: "50 ر.س", tone: "navy", active: true },
];

export function normalizeArabic(value: string) {
  return value.toLowerCase().trim().replace(/[ًٌٍَُِّْـ]/g, "").replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal : Math.min(diagonal + 1, row[j] + 1, row[j - 1] + 1);
      diagonal = above;
    }
  }
  return row[b.length];
}

export function searchLocations(query: string, limit = 8) {
  const q = normalizeArabic(query);
  if (!q) return locations.filter(item => item.popular).slice(0, limit);
  return locations.map(item => {
    const values = [item.code, item.city, item.airport, item.country, ...item.aliases].map(normalizeArabic);
    const score = Math.max(...values.map(value => {
      if (value === q) return 100;
      if (value.startsWith(q)) return 85;
      if (value.includes(q)) return 65;
      if (q.length <= 2 && value.split(" ").some(word => word.startsWith(q))) return 55;
      return Math.max(0, 35 - distance(q, value.slice(0, Math.max(q.length, 4))) * 4);
    }));
    return { ...item, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || Number(Boolean(b.popular)) - Number(Boolean(a.popular))).slice(0, limit).map(({ score: _score, ...item }) => item);
}

export function resolveLocation(query: string) {
  return searchLocations(query, 1)[0];
}
