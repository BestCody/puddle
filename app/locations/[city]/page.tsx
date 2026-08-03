import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { makePlaceSlug } from "@/lib/seo/place-slug";

export const revalidate = 86_400;

const PLACE_LIMIT = 24;
const TORONTO_CITY = {
  city: "Toronto",
  region: "Ontario",
  country: "Canada",
  label: "Toronto, Ontario, Canada",
} as const;

type PageProps = {
  params: Promise<{ city: string }>;
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

function formatKind(kind: string | null): string {
  if (!kind) return "Toronto destination";
  return kind
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveCity(slug: string): ResolvedCity | null {
  return slug.toLowerCase() === "toronto" ? TORONTO_CITY : null;
}

async function getCityPlaces(city: ResolvedCity): Promise<CityPlace[]> {
  try {
    const admin = createAdminClient();
    const result = await admin
      .from("locations")
      .select("id,name,city,region,country,kind")
      .ilike("city", city.city)
      .ilike("country", city.country ?? "Canada")
      .not("name", "is", null)
      .order("name", { ascending: true })
      .limit(PLACE_LIMIT);

    if (result.error) {
      console.warn("Unable to load Toronto places.", result.error.message);
      return [];
    }

    return (result.data ?? []) as CityPlace[];
  } catch (error) {
    console.warn("Unable to load Toronto places.", error);
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { city } = await params;
  const resolvedCity = resolveCity(city);

  if (!resolvedCity) {
    return {
      title: "Location not found | Puddle",
      robots: { index: false, follow: false },
    };
  }

  const title = "Toronto Events, Date Ideas & Places to Go | Puddle";
  const description =
    "Discover Toronto events, date ideas, restaurants, cafes, wedding venues, nightlife, activities, attractions, and places to go with Puddle.";

  return {
    title,
    description,
    alternates: { canonical: "/locations/toronto" },
    openGraph: {
      title,
      description,
      type: "website",
      url: "/locations/toronto",
    },
  };
}

export default async function CityLocationsPage({ params }: PageProps) {
  const { city } = await params;
  const resolvedCity = resolveCity(city);

  if (!resolvedCity) notFound();

  const places = await getCityPlaces(resolvedCity);
  const pageDescription =
    "Find Toronto events, romantic date ideas, restaurants, cafes, wedding and party venues, nightlife, attractions, activities, and memorable places to go.";

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Toronto events, date ideas and places to go",
    description: pageDescription,
    about: {
      "@type": "City",
      name: "Toronto",
      containedInPlace: {
        "@type": "Country",
        name: "Canada",
      },
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
        <p style={{ margin: 0, opacity: 0.65 }}>Puddle Toronto discovery</p>
        <h1 style={{ fontSize: "clamp(2rem, 6vw, 4rem)", margin: "8px 0 12px" }}>
          Toronto events, date ideas and places to go
        </h1>
        <p style={{ maxWidth: 760, fontSize: 18, lineHeight: 1.6 }}>
          {pageDescription}
        </p>
      </section>

      {places.length > 0 ? (
        <section aria-labelledby="toronto-discovery-heading">
          <h2 id="toronto-discovery-heading" style={{ marginBottom: 18 }}>
            Restaurants, venues, attractions and things to do in Toronto
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
                  A Toronto option for outings, dates, events, and group plans.
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section>
          <h2>Explore Toronto with Puddle</h2>
          <p>
            Puddle is adding Toronto events, date spots, restaurants, cafes,
            wedding venues, attractions, activities, and nightlife destinations.
          </p>
        </section>
      )}

      <div style={{ marginTop: 36 }}>
        <Link href="/">Explore Puddle</Link>
      </div>
    </main>
  );
}
