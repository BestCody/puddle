import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{
    city: string;
  }>;
};

const supportedCities = ["oakville", "toronto", "mississauga"] as const;

function formatCity(city: string): string {
  return city
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isSupportedCity(city: string): city is (typeof supportedCities)[number] {
  return supportedCities.includes(city as (typeof supportedCities)[number]);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { city } = await params;

  if (!isSupportedCity(city)) {
    return {};
  }

  const cityName = formatCity(city);

  return {
    title: `Places to Go in ${cityName} | Puddle`,
    description: `Discover restaurants, date spots, hangout locations, and local places worth exploring in ${cityName}.`,
    alternates: {
      canonical: `/locations/${city}`,
    },
  };
}

export default async function CityLocationsPage({ params }: PageProps) {
  const { city } = await params;

  if (!isSupportedCity(city)) {
    notFound();
  }

  const cityName = formatCity(city);

  return (
    <main>
      <section>
        <p>Puddle local discovery</p>
        <h1>Places to go in {cityName}</h1>
        <p>
          Discover restaurants, date spots, hangout locations, and local places
          worth exploring around {cityName}.
        </p>

        <div>
          <Link href="/">Explore Puddle</Link>
        </div>
      </section>
    </main>
  );
}
