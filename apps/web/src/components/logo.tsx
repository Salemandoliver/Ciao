/** The Greeting Bubble wordmark (§3.3) — i-dot deliberately chopped by the bubble edge. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center bg-sea text-white font-baloo font-extrabold relative select-none"
      style={{
        height: size,
        paddingInline: size * 0.35,
        borderRadius: size * 0.32,
        fontSize: size * 0.52,
        lineHeight: 1,
        overflow: "hidden",
      }}
      dir="ltr"
      aria-label="Ciao"
    >
      c<span style={{ marginTop: -size * 0.06 }}>i</span>a
      <span
        className="inline-block bg-amber rounded-full"
        style={{ width: size * 0.38, height: size * 0.38, marginInlineStart: size * 0.06 }}
        aria-hidden
      />
    </span>
  );
}

export function LogoWithTail({ size = 48 }: { size?: number }) {
  return (
    <span className="relative inline-block">
      <Logo size={size} />
      <span
        className="absolute bg-sea"
        style={{
          width: size * 0.22,
          height: size * 0.22,
          bottom: -size * 0.13,
          insetInlineStart: size * 0.18,
          clipPath: "polygon(0 0, 100% 0, 0 100%)",
        }}
        aria-hidden
      />
    </span>
  );
}
