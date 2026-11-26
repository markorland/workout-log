/// <reference path="../pb_data/types.d.ts" />
// Creates the twelve Workout Log collections (docs/Plan.md, "Data model").
//
// Conventions:
// - Record ids accept the importer's stable ids (e.g. "main-0001") and
//   client-made UUIDs, so templates upsert by id and the phone can create
//   records offline with their final id.
// - Template collections are read-only for the app user; only the superuser
//   (importer, admin UI) writes them.
// - Every app-written collection has deleted_at so deletes sync.
// - All weights are lb.

const LIFTS = ["snatch", "clean_and_jerk", "back_squat", "front_squat", "deadlift"];
const USER = '@request.auth.collectionName = "users"';

function idField() {
  return {
    type: "text", name: "id", system: true, primaryKey: true, required: true,
    min: 1, max: 128, pattern: "^[a-z0-9_-]+$", autogeneratePattern: "[a-z0-9]{15}",
  };
}

function timestamps() {
  return [
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];
}

const text = (name, o) => Object.assign({ type: "text", name: name, max: 0 }, o || {});
const num = (name, o) => Object.assign({ type: "number", name: name }, o || {});
const int = (name, o) => num(name, Object.assign({ onlyInt: true }, o || {}));
const bool = (name) => ({ type: "bool", name: name });
const json = (name) => ({ type: "json", name: name, maxSize: 0 });
const date = (name, o) => Object.assign({ type: "date", name: name }, o || {});
const select = (name, values, o) => Object.assign({ type: "select", name: name, values: values, maxSelect: 1 }, o || {});
const rel = (name, target, o) =>
  Object.assign({ type: "relation", name: name, collectionId: target.id, maxSelect: 1, cascadeDelete: false }, o || {});

function make(app, name, fields, opts) {
  opts = opts || {};
  const readOnly = !!opts.readOnly;
  const c = new Collection({
    type: "base",
    name: name,
    listRule: USER,
    viewRule: USER,
    createRule: readOnly ? null : USER,
    updateRule: readOnly ? null : USER,
    deleteRule: readOnly ? null : USER,
    fields: [idField()].concat(fields, timestamps()),
    indexes: opts.indexes || [],
  });
  app.save(c);
  return c;
}

migrate((app) => {
  // ---- templates (importer) ----------------------------------------------
  const exercises = make(app, "exercises", [
    text("name", { required: true }),
    json("aliases"),
    json("components"),
    select("base_lift", LIFTS),
    bool("is_main_lift"),
    select("category", ["oly", "squat", "pull", "press", "arms", "accessory", "conditioning", "circuit"]),
    select("load_type", ["weight", "bodyweight", "time", "text"]),
    bool("unilateral"),
    text("form_cue"),
    { type: "url", name: "video_url" },
  ], { readOnly: true, indexes: ["CREATE UNIQUE INDEX idx_exercises_name ON exercises (name)"] });

  const programs = make(app, "programs", [
    text("name", { required: true }),
    select("track", ["main", "supplemental", "test"], { required: true }),
    int("seq"),
    select("role", ["standard"]),
    text("rotation"),
    int("sessions_per_week"),
    json("phase_names"),
    select("progression", ["none", "double", "fixed"]),
    date("start_date"),
    date("end_date"),
  ], { readOnly: true });

  const workouts = make(app, "workouts", [
    rel("program", programs, { required: true, cascadeDelete: true }),
    int("seq"),
    select("kind", ["regular", "test"]),
    text("phase"),
    text("label"),
    text("title"),
    int("week"),
    int("day"),
    date("original_date"),
  ], { readOnly: true, indexes: ["CREATE INDEX idx_workouts_program_seq ON workouts (program, seq)"] });

  const items = make(app, "workout_items", [
    rel("workout", workouts, { required: true, cascadeDelete: true }),
    text("block"),
    int("order"),
    rel("exercise", exercises, { required: true }),
    text("raw_name"),
    text("raw_scheme"),
    text("prescription"),
    text("notes"),
    select("scheme_type", ["pct", "sets_reps", "sets_only", "max_attempt", "text"]),
    json("planned_sets"),
    int("set_count"),
    int("rep_min"),
    int("rep_max"),
    bool("per_side"),
    int("seconds"),
    bool("open_ended"),
    num("weight_jump"),
    select("base_lift_override", LIFTS),
    bool("needs_review"),
  ], { readOnly: true, indexes: ["CREATE INDEX idx_items_workout_order ON workout_items (workout, `order`)"] });

  // ---- app data ------------------------------------------------------------
  const sessions = make(app, "sessions", [
    rel("workout", workouts),
    select("track", ["main", "supplemental", "test"]),
    select("status", ["done", "skipped"]),
    date("started_at"),
    date("finished_at"),
    num("bodyweight_lb"),
    text("notes"),
    date("deleted_at"),
  ]);

  make(app, "one_rep_maxes", [
    select("lift", LIFTS, { required: true }),
    num("weight_lb", { required: true, min: 0 }),
    date("date", { required: true }),
    select("source", ["manual", "test"]),
    rel("session", sessions),
    text("note"),
    date("deleted_at"),
  ], { indexes: ["CREATE UNIQUE INDEX idx_orm_lift_date ON one_rep_maxes (lift, date)"] });

  make(app, "set_logs", [
    rel("session", sessions, { required: true, cascadeDelete: true }),
    rel("workout_item", items),
    rel("exercise", exercises, { required: true }),
    int("set_index"),
    num("planned_pct"),
    int("planned_reps"),
    select("side", ["left", "right"]),
    num("weight_lb", { min: 0 }),
    int("actual_reps", { min: 0 }),
    bool("completed"),
    date("deleted_at"),
  ], {
    indexes: [
      "CREATE UNIQUE INDEX idx_set_logs_slot ON set_logs (session, workout_item, set_index, side)",
      "CREATE INDEX idx_set_logs_exercise_created ON set_logs (exercise, created)",
    ],
  });

  make(app, "track_state", [
    rel("program", programs, { required: true }),
    rel("current_workout", workouts),
    int("round", { min: 1 }),
    select("status", ["active", "paused", "archived"]),
  ], { indexes: ["CREATE UNIQUE INDEX idx_track_state_program ON track_state (program)"] });

  const bodyParts = make(app, "body_parts", [
    text("key", { required: true, pattern: "^[a-z0-9_]+$" }),
    text("label", { required: true }),
    bool("has_side"),
    select("unit", ["in", "lb", "%"]),
    int("sort_order"),
    bool("custom"),
  ], { indexes: ["CREATE UNIQUE INDEX idx_body_parts_key ON body_parts (key)"] });

  make(app, "body_measurements", [
    date("date", { required: true }),
    rel("body_part", bodyParts, { required: true }),
    select("side", ["left", "right"]),
    num("value", { required: true }),
    select("unit", ["in", "lb", "%"]),
    text("notes"),
    select("source", ["manual", "csv"]),
    date("deleted_at"),
  ], {
    indexes: [
      "CREATE UNIQUE INDEX idx_measurements_slot ON body_measurements (date, body_part, side)",
      "CREATE INDEX idx_measurements_part_date ON body_measurements (body_part, date)",
    ],
  });

  make(app, "progress_photos", [
    date("date", { required: true }),
    text("pose", { required: true }),
    { type: "file", name: "image", maxSelect: 1, maxSize: 20971520, protected: true,
      mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
    { type: "file", name: "thumbnail", maxSelect: 1, maxSize: 1048576, protected: true,
      mimeTypes: ["image/jpeg", "image/webp"] },
    text("notes"),
    date("deleted_at"),
  ]);

  make(app, "settings", [
    num("bar_weight_lb", { min: 0 }),
    json("fractional_plates"),
    int("test_interval_months", { min: 1 }),
    text("connect_shortcut_name"),
  ]);

  // ---- lock down the users collection: one account, no sign-ups -----------
  const users = app.findCollectionByNameOrId("users");
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.createRule = null;
  users.updateRule = "id = @request.auth.id";
  users.deleteRule = null;
  app.save(users);
}, (app) => {
  const names = [
    "settings", "progress_photos", "body_measurements", "body_parts", "track_state",
    "set_logs", "one_rep_maxes", "sessions", "workout_items", "workouts", "programs", "exercises",
  ];
  for (const n of names) {
    try {
      app.delete(app.findCollectionByNameOrId(n));
    } catch (_) {}
  }
});
