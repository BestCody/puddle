from __future__ import annotations

from pathlib import Path


REPAIRS: tuple[tuple[str, str, str], ...] = (
    (
        "supabase/migrations/0008_secure_media_and_discovery.sql",
        "order by distance_m nulls last,published_at desc nulls last limit greatest(1,least(max_rows,500));",
        "order by 20 nulls last,24 desc nulls last limit greatest(1,least(max_rows,500));",
    ),
)


def apply_repair(path_text: str, old: str, new: str) -> None:
    path = Path(path_text)
    text = path.read_text(encoding="utf-8")

    old_count = text.count(old)
    new_count = text.count(new)

    if old_count == 1:
        path.write_text(text.replace(old, new, 1), encoding="utf-8")
        print(f"repaired {path}: {old!r} -> {new!r}")
        return

    if old_count == 0 and new_count == 1:
        print(f"already repaired {path}")
        return

    raise RuntimeError(
        f"Expected exactly one original or repaired fragment in {path}; "
        f"found old={old_count}, new={new_count}."
    )


def main() -> None:
    for repair in REPAIRS:
        apply_repair(*repair)


if __name__ == "__main__":
    main()
