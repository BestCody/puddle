const EVENT_FIELDS = new Set([
  'title','category','tags','summary','description','starts_at','ends_at','timezone','event_format','address_public','online_url',
  'capacity','min_age','price_from_cents','currency','accessibility','accessibility_notes','website','instagram','contact_email','contact_phone'
])
const LOCATION_FIELDS = new Set([
  'name','kind','tags','summary','description','city','neighborhood','address_public','timezone','opening_hours','price_level','amenities',
  'accessibility','accessibility_notes','website','instagram','contact_email','contact_phone'
])
const PURPOSES = new Set(['title','short_description','description','categories_tags','accessibility_prompts','social_caption','missing_information'])

const EVENT_CATEGORIES = ['live-music','nightlife','food-drink','arts-culture','community','sports-fitness','learning','outdoors','markets','family','other']
const LOCATION_CATEGORIES = ['cafe','restaurant','bar','park','museum','gallery','attraction','activity_venue','study_spot','scenic_spot','nightlife','shop','community_space','other']

function cleanText(value, max = 5000) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function cleanValue(value, depth = 0) {
  if (depth > 3) return null
  if (typeof value === 'string') return cleanText(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => cleanValue(item, depth + 1)).filter((item) => item !== null && item !== '')
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [cleanText(key, 80), cleanValue(item, depth + 1)]).filter(([, item]) => item !== null && item !== ''))
  }
  return null
}

export function sanitizeSourceFields(contentKind, source = {}) {
  const allowed = contentKind === 'event' ? EVENT_FIELDS : LOCATION_FIELDS
  const result = {}
  for (const [key, value] of Object.entries(source || {})) {
    if (!allowed.has(key)) continue
    const cleaned = cleanValue(value)
    if (cleaned !== null && cleaned !== '' && (!Array.isArray(cleaned) || cleaned.length)) result[key] = cleaned
  }
  return result
}

export function moderateCreationInput(source) {
  const text = JSON.stringify(source).toLowerCase()
  const flags = []
  if (/\b(kill|shoot|bomb|attack)\b.{0,30}\b(tonight|tomorrow|at|during)\b/.test(text)) flags.push('credible_threat')
  if (/\b(buy|sell|dealer|for sale)\b.{0,24}\b(gun|firearm|explosive|fentanyl|cocaine|meth)\b/.test(text)) flags.push('regulated_transaction')
  if (/\b(minor|child|underage)\b.{0,32}\b(nude|sexual|explicit)\b/.test(text)) flags.push('sexual_content_involving_minors')
  if (/\b(dox|home address|social insurance|social security number)\b/.test(text)) flags.push('sensitive_personal_data')
  return { allowed: flags.length === 0, flags }
}

function missingFields(contentKind, source) {
  const fields = []
  const add = (field, reason) => { if (!source[field] && source[field] !== 0) fields.push({ field, reason }) }
  if (contentKind === 'event') {
    add('title', 'Add the event name.')
    add('summary', 'Add a short reason to attend.')
    add('description', 'Explain what attendees can expect.')
    add('starts_at', 'Add the event start time.')
    add('ends_at', 'Add the event end time.')
    if (!source.address_public && !source.online_url) fields.push({ field: 'location', reason: 'Add a public area, Puddle location, or online link.' })
    if (!source.accessibility_notes && !Object.values(source.accessibility || {}).some(Boolean)) fields.push({ field: 'accessibility', reason: 'Confirm accessibility details rather than leaving them implied.' })
    if (source.price_from_cents === undefined || source.price_from_cents === null || source.price_from_cents === '') fields.push({ field: 'price_from_cents', reason: 'Confirm whether the event is free or paid.' })
    add('min_age', 'Confirm whether the event is all ages or age restricted.')
  } else {
    add('name', 'Add the location name.')
    add('summary', 'Add a short reason to visit.')
    add('description', 'Describe the location using verified details.')
    add('kind', 'Choose a location type.')
    add('city', 'Add the city.')
    add('address_public', 'Add the public address or area.')
    if (!source.opening_hours || !Object.keys(source.opening_hours).length) fields.push({ field: 'opening_hours', reason: 'Add verified opening hours or mark them unknown.' })
    if (!source.amenities || !source.amenities.length) fields.push({ field: 'amenities', reason: 'Add only amenities you have verified.' })
    if (!source.accessibility_notes && !Object.values(source.accessibility || {}).some(Boolean)) fields.push({ field: 'accessibility', reason: 'Confirm accessibility details rather than guessing.' })
  }
  return fields.slice(0, 12)
}

function categorySuggestions(contentKind, source) {
  const haystack = JSON.stringify(source).toLowerCase()
  const categories = contentKind === 'event' ? EVENT_CATEGORIES : LOCATION_CATEGORIES
  const keywordMap = contentKind === 'event' ? {
    'live-music':['concert','dj','band','music','vinyl'],nightlife:['club','dance','late-night','party'],
    'food-drink':['dinner','coffee','tasting','restaurant','food'], 'arts-culture':['gallery','art','museum','theatre','film'],
    community:['community','meetup','volunteer','neighbourhood'], 'sports-fitness':['run','yoga','fitness','sport'],
    learning:['workshop','class','lecture','learn'], outdoors:['park','hike','outdoor','garden'], markets:['market','vendors','craft'], family:['family','children','kids']
  } : {
    cafe:['coffee','espresso','café','cafe'],restaurant:['restaurant','dinner','lunch','food'],bar:['bar','cocktail','beer','wine'],
    park:['park','trail','garden'],museum:['museum','exhibit'],gallery:['gallery','art'],attraction:['attraction','landmark'],
    activity_venue:['bowling','climbing','arcade','activity'],study_spot:['study','quiet','outlets','wifi'],scenic_spot:['view','sunset','lookout','scenic'],
    nightlife:['club','dance','late-night'],shop:['shop','store','boutique'],community_space:['community','library','centre','center']
  }
  const ranked = categories.map((category) => ({ category, matches: (keywordMap[category] || []).filter((word) => haystack.includes(word)) }))
    .filter((item) => item.matches.length).sort((a, b) => b.matches.length - a.matches.length)
  return ranked.slice(0, 3).map((item) => ({ value: item.category, reason: `Matches supplied words: ${item.matches.slice(0, 3).join(', ')}` }))
}

export function deterministicAssist(contentKind, source) {
  return {
    suggestions: {},
    missingFields: missingFields(contentKind, source),
    categorySuggestions: categorySuggestions(contentKind, source),
    accessibilityQuestions: [
      'Is there a step-free entrance?',
      'Is a wheelchair-accessible washroom available?',
      'Are seating, hearing, sensory, or support accommodations confirmed?',
      'Who can visitors contact to verify access needs?'
    ],
    warnings: ['Only add accessibility details that you have verified.']
  }
}

export function buildCreationPrompt({ contentKind, purpose, source }) {
  if (!PURPOSES.has(purpose)) throw new Error('Unknown AI assistance purpose.')
  const deterministic = deterministicAssist(contentKind, source)
  const allowedCategories = contentKind === 'event' ? EVENT_CATEGORIES : LOCATION_CATEGORIES
  const system = `You are Puddle's local drafting assistant. You transform only the facts in SOURCE_FIELDS. Never invent, infer, or assume performers, speakers, schedules, dates, prices, addresses, amenities, accessibility features, refund rules, age restrictions, sponsors, ticket availability, capacity, opening hours, safety claims, or contact details. Do not add a factual proper name that is absent from SOURCE_FIELDS. Return JSON only. Human approval is always required.`
  const prompt = JSON.stringify({
    task: purpose,
    contentKind,
    sourceFields: source,
    allowedOutputKeys: ['title','name','summary','description','category','kind','tags','socialCaption','missingFields','accessibilityQuestions','warnings'],
    allowedCategories,
    deterministicMissingFields: deterministic.missingFields,
    rules: [
      'Use null or omit a field when the supplied facts are insufficient.',
      'Titles and descriptions may improve wording but may not add new facts.',
      'Accessibility output must be questions or prompts unless the source explicitly confirms a feature.',
      'Categories and tags must be supported by words or facts in the source.',
      'Do not repeat private contact data in social captions.'
    ]
  })
  return { system, prompt, deterministic }
}

function arrayOfStrings(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => cleanText(typeof item === 'object' ? item.field || item.reason || item.value : item, maxLength)).filter(Boolean))].slice(0, maxItems)
}

export function normalizeCreationOutput(contentKind, raw, deterministic) {
  const suggestions = {}
  const source = raw && typeof raw === 'object' ? raw : {}
  const titleKey = contentKind === 'event' ? 'title' : 'name'
  if (source[titleKey]) suggestions[titleKey] = cleanText(source[titleKey], 120)
  if (source.summary) suggestions.summary = cleanText(source.summary, contentKind === 'event' ? 280 : 500)
  if (source.description) suggestions.description = cleanText(source.description, 6000)
  if (contentKind === 'event' && EVENT_CATEGORIES.includes(source.category)) suggestions.category = source.category
  if (contentKind === 'location' && LOCATION_CATEGORIES.includes(source.kind)) suggestions.kind = source.kind
  const tags = arrayOfStrings(source.tags, 12, 40)
  if (tags.length) suggestions.tags = tags
  if (source.socialCaption) suggestions.socialCaption = cleanText(source.socialCaption, 600)
  return {
    suggestions,
    missingFields: Array.isArray(source.missingFields) ? source.missingFields.slice(0, 12).map((item) => typeof item === 'string' ? { field: cleanText(item, 80), reason: '' } : { field: cleanText(item?.field, 80), reason: cleanText(item?.reason, 240) }).filter((item) => item.field) : deterministic.missingFields,
    categorySuggestions: deterministic.categorySuggestions,
    accessibilityQuestions: arrayOfStrings(source.accessibilityQuestions, 8, 240).length ? arrayOfStrings(source.accessibilityQuestions, 8, 240) : deterministic.accessibilityQuestions,
    warnings: [...new Set([...deterministic.warnings, ...arrayOfStrings(source.warnings, 8, 240)])]
  }
}

function extractedHardFacts(value) {
  const text = JSON.stringify(value)
  const patterns = [
    /https?:\/\/[^\s"']+/gi,
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,
    /(?:[$€£]|\b(?:CAD|USD|EUR|GBP)\b)\s?\d+(?:[.,]\d+)?/gi,
    /\b\d{1,2}:\d{2}\s?(?:am|pm)?\b/gi,
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/gi,
    /\b\d+(?:[.,]\d+)?\b/g
  ]
  return [...new Set(patterns.flatMap((pattern) => text.match(pattern) || []).map((item) => item.toLowerCase().replace(/\s+/g, ' ').trim()))]
}

export function validateGrounding(source, output) {
  const sourceText = JSON.stringify(source).toLowerCase().replace(/\s+/g, ' ')
  const unsupportedFacts = extractedHardFacts(output).filter((fact) => !sourceText.includes(fact))
  const outputText = JSON.stringify(output).toLowerCase()
  const unsupportedClaims = []
  const protectedClaims = [
    ['performer',/\b(featuring|performance by|performer|headliner)\b/],
    ['sponsor',/\b(sponsored by|presented by|in partnership with)\b/],
    ['refund rule',/\b(refund|non-refundable|money back)\b/],
    ['accessibility',/\b(wheelchair accessible|step-free|accessible washroom|hearing loop|sensory friendly)\b/],
    ['amenity',/\b(parking|wifi|wi-fi|patio|coat check|childcare)\b/]
  ]
  for (const [name, pattern] of protectedClaims) {
    const match = outputText.match(pattern)
    if (match && !sourceText.includes(match[0])) unsupportedClaims.push(name)
  }
  return { allowed: unsupportedFacts.length === 0 && unsupportedClaims.length === 0, unsupportedFacts, unsupportedClaims }
}
