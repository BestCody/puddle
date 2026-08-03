import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  geocodingConfigured,
  searchCities,
} from "@/lib/app/geocoding";

export const revalidate = 86_400;

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

  return {
    title: `Places to Go in ${resolvedCity.city} | Puddle`,
    description: `Discover restaurants, date spots, hangout locations, and local places worth exploring in ${placeLabel}.`,
    alternates: {
      canonical: `/locations/${city}`,
    },
    openGraph: {
      title: `Places to Go in ${resolvedCity.city} | Puddle`,
      description: `Discover places worth exploring in ${placeLabel}.`,
      type: "website",
      url: `/locations/${city}`,
    },
  };
}

export default async function CityLocationsPage({ params }: PageProps) {
  const { city } = await params;
  const resolvedCity = await resolveCity(city);

  if (!resolvedCity) notFound();

  const placeLabel = [resolvedCity.city, resolvedCity.region, resolvedCity.country]
    .filter(Boolean)
    .join(", ");

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Places to go in ${resolvedCity.city}`,
    description: `Discover restaurants, date spots, hangout locations, and local places worth exploring in ${placeLabel}.`,
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
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section>
        <p>Puddle local discovery</p>
        <h1>Places to go in {resolvedCity.city}</h1>
        <p>
          Discover restaurants, date spots, hangout locations, and local places
          worth exploring around {placeLabel}.
        </p>

        <div>
          <Link href="/">Explore Puddle</Link>
        </div>
      </section>
    </main>
  );
}
