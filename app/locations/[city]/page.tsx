import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  geocodingConfigured,
  searchCities,
} from "@/lib/app/geocoding";
import { createAdminClient } from "@/lib/supabase/admin";
import { makePlaceSlug } from "@/lib/seo/place-slug";

export const revalidate = 86_400;

const PLACE_LIMIT = 24;

type PageProps = {
  params: Promise<{
    city: string;
  }>;
};

type ResolvedCity = {
  city: string;
  region: string | null;
  country: string | null;
  label: string;
};

type CityPlace = {
  id: string | number;
  name: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  kind: string | null;
};

const localDevelopmentFallback = new Map<string, ResolvedCity>([
  [
    "oakville",
    {
      city: "Oakville",
      region: "Ontario",
      country: "Canada",
      label: "Oakville, Ontario, Canada",
    },
  ],
  [
    "toronto",
    {
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      label: "Toronto, Ontario, Canada",
    },
  ],
  [
    "mississauga",
    {
      city: "Mississauga",
      region: "Ontario",
      country: "Canada",
      label: "Mississauga, Ontario, Canada",
    },
  ],
]);

function slugToSearchQuery(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .join(" ")
    .slice(0, 120);
}

function isSafeCitySlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 120;
}

function formatKind(kind: string | null): string {
  if (!kind) return "Local place";
  return kind
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function resolveCity(slug: string): Promise<ResolvedCity | null> {
  if (!isSafeCitySlug(slug)) return null;

  if (!geocodingConfigured()) {
    return localDevelopmentFallback.get(slug) ?? null;
  }

  try {
    const query = slugToSearchQuery(slug);
    const results = await searchCities(query, { limit: 6 });
    const exact = results.find(
      (result) => result.city.toLowerCase() === query.toLowerCase(),
    );
    const match = exact ?? results[0];

    if (!match) return null;

    return {
      city: match.city,
      region: match.region,
      country: match.country,
      label: match.label,
    };
  } catch (error) {
    console.warn("Unable to validate SEO city page.", error);
    return null;
  }
}

async function getCityPlaces(city: ResolvedCity): Promise<CityPlace[]> {
  try {
    const admin = createAdminClient();
    let query = admin
      .from("locations")
      .select("id,name,city,region,country,kind")
      .ilike("city", city.city)
      .not("name", "is", null)
      .order("name", { ascending: true })
      .limit(PLACE_LIMIT);

    if (city.country) {
      query = query.ilike("country", city.country);
    }

    const result = await query;

    if (result.error) {
      console.warn("Unable to load city places.", result.error.message);
      return [];
    }

    return (result.data ?? []) as CityPlace[];
  } catch (error) {
    console.warn("Unable to load city places.", error);
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { city } = await params;
  const resolvedCity = await resolveCity(city);

  if (!resolvedCity) {
    return {
      title: "Location not found | Puddle",
      robots: { index: false, follow: false },
    };
  }

  const placeLabel = [resolvedCity.city, resolvedCity.region, resolvedCity.country]
    .filter(Boolean)
    .join(", ");

  const title = `Best Places to Visit in ${resolvedCity.city} | Restaurants, Cafes & Attractions | Puddle`;
  const description = `Discover restaurants, coffee shops, cafes, parks, attractions, activities, shopping, nightlife, and hidden gems in ${placeLabel}.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/locations/${city}`,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `/locations/${city}`,
    },
  };
}

export default async function CityLocationsPage({ params }: PageProps) {
  const { city } = await params;
  const resolvedCity = await resolveCity(city);

  if (!resolvedCity) notFound();

  const places = await getCityPlaces(resolvedCity);
  const placeLabel = [resolvedCity.city, resolvedCity.region, resolvedCity.country]
    .filter(Boolean)
    .join(", ");

  const pageDescription = `Explore restaurants, coffee shops, cafes, parks, attractions, shopping, nightlife, entertainment, activities, local businesses, and hidden gems in ${placeLabel}.`;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Best places to visit in ${resolvedCity.city}`,
    description: pageDescription,
    about: {
      "@type": "City",
      name: resolvedCity.city,
      containedInPlace: resolvedCity.country
        ? {
            "@type": "Country",
            name: resolvedCity.country,
          }
        : undefined,
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: places.length,
      itemListElement: places.map((place, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: place.name,
        url: `/place/${makePlaceSlug(place)}`,
      })),
    },
  };

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: "48px 20px 72px" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section style={{ marginBottom: 32 }}>
        <p style={{ margin: 0, opacity: 0.65 }}>Puddle local discovery</p>
        <h1 style={{ fontSize: "clamp(2rem, 6vw, 4rem)", margin: "8px 0 12px" }}>
          Best places to visit in {resolvedCity.city}
        </h1>
        <p style={{ maxWidth: 760, fontSize: 18, lineHeight: 1.6 }}>
          {pageDescription}
        </p>
      </section>

      {places.length > 0 ? (
        <section aria-labelledby="city-places-heading">
          <h2 id="city-places-heading" style={{ marginBottom: 18 }}>
            Restaurants, cafes, attractions and things to do in {resolvedCity.city}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {places.map((place) => (
              <Link
                key={String(place.id)}
                href={`/place/${makePlaceSlug(place)}`}
                style={{
                  display: "block",
                  padding: 20,
                  border: "1px solid rgba(0, 0, 0, 0.14)",
                  borderRadius: 18,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <p style={{ margin: "0 0 8px", opacity: 0.65 }}>
                  {formatKind(place.kind)}
                </p>
                <h3 style={{ margin: 0, fontSize: 20 }}>{place.name}</h3>
                <p style={{ margin: "10px 0 0", opacity: 0.75 }}>
                  {[place.city, place.region].filter(Boolean).join(", ")}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section>
          <h2>Things to do in {resolvedCity.city}</h2>
          <p>
            Puddle is adding more restaurants, cafes, attractions, activities,
            parks, and local businesses for {resolvedCity.city}. Explore the main
            discovery experience while the catalogue grows.
          </p>
        </section>
      )}

      <div style={{ marginTop: 36 }}>
        <Link href="/">Explore all of Puddle</Link>
      </div>
    </main>
  );
}
