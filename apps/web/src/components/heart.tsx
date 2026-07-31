"use client";
/** The wishlist heart — Airbnb-familiar, satisfying, and a rich intent signal. */
import { useEffect, useState } from "react";
import { hydrateWishlist, isSaved, onWishlistChange, toggleSaved } from "@/lib/wishlist";

let hydrated = false;

export function Heart({
  listingId,
  meta,
  size = 34,
}: {
  listingId: string;
  meta?: { vertical?: string; city?: string; area?: string; priceNightly?: number };
  size?: number;
}) {
  const [saved, setSaved] = useState(false);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    if (!hydrated) {
      hydrated = true;
      void hydrateWishlist();
    }
    setSaved(isSaved(listingId));
    return onWishlistChange(() => setSaved(isSaved(listingId)));
  }, [listingId]);

  return (
    <button
      aria-label={saved ? "أزل من المفضلة" : "أضف إلى المفضلة"}
      className="rounded-full bg-white/85 shadow flex items-center justify-center active:scale-95 transition-transform"
      style={{ width: size, height: size }}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPop(true);
        setTimeout(() => setPop(false), 300);
        setSaved(await toggleSaved(listingId, meta));
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.55}
        height={size * 0.55}
        className={pop ? "animate-ping-once" : ""}
        style={{ transition: "transform 0.2s", transform: pop ? "scale(1.25)" : "scale(1)" }}
      >
        <path
          d="M12 21c-.4 0-.8-.14-1.1-.42C7 17.1 2.5 13.3 2.5 8.9 2.5 6 4.7 3.8 7.5 3.8c1.7 0 3.3.8 4.5 2.2 1.2-1.4 2.8-2.2 4.5-2.2 2.8 0 5 2.2 5 5.1 0 4.4-4.5 8.2-8.4 11.7-.3.28-.7.42-1.1.42z"
          fill={saved ? "#E8A33D" : "rgba(27,79,114,0.35)"}
          stroke={saved ? "#C9871F" : "#FFFFFF"}
          strokeWidth="1.4"
        />
      </svg>
    </button>
  );
}
