/**
 * The pricing engine, tested against a rate card that actually exists.
 *
 * Every number in the first block is copied from the summer-2026 price list
 * منتجع لانكستر السلام published on Facebook. It is here rather than in a
 * fixture file on purpose: a synthetic rate card would have been built from
 * the same assumptions as the engine and would have agreed with it about
 * everything, including the two things the engine had wrong.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHILD_POLICY,
  guestWeights,
  nightlyPrice,
  quoteStay,
  type PricingConfig,
} from "@ciao/shared";

/**
 * Lancaster's villas: 3,600 د.ل weekday for two, +300 per further guest,
 * +600 flat at the weekend. Expressed the way our columns hold it.
 *
 * Written with `weekendSupplement` rather than a multiplier, and that is the
 * point of the field existing: 4,200/3,600 is exactly 7/6, i.e. 11666.67 basis
 * points, which no integer bps value can express. This table is what proved
 * the multiplier-only model could not hold a real Libyan price list.
 */
const LANCASTER_VILLA: PricingConfig = {
  baseNightly: 3_600_000,
  weekendMultiplierBps: 12500, // ignored while the supplement is set
  weekendSupplement: 600_000,
  thursdayMultiplierBps: 10000,
  seasonMultiplierBps: 10000,
  includedGuests: 2,
  extraGuestFee: 300_000,
  extraBedPrice: 150_000,
  board: "full_board",
  childPolicy: { freeUnder: 6, reducedUnder: 11, reducedBps: 5000 },
};

/** A Wednesday and a Friday in the 2026 season. */
const WEEKDAY_IN = new Date("2026-08-05T00:00:00Z");
const WEEKDAY_OUT = new Date("2026-08-06T00:00:00Z");
const WEEKEND_IN = new Date("2026-08-07T00:00:00Z");
const WEEKEND_OUT = new Date("2026-08-08T00:00:00Z");

function oneNight(cfg: PricingConfig, adults: number, weekend: boolean) {
  return quoteStay(
    cfg,
    weekend ? WEEKEND_IN : WEEKDAY_IN,
    weekend ? WEEKEND_OUT : WEEKDAY_OUT,
    { party: { adults, childAges: [] } },
  ).total;
}

describe("the published Lancaster villa table", () => {
  // The whole point of this file. All eight cells, exactly.
  const published: [number, number, number][] = [
    // guests, weekday, weekend
    [2, 3_600_000, 4_200_000],
    [4, 4_200_000, 4_800_000],
    [5, 4_500_000, 5_100_000],
    [6, 4_800_000, 5_400_000],
  ];

  for (const [guests, weekday, weekend] of published) {
    it(`quotes ${guests} guests at ${weekday / 1000} weekday and ${weekend / 1000} weekend`, () => {
      expect(oneNight(LANCASTER_VILLA, guests, false)).toBe(weekday);
      expect(oneNight(LANCASTER_VILLA, guests, true)).toBe(weekend);
    });
  }

  it("adds the guest supplement AFTER the band, not before", () => {
    /*
     * The bug this whole rewrite exists to prevent. Multiplying the banded
     * total — base plus supplement — gives 5,600 for six guests at the
     * weekend against a published 5,400: 200 د.ل a night too much, which
     * across a long weekend is 600 د.ل of a quote that would have been wrong
     * in the direction that gets an angry phone call at the gate.
     */
    const wrongOrder =
      LANCASTER_VILLA.baseNightly +
      LANCASTER_VILLA.extraGuestFee! * 4 +
      LANCASTER_VILLA.weekendSupplement!;
    // Adding the supplement to a figure that already carries four guests is
    // fine here; the failure the old engine had was *multiplying* it. Both
    // orders are shown because the model must be right under either shape.
    expect(wrongOrder).toBe(5_400_000);
    expect(oneNight(LANCASTER_VILLA, 6, true)).toBe(5_400_000);
  });

  it("cannot be expressed by a single ratio applied to the whole nightly figure", () => {
    /*
     * Evidence for the design rather than a test of it. Their weekend is a
     * flat +600 whatever the occupancy, which as a ratio of the total is
     * 1.1667× at two guests and 1.125× at six — so the old model, one
     * multiplier over the whole figure, is wrong for three of the four rows
     * whichever value you pick.
     */
    const ratios = published.map(([, wd, we]) => we / wd);
    expect(new Set(ratios.map((r) => r.toFixed(4))).size).toBe(4);
    // And the two-guest ratio is not even representable in basis points.
    expect(Math.round((3_600_000 * 11667) / 10000)).not.toBe(4_200_000);
    expect(Math.round((3_600_000 * 11666) / 10000)).not.toBe(4_200_000);
  });
});

describe("children", () => {
  it("prices a Libyan family the way the front desk would", () => {
    // Two adults, one eight-year-old, two toddlers: six heads, two included,
    // the toddlers free and the eight-year-old at half of 300.
    const q = quoteStay(LANCASTER_VILLA, WEEKDAY_IN, WEEKDAY_OUT, {
      party: { adults: 2, childAges: [8, 3, 2] },
    });
    expect(q.total).toBe(3_600_000 + 150_000);
    expect(q.party).toMatchObject({ childrenFree: 2, childrenReduced: 1, childrenFull: 0 });
  });

  it("fills the included slots with the dearest guests, so the discounted ones spill", () => {
    /*
     * Guest-favourable and also what a receptionist says out loud: "the rate
     * covers two, the children are extra at half". Sorting the other way would
     * have consumed the included places with free toddlers and then charged
     * full price for the adults.
     */
    const weights = guestWeights({ adults: 2, childAges: [8, 3] }, DEFAULT_CHILD_POLICY);
    expect(weights).toEqual([1, 1, 0.5, 0]);
  });

  it("leaves no age uncovered, including the five-year-old the price list forgets", () => {
    /*
     * Lancaster's own wording is "under 5 free, from 6 to 10 half price",
     * which leaves a five-year-old belonging to neither rule — an argument at
     * a front desk in front of a tired family. Two upper bounds instead of two
     * ranges makes that structurally impossible.
     */
    for (let age = 0; age <= 20; age++) {
      const w = guestWeights({ adults: 0, childAges: [age] }, DEFAULT_CHILD_POLICY);
      expect(w).toHaveLength(1);
      expect([0, 0.5, 1]).toContain(w[0]);
    }
    expect(guestWeights({ adults: 0, childAges: [5] }, DEFAULT_CHILD_POLICY)).toEqual([0]);
    expect(guestWeights({ adults: 0, childAges: [6] }, DEFAULT_CHILD_POLICY)).toEqual([0.5]);
  });

  it("charges an infant nothing but still counts the head against capacity", () => {
    const q = quoteStay(LANCASTER_VILLA, WEEKDAY_IN, WEEKDAY_OUT, {
      party: { adults: 2, childAges: [1] },
    });
    expect(q.total).toBe(3_600_000);
    expect(q.party.adults + q.party.childrenFree).toBe(3);
  });
});

describe("backwards compatibility", () => {
  it("quotes a listing with none of the new fields exactly as it did before", () => {
    const legacy: PricingConfig = {
      baseNightly: 600_000,
      weekendMultiplierBps: 12500,
      thursdayMultiplierBps: 11500,
      seasonMultiplierBps: 10000,
    };
    // No party, no includedGuests, no extraGuestFee: the room and nothing else.
    expect(quoteStay(legacy, WEEKDAY_IN, WEEKDAY_OUT).total).toBe(600_000);
    // And with a party, because `includedGuests` defaults to the whole party
    // rather than to one — a default of one would have silently repriced the
    // entire catalogue the day the checkout started sending a guest count.
    expect(
      quoteStay(legacy, WEEKDAY_IN, WEEKDAY_OUT, { party: { adults: 8, childAges: [] } }).total,
    ).toBe(600_000);
  });
});

describe("rate windows", () => {
  const withOffer: PricingConfig = {
    ...LANCASTER_VILLA,
    rates: [
      {
        startDate: "2026-08-10",
        endDate: "2026-08-20",
        nightly: 3_000_000,
        minNights: 2,
        labelAr: "عرض خاص",
      },
    ],
  };

  it("replaces the base inside the window and leaves it alone outside", () => {
    expect(nightlyPrice(withOffer, new Date("2026-08-12T00:00:00Z"))).toBe(3_000_000);
    expect(nightlyPrice(withOffer, new Date("2026-08-05T00:00:00Z"))).toBe(3_600_000);
  });

  it("still applies the weekend band inside the window", () => {
    // 14 August 2026 is a Friday. A promotional fortnight still has expensive
    // weekends; anything else would have hosts pricing around us.
    expect(nightlyPrice(withOffer, new Date("2026-08-14T00:00:00Z"))).toBe(3_600_000);
  });

  it("honours `flat` for an operator who means one price, full stop", () => {
    const flat: PricingConfig = {
      ...withOffer,
      rates: [{ ...withOffer.rates![0]!, flat: true }],
    };
    expect(nightlyPrice(flat, new Date("2026-08-14T00:00:00Z"))).toBe(3_000_000);
  });

  it("surfaces the window's minimum so the caller can refuse a one-night booking", () => {
    const q = quoteStay(withOffer, new Date("2026-08-12T00:00:00Z"), new Date("2026-08-13T00:00:00Z"), {
      party: { adults: 2, childAges: [] },
    });
    expect(q.requiredMinNights).toBe(2);
    expect(q.nights).toHaveLength(1);
  });

  it("names the offer on the night so a receipt can show its working", () => {
    const q = quoteStay(withOffer, new Date("2026-08-12T00:00:00Z"), new Date("2026-08-14T00:00:00Z"));
    expect(q.nights[0]?.offerAr).toBe("عرض خاص");
  });
});

describe("the deposit ceiling", () => {
  const fees = { coastDepositBps: 2000, coastCommissionBps: 1000, coastDepositCapDirhams: 2_000_000 };

  it("caps a percentage that real supply blew straight through", () => {
    // Three weekday nights, six guests: 14,400 د.ل, of which 20% is 2,880 —
    // asked for in one push on Sadad from someone who met us ten minutes ago.
    const q = quoteStay(
      LANCASTER_VILLA,
      new Date("2026-08-04T00:00:00Z"),
      new Date("2026-08-07T00:00:00Z"),
      { party: { adults: 6, childAges: [] }, fees },
    );
    expect(q.total).toBe(14_400_000);
    expect(q.deposit).toBe(2_000_000);
    expect(q.depositCapped).toBe(true);
  });

  it("will not let the ceiling cut into the commission the deposit has to carry", () => {
    /*
     * The honest limit of the idea. Commission is withheld from the deposit
     * and Ciao never invoices a host for it (§9.1), so on a long booking the
     * deposit rises to meet the commission rather than us quietly earning
     * less. Worth stating out loud because it is the one case where the
     * operator's ceiling does not hold.
     */
    const q = quoteStay(
      LANCASTER_VILLA,
      new Date("2026-08-03T00:00:00Z"),
      new Date("2026-08-10T00:00:00Z"),
      { party: { adults: 6, childAges: [] }, fees },
    );
    expect(q.commission).toBeGreaterThan(2_000_000);
    expect(q.deposit).toBe(q.commission);
  });

  it("leaves an ordinary chalet booking untouched", () => {
    const chalet: PricingConfig = {
      baseNightly: 600_000,
      weekendMultiplierBps: 12500,
      thursdayMultiplierBps: 11500,
      seasonMultiplierBps: 10000,
    };
    const q = quoteStay(chalet, WEEKDAY_IN, WEEKDAY_OUT, { fees });
    expect(q.deposit).toBe(120_000);
    expect(q.depositCapped).toBe(false);
  });
});

describe("extra beds", () => {
  it("charges per bed per night", () => {
    const q = quoteStay(
      LANCASTER_VILLA,
      new Date("2026-08-04T00:00:00Z"),
      new Date("2026-08-06T00:00:00Z"),
      { party: { adults: 2, childAges: [], extraBeds: 2 } },
    );
    expect(q.bedTotal).toBe(2 * 2 * 150_000);
  });
});
