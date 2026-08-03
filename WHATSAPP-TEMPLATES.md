# WhatsApp template submissions — Ciao

Generated from `apps/api/src/modules/messaging/templates.ts` — the same
strings the API sends parameters against, so the registered template and the
code cannot drift. Submit these in **WhatsApp Manager → Account tools →
Message templates** on the WhatsApp Business Account connected to the Ciao
sender number.

Rules that matter:

- **Template name must match exactly** (`ciao_<key>`, lowercase) — the API
  sends by that name.
- Register **each language separately** under the same name (Arabic `ar`,
  English `en`). The placeholder numbering below is already per-language.
- The three sign-in-code templates are marked **AUTHENTICATION**: Meta
  forces a fixed format for that category (their preset body + a copy-code
  button, your text is not used verbatim). Register them as authentication
  templates with a copy-code button; the one parameter is the code. If Meta's
  authentication preset is unacceptable, register as UTILITY and expect
  tighter review.
- Everything else is **UTILITY** (transactional). Nothing here is MARKETING.
- Approval is usually minutes to a day for UTILITY.

---

## `ciao_otp`

Category: **AUTHENTICATION** · critical (ignores quiet hours)

**Arabic (`ar`)**

> رمز الدخول إلى تشاو: {{1}} — صالح ٥ دقائق. لا تشاركه مع أحد.

Parameters: {{1}} = code

**English (`en`)**

> Your Ciao sign-in code: {{1}} — valid 5 minutes. Never share it.

Parameters: {{1}} = code

---

## `ciao_booking_request_host`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> طلب حجز جديد {{1}}: {{2}} — {{3}}. العربون {{4}} د.ل محجوز. أكّد أو ارفض خلال {{5}}: {{6}}

Parameters: {{1}} = code · {{2}} = nights · {{3}} = dates · {{4}} = deposit · {{5}} = window · {{6}} = link

**English (`en`)**

> New booking request {{1}}: {{2}} — {{3}}. Deposit {{4}} LYD held. Confirm or decline within {{5}}: {{6}}

Parameters: {{1}} = code · {{2}} = nights · {{3}} = dates · {{4}} = deposit · {{5}} = window · {{6}} = link

---

## `ciao_booking_confirmed_guest`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> مبروك! تأكد حجزك {{1}} في {{2}}. قسيمة الحجز والعنوان: {{3}} — الباقي {{4}} د.ل نقدًا عند الوصول.

Parameters: {{1}} = code · {{2}} = venue · {{3}} = link · {{4}} = balance

**English (`en`)**

> Confirmed! Booking {{1}} at {{2}}. Voucher & address: {{3}} — balance {{4}} LYD in cash on arrival.

Parameters: {{1}} = code · {{2}} = venue · {{3}} = link · {{4}} = balance

---

## `ciao_booking_declined_guest`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> نعتذر — لم يتمكن المضيف من تأكيد {{1}}. عربونك يُرجَع كاملًا. بدائل مشابهة: {{2}}

Parameters: {{1}} = code · {{2}} = link

**English (`en`)**

> Sorry — the host couldn't confirm {{1}}. Your deposit is returned in full. Similar alternatives: {{2}}

Parameters: {{1}} = code · {{2}} = link

---

## `ciao_host_timeout_guest`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> انتهت مهلة تأكيد {{1}} دون رد المضيف. عربونك يُرجَع كاملًا + خصم ٥٪ على حجزك القادم. بدائل: {{2}}

Parameters: {{1}} = code · {{2}} = link

**English (`en`)**

> The confirmation window for {{1}} passed. Full deposit returned + 5% credit toward your next booking. Alternatives: {{2}}

Parameters: {{1}} = code · {{2}} = link

---

## `ciao_payment_pending_guest`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> مشكلة مؤقتة في شبكة الدفع — حجزك {{1}} محفوظ ٦ ساعات. أكمل الدفع من هنا: {{2}}

Parameters: {{1}} = code · {{2}} = link

**English (`en`)**

> Temporary payment-network issue — booking {{1}} is held for 6 hours. Complete payment here: {{2}}

Parameters: {{1}} = code · {{2}} = link

---

## `ciao_pre_arrival_reminder`

Category: **UTILITY**

**Arabic (`ar`)**

> تذكير: حجزك {{1}} بعد غدٍ في {{2}}. الباقي {{3}} د.ل نقدًا. القسيمة: {{4}}{{5}}

Parameters: {{1}} = code · {{2}} = venue · {{3}} = balance · {{4}} = link · {{5}} = directions

**English (`en`)**

> Reminder: booking {{1}} is in 2 days at {{2}}. Balance {{3}} LYD in cash. Voucher: {{4}}{{5}}

Parameters: {{1}} = code · {{2}} = venue · {{3}} = balance · {{4}} = link · {{5}} = directions

---

## `ciao_host_reconfirm_request`

Category: **UTILITY**

**Arabic (`ar`)**

> تذكير تشاو: ضيفك {{1}} يصل بعد ٤٨ ساعة. اضغط للتأكيد أن كل شيء جاهز: {{2}}

Parameters: {{1}} = code · {{2}} = link

**English (`en`)**

> Ciao reminder: guest {{1}} arrives in 48h. Tap to confirm all is ready: {{2}}

Parameters: {{1}} = code · {{2}} = link

---

## `ciao_review_prompt`

Category: **UTILITY**

**Arabic (`ar`)**

> كيف كانت إقامتك في {{1}}؟ قيّم تجربتك (يفتح رصيد خصم لحجزك القادم): {{2}}

Parameters: {{1}} = venue · {{2}} = link

**English (`en`)**

> How was your stay at {{1}}? Review it (unlocks credit toward your next booking): {{2}}

Parameters: {{1}} = venue · {{2}} = link

---

## `ciao_refund_issued`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> تم إصدار استرجاع {{1}} د.ل لحجز {{2}} ({{3}}). التفاصيل: {{4}}

Parameters: {{1}} = amount · {{2}} = code · {{3}} = method · {{4}} = link

**English (`en`)**

> A refund of {{1}} LYD was issued for {{2}} ({{3}}). Details: {{4}}

Parameters: {{1}} = amount · {{2}} = code · {{3}} = method · {{4}} = link

---

## `ciao_birthday`

Category: **UTILITY**

**Arabic (`ar`)**

> كل عام وأنت بخير{{1}} 🎉 أضفنا لك {{2}} نقطة هدية في حسابك بتشاو. صيفك أحلى بإقامة على البحر: {{3}}

Parameters: {{1}} = name · {{2}} = points · {{3}} = link

**English (`en`)**

> Happy birthday{{1}} 🎉 We've added {{2}} reward points to your Ciao account. Somewhere by the sea, perhaps: {{3}}

Parameters: {{1}} = name · {{2}} = points · {{3}} = link

---

## `ciao_occasion_nudge`

Category: **UTILITY**

**Arabic (`ar`)**

> عندك مناسبة هذا الشهر 🎈 اخترنا لك أماكن تناسبها — احجز مبكرًا فالتواريخ الحلوة تُحجز أولًا: {{1}}

Parameters: {{1}} = link

**English (`en`)**

> You have an occasion this month 🎈 We've picked places that suit it — book early, the good dates go first: {{1}}

Parameters: {{1}} = link

---

## `ciao_partner_daily_agenda`

Category: **UTILITY**

**Arabic (`ar`)**

> برنامج بكرة ({{1}}):
{{2}}
التفاصيل: {{3}}

Parameters: {{1}} = date · {{2}} = lines · {{3}} = link

**English (`en`)**

> Tomorrow ({{1}}):
{{2}}
Details: {{3}}

Parameters: {{1}} = date · {{2}} = lines · {{3}} = link

---

## `ciao_partner_quote_accepted`

Category: **UTILITY**

**Arabic (`ar`)**

> قُبل عرضك {{1}} ({{2}} د.ل){{3}} — أضفناه لبرنامجك وحجزنا اليوم في تقويمك: {{4}}

Parameters: {{1}} = code · {{2}} = total · {{3}} = when · {{4}} = link

**English (`en`)**

> Your quote {{1}} was accepted ({{2}} LYD){{3}} — it's in your diary and the day is held: {{4}}

Parameters: {{1}} = code · {{2}} = total · {{3}} = when · {{4}} = link

---

## `ciao_partner_payout_account_changed`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> تنبيه أمان: طُلب تغيير حساب استلام أموالك إلى {{1}}. يسري بعد {{2}} ساعة. إن لم تكن أنت، أوقفه فورًا: {{3}}

Parameters: {{1}} = ref · {{2}} = hours · {{3}} = link

**English (`en`)**

> Security alert: a request was made to change your payout account to {{1}}. It takes effect in {{2}} hours. If this wasn't you, stop it now: {{3}}

Parameters: {{1}} = ref · {{2}} = hours · {{3}} = link

---

## `ciao_partner_plus_trial_ending`

Category: **UTILITY**

**Arabic (`ar`)**

> موسمك المجاني في تشاو بلس ينتهي بعد {{1}} يوم. بعدها {{2}} د.ل شهريًا تُخصم من مستحقاتك، وأرقامك الخاصة تبقى مجانية دائمًا: {{3}}

Parameters: {{1}} = days · {{2}} = price · {{3}} = link

**English (`en`)**

> Your free season of Ciao Plus ends in {{1}} days. After that it's {{2}} LYD a month, taken from your payouts — your own numbers stay free forever: {{3}}

Parameters: {{1}} = days · {{2}} = price · {{3}} = link

---

## `ciao_partner_invite`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> أهلًا بك في تشاو للشركاء 👋 اضغط الرابط واختر كلمة سرّك — صالح ٧ أيام ولمرة واحدة: {{1}}

Parameters: {{1}} = link

**English (`en`)**

> Welcome to Ciao Partners 👋 Tap the link and choose your password — valid 7 days, one use only: {{1}}

Parameters: {{1}} = link

---

## `ciao_partner_password_reset`

Category: **AUTHENTICATION** · critical (ignores quiet hours)

**Arabic (`ar`)**

> رمز استعادة كلمة السر في تشاو للشركاء: {{1}} — صالح ٥ دقائق. لا تشاركه مع أحد، حتى لو طلبه أحد باسم تشاو.

Parameters: {{1}} = code

**English (`en`)**

> Your Ciao Partners password-reset code: {{1}} — valid 5 minutes. Never share it, even with someone claiming to be from Ciao.

Parameters: {{1}} = code

---

## `ciao_biz_invite`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> أهلًا بك في تشاو بزنس 👋 اضغط الرابط واختر كلمة سرّك — صالح ٧ أيام ولمرة واحدة: {{1}}

Parameters: {{1}} = link

**English (`en`)**

> Welcome to Ciao Business 👋 Tap the link and choose your password — valid 7 days, one use only: {{1}}

Parameters: {{1}} = link

---

## `ciao_biz_password_reset`

Category: **AUTHENTICATION** · critical (ignores quiet hours)

**Arabic (`ar`)**

> رمز استعادة كلمة السر في تشاو بزنس: {{1}} — صالح ٥ دقائق. لا تشاركه مع أحد، حتى لو طلبه أحد باسم تشاو.

Parameters: {{1}} = code

**English (`en`)**

> Your Ciao Business password-reset code: {{1}} — valid 5 minutes. Never share it, even with someone claiming to be from Ciao.

Parameters: {{1}} = code

---

## `ciao_test_message`

Category: **UTILITY** · critical (ignores quiet hours)

**Arabic (`ar`)**

> رسالة تجريبية من تشاو بزنس — القناة تعمل. الرمز: {{1}}

Parameters: {{1}} = code

**English (`en`)**

> Test message from Ciao Business — this channel works. Reference: {{1}}

Parameters: {{1}} = code

---

## `ciao_calendar_attestation`

Category: **UTILITY**

**Arabic (`ar`)**

> تشاو الأسبوعي: هل عندك حجوزات خارج المنصة نحجبها من التقويم؟ رد بالتواريخ أو اضغط: {{1}}

Parameters: {{1}} = link

**English (`en`)**

> Ciao weekly: any off-platform bookings to block on your calendar? Reply with dates or tap: {{1}}

Parameters: {{1}} = link

---

After approval: set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` on
the API service, switch `MESSAGING_PROVIDER` to `live`, and send yourself a
test from the console's Messaging tab. A rejected or not-yet-approved template
shows up there as a failed row carrying Meta's error text.
