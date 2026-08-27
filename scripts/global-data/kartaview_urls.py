"""Normalize KartaView photo URLs to the current CDN delivery contract."""
from __future__ import annotations

import base64
import urllib.parse


def canonical_asset_url(value: object) -> str | None:
    """Return a stable HTTPS asset URL for a KartaView photo.

    KartaView's API still exposes historical storage URLs, including the
    literal ``{{sizeprefix}}`` placeholder. Those storage hosts now return
    404 for otherwise valid photos. The supported delivery path is the
    KartaView image CDN, which accepts the original HTTPS photo URL encoded in
    the path.
    """
    raw = str(value or "").strip()
    if not raw:
        return None
    raw = raw.replace("{{sizeprefix}}", "proc").replace("[[sizeprefix]]", "proc")
    try:
        parsed = urllib.parse.urlsplit(raw)
    except ValueError:
        return raw
    host = (parsed.hostname or "").lower().rstrip(".")
    if host == "cdn.kartaview.org":
        return raw
    if host == "openstreetcam.org" or host.endswith(".openstreetcam.org"):
        if "/files/photo/" in parsed.path:
            source = urllib.parse.urlunsplit(
                ("https", parsed.netloc, parsed.path, parsed.query, "")
            )
            token = base64.urlsafe_b64encode(source.encode("utf-8")).decode("ascii").rstrip("=")
            return f"https://cdn.kartaview.org/pr:sharp/{token}"
    return raw


def asset_url(row: dict) -> str | None:
    """Select the processed KartaView asset field and canonicalize it."""
    value = (
        row.get("imageProcUrl")
        or row.get("procUrl")
        or row.get("processedUrl")
        or row.get("fileurlProc")
        or row.get("imageLthUrl")
        or row.get("fileurlLTh")
        or row.get("imageThUrl")
        or row.get("fileurlTh")
        or row.get("imageUrl")
        or row.get("fileurl")
        or row.get("fileUrl")
        or (row.get("sequence") or {}).get("fileurl")
    )
    return canonical_asset_url(value)
