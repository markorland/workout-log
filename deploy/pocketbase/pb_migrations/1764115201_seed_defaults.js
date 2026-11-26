/// <reference path="../pb_data/types.d.ts" />
// Seeds non-personal defaults: body-tracking sites and the settings row.
// Personal data (1RMs, templates) is loaded by importer/upload.py instead.

const BODY_PARTS = [
  // key, label, has_side, unit
  ["neck", "Neck", false, "in"],
  ["shoulders", "Shoulders", false, "in"],
  ["chest", "Chest", false, "in"],
  ["arm", "Arm", true, "in"],
  ["forearm", "Forearm", true, "in"],
  ["waist", "Waist", false, "in"],
  ["hips", "Hips", false, "in"],
  ["thigh", "Thigh", true, "in"],
  ["calf", "Calf", true, "in"],
  ["bodyweight", "Bodyweight", false, "lb"],
  ["body_fat", "Body fat", false, "%"],
];

migrate((app) => {
  const parts = app.findCollectionByNameOrId("body_parts");
  BODY_PARTS.forEach((p, i) => {
    const r = new Record(parts);
    r.set("id", "bp-" + p[0].replace(/_/g, "-"));
    r.set("key", p[0]);
    r.set("label", p[1]);
    r.set("has_side", p[2]);
    r.set("unit", p[3]);
    r.set("sort_order", (i + 1) * 10);
    r.set("custom", false);
    app.save(r);
  });

  const settings = app.findCollectionByNameOrId("settings");
  const s = new Record(settings);
  s.set("id", "settings");
  s.set("bar_weight_lb", 45);
  s.set("fractional_plates", { "1": 2, "0.75": 2, "0.5": 2, "0.25": 2 });
  s.set("test_interval_months", 3);
  s.set("connect_shortcut_name", "Connect Tailscale");
  app.save(s);
}, (app) => {
  for (const [coll, ids] of [
    ["settings", ["settings"]],
    ["body_parts", BODY_PARTS.map((p) => "bp-" + p[0].replace(/_/g, "-"))],
  ]) {
    for (const id of ids) {
      try {
        app.delete(app.findRecordById(coll, id));
      } catch (_) {}
    }
  }
});
