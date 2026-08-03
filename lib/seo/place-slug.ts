export type PlaceSlugRecord = {
  id: string | number;
  name: string | null;
  city: string | null;
};

export function slugifyPlacePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function makePlaceSlug(place: PlaceSlugRecord): string {
  const label = [place.name, place.city].filter(Boolean).join(" ");
  return `${slugifyPlacePart(label || "place")}--${place.id}`;
}
