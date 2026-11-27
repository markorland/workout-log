/// <reference path="../pb_data/types.d.ts" />
// Rounds: each session records the round of its track (1, 2…), so the main
// timeline can loop and past rounds keep their labels.

migrate((app) => {
  const sessions = app.findCollectionByNameOrId("sessions")
  sessions.fields.add(new NumberField({ name: "round", onlyInt: true, min: 1 }))
  app.save(sessions)
}, (app) => {
  const sessions = app.findCollectionByNameOrId("sessions")
  sessions.fields.removeByName("round")
  app.save(sessions)
})
