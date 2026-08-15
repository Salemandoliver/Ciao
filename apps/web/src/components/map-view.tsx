"use client";
/**
 * The map, whichever one it is.
 *
 * Designed to live PERMANENTLY beside the results list rather than as a hidden
 * toggle — the map is how people actually think about "which strip of coast is
 * this?". Pins are APPROXIMATE locations only (§7.1); a venue whose provider
 * chose area-only carries no coordinates at all and gets no pin, ever, in
 * either implementation.
 *
 * ## Why there are three implementations
 *
 * Mapbox is the default: real Arabic labels on the tiles themselves, and a free
 * tier measured in tens of thousands of loads rather than Google's ten.
 *
 * OpenStreetMap costs nothing and needs no account, so it is the floor — what
 * renders on the day no credential exists anywhere. Google's tiles are still
 * the ones Libyans recognise best — the informal names and the unpaved coast
 * turnings — but Google bills per map load, and Salem has bought neither the
 * key nor the domain yet.
 *
 * So the provider is an operator setting (`maps.provider`), and this file is
 * the seam. Two conditions must both hold for anything but OSM to render: the
 * console says so, and that provider's token is in the build. Otherwise it
 * falls back silently — a credential we have not bought is a procurement fact,
 * not something to tell a guest looking for a beach house. The day a token
 * lands, a rebuild switches maps with no code change.
 *
 * All three implementations are lazy chunks (§12.3): a mapping library must not
 * be on the critical path of someone reading a listing on 3G, and the two the
 * operator is not using must not be downloaded at all.
 */
import dynamic from "next/dynamic";
import { DEFAULT_MAPS, resolveProvider, type MapLatLng, type MapsSettings } from "./map-geo";
import type { PublicListing } from "@/lib/types";

export type { MapLatLng, MapProvider, MapsSettings } from "./map-geo";
export {
  DEFAULT_MAPS,
  TINY_AREA_KM2,
  encodePolygon,
  polygonAreaKm2,
  polygonCentre,
  resolveProvider,
  round3,
} from "./map-geo";

/*
 * `ssr: false` is load-bearing rather than a convenience: every one of these
 * libraries touches `window` at import time. It also keeps them out of the
 * server render and out of the first HTML payload.
 */
const LeafletMap = dynamic(() => import("./map-leaflet"), {
  ssr: false,
  loading: MapSkeleton,
});
const GoogleMap = dynamic(() => import("./map-google"), {
  ssr: false,
  loading: MapSkeleton,
});
const MapboxMap = dynamic(() => import("./map-mapbox"), {
  ssr: false,
  loading: MapSkeleton,
});

/**
 * A quiet block of surface while the chunk arrives — never a spinner. On a
 * connection bad enough for the wait to be visible, a spinner is a promise we
 * might not keep.
 */
function MapSkeleton() {
  return <div className="h-full w-full bg-sand" />;
}

export function MapView({
  items,
  vertical,
  selectedId,
  onSelect,
  className = "",
  maps,
  drawing = false,
  polygon = null,
  onDrawn,
  onDrawCancelled,
}: {
  items: PublicListing[];
  vertical: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  /** From `/v1/settings/public`. Absent → OpenStreetMap, centred on Tripoli. */
  maps?: MapsSettings;
  drawing?: boolean;
  polygon?: MapLatLng[] | null;
  onDrawn?: (points: MapLatLng[]) => void;
  onDrawCancelled?: () => void;
}) {
  const settings = maps ?? DEFAULT_MAPS;
  const provider = resolveProvider(settings);
  const Impl =
    provider === "mapbox" ? MapboxMap : provider === "google" ? GoogleMap : LeafletMap;
  return (
    <Impl
      items={items}
      vertical={vertical}
      selectedId={selectedId}
      onSelect={onSelect}
      className={className}
      centre={settings.defaultCentre}
      drawing={drawing}
      polygon={polygon}
      onDrawn={onDrawn}
      onDrawCancelled={onDrawCancelled}
    />
  );
}
