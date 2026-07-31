/**
 * Arabic-first error catalogue — §13.3.
 * Support quotes codes over WhatsApp; messages are user-facing.
 */

export interface CiaoErrorDef {
  code: string;
  httpStatus: number;
  ar: string;
  en: string;
}

export const ERRORS = {
  AUTH_OTP_INVALID: {
    code: "CIAO-1001",
    httpStatus: 401,
    ar: "رمز التحقق غير صحيح أو منتهي. اطلب رمزًا جديدًا.",
    en: "The verification code is wrong or expired. Request a new one.",
  },
  AUTH_OTP_THROTTLED: {
    code: "CIAO-1002",
    httpStatus: 429,
    ar: "محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.",
    en: "Too many attempts. Wait a minute and try again.",
  },
  AUTH_REQUIRED: {
    code: "CIAO-1003",
    httpStatus: 401,
    ar: "يلزم تسجيل الدخول برقم الهاتف.",
    en: "Phone sign-in required.",
  },
  AUTH_FORBIDDEN: {
    code: "CIAO-1004",
    httpStatus: 403,
    ar: "ليست لديك صلاحية لهذا الإجراء.",
    en: "You don't have permission for this action.",
  },
  ACTION_TOKEN_INVALID: {
    code: "CIAO-1010",
    httpStatus: 401,
    ar: "رابط التأكيد غير صالح أو استُخدم من قبل.",
    en: "This confirmation link is invalid or was already used.",
  },
  BOOKING_NOT_FOUND: {
    code: "CIAO-2001",
    httpStatus: 404,
    ar: "الحجز غير موجود.",
    en: "Booking not found.",
  },
  BOOKING_ILLEGAL_TRANSITION: {
    code: "CIAO-2002",
    httpStatus: 409,
    ar: "لا يمكن تنفيذ هذا الإجراء على الحجز في حالته الحالية.",
    en: "This action isn't possible in the booking's current state.",
  },
  DATES_UNAVAILABLE: {
    code: "CIAO-2003",
    httpStatus: 409,
    ar: "هذه التواريخ لم تعد متاحة — إليك بدائل مشابهة.",
    en: "These dates are no longer available — here are similar alternatives.",
  },
  CONFIRMATION_WINDOW_CLOSED: {
    code: "CIAO-2004",
    httpStatus: 409,
    ar: "انتهت مهلة التأكيد لهذا الطلب.",
    en: "The confirmation window for this request has closed.",
  },
  PAYMENT_RAIL_DOWN: {
    code: "CIAO-3001",
    httpStatus: 503,
    ar: "قناة الدفع متوقفة مؤقتًا — حجزك محفوظ وسنراسلك فور عودتها.",
    en: "This payment channel is temporarily down — your booking is held and we'll message you when it's back.",
  },
  PAYMENT_FAILED: {
    code: "CIAO-3002",
    httpStatus: 402,
    ar: "لم تكتمل عملية الدفع. جرّب قناة دفع أخرى.",
    en: "The payment didn't complete. Try another payment method.",
  },
  PAYMENT_DUPLICATE: {
    code: "CIAO-3003",
    httpStatus: 409,
    ar: "هذه العملية قيد المعالجة بالفعل.",
    en: "This payment is already being processed.",
  },
  REFUND_UNSUPPORTED_RAIL: {
    code: "CIAO-3004",
    httpStatus: 409,
    ar: "الاسترجاع لهذه القناة يتم كرصيد فوري في المنصة أو تحويل بنكي خلال ٧ أيام عمل.",
    en: "Refunds on this channel are issued as instant platform credit or a bank transfer within 7 working days.",
  },
  VALIDATION: {
    code: "CIAO-4001",
    httpStatus: 400,
    ar: "بيانات غير صالحة.",
    en: "Invalid input.",
  },
  IDEMPOTENCY_CONFLICT: {
    code: "CIAO-4002",
    httpStatus: 409,
    ar: "طلب مكرر بمحتوى مختلف.",
    en: "Duplicate request with different content.",
  },
  RATE_LIMITED: {
    code: "CIAO-4003",
    httpStatus: 429,
    ar: "طلبات كثيرة — حاول بعد قليل.",
    en: "Too many requests — try again shortly.",
  },
  INTERNAL: {
    code: "CIAO-5000",
    httpStatus: 500,
    ar: "حدث خطأ عندنا — فريق الدعم أُبلغ تلقائيًا.",
    en: "Something went wrong on our side — support has been notified.",
  },
} as const satisfies Record<string, CiaoErrorDef>;

export type ErrorKey = keyof typeof ERRORS;
