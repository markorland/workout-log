/// <reference path="../pb_data/types.d.ts" />
// Withings weigh-ins -> Bodyweight and Body fat (see withings_lib.js).
//
//   GET  /api/withings/status      connected?, last check, latest weigh-in
//   POST /api/withings/start       the Withings sign-in link (Connect button)
//   GET  /api/withings/callback    where the sign-in comes back to (via GitHub Pages)
//   POST /api/withings/sync        check for new weigh-ins now (Get weigh-ins button)
//   POST /api/withings/disconnect  forget the Withings tokens
//
// Plus a check every 4 hours.

routerAdd("GET", "/api/withings/status", (e) => {
  const w = require(`${__hooks}/withings_lib.js`)
  return e.json(200, w.status($app, e.request.url.query().get("tz")))
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/withings/start", (e) => {
  const w = require(`${__hooks}/withings_lib.js`)
  const body = e.requestInfo().body || {}
  try {
    return e.json(200, { url: w.startUrl($app, body.origin, body.tz) })
  } catch (err) {
    return e.json(400, { message: String(err.message || err) })
  }
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/withings/sync", (e) => {
  const w = require(`${__hooks}/withings_lib.js`)
  const body = e.requestInfo().body || {}
  try {
    return e.json(200, w.sync($app, body.tz))
  } catch (err) {
    return e.json(502, { message: String(err.message || err) })
  }
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/withings/disconnect", (e) => {
  const w = require(`${__hooks}/withings_lib.js`)
  w.disconnect($app)
  return e.json(200, { ok: true })
}, $apis.requireAuth("users"))

// No login here: the browser arrives straight from the Withings sign-in. The
// state nonce from /start is what proves the request is ours.
routerAdd("GET", "/api/withings/callback", (e) => {
  const w = require(`${__hooks}/withings_lib.js`)
  const q = e.request.url.query()
  const page = (title, text) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title}</title><style>body{font:17px -apple-system,system-ui,sans-serif;margin:3rem 1.5rem;max-width:30rem;color:#222}` +
    `@media(prefers-color-scheme:dark){body{background:#000;color:#eee}}a{color:#2f7cf6}</style></head>` +
    `<body><h1>${title}</h1><p>${text}</p><p><a href="/">Open Workout Log</a></p></body></html>`
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
  if (q.get("error")) {
    return e.html(200, page("Withings not connected", "The sign-in was cancelled. You can close this page and try again from the app."))
  }
  try {
    const r = w.finishSignIn($app, q.get("code"), q.get("state"))
    const n = r.added + r.updated
    const done = r.error
      ? `Fetching weigh-ins didn't work yet (${esc(r.error)}); the server tries again every 4 hours, or tap Get weigh-ins in the app.`
      : n ? `Imported today's weigh-in (${n} measurement${n === 1 ? "" : "s"}).` : "No weigh-in yet today; it will come in on the next check."
    return e.html(200, page("Withings connected", `${done} You can close this page and go back to the app.`))
  } catch (err) {
    return e.html(400, page("Withings not connected", esc(err.message || err)))
  }
})

cronAdd("withings_sync", "17 */4 * * *", () => {
  require(`${__hooks}/withings_lib.js`).scheduledSync($app)
})
