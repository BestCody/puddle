# GeoNames city index

`cities.tsv.gz` is the self-hosted city index behind city search, "use my
location" and place-editor lookups (`lib/app/geocoding.js`). Lookups run in
memory on the server: no external geocoding API, key or quota is involved, and
user coordinates are never sent to a third party.

## Source and licence

Data from [GeoNames](https://www.geonames.org), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The Terms page
carries the attribution.

Built from the 2026-11-23 GeoNames export (`cities1000`, `admin1CodesASCII`,
`countryInfo`): 162,279 populated places with population of at least 1,000.
Changes from the source: sections of towns and historical, abandoned or
destroyed places are excluded; region and country names are resolved; Canadian
provinces carry their postal abbreviations; coordinates are rounded to four
decimals; rows are sorted by population.

## Rebuilding

```sh
mkdir geonames && cd geonames
curl -O https://download.geonames.org/export/dump/cities1000.zip && unzip cities1000.zip
curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
curl -O https://download.geonames.org/export/dump/countryInfo.txt
cd .. && node scripts/build-city-index.mjs geonames
```

Commit the regenerated `cities.tsv.gz`; the Next.js build traces it into the
standalone server for the three location routes (`next.config.mjs`).
