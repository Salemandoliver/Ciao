export const SERVICE_CATEGORIES: [string, string, string][] = [
  // [key, emoji, Arabic label]
  ["catering", "🍽", "ضيافة وبوفيهات"],
  ["photography", "📸", "تصوير"],
  ["makeup", "💄", "ميكب"],
  ["hair", "💇‍♀️", "كوافير"],
  ["cakes", "🎂", "كيك وحلويات"],
  ["gym", "🏋️", "جيم ولياقة"],
];
export const SERVICE_AR = Object.fromEntries(
  SERVICE_CATEGORIES.map(([k, e, l]) => [k, `${e} ${l}`]),
);
