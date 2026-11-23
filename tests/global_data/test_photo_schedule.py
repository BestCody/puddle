import sys
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts' / 'global-data'))

from photo_schedule import next_start_country, retry_delay, rotate_countries  # noqa: E402

COUNTRIES = ['AD', 'CA', 'DE', 'FR', 'US']


class RotateCountriesTest(unittest.TestCase):
    def test_without_cursor_keeps_sorted_order(self):
        self.assertEqual(rotate_countries(COUNTRIES), COUNTRIES)
        self.assertEqual(rotate_countries(COUNTRIES, ''), COUNTRIES)

    def test_resumes_at_cursor_and_wraps(self):
        self.assertEqual(rotate_countries(COUNTRIES, 'DE'), ['DE', 'FR', 'US', 'AD', 'CA'])

    def test_removed_cursor_country_resumes_at_next_country(self):
        self.assertEqual(rotate_countries(COUNTRIES, 'CZ'), ['DE', 'FR', 'US', 'AD', 'CA'])

    def test_cursor_after_last_country_wraps_to_start(self):
        self.assertEqual(rotate_countries(COUNTRIES, 'ZW'), COUNTRIES)

    def test_every_country_is_kept_exactly_once(self):
        for start in [None, 'AD', 'CZ', 'US', 'ZZ']:
            self.assertEqual(sorted(rotate_countries(COUNTRIES, start)), COUNTRIES)

    def test_empty_list(self):
        self.assertEqual(rotate_countries([], 'US'), [])


class NextStartCountryTest(unittest.TestCase):
    def test_budget_stop_resumes_at_same_country(self):
        self.assertEqual(next_start_country('FR', complete=False), 'FR')

    def test_complete_pass_restarts_from_beginning(self):
        self.assertIsNone(next_start_country('FR', complete=True))
        self.assertIsNone(next_start_country(None, complete=False))


class RetryDelayTest(unittest.TestCase):
    def test_first_retryable_failure_keeps_original_delay(self):
        self.assertEqual(retry_delay('retryable_error', 0, 1, 7), timedelta(hours=1))

    def test_repeated_retryable_failures_double(self):
        self.assertEqual(retry_delay('retryable_error', 1, 1, 7), timedelta(hours=2))
        self.assertEqual(retry_delay('worker_error', 3, 1, 7), timedelta(hours=8))

    def test_backoff_is_capped_at_retry_days(self):
        self.assertEqual(retry_delay('retryable_error', 8, 1, 7), timedelta(days=7))
        self.assertEqual(retry_delay('retryable_error', 10_000, 1, 7), timedelta(days=7))

    def test_long_retry_statuses_use_days(self):
        self.assertEqual(retry_delay('exhausted', 0, 1, 7), timedelta(days=7))
        self.assertEqual(retry_delay('invalid', 5, 1, 7), timedelta(days=7))

    def test_other_statuses_keep_flat_hourly_retry(self):
        self.assertEqual(retry_delay('already_claimed', 9, 1, 7), timedelta(hours=1))

    def test_bad_failure_counts_are_treated_as_zero(self):
        self.assertEqual(retry_delay('retryable_error', None, 1, 7), timedelta(hours=1))
        self.assertEqual(retry_delay('retryable_error', -3, 1, 7), timedelta(hours=1))


if __name__ == '__main__':
    unittest.main()
