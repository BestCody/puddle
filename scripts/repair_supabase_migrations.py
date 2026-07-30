from __future__ import annotations

from pathlib import Path


Repair = tuple[str, str, str, int]

REPAIRS: tuple[Repair, ...] = (
    (
        "supabase/migrations/0008_secure_media_and_discovery.sql",
        "order by distance_m nulls last,published_at desc nulls last limit greatest(1,least(max_rows,500));",
        "order by 20 nulls last,24 desc nulls last limit greatest(1,least(max_rows,500));",
        1,
    ),
    (
        "supabase/migrations/0016_hybrid_recommendation_runtime.sql",
        "from public.events e left join public.locations l on l.id=e.location_id left join public.host_profiles h on h.id=e.host_profile_id cross join origin o cross join prefs",
        "from public.events e left join public.locations l on l.id=e.location_id left join public.host_profiles h on h.id=e.host_profile_id cross join origin o cross join prefs left join ue on true",
        1,
    ),
    (
        "supabase/migrations/0016_hybrid_recommendation_runtime.sql",
        "from public.locations l left join public.host_profiles h on h.id=l.host_profile_id cross join origin o cross join prefs",
        "from public.locations l left join public.host_profiles h on h.id=l.host_profile_id cross join origin o cross join prefs left join ue on true",
        1,
    ),
    (
        "supabase/migrations/0016_hybrid_recommendation_runtime.sql",
        "from public.content_embeddings c,ue where",
        "from public.content_embeddings c where",
        2,
    ),
    (
        "supabase/migrations/0016_hybrid_recommendation_runtime.sql",
        "order by vector_similarity desc nulls last,distance_m nulls last,published_at desc nulls last limit greatest(1,least(max_rows,500));",
        "order by 28 desc nulls last,20 nulls last,25 desc nulls last limit greatest(1,least(max_rows,500));",
        1,
    ),
)


def apply_repair(path_text: str, old: str, new: str, expected_count: int) -> None:
    path = Path(path_text)
    text = path.read_text(encoding="utf-8")

    old_count = text.count(old)
    new_count = text.count(new)

    if old_count == expected_count:
        path.write_text(text.replace(old, new), encoding="utf-8")
        print(
            f"repaired {path}: replaced {expected_count} occurrence(s) "
            f"of {old!r}"
        )
        return

    if old_count == 0 and new_count >= expected_count:
        print(f"already repaired {path}: {new_count} repaired occurrence(s)")
        return

    raise RuntimeError(
        f"Expected {expected_count} original occurrence(s) or at least "
        f"{expected_count} repaired occurrence(s) in {path}; "
        f"found old={old_count}, new={new_count}."
    )


def main() -> None:
    for repair in REPAIRS:
        apply_repair(*repair)


if __name__ == "__main__":
    main()
