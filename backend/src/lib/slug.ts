export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function slugWithSuffix(base: string, suffix: string): string {
  const slug = slugify(base) || "workspace";
  return `${slug}-${suffix}`.slice(0, 64);
}
