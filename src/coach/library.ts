/**
 * A small exercise library: common gym exercises by muscle group, for name
 * suggestions in the day editor and for the coach's "Suggest exercises".
 * Pure; written by hand (no external data). Compact on purpose: one string
 * per group, entries "Name:e" where e is an equipment code.
 */

export type MuscleGroup =
  | "Chest"
  | "Back"
  | "Shoulders"
  | "Biceps"
  | "Triceps"
  | "Legs"
  | "Glutes"
  | "Hamstrings"
  | "Calves"
  | "Core"
  | "Full body"
  | "Cardio";

export interface LibraryExercise {
  name: string;
  group: MuscleGroup;
  equipment: "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "band" | "other";
}

export const MUSCLE_GROUPS: MuscleGroup[] = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Legs",
  "Glutes",
  "Hamstrings",
  "Calves",
  "Core",
  "Full body",
  "Cardio",
];

const EQUIPMENT: Record<string, LibraryExercise["equipment"]> = {
  b: "barbell",
  d: "dumbbell",
  m: "machine",
  c: "cable",
  w: "bodyweight",
  k: "kettlebell",
  r: "band",
  o: "other",
};

const RAW: Record<MuscleGroup, string> = {
  Chest:
    "Bench press:b;Incline bench press:b;Decline bench press:b;Dumbbell bench press:d;Incline dumbbell press:d;" +
    "Dumbbell fly:d;Incline dumbbell fly:d;Cable crossover:c;Low-to-high cable fly:c;Pec deck:m;" +
    "Chest press machine:m;Smith machine bench press:m;Push-up:w;Incline push-up:w;Chest dip:w",
  Back:
    "Deadlift:b;Barbell row:b;Pendlay row:b;T-bar row:b;Dumbbell row:d;Chest-supported dumbbell row:d;" +
    "Lat pulldown:c;Close-grip lat pulldown:c;Straight-arm pulldown:c;Seated cable row:c;Single-arm cable row:c;" +
    "Pull-up:w;Chin-up:w;Assisted pull-up:m;Inverted row:w;Machine row:m;Rack pull:b;Back extension:w;" +
    "Barbell shrug:b;Dumbbell shrug:d",
  Shoulders:
    "Overhead press:b;Seated dumbbell press:d;Arnold press:d;Push press:b;Machine shoulder press:m;Landmine press:b;" +
    "Lateral raise:d;Cable lateral raise:c;Machine lateral raise:m;Front raise:d;Rear delt fly:d;Reverse pec deck:m;" +
    "Face pull:c;Upright row:b;Band pull-apart:r;Pike push-up:w",
  Biceps:
    "Dumbbell curl:d;Barbell curl:b;EZ-bar curl:b;Hammer curl:d;Incline dumbbell curl:d;Preacher curl:b;" +
    "Machine preacher curl:m;Cable curl:c;Concentration curl:d;Bayesian cable curl:c;Reverse curl:b;Band curl:r",
  Triceps:
    "Triceps pushdown:c;Rope pushdown:c;Overhead cable extension:c;Skull crusher:b;Dumbbell overhead extension:d;" +
    "Close-grip bench press:b;Triceps dip:w;Bench dip:w;Dumbbell kickback:d;Diamond push-up:w;Machine triceps extension:m",
  Legs:
    "Back squat:b;Front squat:b;Goblet squat:d;Hack squat:m;Leg press:m;Leg extension:m;Bulgarian split squat:d;" +
    "Walking lunge:d;Reverse lunge:d;Step-up:d;Split squat:d;Smith machine squat:m;Pendulum squat:m;Box squat:b;" +
    "Pause squat:b;Lateral lunge:d;Belt squat:m;Sissy squat:w;Bodyweight squat:w;Wall sit:w",
  Glutes:
    "Hip thrust:b;Dumbbell hip thrust:d;Machine hip thrust:m;Glute bridge:w;Single-leg glute bridge:w;" +
    "Cable kickback:c;Glute kickback machine:m;Hip abduction machine:m;Banded lateral walk:r;Frog pump:w;" +
    "Cable pull-through:c;Sumo deadlift:b;Curtsy lunge:d;B-stance hip thrust:b;Fire hydrant:w",
  Hamstrings:
    "Romanian deadlift:b;Dumbbell Romanian deadlift:d;Single-leg Romanian deadlift:d;Stiff-leg deadlift:b;" +
    "Good morning:b;Lying leg curl:m;Seated leg curl:m;Nordic curl:w;Stability ball leg curl:o;Glute-ham raise:m;" +
    "Kettlebell Romanian deadlift:k",
  Calves:
    "Standing calf raise:m;Seated calf raise:m;Leg press calf raise:m;Single-leg calf raise:w;Smith machine calf raise:m;" +
    "Dumbbell calf raise:d",
  Core:
    "Plank:w;Side plank:w;Dead bug:w;Hanging leg raise:w;Hanging knee raise:w;Cable crunch:c;Ab wheel rollout:o;" +
    "Russian twist:w;Bicycle crunch:w;Crunch:w;Pallof press:c;Cable woodchop:c;Bird dog:w;Hollow hold:w;" +
    "Mountain climber:w;Decline sit-up:w;Reverse crunch:w;Captain's chair leg raise:m;Suitcase carry:d",
  "Full body":
    "Kettlebell swing:k;Power clean:b;Hang clean:b;Thruster:b;Dumbbell thruster:d;Burpee:w;Farmer's carry:d;" +
    "Turkish get-up:k;Dumbbell snatch:d;Clean and press:b;Trap bar deadlift:b;Sled push:o;Wall ball:o;Battle ropes:o",
  Cardio:
    "Treadmill run:m;Incline treadmill walk:m;Stationary bike:m;Assault bike:m;Rowing machine:m;Elliptical:m;" +
    "Stair climber:m;Ski erg:m;Jump rope:o;Box jump:w;Jumping jacks:w;Outdoor run:o;Swimming:o",
};

export const EXERCISES: LibraryExercise[] = MUSCLE_GROUPS.flatMap((group) =>
  RAW[group].split(";").map((entry) => {
    const i = entry.lastIndexOf(":");
    return { name: entry.slice(0, i), group, equipment: EQUIPMENT[entry.slice(i + 1)] ?? "other" };
  }),
);

/** Lowercase, strip diacritics, punctuation → spaces, collapse whitespace. */
export function normalizeQuery(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Common abbreviations and other names → library name. */
const ALIASES: Record<string, string> = {
  rdl: "Romanian deadlift",
  sldl: "Stiff-leg deadlift",
  ohp: "Overhead press",
  "military press": "Overhead press",
  "shoulder press": "Overhead press",
  bss: "Bulgarian split squat",
  squat: "Back squat",
  "bench": "Bench press",
  "flat bench": "Bench press",
  "chest fly": "Dumbbell fly",
  "pec fly": "Pec deck",
  "leg curl": "Lying leg curl",
  "calf raise": "Standing calf raise",
  "lat raise": "Lateral raise",
  "side raise": "Lateral raise",
  "skullcrusher": "Skull crusher",
  "glute kickback": "Cable kickback",
  "abductor": "Hip abduction machine",
  "abduction": "Hip abduction machine",
  "rope pushdown": "Rope pushdown",
  "rower": "Rowing machine",
  "row machine": "Rowing machine",
  "bike": "Stationary bike",
  "farmers walk": "Farmer's carry",
  "pullup": "Pull-up",
  "chinup": "Chin-up",
  "pushup": "Push-up",
};

/** Token shorthands expanded inside a query ("db row" → "dumbbell row"). */
const TOKENS: Record<string, string> = { db: "dumbbell", bb: "barbell", kb: "kettlebell", ez: "ez bar" };

interface Indexed {
  ex: LibraryExercise;
  norm: string;
  compact: string;
  words: string[];
}

const INDEX: Indexed[] = EXERCISES.map((ex) => {
  const norm = normalizeQuery(ex.name);
  return { ex, norm, compact: norm.replace(/ /g, ""), words: norm.split(" ") };
});

const BY_NAME = new Map<string, Indexed>(INDEX.map((x) => [x.norm, x]));
const ALIAS_INDEX = new Map<string, Indexed>();
for (const [alias, name] of Object.entries(ALIASES)) {
  const hit = BY_NAME.get(normalizeQuery(name));
  if (hit) ALIAS_INDEX.set(normalizeQuery(alias), hit);
}

function score(x: Indexed, q: string, qTokens: string[], qCompact: string): number {
  if (x.norm === q) return 0;
  if (x.norm.startsWith(q)) return 1;
  if (x.norm.includes(" " + q)) return 2;
  if (qTokens.every((t) => x.words.some((w) => w.startsWith(t)))) return 3;
  if (x.norm.includes(q) || (qCompact.length >= 3 && x.compact.includes(qCompact))) return 4;
  return -1;
}

/**
 * Case- and diacritic-insensitive search. Ranking: exact or alias match,
 * then name prefix, then word prefix, then substring; ties by shorter name,
 * then library order. Empty query → [].
 */
export function searchExercises(query: string, limit = 8): LibraryExercise[] {
  const raw = normalizeQuery(query ?? "");
  if (!raw) return [];
  const q = raw
    .split(" ")
    .map((t) => TOKENS[t] ?? t)
    .join(" ");
  const qTokens = q.split(" ");
  const qCompact = q.replace(/ /g, "");
  const ranked: { x: Indexed; s: number; i: number }[] = [];
  const alias = ALIAS_INDEX.get(raw) ?? ALIAS_INDEX.get(q) ?? ALIAS_INDEX.get(qCompact);
  INDEX.forEach((x, i) => {
    const s = x === alias ? 0 : score(x, q, qTokens, qCompact);
    if (s >= 0) ranked.push({ x, s, i });
  });
  ranked.sort((a, b) => a.s - b.s || a.x.norm.length - b.x.norm.length || a.i - b.i);
  return ranked.slice(0, Math.max(0, limit)).map((r) => r.x.ex);
}

/** The muscle group of a library exercise (or alias), by normalized name; null if unknown. */
export function groupOf(name: string): MuscleGroup | null {
  const n = normalizeQuery(name ?? "");
  if (!n) return null;
  return (BY_NAME.get(n) ?? ALIAS_INDEX.get(n) ?? ALIAS_INDEX.get(n.replace(/ /g, "")))?.ex.group ?? null;
}

/** Library names of one group (for the coach prompt). */
export function exercisesIn(group: MuscleGroup): LibraryExercise[] {
  return EXERCISES.filter((e) => e.group === group);
}
