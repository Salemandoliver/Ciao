"use client";
/** Declarative event emitters for server-rendered pages. */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackClient } from "@/lib/tracker";

/** Fires once per mount — drop into any server component with props computed server-side. */
export function TrackEvent({
  name,
  props,
}: {
  name: string;
  props: Record<string, unknown>;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackClient(name, props);
  }, [name, props]);
  return null;
}

/** Page-view tracking — lives in the root layout. */
export function PageViews() {
  const pathname = usePathname();
  useEffect(() => {
    // Skip voucher/booking codes from path to avoid identifying props.
    const path = pathname.replace(/\/booking\/[A-Z0-9-]+/, "/booking/:code");
    trackClient("page.view", { path });
  }, [pathname]);
  return null;
}
