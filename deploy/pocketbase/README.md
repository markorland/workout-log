# PocketBase on TrueNAS (Dockge) — Phase 2 setup

PocketBase runs as a Dockge stack using the community image
[`ghcr.io/muchobien/pocketbase`](https://github.com/muchobien/pocketbase-docker),
which tracks official PocketBase releases. It's reachable two ways:

- **Home network:** `http://10.0.0.200:8090` (plain HTTP; handy for the admin UI from a computer at home).
- **Tailnet:** `https://<machine>.<tailnet>.ts.net` via `tailscale serve`. **The phone app uses this one**, at home too, because iOS only runs an installed PWA (service worker) over HTTPS.

```
/mnt/HDDs/Docker/DockgeStacks/pocketbase/
├── compose.yaml        # pasted into Dockge from the repo
├── .env                # admin login, typed into Dockge (never in the repo)
├── pb_migrations/      # copied from the repo: collections, rules and default settings, applied on start
├── pb_data/            # database, uploaded photos, backups (created on first start)
└── pb_public/          # the built PWA (Phase 3 deploys copy into here)
```

Everything lives in the Docker folder, so the Backblaze backup covers it.

**Version:** `compose.yaml` uses `:latest`. To pin, swap in the commented
`:0.42.3` line (tested with these migrations and the uploader); swap back to
return to `:latest`. In Dockge, **Update** pulls the newest image.

## 1. Create the stack in Dockge

PocketBase has its own accounts, separate from your Dockge login. It needs one
admin ("superuser") account, used by its admin UI and by the uploader. The
stack creates it from two values in the stack's `.env` file.

1. In Dockge, click **+ Compose** and name the stack `pocketbase`.
2. Paste in the contents of `deploy/pocketbase/compose.yaml`.
3. In the **.env** box, paste the two lines from `deploy/pocketbase/.env.example`
   and fill in an email and a strong, unique password:

   ```
   PB_ADMIN_EMAIL=you@example.com
   PB_ADMIN_PASSWORD='a-long-unique-password'
   ```

4. Click **Save** (not Deploy yet). That creates
   `/mnt/HDDs/Docker/DockgeStacks/pocketbase/`.

## 2. Copy the migration files

1. From your computer, copy the `deploy/pocketbase/pb_migrations` folder (two
   `.js` files) to your SMB share at `/mnt/HDDs/nas/`.
2. In a TrueNAS shell, copy it into the stack folder:

   ```sh
   sudo cp -r --no-preserve=mode,ownership /mnt/HDDs/nas/pb_migrations /mnt/HDDs/Docker/DockgeStacks/pocketbase/
   ls -la /mnt/HDDs/Docker/DockgeStacks/pocketbase/pb_migrations
   ```

   You should see `1764115200_init_collections.js` and `1764115201_seed_defaults.js`.
   `--no-preserve` stops the SMB share's restrictive permissions from coming
   along. Without it, the folder ends up owned by root with a mode only root
   can open. If that already happened, fix it with
   `sudo chmod 755 …/pb_migrations && sudo chmod 644 …/pb_migrations/*.js`.

If the migration files change later, repeat this step and restart the stack.
New migrations are applied on start; ones already applied are skipped.

## 3. Start it

1. In Dockge, click **Deploy** / **Start**. It pulls the image, applies the
   migrations and creates the admin account.
2. The stack should show healthy, and `http://10.0.0.200:8090/api/health`
   should return `API is healthy`.
3. Sign in at `http://10.0.0.200:8090/_/` with the admin email and password.
   The sidebar should list the collections (exercises, programs, workouts…).
   If it doesn't, the migration files weren't in place: check step 2, then
   restart the stack.

The account is reset to the `.env` values on every start, so change the
admin password in `.env` (then restart), not in the admin UI. The `.env` file
sits in the stack folder on the NAS, so it's included in the Backblaze backup
along with everything else; it's never in the repo.

## 4. Publish it on the tailnet

1. In the Tailscale admin console: **DNS → MagicDNS** on, and **HTTPS
   Certificates** enabled.
2. Open a shell inside the Tailscale app: in TrueNAS go to **Apps**, click the
   **tailscale** app, find **Workloads** (or **Containers**) in its details
   panel, and click the **Shell** icon (`>_`) next to the tailscale container.
   If it asks which shell, pick `/bin/sh`.
3. In that shell, add the serve rule and check it:

   ```sh
   tailscale serve --bg --https=443 http://10.0.0.200:8090
   tailscale serve status
   ```

   The first command should report that serving started and print an address
   like `https://orland-nas.<tailnet>.ts.net/`; `serve status` shows the saved rule.
4. On your phone or laptop, with Tailscale on, open that address with `/_/` on
   the end. The admin sign-in page should load. The first visit can take a few
   seconds while the certificate is issued.

What the rule does: Tailscale accepts HTTPS at the NAS's tailnet name, using
the certificate from step 1, and passes requests to PocketBase. `--bg` saves
the rule, so it survives restarts. The target is the NAS's LAN address, which
works whether or not the Tailscale app uses host networking (`127.0.0.1`
would only work with host networking).

If `tailscale serve` prints an error, the usual cause is HTTPS certificates
not being enabled yet in the Tailscale admin console (step 1).

Prefer a regular TrueNAS shell? The same commands work from there by running
them inside the container: `sudo docker ps --format '{{.Names}}' | grep -i tailscale`
gives the container name (e.g. `ix-tailscale-tailscale-1`), then
`sudo docker exec -it <that-name> tailscale serve --bg --https=443 http://10.0.0.200:8090`.

**Never run `tailscale funnel`.** That would put the server on the public internet.

## 5. Create your app login

Open the admin UI (`http://10.0.0.200:8090/_/` at home, or the tailnet address),
sign in as the superuser, open the **users** collection and add one record
(email + password). This is the login the phone app uses. Sign-ups are
disabled, so this is the only account.

## 6. Turn on scheduled backups

In the admin UI: **Settings → Backups** → enable auto backups (e.g. daily at
3 am, keep the last 7). PocketBase writes a consistent zip of the database and
files into `pb_data/backups/`, which Backblaze then picks up with the rest of
the Docker folder. (Backing up the live database file alone can catch it
mid-write; these zips can't.)

## 7. Upload the workout data

On your computer, in the repo:

```sh
cp .env.example .env        # then fill in PB_URL and the superuser login
python3 -m importer.import_main data/raw/tribe_barbell_workouts.csv
python3 -m importer.upload --dry-run
python3 -m importer.upload
```

`PB_URL` can be the home-network address (`http://10.0.0.200:8090`) or the
tailnet one. This loads 289 exercises, 42 programs, 363 workouts, 1,778
workout items and your starting 1RMs. It's safe to re-run: records are
updated in place, and 1RMs already on the server are never overwritten. Add
`--prune` to delete template records that are no longer in `templates.json`.

## 8. Check (Phase 2 "done when")

- On the phone, on cellular, with Tailscale **on**: `https://<machine>.<tailnet>.ts.net/_/` loads.
- With Tailscale **off** (and off the home Wi-Fi): it doesn't.
- The admin UI shows 363 records in **workouts** (314 main, 47 accessory, 2 test).

## Who can get in

Being on the home network only gets someone to the login screen. They still need an account:

- Without a login, the API returns no data from any collection.
- The only account that can sign in to the app is the one you create in step 5. Sign-ups are disabled.
- The admin UI (`/_/`) needs the superuser login.
- On plain HTTP at home, a password could in principle be read by someone
  snooping on your Wi-Fi. If you sign in from a computer at home, using the
  tailnet HTTPS address avoids that; the phone app always uses it.

## Updating the server for a new phase

When a phase adds a migration file (Phase 6 added `1764300000_supplemental_programs.js`; the loop-back feature added `1764400000_session_round.js`):

1. Copy the new file from `deploy/pocketbase/pb_migrations/` to your share, then into the stack's `pb_migrations/` folder (`sudo cp --no-preserve=mode,ownership …`, as in step 2).
2. Restart the stack in Dockge. New migrations are applied on start; the log shows `Applied 1764300000_supplemental_programs.js`.

## Starting fresh (erase logged data)

Removes sessions, logged sets, your place in each program and body
measurements. Keeps 1RMs, progress photos, the workout templates, settings and
your login. Each device keeps an offline copy and doesn't pick up deletions, so
wipe those too.

1. **Check nothing is waiting to sync:** the badge at the top says "Synced",
   so any photo you added is on the server.
2. **iPhone:** delete the Workout Log icon from the Home Screen (this removes
   its offline data). Then in Settings → Apps → Safari → Advanced → Website
   Data, remove your `ts.net` address and `10.0.0.200`.
3. **Chrome on a PC** (only that site): go to
   `chrome://settings/content/all`, search `10.0.0.200`, and click the trash
   icon next to `http://10.0.0.200:8090` → **Delete**. Or, with the app open,
   click the icon left of the address bar → **Site settings** → **Delete data**.
   This removes the offline data, cache and service worker for that site only.
4. **Server:** from the repo root:

   ```sh
   python3 -m importer.reset_data          # dry run: shows counts
   python3 -m importer.reset_data --yes    # delete
   ```

   Options: `--maxes` and `--photos` also delete 1RMs and photos; `--programs`
   deletes supplemental programs uploaded in the app (ids starting `sup-`).
   Barbell Accessory always stays.
5. Reinstall on the phone (see `app/README.md`, "Install on the iPhone") and
   sign in. Your 1RMs and photos download again, and you start at Beginner's
   Cycle 1, Round 1.

## Notes

- Changes made to collections in the admin UI are written as new migration
  files into the NAS's `pb_migrations/`. Copy them back into the repo if you
  want to keep them.
