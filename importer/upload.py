"""Upload data/out/templates.json to PocketBase.

Usage:
    python -m importer.upload [--templates data/out/templates.json] [--prune] [--dry-run]

Connection details come from the environment or a .env file in the repo root:
    PB_URL=https://<machine>.<tailnet>.ts.net
    PB_SUPERUSER_EMAIL=...
    PB_SUPERUSER_PASSWORD=...

Records are upserted by id, so re-running is safe. Template collections
(exercises, programs, workouts, workout_items) are replaced to match the
file; with --prune, template records no longer in the file are deleted.
Starting 1RMs are created once (id "orm-<lift>-<date>") and never overwritten,
so maxes edited in the app are left alone.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
import urllib.parse
from pathlib import Path

TEMPLATE_COLLECTIONS = ["exercises", "programs", "workouts", "workout_items"]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():  # tolerate a BOM (Notepad/PowerShell)
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def pb_date(d: str | None) -> str | None:
    return f"{d} 00:00:00.000Z" if d else None


class PocketBase:
    def __init__(self, url: str):
        u = urllib.parse.urlparse(url.rstrip("/"))
        if u.scheme not in ("http", "https"):
            raise SystemExit(f"PB_URL must start with http:// or https:// (got {url!r})")
        self.base = u.path
        conn_cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
        self.conn = conn_cls(u.netloc, timeout=30)
        self.token = ""

    def request(self, method: str, path: str, body=None, ok=(200, 204)) -> tuple[int, dict]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = self.token
        data = json.dumps(body).encode() if body is not None else None
        for attempt in (1, 2):
            try:
                self.conn.request(method, self.base + path, body=data, headers=headers)
                resp = self.conn.getresponse()
                raw = resp.read()
                break
            except (http.client.HTTPException, ConnectionError, TimeoutError):
                if attempt == 2:
                    raise
                self.conn.close()
        payload = json.loads(raw) if raw else {}
        if resp.status not in ok:
            raise RuntimeError(f"{method} {path} -> {resp.status}: {json.dumps(payload)[:500]}")
        return resp.status, payload

    def login(self, email: str, password: str) -> None:
        _, p = self.request("POST", "/api/collections/_superusers/auth-with-password",
                            {"identity": email, "password": password})
        self.token = p["token"]

    def ids(self, collection: str) -> set[str]:
        out, page = set(), 1
        while True:
            q = urllib.parse.urlencode({"page": page, "perPage": 500, "fields": "id", "skipTotal": 1})
            _, p = self.request("GET", f"/api/collections/{collection}/records?{q}")
            items = p.get("items", [])
            out.update(i["id"] for i in items)
            if len(items) < 500:
                return out
            page += 1

    def create(self, collection: str, record: dict) -> None:
        self.request("POST", f"/api/collections/{collection}/records", record)

    def update(self, collection: str, record: dict) -> None:
        rid = record["id"]
        body = {k: v for k, v in record.items() if k != "id"}
        self.request("PATCH", f"/api/collections/{collection}/records/{rid}", body)

    def delete(self, collection: str, rid: str) -> None:
        self.request("DELETE", f"/api/collections/{collection}/records/{rid}")


# --------------------------------------------------------------------------
# templates.json -> PocketBase records
# --------------------------------------------------------------------------


def records_from(t: dict) -> dict[str, list[dict]]:
    ex = [
        {
            "id": e["id"], "name": e["name"], "aliases": e["aliases"], "components": e["components"],
            "base_lift": e["base_lift"] or "", "is_main_lift": e["is_main_lift"], "category": e["category"],
            "load_type": e["load_type"], "unilateral": e["unilateral"],
        }
        for e in t["exercises"]
    ]
    progs = [
        {
            "id": p["id"], "name": p["name"], "track": p["track"], "seq": p["seq"],
            "role": p.get("role", "") if p["track"] == "test" else "",
            "rotation": p.get("rotation", ""),
            "progression": "none" if p["track"] == "supplemental" else "",
            "start_date": pb_date(p.get("start_date")), "end_date": pb_date(p.get("end_date")),
        }
        for p in t["programs"]
    ]
    wos = [
        {
            "id": w["id"], "program": w["program"], "seq": w["seq"], "kind": w["kind"],
            "phase": w["phase"] or "", "title": w["title"], "week": w["week"], "day": w["day"],
            "original_date": pb_date(w["original_date"]),
        }
        for w in t["workouts"]
    ]
    items = [
        {
            "id": i["id"], "workout": i["workout"], "block": i["block"], "order": i["order"],
            "exercise": i["exercise"], "raw_name": i["raw_name"], "raw_scheme": i["raw_scheme"],
            "prescription": i["prescription"], "notes": i["notes"], "scheme_type": i["scheme_type"],
            "planned_sets": i["planned_sets"], "set_count": i["set_count"], "rep_min": i["rep_min"],
            "rep_max": i["rep_max"], "per_side": i["per_side"], "seconds": i["seconds"],
            "open_ended": i["open_ended"], "base_lift_override": i["base_lift_override"] or "",
            "needs_review": i["needs_review"],
        }
        for i in t["workout_items"]
    ]
    maxes = [
        {
            "id": f"orm-{m['lift'].replace('_', '-')}-{m['date']}", "lift": m["lift"],
            "weight_lb": m["weight_lb"], "date": pb_date(m["date"]), "source": m.get("source", "manual"),
            "note": m.get("note", ""),
        }
        for m in t.get("one_rep_maxes", [])
    ]
    return {"exercises": ex, "programs": progs, "workouts": wos, "workout_items": items, "one_rep_maxes": maxes}


def upload(pb: PocketBase, recs: dict[str, list[dict]], prune: bool, dry_run: bool) -> None:
    for coll in TEMPLATE_COLLECTIONS:
        existing = pb.ids(coll)
        wanted = {r["id"] for r in recs[coll]}
        new = [r for r in recs[coll] if r["id"] not in existing]
        upd = [r for r in recs[coll] if r["id"] in existing]
        stale = sorted(existing - wanted)
        print(f"{coll:<15} create {len(new):>5}  update {len(upd):>5}  stale {len(stale):>4}"
              + ("  (pruning)" if prune and stale else ""))
        if dry_run:
            continue
        for n, r in enumerate(new + upd, start=1):
            (pb.create if r["id"] not in existing else pb.update)(coll, r)
            if n % 250 == 0:
                print(f"    {n}/{len(new) + len(upd)}")
    if prune and not dry_run:
        # children first, so cascades don't hit already-deleted parents
        for coll in reversed(TEMPLATE_COLLECTIONS):
            existing = pb.ids(coll)
            wanted = {r["id"] for r in recs[coll]}
            for rid in sorted(existing - wanted):
                pb.delete(coll, rid)

    existing = pb.ids("one_rep_maxes")
    new = [r for r in recs["one_rep_maxes"] if r["id"] not in existing]
    print(f"{'one_rep_maxes':<15} create {len(new):>5}  (existing maxes are never overwritten)")
    if not dry_run:
        for r in new:
            pb.create("one_rep_maxes", r)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--templates", type=Path, default=Path("data/out/templates.json"))
    ap.add_argument("--env", type=Path, default=Path(".env"))
    ap.add_argument("--prune", action="store_true", help="delete template records not in the file")
    ap.add_argument("--dry-run", action="store_true", help="show what would change, write nothing")
    args = ap.parse_args(argv)

    load_env(args.env)
    missing = [k for k in ("PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD") if not os.environ.get(k)]
    if missing:
        print(f"Missing {', '.join(missing)} (set them in .env or the environment)", file=sys.stderr)
        return 2
    with args.templates.open(encoding="utf-8") as f:
        t = json.load(f)
    if t.get("units") != "lb":
        print("templates.json is not in lb; re-run the importer", file=sys.stderr)
        return 2

    pb = PocketBase(os.environ["PB_URL"])
    pb.login(os.environ["PB_SUPERUSER_EMAIL"], os.environ["PB_SUPERUSER_PASSWORD"])
    upload(pb, records_from(t), prune=args.prune, dry_run=args.dry_run)
    print("Done." if not args.dry_run else "Dry run: nothing written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
