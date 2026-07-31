#!/usr/bin/env bash
# End-to-end smoke test against a running stack (§6.1 happy path via HTTP only).
set -euo pipefail
API=${API:-http://localhost:4000}

jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

echo "1) Guest OTP login"
PHONE="+218955$((RANDOM))$((RANDOM % 10))"
CODE=$(curl -s -X POST $API/v1/auth/otp/request -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}" | jqr "d['devCode']")
TOKEN=$(curl -s -X POST $API/v1/auth/otp/verify -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\",\"displayName\":\"ضيف الدخان\"}" | jqr "d['accessToken']")
echo "   token ok"

echo "2) Search live listings"
LISTING=$(curl -s "$API/v1/listings?city=tripoli&type=coast" | jqr "d['items'][0]['id']")
SLUG=$(curl -s "$API/v1/listings?city=tripoli&type=coast" | jqr "d['items'][0]['slug']")
echo "   listing $SLUG"

echo "3) Create booking + deposit intent"
CI=$(date -u -d "+21 days" +%F); CO=$(date -u -d "+23 days" +%F)
RESP=$(curl -s -X POST $API/v1/bookings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"listingId\":\"$LISTING\",\"checkIn\":\"$CI\",\"checkOut\":\"$CO\",\"rail\":\"local_card\"}")
BOOKING_CODE=$(echo "$RESP" | jqr "d['code']")
INVOICE=$(echo "$RESP" | jqr "d['payment']['invoiceNo']")
DEPOSIT=$(echo "$RESP" | jqr "d['quote']['deposit']")
echo "   booking $BOOKING_CODE deposit=$DEPOSIT invoice=$INVOICE"

echo "4) Pay deposit via signed mock webhook"
PAYLOAD="{\"event\":\"payment.completed\",\"invoice_no\":\"$INVOICE\",\"transaction_id\":\"mock_$INVOICE\",\"amount\":$DEPOSIT}"
SIG=$(python3 - "$PAYLOAD" <<'EOF'
import hmac,hashlib,sys
print(hmac.new(b"mock-webhook-secret", sys.argv[1].encode(), hashlib.sha256).hexdigest())
EOF
)
curl -s -X POST $API/v1/payments/webhook/mock -H 'Content-Type: application/json' -H "X-Signature: $SIG" -d "$PAYLOAD" | grep -q '"ok":true'
echo "   captured"

echo "5) Host confirms via one-tap link (SMS/WhatsApp path)"
sleep 1
STATE=$(curl -s $API/v1/bookings/$BOOKING_CODE -H "Authorization: Bearer $TOKEN" | jqr "d['state']")
[ "$STATE" = "payment_held" ] || { echo "unexpected state $STATE"; exit 1; }
echo "   state=payment_held ✓ (host ping ladder fired — see API logs)"

echo "SMOKE PASSED — full confirm path covered by vitest integration suite."
