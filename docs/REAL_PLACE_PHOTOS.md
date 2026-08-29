# Real place photos

Puddle swipe cards must show a photograph of the actual place or a neutral Puddle placeholder. AI-generated, generic stock, scraped, or unrelated imagery must never be presented as a venue photo.

## Supported sources

Photo priority is:

1. Verified venue upload stored in Puddle public media (`locations.cover_path`)
2. Approved Puddle user photo stored in Puddle public media
3. Licensed provider photo registered in `location_photo_sources`
4. Properly licensed public photo for a landmark, park, or attraction
5. Neutral placeholder

Provider photos are stored as licensed references rather than silently copied into Puddle storage. The browser receives them through `/api/location-photos/[id]`, which only accepts approved HTTPS hosts configured in `LOCATION_PHOTO_ALLOWED_HOSTS`.

## Register provider photos

Set the exact image hosts and provide a JSON manifest:

```bash
LOCATION_PHOTO_ALLOWED_HOSTS=images.example-provider.com,cdn.example-provider.com \
  npm run locations:photos -- ./location-photos.json
```

Example manifest:

```json
{
  "photos": [
    {
      "locationId": "00000000-0000-4000-8000-000000000000",
      "source": "provider",
      "provider": "example-provider",
      "externalPhotoId": "photo-123",
      "photoUrl": "https://images.example-provider.com/photo-123.jpg",
      "attributionText": "Photo by Example Photographer",
      "attributionUrl": "https://example-provider.com/photo-123",
      "license": "provider-display-license",
      "termsUrl": "https://example-provider.com/terms",
      "width": 1600,
      "height": 1000,
      "isPrimary": true,
      "cacheTtlSeconds": 3600
    }
  ]
}
```

Only register a photo after confirming that it depicts the exact place and that Puddle is permitted to display it. Use provider IDs, address, coordinates, website, and phone matching rather than name-only matching.

## Licensing and caching

`cacheTtlSeconds` must reflect the provider agreement. Set it to `0` when the response must not be cached. Keep attribution and terms fields current. Expired records stop rendering automatically.

Puddle does not scrape Google Maps, review sites, social networks, or venue websites for images.
