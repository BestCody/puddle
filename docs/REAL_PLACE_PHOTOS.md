# Real place photos

Puddle place cards show a verified place photo or a neutral placeholder. AI-generated,
generic stock, scraped, or unrelated imagery is never accepted as a venue photo.

## Canonical pipeline

Wikimedia, Mapillary, and KartaView candidates are discovered by the scheduled B2
workflows and written to the candidate manifest. The resumable materializer then:

1. validates provider identity, geography, license, host, and image type;
2. normalizes the image and computes SHA-256 plus a perceptual hash;
3. rejects provider, exact-content, and near-duplicate candidates;
4. uploads accepted bytes to `media/photos/by-sha256/<prefix>/<sha256>.jpg`;
5. registers provenance and publishes the searchable photo overlay only after upload success.

The browser receives only `/api/open-photo/<sha256>`. It never receives a provider
photo URL or a B2 public URL. A missing canonical photo renders the neutral placeholder
until an eligible candidate is materialized.

## Local commands

The same stages can be run from the repository with the current scripts:

```bash
npm run global:photos:wikimedia
npm run global:photos:mapillary
npm run global:photos:kartaview
npm run global:photos:materialize
npm run global:photos:overlay
```

All stages are checkpointed and must be resumed through the active workflow when a
large import is interrupted. Puddle does not scrape Google Maps, review sites, social
networks, or venue websites for images.
