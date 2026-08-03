import type { MetadataRoute } from "next";

export const revalidate = 3600;

const fallbackCities = ["oakville", "toronto", "mississauga"] as const;
const MAX_LOCATION_ROWS = 10_000;

type LocationCityRow = {
  city: string | null;
};

function getBaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  return "https://puddle.you";
}

function slugifyCity(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getLocationCities(): Promise<string[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    return [...fallbackCities];
  }

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/locations?select=city&city=not.is.null&limit=${MAX_LOCATION_ROWS}`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        next: { revalidate },
      },
    );

    if (!response.ok) {
      console.warn(`Sitemap location query failed with status ${response.status}.`);
      return [...fallbackCities];
    }

    const rows = (await response.json()) as LocationCityRow[];
    const cities = new Set<string>();

    for (const row of rows) {
      if (typeof row.city !== "string") continue;
      const slug = slugifyCity(row.city);
      if (slug) cities.add(slug);
    }

    return cities.size > 0
      ? [...cities].sort((a, b) => a.localeCompare(b))
      : [...fallbackCities];
  } catch (error) {
    console.warn("Sitemap location query failed.", error);
    return [...fallbackCities];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl();
  const lastModified = new Date();
  const cities = await getLocationCities();

  const cityPages: MetadataRoute.Sitemap = cities.map((city) => ({
    url: `${baseUrl}/locations/${city}`,
    lastModified,
    changeFrequency: "daily",
    priority: 0.8,
  }));

  return [
    {
      url: baseUrl,
      lastModified,
      changeFrequency: "daily",
      priority: 1,
    },
    ...cityPages,
  ];
}
