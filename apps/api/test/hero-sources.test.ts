/**
 * Hero image sources — the bug that rendered the home page blank.
 *
 * Two uploaded hero images showed as empty grey panels on the live site and as
 * broken thumbnails in the console, and nothing anywhere reported a problem,
 * because a 404 on an `<img>` is silent.
 *
 * The cause was a convention meeting a rule it predated. A hero was stored as
 * a path with no width suffix and every consumer appended `-800.webp` and
 * `-1600.webp`, which is correct for assets shipped in the build because a
 * designer made both files. The uploader never enlarges an image — enlarging a
 * small photograph produces a bigger file of the same picture, which is the
 * opposite of the point on a Libyan mobile connection — so a 760px screenshot
 * asked for 1600 and for 800 came back at 760 twice, wrote one object, and
 * left the stored path pointing at two files that had never existed.
 *
 * These tests pin the fix: widths are recorded, never inferred, and the
 * `srcSet` states what is true.
 */
import { describe, expect, it } from "vitest";
import { heroSources, heroThumb, type HeroImage } from "@ciao/shared";

const BUILD_ASSET: HeroImage = { src: "/hero-marina", alt: "الواجهة البحرية" };

/** Exactly the shape that broke: one encoding, at neither nominal width. */
const NARROW_UPLOAD: HeroImage = {
  src: "https://img.example/hero/2f3f66c8",
  alt: "screenshot1",
  variants: [{ url: "https://img.example/hero/2f3f66c8-760.webp", width: 760 }],
};

const WIDE_UPLOAD: HeroImage = {
  src: "https://img.example/hero/abc123",
  alt: "corniche",
  variants: [
    { url: "https://img.example/hero/abc123-1600.webp", width: 1600 },
    { url: "https://img.example/hero/abc123-800.webp", width: 800 },
  ],
};

describe("hero sources", () => {
  it("keeps the suffix convention for images shipped in the build", () => {
    // Nothing that worked before may change: these files exist because a
    // designer made them, and the path is a prefix by design.
    const { src, srcSet } = heroSources(BUILD_ASSET);
    expect(src).toBe("/hero-marina-800.webp");
    expect(srcSet).toBe("/hero-marina-800.webp 800w, /hero-marina-1600.webp 1600w");
  });

  it("never claims a width an upload does not have", () => {
    const { src, srcSet } = heroSources(NARROW_UPLOAD);
    // The old code produced `<prefix>-800.webp` and `<prefix>-1600.webp` here.
    // Both 404'd. Neither string may reappear.
    expect(src).not.toContain("-800.webp");
    expect(srcSet).not.toContain("1600w");
    expect(src).toBe("https://img.example/hero/2f3f66c8-760.webp");
    expect(srcSet).toBe("https://img.example/hero/2f3f66c8-760.webp 760w");
  });

  it("offers every encoding an upload does have, narrowest first", () => {
    const { src, srcSet } = heroSources(WIDE_UPLOAD);
    // The default `src` is the cheap one: it is what a browser without srcSet
    // support downloads, and this market's default should be the small file.
    expect(src).toBe("https://img.example/hero/abc123-800.webp");
    expect(srcSet).toBe(
      "https://img.example/hero/abc123-800.webp 800w, https://img.example/hero/abc123-1600.webp 1600w",
    );
  });

  it("ignores malformed variants rather than emitting a broken candidate", () => {
    const junk = {
      src: "/hero-marina",
      alt: "x",
      variants: [{ url: "", width: 800 }, { url: "/a.webp", width: 0 }],
    } as unknown as HeroImage;
    // Every variant is unusable, so it falls back to the convention rather
    // than rendering an empty src.
    expect(heroSources(junk).src).toBe("/hero-marina-800.webp");
  });

  it("thumbnails take the smallest encoding there is", () => {
    expect(heroThumb(WIDE_UPLOAD)).toBe("https://img.example/hero/abc123-800.webp");
    expect(heroThumb(NARROW_UPLOAD)).toBe("https://img.example/hero/2f3f66c8-760.webp");
    expect(heroThumb(BUILD_ASSET)).toBe("/hero-marina-800.webp");
  });
});
