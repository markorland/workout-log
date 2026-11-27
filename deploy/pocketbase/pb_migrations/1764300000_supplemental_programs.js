/// <reference path="../pb_data/types.d.ts" />
// Phase 6: supplemental programs uploaded from the app.
//
// - The app user may create, edit and delete programs, workouts and workout
//   items whose id starts with "sup-" (uploaded supplemental programs). The
//   imported TrueCoach templates stay read-only.
// - The app user may add exercises (new names from a program CSV), but not
//   edit or delete existing ones.
// - New fields: programs.end_action, programs.weeks_per_phase,
//   workout_items.form_cue and workout_items.video_url.

const USER = '@request.auth.collectionName = "users"'
const SUP_CREATE = `${USER} && @request.body.id ~ "sup-%"`
const SUP_EDIT = `${USER} && id ~ "sup-%"`

migrate((app) => {
  const programs = app.findCollectionByNameOrId("programs")
  programs.fields.add(new SelectField({ name: "end_action", values: ["restart", "stop"], maxSelect: 1 }))
  programs.fields.add(new NumberField({ name: "weeks_per_phase", onlyInt: true }))
  programs.createRule = SUP_CREATE
  programs.updateRule = SUP_EDIT
  programs.deleteRule = SUP_EDIT
  app.save(programs)

  for (const name of ["workouts", "workout_items"]) {
    const c = app.findCollectionByNameOrId(name)
    if (name === "workout_items") {
      c.fields.add(new TextField({ name: "form_cue" }))
      c.fields.add(new URLField({ name: "video_url" }))
    }
    c.createRule = SUP_CREATE
    c.updateRule = SUP_EDIT
    c.deleteRule = SUP_EDIT
    app.save(c)
  }

  const exercises = app.findCollectionByNameOrId("exercises")
  exercises.createRule = `${USER} && @request.body.id ~ "ex-%"`
  app.save(exercises)
}, (app) => {
  const programs = app.findCollectionByNameOrId("programs")
  programs.fields.removeByName("end_action")
  programs.fields.removeByName("weeks_per_phase")
  programs.createRule = null
  programs.updateRule = null
  programs.deleteRule = null
  app.save(programs)
  for (const name of ["workouts", "workout_items"]) {
    const c = app.findCollectionByNameOrId(name)
    if (name === "workout_items") {
      c.fields.removeByName("form_cue")
      c.fields.removeByName("video_url")
    }
    c.createRule = null
    c.updateRule = null
    c.deleteRule = null
    app.save(c)
  }
  const exercises = app.findCollectionByNameOrId("exercises")
  exercises.createRule = null
  app.save(exercises)
})
