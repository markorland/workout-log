/// <reference path="../pb_data/types.d.ts" />
// Withings: shared code for withings.pb.js. PocketBase runs each hook handler
// on its own, so every handler loads this file with require().
//
// Settings (environment variables, set in the Dockge stack's .env):
//   WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET   from the Withings developer app
//   WITHINGS_REDIRECT_URI                        the registered redirect URL
//   WITHINGS_API_BASE, WITHINGS_ACCOUNT_BASE     only for local testing

const env = (k, d) => $os.getenv(k) || d || ""
const API = () => env("WITHINGS_API_BASE", "https://wbsapi.withings.net").replace(/\/$/, "")
const ACCOUNT = () => env("WITHINGS_ACCOUNT_BASE", "https://account.withings.com").replace(/\/$/, "")
const REDIRECT = () => env("WITHINGS_REDIRECT_URI", "https://markorland.github.io/workout-log/withings/")

const AUTH_ID = "withings" // the one withings_auth record
const KG_TO_LB = 2.2046226218
const WEIGHT = 1 // Withings measure type: weight, kg
const FAT_RATIO = 6 // Withings measure type: fat ratio, %
// Where the sign-in may send the browser back to: the server's Tailscale
// HTTPS name, or its address on the home network.
const ORIGIN_OK = /^(https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net|http:\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))(\.\d{1,3}){1,3}(:\d+)?)$/

// Scheduled checks: every 30 minutes in the morning weigh-in window (local
// time, start inclusive through the end hour on the dot), otherwise every 4 hours.
const WINDOW_START_HOUR = 6
const WINDOW_END_HOUR = 10
const FALLBACK_EVERY_HOURS = 4

const now = () => Math.floor(Date.now() / 1000)
const round2 = (v) => Math.round(v * 100) / 100

function configured() {
  return !!(env("WITHINGS_CLIENT_ID") && env("WITHINGS_CLIENT_SECRET"))
}

function authRecord(app) {
  try {
    return app.findRecordById("withings_auth", AUTH_ID)
  } catch (_) {
    const r = new Record(app.findCollectionByNameOrId("withings_auth"))
    r.set("id", AUTH_ID)
    return r
  }
}

function form(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])))
    .join("&")
}

/** POST to the Withings API; returns the response body or throws with Withings' error. */
function call(path, params, token) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" }
  if (token) headers["Authorization"] = "Bearer " + token
  const res = $http.send({ url: API() + path, method: "POST", body: form(params), headers: headers, timeout: 30 })
  const j = res.json || {}
  if (res.statusCode !== 200 || j.status !== 0) {
    const detail = j.error ? ": " + j.error : ""
    throw new Error("Withings said " + (j.status !== undefined ? "status " + j.status : "HTTP " + res.statusCode) + detail)
  }
  return j.body || {}
}

function saveTokens(app, rec, body) {
  rec.set("access_token", body.access_token)
  // Withings issues a new refresh token every time; the old one stops working.
  rec.set("refresh_token", body.refresh_token)
  rec.set("token_expires", now() + (Number(body.expires_in) || 10800))
  if (body.userid) rec.set("userid", String(body.userid))
  app.save(rec)
}

function requestToken(params) {
  return call("/v2/oauth2", Object.assign({
    action: "requesttoken",
    client_id: env("WITHINGS_CLIENT_ID"),
    client_secret: env("WITHINGS_CLIENT_SECRET"),
  }, params))
}

function accessToken(app, rec) {
  if (!rec.getString("refresh_token")) throw new Error("Withings isn't connected yet.")
  if (rec.getInt("token_expires") - 300 > now()) return rec.getString("access_token")
  saveTokens(app, rec, requestToken({ grant_type: "refresh_token", refresh_token: rec.getString("refresh_token") }))
  return rec.getString("access_token")
}

/** Midnight today in the phone's time zone, as unix seconds. */
function startOfToday(tzOffsetMin) {
  const local = now() - tzOffsetMin * 60
  return local - (local % 86400) + tzOffsetMin * 60
}

/** "YYYY-MM-DD" in the phone's time zone (offset as from Date.getTimezoneOffset()). */
function localDay(unix, tzOffsetMin) {
  const d = new Date((unix - tzOffsetMin * 60) * 1000)
  const p = (n) => (n < 10 ? "0" : "") + n
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate())
}

function setTz(rec, tz) {
  const n = parseInt(tz, 10)
  if (!isNaN(n) && n >= -900 && n <= 900) rec.set("tz_offset_min", n)
}

/** Sign-in link for the Connect button. */
function startUrl(app, origin, tz) {
  if (!configured()) throw new Error("Withings isn't set up on the server (WITHINGS_CLIENT_ID / WITHINGS_CLIENT_SECRET).")
  if (!ORIGIN_OK.test(origin || "")) throw new Error("Open the app from its Tailscale or home address to connect Withings.")
  const rec = authRecord(app)
  const nonce = $security.randomString(32)
  rec.set("pending_state", nonce)
  rec.set("pending_state_at", now())
  setTz(rec, tz)
  app.save(rec)
  // The redirect page (GitHub Pages) reads the part after "~" to know where to
  // send the browser back to. The nonce proves the sign-in started here.
  const state = nonce + "~" + encodeURIComponent(origin)
  return ACCOUNT() + "/oauth2_user/authorize2?" + form({
    response_type: "code",
    client_id: env("WITHINGS_CLIENT_ID"),
    scope: "user.metrics",
    redirect_uri: REDIRECT(),
    state: state,
  })
}

/** Back from the Withings sign-in: swap the code for tokens, then fetch weigh-ins. */
function finishSignIn(app, code, state) {
  const rec = authRecord(app)
  const nonce = String(state || "").split("~")[0]
  const expected = rec.getString("pending_state")
  if (!nonce || !expected || nonce !== expected || now() - rec.getInt("pending_state_at") > 900) {
    throw new Error("This sign-in link has expired or didn't start from the app. Tap Connect Withings again.")
  }
  rec.set("pending_state", "")
  app.save(rec)
  // The code is only good for 30 seconds, so this happens straight away.
  saveTokens(app, rec, requestToken({ grant_type: "authorization_code", code: code, redirect_uri: REDIRECT() }))
  // Connected from here on; a failed first fetch is retried by the schedule.
  try {
    return sync(app)
  } catch (err) {
    return { added: 0, updated: 0, skipped: 0, latest: null, error: String(err.message || err) }
  }
}

/** Fetch new weigh-ins and save them as Bodyweight and Body fat measurements. */
function sync(app, tz) {
  const rec = authRecord(app)
  setTz(rec, tz)
  try {
    const token = accessToken(app, rec)
    const since = rec.getInt("last_update")
    // First check after connecting: today only (history comes from your CSVs).
    // After that: everything new or changed since the last check.
    const range = since > 0
      ? { lastupdate: since }
      : { startdate: startOfToday(rec.getInt("tz_offset_min")), enddate: now() }
    const groups = []
    let offset = 0
    let updatetime = 0
    for (let page = 0; page < 50; page++) {
      const body = call("/measure", Object.assign({
        action: "getmeas",
        meastypes: WEIGHT + "," + FAT_RATIO,
        category: 1, // real measurements, not goals
        offset: offset || "",
      }, range), token)
      updatetime = body.updatetime || updatetime
      for (const g of body.measuregrps || []) groups.push(g)
      if (!body.more) break
      offset = body.offset
    }
    const result = saveWeighIns(app, groups, rec.getInt("tz_offset_min"))
    rec.set("last_update", updatetime || now())
    rec.set("last_error", "")
    rec.set("last_check", new Date().toISOString())
    app.save(rec)
    return result
  } catch (err) {
    rec.set("last_error", String(err && err.message ? err.message : err))
    rec.set("last_check", new Date().toISOString())
    app.save(rec)
    throw err
  }
}

function partId(app, key) {
  try {
    return app.findFirstRecordByFilter("body_parts", "key = {:k}", { k: key }).id
  } catch (_) {
    return ""
  }
}

function saveWeighIns(app, groups, tz) {
  const parts = { bodyweight: partId(app, "bodyweight"), body_fat: partId(app, "body_fat") }
  let added = 0
  let updated = 0
  let skipped = 0
  let latest = null
  groups.sort((a, b) => a.date - b.date)
  for (const g of groups) {
    const values = {}
    for (const m of g.measures || []) {
      const v = m.value * Math.pow(10, m.unit)
      if (m.type === WEIGHT) values.bodyweight = { value: round2(v * KG_TO_LB), unit: "lb" }
      if (m.type === FAT_RATIO) values.body_fat = { value: round2(v), unit: "%" }
    }
    if (!values.bodyweight && !values.body_fat) continue
    const day = localDay(g.date, tz)
    for (const key of Object.keys(values)) {
      if (!parts[key]) continue
      // Same id the app uses, so a value typed on the phone and a weigh-in on
      // the same day are the same record.
      const id = "bm-" + day + "-" + key.replace(/_/g, "-") + "-x"
      let r = null
      try { r = app.findRecordById("body_measurements", id) } catch (_) {}
      if (r && r.getString("source") !== "withings") { skipped++; continue } // typed or imported by you: keep it
      if (r && r.getInt("withings_time") > g.date) continue // a later weigh-in that day is already saved
      if (r && r.getInt("withings_time") === g.date && r.getFloat("value") === values[key].value && !r.getString("deleted_at")) continue // already have it
      const isNew = !r
      if (!r) {
        r = new Record(app.findCollectionByNameOrId("body_measurements"))
        r.set("id", id)
        r.set("date", day + " 00:00:00.000Z")
        r.set("body_part", parts[key])
        r.set("side", "")
      }
      r.set("value", values[key].value)
      r.set("unit", values[key].unit)
      r.set("source", "withings")
      r.set("notes", "Withings")
      r.set("deleted_at", "")
      r.set("withings_time", g.date)
      app.save(r)
      if (isNew) added++
      else updated++
    }
    if (!latest || g.date >= latest.time) {
      latest = { time: g.date, weight: values.bodyweight ? values.bodyweight.value : null, fat: values.body_fat ? values.body_fat.value : null }
    }
  }
  return { added: added, updated: updated, skipped: skipped, latest: latest }
}

function latestWeighIn(app) {
  try {
    const rows = app.findRecordsByFilter("body_measurements", "source = 'withings' && deleted_at = ''", "-withings_time", 4, 0)
    if (!rows.length) return null
    const t = rows[0].getInt("withings_time")
    const out = { time: t, weight: null, fat: null }
    for (const r of rows) {
      if (r.getInt("withings_time") !== t) continue
      if (r.getString("unit") === "lb") out.weight = r.getFloat("value")
      if (r.getString("unit") === "%") out.fat = r.getFloat("value")
    }
    return out
  } catch (_) {
    return null
  }
}

function status(app, tz) {
  const rec = authRecord(app)
  if (tz !== undefined && tz !== null && tz !== "" && rec.getString("refresh_token")) {
    setTz(rec, tz)
    app.save(rec)
  }
  return {
    configured: configured(),
    connected: !!rec.getString("refresh_token"),
    lastCheck: rec.getString("last_check"),
    lastError: rec.getString("last_error"),
    latest: latestWeighIn(app),
  }
}

function disconnect(app) {
  const rec = authRecord(app)
  for (const f of ["access_token", "refresh_token", "userid", "pending_state", "last_error"]) rec.set(f, "")
  rec.set("token_expires", 0)
  rec.set("last_update", 0)
  app.save(rec)
}

/**
 * Should the half-hourly tick run a check? nowMs is the time, tzOffsetMin the
 * phone's offset (as from Date.getTimezoneOffset()).
 */
function isCheckTime(nowMs, tzOffsetMin) {
  const local = new Date(nowMs - tzOffsetMin * 60000)
  const h = local.getUTCHours()
  const firstHalf = local.getUTCMinutes() < 30
  const inWindow = (h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR) || (h === WINDOW_END_HOUR && firstHalf)
  return inWindow || (firstHalf && h % FALLBACK_EVERY_HOURS === 0)
}

/** The scheduled check: quietly skip when Withings isn't connected or it isn't time. */
function scheduledSync(app) {
  if (!configured()) return
  const rec = authRecord(app)
  if (!rec.getString("refresh_token")) return
  if (!isCheckTime(Date.now(), rec.getInt("tz_offset_min"))) return
  try {
    const r = sync(app)
    if (r.added || r.updated) console.log("withings: " + r.added + " new, " + r.updated + " updated")
  } catch (err) {
    console.log("withings: " + err)
  }
}

module.exports = { configured, startUrl, finishSignIn, sync, status, disconnect, scheduledSync, localDay, startOfToday, isCheckTime }
