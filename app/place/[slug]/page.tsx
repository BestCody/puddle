import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

export const revalidate = 3600;

type PageProps = {
  params: Promise<{ slug: string }>;
};

type LocationRow = {
  id: string | number;
  name: string | null;
  city: string | null;
  description?: string | null;
  address?: string | null;
};

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractId(slug: string): string | null {
  const separator = slug.lastIndexOf("--");
  if (separator === -1) return null;
  const id = slug.slice(separator + 2).trim();
  return id || null;
}

async function getLocation(slug: string): Promise<LocationRow | null> {
  const config = getSupabaseConfig();
  const id = extractId(slug);

  if (!config || !id) return null;

  try {
    const response = await fetch(
      `${config.url}/rest/v1/locations?select=id,name,city,description,address&id=eq.${encodeURIComponent(id)}&city=ilike.Toronto&limit=1`,
      {
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
        },
        next: { revalidate },
      },
    );

    if (!response.ok) return null;

    const rows = (await response.json()) as LocationRow[];
    const location = rows[0] ?? null;

    return location?.city?.toLowerCase() === "toronto" ? location : null;
  } catch {
    return null;
  }
}

function canonicalSlug(location: LocationRow): string {
  const label = [location.name, "Toronto"].filter(Boolean).join(" ");
  return `${slugify(label || "place")}--${location.id}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const location = await getLocation(slug);

  if (!location?.name) {
    return {
      title: "Place not found | Puddle",
      robots: { index: false, follow: false },
    };
  }

  const description =
    location.description?.trim() ||
    `Discover ${location.name} in Toronto, including location details and ideas for your next outing.`;

  return {
    title: `${location.name} in Toronto | Puddle`,
    description: description.slice(0, 160),
    alternates: {
      canonical: `/place/${canonicalSlug(location)}`,
    },
  };
}

export default async function PlacePage({ params }: PageProps) {
  const { slug } = await params;
  const location = await getLocation(slug);

  if (!location?.name) notFound();

  return (
    <main>
      <article>
        <p>Puddle Toronto place discovery</p>
        <h1>{location.name} in Toronto</h1>
        {location.address ? <p>{location.address}</p> : null}
        <p>
          {location.description?.trim() ||
            `Explore ${location.name} in Toronto and decide whether it belongs on your next Puddle shortlist.`}
        </p>

        <nav aria-label="Place navigation">
          <Link href="/">Explore Puddle</Link>
          <Link href="/locations/toronto">More places in Toronto</Link>
        </nav>
      </article>
    </main>
  );
}
