"""Scheduling rules for the photo materializer.

Each materialize run stops when its time budget is spent. Two rules keep that
budget on productive work:

* Country rotation: a run resumes at the country where the previous run
  stopped. Always starting from the first country starved every country the
  budget never reached.
* Failure back-off: a location whose candidates keep failing with retryable
  errors (for example a KartaView image that always returns HTTP 500) waits
  exponentially longer between attempts instead of being retried every hour.
"""
from __future__ import annotations

from datetime import timedelta

RETRYABLE_STATUSES = frozenset({'retryable_error', 'worker_error'})
LONG_RETRY_STATUSES = frozenset({'exhausted', 'invalid'})
MAX_BACKOFF_DOUBLINGS = 16


def rotate_countries(countries, start=None):
    """Return the sorted country list starting at ``start`` and wrapping around.

    When ``start`` is no longer a known country, rotation begins at the next
    country after it in sort order, so a removed country never resets progress.
    """
    ordered = list(countries)
    if not ordered or not start:
        return ordered
    index = next((i for i, country in enumerate(ordered) if country >= start), 0)
    return ordered[index:] + ordered[:index]


def next_start_country(stopped_at, complete):
    """Country the next run should start from; ``None`` restarts the full pass."""
    if complete or not stopped_at:
        return None
    return stopped_at


def retry_delay(status, prior_failures, retry_hours, retry_days):
    """Delay before a location that did not get a photo is queued again.

    ``prior_failures`` counts the location's earlier retryable failures. The
    first failure keeps the original ``retry_hours`` delay; each further one
    doubles it, capped at ``retry_days``. Exhausted or invalid locations keep
    the long ``retry_days`` delay, and other statuses keep ``retry_hours``.
    """
    cap = timedelta(days=retry_days)
    if status in LONG_RETRY_STATUSES:
        return cap
    hours = retry_hours
    if status in RETRYABLE_STATUSES:
        doublings = min(max(int(prior_failures or 0), 0), MAX_BACKOFF_DOUBLINGS)
        hours = retry_hours * 2 ** doublings
    return min(timedelta(hours=hours), cap)
