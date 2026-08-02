/**
 * Template registry — §13.5. Arabic primary, English secondary.
 * WhatsApp-approved template mirrors as SMS/voice variants.
 * {{var}} interpolation; SMS variants kept short (one-way alphanumeric sender).
 */

export interface MessageTemplate {
  key: string;
  ar: string;
  en: string;
  smsAr?: string; // shorter SMS variant
  critical: boolean; // critical events ignore quiet hours on day-of-arrival
}

export const TEMPLATES: Record<string, MessageTemplate> = {
  otp: {
    key: "otp",
    ar: "رمز الدخول إلى تشاو: {{code}} — صالح ٥ دقائق. لا تشاركه مع أحد.",
    en: "Your Ciao sign-in code: {{code}} — valid 5 minutes. Never share it.",
    critical: true,
  },
  booking_request_host: {
    key: "booking_request_host",
    ar: "طلب حجز جديد {{code}}: {{nights}} — {{dates}}. العربون {{deposit}} د.ل محجوز. أكّد أو ارفض خلال {{window}}: {{link}}",
    en: "New booking request {{code}}: {{nights}} — {{dates}}. Deposit {{deposit}} LYD held. Confirm or decline within {{window}}: {{link}}",
    smsAr: "تشاو: طلب حجز {{code}} {{dates}}. أكد خلال {{window}}: {{link}}",
    critical: true,
  },
  booking_confirmed_guest: {
    key: "booking_confirmed_guest",
    ar: "مبروك! تأكد حجزك {{code}} في {{venue}}. قسيمة الحجز والعنوان: {{link}} — الباقي {{balance}} د.ل نقدًا عند الوصول.",
    en: "Confirmed! Booking {{code}} at {{venue}}. Voucher & address: {{link}} — balance {{balance}} LYD in cash on arrival.",
    smsAr: "تشاو: تأكد حجزك {{code}}. القسيمة: {{link}}",
    critical: true,
  },
  booking_declined_guest: {
    key: "booking_declined_guest",
    ar: "نعتذر — لم يتمكن المضيف من تأكيد {{code}}. عربونك يُرجَع كاملًا. بدائل مشابهة: {{link}}",
    en: "Sorry — the host couldn't confirm {{code}}. Your deposit is returned in full. Similar alternatives: {{link}}",
    critical: true,
  },
  host_timeout_guest: {
    key: "host_timeout_guest",
    ar: "انتهت مهلة تأكيد {{code}} دون رد المضيف. عربونك يُرجَع كاملًا + خصم ٥٪ على حجزك القادم. بدائل: {{link}}",
    en: "The confirmation window for {{code}} passed. Full deposit returned + 5% credit toward your next booking. Alternatives: {{link}}",
    critical: true,
  },
  payment_pending_guest: {
    key: "payment_pending_guest",
    ar: "مشكلة مؤقتة في شبكة الدفع — حجزك {{code}} محفوظ ٦ ساعات. أكمل الدفع من هنا: {{link}}",
    en: "Temporary payment-network issue — booking {{code}} is held for 6 hours. Complete payment here: {{link}}",
    critical: true,
  },
  /**
   * The pre-arrival reminder is where the map link belongs.
   *
   * Not the confirmation — that arrives weeks early, when nobody is thinking
   * about the road. This one lands two days out, and it is the message a
   * family actually has open in the car. Most istirahas have no street
   * address, so «الطريق» is not a convenience here; it is the difference
   * between arriving and phoning the host from a roundabout.
   *
   * The SMS variant carries the map link and drops the voucher link: an SMS
   * fallback means the network is already struggling, and directions beat a
   * web page at that point.
   */
  pre_arrival_reminder: {
    key: "pre_arrival_reminder",
    ar: "تذكير: حجزك {{code}} بعد غدٍ في {{venue}}. الباقي {{balance}} د.ل نقدًا. القسيمة: {{link}}{{directions}}",
    en: "Reminder: booking {{code}} is in 2 days at {{venue}}. Balance {{balance}} LYD in cash. Voucher: {{link}}{{directions}}",
    smsAr: "تشاو: حجزك {{code}} بعد غدٍ. الطريق: {{mapLink}}",
    critical: false,
  },
  host_reconfirm_request: {
    key: "host_reconfirm_request",
    ar: "تذكير تشاو: ضيفك {{code}} يصل بعد ٤٨ ساعة. اضغط للتأكيد أن كل شيء جاهز: {{link}}",
    en: "Ciao reminder: guest {{code}} arrives in 48h. Tap to confirm all is ready: {{link}}",
    critical: false,
  },
  review_prompt: {
    key: "review_prompt",
    ar: "كيف كانت إقامتك في {{venue}}؟ قيّم تجربتك (يفتح رصيد خصم لحجزك القادم): {{link}}",
    en: "How was your stay at {{venue}}? Review it (unlocks credit toward your next booking): {{link}}",
    critical: false,
  },
  refund_issued: {
    key: "refund_issued",
    ar: "تم إصدار استرجاع {{amount}} د.ل لحجز {{code}} ({{method}}). التفاصيل: {{link}}",
    en: "A refund of {{amount}} LYD was issued for {{code}} ({{method}}). Details: {{link}}",
    critical: true,
  },
  /**
   * The birthday note.
   *
   * Marketing, not service — it only sends to members who opted in, and the
   * points land whether or not it does. Short, no hard sell, and it names the
   * gift so the message is worth having rather than being an advert wearing a
   * greeting as a disguise.
   */
  birthday: {
    key: "birthday",
    ar: "كل عام وأنت بخير{{name}} 🎉 أضفنا لك {{points}} نقطة هدية في حسابك بتشاو. صيفك أحلى بإقامة على البحر: {{link}}",
    en: "Happy birthday{{name}} 🎉 We've added {{points}} reward points to your Ciao account. Somewhere by the sea, perhaps: {{link}}",
    critical: false,
  },
  /**
   * The occasion nudge — an anniversary or a family birthday whose month the
   * member told us. Month-level only, so it says "this month", never a date we
   * were never given.
   */
  occasion_nudge: {
    key: "occasion_nudge",
    ar: "عندك مناسبة هذا الشهر 🎈 اخترنا لك أماكن تناسبها — احجز مبكرًا فالتواريخ الحلوة تُحجز أولًا: {{link}}",
    en: "You have an occasion this month 🎈 We've picked places that suit it — book early, the good dates go first: {{link}}",
    critical: false,
  },
  calendar_attestation: {
    key: "calendar_attestation",
    ar: "تشاو الأسبوعي: هل عندك حجوزات خارج المنصة نحجبها من التقويم؟ رد بالتواريخ أو اضغط: {{link}}",
    en: "Ciao weekly: any off-platform bookings to block on your calendar? Reply with dates or tap: {{link}}",
    critical: false,
  },
};

export function render(
  key: string,
  locale: "ar" | "en",
  vars: Record<string, string>,
  variant: "full" | "sms" = "full",
): string {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`Unknown template ${key}`);
  let body =
    variant === "sms" && t.smsAr && locale === "ar" ? t.smsAr : locale === "en" ? t.en : t.ar;
  for (const [k, v] of Object.entries(vars)) {
    body = body.replaceAll(`{{${k}}}`, v);
  }
  return body;
}
