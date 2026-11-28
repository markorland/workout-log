/// <reference path="../pb_data/types.d.ts" />
// Withings: weigh-ins fetched by the server (pb_hooks/withings.pb.js).
//
// - body_measurements.source gains "withings", and withings_time (unix
//   seconds) records when that weigh-in happened, so a later weigh-in the same
//   day replaces an earlier one and never the other way round.
// - withings_auth holds the Withings tokens in a single record. No API rules:
//   only superusers and the server's hooks can read it.

migrate((app) => {
  const m = app.findCollectionByNameOrId("body_measurements")
  m.fields.getByName("source").values = ["manual", "csv", "withings"]
  m.fields.add(new NumberField({ name: "withings_time", onlyInt: true }))
  app.save(m)

  const auth = new Collection({
    type: "base",
    name: "withings_auth",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        type: "text", name: "id", system: true, primaryKey: true, required: true,
        min: 1, max: 128, pattern: "^[a-z0-9_-]+$", autogeneratePattern: "[a-z0-9]{15}",
      },
      { type: "text", name: "userid", max: 0 },
      { type: "text", name: "access_token", max: 0, hidden: true },
      { type: "text", name: "refresh_token", max: 0, hidden: true },
      { type: "number", name: "token_expires", onlyInt: true },
      { type: "text", name: "pending_state", max: 0, hidden: true },
      { type: "number", name: "pending_state_at", onlyInt: true },
      { type: "number", name: "last_update", onlyInt: true },
      { type: "date", name: "last_check" },
      { type: "text", name: "last_error", max: 0 },
      { type: "number", name: "tz_offset_min", onlyInt: true },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
  })
  app.save(auth)
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("withings_auth")) } catch (_) {}
  const m = app.findCollectionByNameOrId("body_measurements")
  m.fields.removeByName("withings_time")
  m.fields.getByName("source").values = ["manual", "csv"]
  app.save(m)
})
