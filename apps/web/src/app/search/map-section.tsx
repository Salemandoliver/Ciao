"use client";
/** Map toggle for search results — Leaflet loads only when opened. */
import { useState } from "react";
import { MapView } from "@/components/map-view";
import type { PublicListing } from "@/lib/types";

export function MapSection({
  items,
  vertical,
}: {
  items: PublicListing[];
  vertical: string;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <button
        className={`chip ${open ? "!bg-sea !text-white" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        🗺 {open ? "أخفِ الخريطة" : "اعرض على الخريطة"}
      </button>
      {open ? (
        <div className="mt-3">
          <MapView items={items} vertical={vertical} />
        </div>
      ) : null}
    </div>
  );
}
