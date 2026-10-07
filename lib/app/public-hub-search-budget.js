export const DATE_GROUP_SIZE = 6

// A saturated search can have enough rows before moderation but too few after it.
// Only widen in that case; an unsaturated search has already seen every match.
export function shouldExpandPublicHubSearch({ returned, visible, requested, needed }) {
  return returned >= requested && visible < needed
}
