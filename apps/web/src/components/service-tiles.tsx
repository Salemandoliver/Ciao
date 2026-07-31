import Link from "next/link";
import { SERVICE_CATEGORIES } from "@/lib/services";

/** Airbnb-style services strip — emoji tiles per category. */
export function ServiceTiles() {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-xl text-sea">خدمات المناسبات 🛎</h2>
        <Link href="/search?type=service" className="text-amber-dark font-bold text-sm">
          عرض الكل ←
        </Link>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {SERVICE_CATEGORIES.map(([key, emoji, label]) => (
          <Link
            key={key}
            href={`/search?type=service&serviceCategory=${key}`}
            className="card p-3 text-center hover:shadow-md transition-shadow"
          >
            <span className="block text-3xl" aria-hidden>{emoji}</span>
            <span className="block text-xs font-bold text-sea mt-1.5">{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
