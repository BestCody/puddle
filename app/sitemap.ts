import type { MetadataRoute } from "next";

const supportedCities = ["oakville", "toronto", "mississauga"] as const;

function getBaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  return "https://puddle.you";
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();
  const lastModified = new Date();

  const cityPages: MetadataRoute.Sitemap = supportedCities.map((city) => ({
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
