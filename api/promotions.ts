export default function handler(_req: any, res: any) { return res.status(200).json({ promotions: [
  { id: "ramadan", code: "BQM10", title: "خصم البقمي", subtitle: "خصم يصل إلى 10% على رسوم الخدمة", value: "10%", tone: "teal", active: true },
  { id: "saudi", code: "SAUDI25", title: "وجهات السعودية", subtitle: "عرض خاص على الرحلات الداخلية", value: "25 ر.س", tone: "orange", active: true },
  { id: "welcome", code: "WELCOME", title: "أول حجز", subtitle: "خصم ترحيبي للمستخدم الجديد", value: "50 ر.س", tone: "navy", active: true },
] }); }
