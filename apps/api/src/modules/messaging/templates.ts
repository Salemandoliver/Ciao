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
  /**
   * ───────────────────────── Partner messages ─────────────────────────
   *
   * The partner console is a phone product before it is a desk product, and
   * for a large share of this supply base WhatsApp *is* the product. These are
   * the messages that make it work when nobody opens the app.
   */

  /**
   * The evening agenda — the single most useful message Ciao sends anyone.
   *
   * It goes out the night before rather than the morning of, because the
   * decisions it changes (buy the flowers, charge the batteries, tell the
   * driver) are made the night before. It carries the whole day in the message
   * body rather than only a link, since the point is that it is useful with no
   * signal and no data left on the bundle.
   */
  partner_daily_agenda: {
    key: "partner_daily_agenda",
    ar: "برنامج بكرة ({{date}}):\n{{lines}}\nالتفاصيل: {{link}}",
    en: "Tomorrow ({{date}}):\n{{lines}}\nDetails: {{link}}",
    smsAr: "تشاو — بكرة: {{summary}}. {{link}}",
    critical: false,
  },
  /** A quote the partner sent has been accepted. Their day just changed. */
  partner_quote_accepted: {
    key: "partner_quote_accepted",
    ar: "قُبل عرضك {{code}} ({{total}} د.ل){{when}} — أضفناه لبرنامجك وحجزنا اليوم في تقويمك: {{link}}",
    en: "Your quote {{code}} was accepted ({{total}} LYD){{when}} — it's in your diary and the day is held: {{link}}",
    critical: false,
  },
  /**
   * The security alert. It goes to the number *on record before* the change,
   * which is the only channel that reaches the real owner if the account has
   * been taken over — so it is critical priority and ignores quiet hours. A
   * payout redirect at 2am is exactly when this needs to arrive.
   */
  partner_payout_account_changed: {
    key: "partner_payout_account_changed",
    ar: "تنبيه أمان: طُلب تغيير حساب استلام أموالك إلى {{ref}}. يسري بعد {{hours}} ساعة. إن لم تكن أنت، أوقفه فورًا: {{link}}",
    en: "Security alert: a request was made to change your payout account to {{ref}}. It takes effect in {{hours}} hours. If this wasn't you, stop it now: {{link}}",
    critical: true,
  },
  /** The free season is running out — said plainly, well before it does. */
  partner_plus_trial_ending: {
    key: "partner_plus_trial_ending",
    ar: "موسمك المجاني في تشاو بلس ينتهي بعد {{days}} يوم. بعدها {{price}} د.ل شهريًا تُخصم من مستحقاتك، وأرقامك الخاصة تبقى مجانية دائمًا: {{link}}",
    en: "Your free season of Ciao Plus ends in {{days}} days. After that it's {{price}} LYD a month, taken from your payouts — your own numbers stay free forever: {{link}}",
    critical: false,
  },
  /**
   * The set-password link — how a partner account comes into existence.
   *
   * Critical priority: it is either the first thing a newly onboarded business
   * is waiting for after a field visit, or it is a password reset, and both
   * are worse for being delayed until morning.
   */
  partner_invite: {
    key: "partner_invite",
    ar: "أهلًا بك في تشاو للشركاء 👋 اضغط الرابط واختر كلمة سرّك — صالح ٧ أيام ولمرة واحدة: {{link}}",
    en: "Welcome to Ciao Partners 👋 Tap the link and choose your password — valid 7 days, one use only: {{link}}",
    smsAr: "تشاو للشركاء: اختر كلمة سرّك {{link}}",
    critical: true,
  },
  /*
   * Ciao Plus, bought for a year.
   *
   * The activation message names the date the year ends rather than saying
   * "you're subscribed". A partner who has just handed over ten months' fee in
   * one payment wants the receipt fact, not the marketing one — and having it
   * in WhatsApp means they can find it in December without opening the app.
   */
  partner_plus_activated: {
    key: "partner_plus_activated",
    ar: "تم تفعيل تشاو بلس ✅ اشتراكك سارٍ حتى {{until}}. أرقام السوق مفتوحة لك من الحين.",
    en: "Ciao Plus is active ✅ Your subscription runs until {{until}}. The market numbers are open to you now.",
    smsAr: "تشاو بلس مفعّل حتى {{until}}",
    critical: false,
  },
  /*
   * The renewal nudge. Deliberately not dunning: it states a date and stops.
   * Three of these go out over a month and no more, because a partner who has
   * decided not to renew and is messaged anyway learns to mute us — and they
   * still have a diary here we want them opening every morning.
   */
  partner_plus_renewal: {
    key: "partner_plus_renewal",
    ar: "تشاو بلس: باقي {{days}} يوم على انتهاء اشتراكك ({{until}}). تقدر تجدّده من التطبيق — أرقامك تبقى مجانية دائمًا في كل الأحوال.",
    en: "Ciao Plus: {{days}} days left on your subscription ({{until}}). You can renew in the app — your own numbers stay free either way.",
    smsAr: "تشاو بلس ينتهي {{until}}",
    critical: false,
  },
  partner_password_reset: {
    key: "partner_password_reset",
    ar: "رمز استعادة كلمة السر في تشاو للشركاء: {{code}} — صالح ٥ دقائق. لا تشاركه مع أحد، حتى لو طلبه أحد باسم تشاو.",
    en: "Your Ciao Partners password-reset code: {{code}} — valid 5 minutes. Never share it, even with someone claiming to be from Ciao.",
    smsAr: "تشاو: رمز استعادة كلمة السر {{code}}",
    critical: true,
  },
  /** The business console's set-password link — how a team account starts. */
  biz_invite: {
    key: "biz_invite",
    ar: "أهلًا بك في تشاو بزنس 👋 اضغط الرابط واختر كلمة سرّك — صالح ٧ أيام ولمرة واحدة: {{link}}",
    en: "Welcome to Ciao Business 👋 Tap the link and choose your password — valid 7 days, one use only: {{link}}",
    smsAr: "تشاو بزنس: اختر كلمة سرّك {{link}}",
    critical: true,
  },
  biz_password_reset: {
    key: "biz_password_reset",
    ar: "رمز استعادة كلمة السر في تشاو بزنس: {{code}} — صالح ٥ دقائق. لا تشاركه مع أحد، حتى لو طلبه أحد باسم تشاو.",
    en: "Your Ciao Business password-reset code: {{code}} — valid 5 minutes. Never share it, even with someone claiming to be from Ciao.",
    smsAr: "تشاو بزنس: رمز استعادة كلمة السر {{code}}",
    critical: true,
  },
  /**
   * The console's wiring check. Critical on purpose: an operator verifying a
   * freshly-configured channel at half past midnight needs the message to go
   * NOW, and a test that silently queues until morning reads as a broken
   * integration — the exact wrong answer at the moment of configuration.
   */
  test_message: {
    key: "test_message",
    ar: "رسالة تجريبية من تشاو بزنس — القناة تعمل. الرمز: {{code}}",
    en: "Test message from Ciao Business — this channel works. Reference: {{code}}",
    smsAr: "تشاو: رسالة تجريبية {{code}}",
    critical: true,
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
