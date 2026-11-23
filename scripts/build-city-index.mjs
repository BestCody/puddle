#!/usr/bin/env node
// Build data/geonames/cities.tsv.gz, the self-hosted city index behind city
// search, "use my location" and place-editor lookups (lib/app/geocoding.js).
//
// Source: GeoNames (https://www.geonames.org), licensed CC BY 4.0.
// Download into one directory, then run with that directory:
//   https://download.geonames.org/export/dump/cities1000.zip   (unzip it)
//   https://download.geonames.org/export/dump/admin1CodesASCII.txt
//   https://download.geonames.org/export/dump/countryInfo.txt
//   node scripts/build-city-index.mjs <download-dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

const source = process.argv[2]
if (!source) {
  console.error('Usage: node scripts/build-city-index.mjs <geonames-download-dir>')
  process.exit(1)
}
const output = join(process.cwd(), 'data', 'geonames', 'cities.tsv.gz')

// Sections of towns and historical, abandoned or destroyed places are not
// useful answers to "which city is this?".
const EXCLUDED_FEATURE_CODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'])
// GeoNames uses numeric admin1 codes for Canada; people type postal abbreviations.
const CANADIAN_PROVINCES = {
  '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON',
  '09': 'PE', '10': 'QC', '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU'
}

const lines = (file) => readFileSync(join(source, file), 'utf8').split('\n').filter((line) => line && !line.startsWith('#'))
const clean = (value) => String(value || '').replace(/[\t\r\n]+/g, ' ').trim()

const countries = new Map(lines('countryInfo.txt').map((line) => {
  const columns = line.split('\t')
  return [columns[0], clean(columns[4])]
}))
const regions = new Map(lines('admin1CodesASCII.txt').map((line) => {
  const [code, name] = line.split('\t')
  return [code, clean(name)]
}))

const rows = []
for (const line of lines('cities1000.txt')) {
  const c = line.split('\t')
  if (c[6] !== 'P' || EXCLUDED_FEATURE_CODES.has(c[7])) continue
  const latitude = Number(c[4])
  const longitude = Number(c[5])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
  const countryCode = clean(c[8]).toUpperCase()
  const admin1 = clean(c[10])
  const regionCode = countryCode === 'CA' ? CANADIAN_PROVINCES[admin1] || '' : /^[A-Z]{2,3}$/.test(admin1) ? admin1 : ''
  rows.push({
    id: Number(c[0]),
    name: clean(c[1]),
    ascii: clean(c[2]),
    region: regions.get(`${countryCode}.${admin1}`) || '',
    regionCode,
    countryCode,
    country: countries.get(countryCode) || '',
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    population: Number(c[14]) || 0,
    timezone: clean(c[17])
  })
}
rows.sort((a, b) => b.population - a.population || a.id - b.id)

const header = 'id\tname\tascii\tregion\tregion_code\tcountry_code\tcountry\tlatitude\tlongitude\tpopulation\ttimezone'
const body = rows.map((r) => [r.id, r.name, r.ascii === r.name ? '' : r.ascii, r.region, r.regionCode, r.countryCode, r.country, r.latitude, r.longitude, r.population, r.timezone].join('\t'))
mkdirSync(dirname(output), { recursive: true })
const gz = gzipSync(Buffer.from([header, ...body].join('\n') + '\n', 'utf8'), { level: 9 })
writeFileSync(output, gz)
console.log(`Wrote ${rows.length} cities to ${output} (${(gz.length / 1024 / 1024).toFixed(2)} MB gzip)`)
