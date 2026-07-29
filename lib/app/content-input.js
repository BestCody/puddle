const eventFormats = new Set(['in_person', 'online', 'hybrid', 'private'])
const visibilities = new Set(['public', 'unlisted', 'private'])
const locationKinds = new Set(['cafe','restaurant','bar','park','museum','gallery','attraction','activity_venue','study_spot','scenic_spot','nightlife','shop','community_space','other'])

function text(value, max = 5000) {
  return String(value || '').trim().slice(0, max)
}

function nullableText(value, max = 5000) {
  const cleaned = text(value, max)
  return cleaned || null
}

function list(value, maxItems = 24) {
  return text(value, 2000).split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, maxItems)
}

function boolean(value) {
  return value === true || value === 'true' || value === 'on' || value === '1'
}

function integer(value, { min = 0, max = 1000000, nullable = true } = {}) {
  if (value === '' || value === null || value === undefined) return nullable ? null : min
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return nullable ? null : min
  return Math.min(max, Math.max(min, parsed))
}

function decimal(value, { min, max } = {}) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.min(max, Math.max(min, parsed))
}

function dateTime(value, fallback) {
  const parsed = new Date(String(value || ''))
  if (Number.isNaN(parsed.getTime())) return fallback
  return parsed.toISOString()
}

function slugify(value) {
  return text(value, 100).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'puddle-draft'
}

function uniqueSlug(value) {
  return `${slugify(value)}-${crypto.randomUUID().slice(0, 7)}`
}

function contactLinks(input) {
  const links = {
    website: nullableText(input.website, 400),
    instagram: nullableText(input.instagram, 120),
    email: nullableText(input.contact_email, 254),
    phone: nullableText(input.contact_phone, 40)
  }
  return Object.fromEntries(Object.entries(links).filter(([, value]) => value))
}

function accessibility(input) {
  return {
    wheelchair_accessible: boolean(input.wheelchair_accessible),
    accessible_washroom: boolean(input.accessible_washroom),
    step_free: boolean(input.step_free),
    hearing_support: boolean(input.hearing_support),
    sensory_friendly: boolean(input.sensory_friendly),
    notes: nullableText(input.accessibility_notes, 1200)
  }
}

function openingHours(input) {
  const result = {}
  for (const day of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) {
    const hours = nullableText(input[`hours_${day}`], 100)
    if (hours) result[day] = hours
  }
  return result
}

export function eventPayload(input, userId, existing = null) {
  const now = Date.now()
  const defaultStart = new Date(now + 7 * 24 * 60 * 60 * 1000)
  defaultStart.setMinutes(0, 0, 0)
  const startsAt = dateTime(input.starts_at, existing?.starts_at || defaultStart.toISOString())
  const endsAt = dateTime(input.ends_at, existing?.ends_at || new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000).toISOString())
  const format = eventFormats.has(input.event_format) ? input.event_format : 'in_person'
  const hostProfileId = nullableText(input.host_profile_id, 64)
  const title = text(input.title || existing?.title || '', 120)

  return {
    created_by: existing?.created_by || userId,
    host_profile_id: hostProfileId,
    title,
    slug: existing?.slug || uniqueSlug(title),
    summary: nullableText(input.summary, 280),
    description: nullableText(input.description, 10000),
    category: text(input.category || 'local-gems', 80),
    tags: list(input.tags, 20),
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: text(input.timezone || existing?.timezone || 'America/Toronto', 80),
    recurrence_rule: nullableText(input.recurrence_rule, 500),
    recurrence_ends_at: input.recurrence_ends_at ? dateTime(input.recurrence_ends_at, null) : null,
    publish_at: input.publish_at ? dateTime(input.publish_at, null) : null,
    event_format: format,
    location_id: nullableText(input.location_id, 64),
    address_public: nullableText(input.address_public, 500),
    private_address: nullableText(input.private_address, 500),
    online_url: nullableText(input.online_url, 500),
    exact_address_after_rsvp: boolean(input.exact_address_after_rsvp),
    capacity: integer(input.capacity, { min: 1, max: 100000, nullable: true }),
    min_age: integer(input.min_age, { min: 0, max: 99, nullable: true }),
    price_from_cents: integer(input.price_from_cents, { min: 0, max: 100000000, nullable: false }),
    currency: text(input.currency || 'CAD', 3).toUpperCase(),
    visibility: visibilities.has(input.visibility) ? input.visibility : 'public',
    approval_required: boolean(input.approval_required),
    comments_enabled: boolean(input.comments_enabled),
    chat_enabled: boolean(input.chat_enabled),
    attendee_questions: list(input.attendee_questions, 20).map((question) => ({ question, required: false })),
    accessibility: accessibility(input),
    contact_links: contactLinks(input),
    autosaved_at: new Date().toISOString()
  }
}

export function locationPayload(input, userId, existing = null) {
  const hostProfileId = nullableText(input.host_profile_id, 64)
  const name = text(input.name || existing?.name || '', 120)
  return {
    created_by: existing?.created_by || userId,
    host_profile_id: hostProfileId,
    name,
    slug: existing?.slug || uniqueSlug(name),
    kind: locationKinds.has(input.kind) ? input.kind : 'other',
    summary: nullableText(input.summary, 500),
    description: nullableText(input.description, 10000),
    city: text(input.city || existing?.city || '', 120),
    neighborhood: nullableText(input.neighborhood, 120),
    address_public: nullableText(input.address_public, 500),
    private_address: nullableText(input.private_address, 500),
    latitude: decimal(input.latitude, { min: -90, max: 90 }),
    longitude: decimal(input.longitude, { min: -180, max: 180 }),
    timezone: text(input.timezone || existing?.timezone || 'America/Toronto', 80),
    opening_hours: openingHours(input),
    amenities: list(input.amenities, 30),
    tags: list(input.tags, 20),
    accessibility: accessibility(input),
    price_level: integer(input.price_level, { min: 1, max: 4, nullable: true }),
    visibility: visibilities.has(input.visibility) ? input.visibility : 'public',
    comments_enabled: boolean(input.comments_enabled),
    contact_links: contactLinks(input),
    autosaved_at: new Date().toISOString()
  }
}

export function validateEvent(payload) {
  const errors = []
  if (payload.title.length < 3) errors.push('Add an event title with at least 3 characters.')
  if (new Date(payload.ends_at) <= new Date(payload.starts_at)) errors.push('The event must end after it starts.')
  if (payload.host_profile_id && !/^[0-9a-f-]{36}$/i.test(payload.host_profile_id)) errors.push('Choose a valid host identity.')
  return errors
}

export function validateLocation(payload) {
  const errors = []
  if (payload.name.length < 2) errors.push('Add a location name.')
  if (!payload.city) errors.push('Add the city for this location.')
  if ((payload.latitude === null) !== (payload.longitude === null)) errors.push('Add both latitude and longitude, or leave both blank.')
  if (payload.host_profile_id && !/^[0-9a-f-]{36}$/i.test(payload.host_profile_id)) errors.push('Choose a valid host identity.')
  return errors
}

export function objectFromFormData(formData) {
  return Object.fromEntries(formData.entries())
}
