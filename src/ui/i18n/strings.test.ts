import test from "node:test";
import assert from "node:assert/strict";
import { missingTranslations, translationProblems, setUiLang, t } from "./strings.ts";

test("English, Russian and Azerbaijani have matching translation keys and parameters", () => {
  assert.deepEqual(translationProblems(), []);
  assert.deepEqual(missingTranslations(), { en: [], ru: [], az: [] });
  for (const lang of ["en", "ru", "az"]) {
    setUiLang(lang);
    assert.match(t("voteMinimum", { count: 3, living: 6 }), /3/);
    assert.doesNotMatch(t("voteMinimum", { count: 3, living: 6 }), /\{/);
  }
});

// The storyteller step contract (issue #45) adds screens and consequences, so
// every one of its keys must reach all three catalogs with the same placeholders.
const STEP_KEYS = [
  "ui.stepWakes",
  "ui.stepAllowed",
  "ui.activeEffects",
  "ui.noActiveEffects",
  "ui.chosenTargets",
  "ui.consequences",
  "ui.previewEmpty",
  "ui.blockedTitle",
  "ui.blockSecrets",
  "ui.blockTargets",
  "ui.blockGiven",
  "ui.blockRedirect",
  "ui.consequence.target",
  "ui.consequence.applied",
  "ui.consequence.death",
  "ui.consequence.scheduled",
  "ui.consequence.prevented",
  "ui.consequence.revived",
  "ui.rejectedTitle",
  "ui.dismiss",
  "ui.resetStep",
  "ui.effect.poison",
  "ui.effect.protected",
  "ui.effect.drunk",
  "ui.effect.butler",
  "ui.effect.devilsadvocate",
  "ui.effect.pukka-death",
];

test("storyteller step guidance is semantically translated in ru, en and az", () => {
  const missing = missingTranslations();
  for (const lang of ["en", "ru", "az"]) {
    assert.deepEqual(
      missing[lang].filter((key) => STEP_KEYS.includes(key)),
      [],
      `${lang} is missing a storyteller step key`,
    );
  }
  const problems = translationProblems().filter((problem) =>
    STEP_KEYS.some((key) => problem.endsWith(":" + key)),
  );
  assert.deepEqual(problems, []);
  const vars = { name: "A", names: "A, B", count: 2 };
  for (const lang of ["en", "ru", "az"]) {
    setUiLang(lang);
    for (const key of STEP_KEYS) {
      const text = t(key, vars);
      assert.ok(text && text !== key, `${lang}:${key} is translated`);
      assert.doesNotMatch(text, /\{\w+\}/, `${lang}:${key} leaves a placeholder`);
    }
  }
  setUiLang("ru");
});

const NOTE_KEYS = [
  "note.bmr.sailor",
  "note.bmr.courtier",
  "note.bmr.devilAdvocateFirst",
  "note.bmr.devilAdvocateOther",
  "note.bmr.pukka",
  "note.bmr.grandmotherDeath",
  "note.bmr.innkeeper",
  "note.bmr.gambler",
  "note.bmr.lunatic",
  "note.bmr.exorcist",
  "note.bmr.zombuul",
  "note.bmr.shabaloth",
  "note.bmr.po",
  "note.bmr.assassin",
  "note.bmr.godfather",
  "note.bmr.gossip",
  "note.bmr.professor",
  "note.bmr.tinker",
  "note.bmr.moonchild",
  "note.abilityFailed",
  "note.pukkaSuspended",
  "note.exorcistBlocked",
  "note.characterChanged",
  "note.abilityUnused",
  "note.philosopherOwner",
  "note.philosopherAbility",
  "note.characterBecame",
  "note.characterSwapPoisoned",
  "note.characterSwap",
  "note.klutzNotEvil",
  "note.klutzEvil",
  "note.madness",
  "note.actorDied",
  "note.poisoned",
  "note.protected",
  "note.butlerMaster",
  "note.impKilled",
  "note.finished",
  "note.skipped",
  "note.skippedNone",
  "note.demonChanged",
  "note.roleChangedDemon",
  "ui.noNomination",
  "ui.zombuulExecution",
  "ui.tinkerDecision",
  "ui.tinkerHint",
  "ui.tinkerDies",
  "ui.tinkerLives",
  "ui.drunkMaskHint",
  "winReason.demon-executed",
  "backToTableConfirm",
];

test("engine notes and the new console copy are translated in ru, en and az", () => {
  const missing = missingTranslations();
  for (const lang of ["en", "ru", "az"]) {
    assert.deepEqual(
      missing[lang].filter((key) => NOTE_KEYS.includes(key)),
      [],
      `${lang} is missing an engine note key`,
    );
  }
  const problems = translationProblems().filter((problem) =>
    NOTE_KEYS.some((key) => problem.endsWith(":" + key)),
  );
  assert.deepEqual(problems, []);
  const vars = {
    name: "A",
    names: "A, B",
    role: "R",
    owner: "O",
    actor: "A",
    target: "T",
    first: "F",
    second: "S",
    reason: "R",
  };
  for (const lang of ["en", "ru", "az"]) {
    setUiLang(lang);
    for (const key of NOTE_KEYS) {
      const text = t(key, vars);
      assert.ok(text && text !== key, `${lang}:${key} is translated`);
      assert.doesNotMatch(text, /\{\w+\}/, `${lang}:${key} leaves a placeholder`);
    }
  }
  setUiLang("ru");
});

const TABLE_LABEL_KEYS = [
  "execute",
  "threshold",
  "dead",
  "deadCount",
  "deaths",
  "dayWithoutExecution",
  "ui.activeSeat",
];

test("table action labels are translated in ru, en and az", () => {
  for (const lang of ["en", "ru", "az"]) {
    setUiLang(lang);
    for (const key of TABLE_LABEL_KEYS) {
      const text = t(key);
      assert.ok(text && text !== key, `${lang}:${key} is translated`);
    }
  }
  setUiLang("ru");
});

const MADNESS_KEYS = [
  "ui.madnessReviewTitle",
  "ui.madnessReviewHint",
  "ui.madnessCerenovus",
  "ui.madnessMutant",
  "ui.madnessPending",
  "ui.madnessTransitionBlock",
  "ui.madnessReviewedExecute",
  "ui.madnessReviewedNone",
  "ui.madnessReason",
  "ui.madnessExecute",
  "ui.madnessNone",
];

test("madness review guidance is translated in ru, en and az", () => {
  const missing = missingTranslations();
  for (const lang of ["en", "ru", "az"]) {
    assert.deepEqual(
      missing[lang].filter((key) => MADNESS_KEYS.includes(key)),
      [],
    );
  }
  assert.deepEqual(
    translationProblems().filter((problem) =>
      MADNESS_KEYS.some((key) => problem.endsWith(":" + key)),
    ),
    [],
  );
  for (const lang of ["en", "ru", "az"]) {
    setUiLang(lang);
    for (const key of MADNESS_KEYS) {
      const text = t(key, { name: "A", role: "Clockmaker" });
      assert.ok(text && text !== key, `${lang}:${key} is translated`);
      assert.doesNotMatch(text, /\{\w+\}/, `${lang}:${key} leaves no placeholder`);
    }
  }
  setUiLang("ru");
});

// `guideFor` composes these keys for every step card; the five row labels are
// the ones the card renders around them.
const GUIDE_KEYS = [
  "guidedInstructions",
  "hostAction",
  "playerAction",
  "grimoireNote",
  "publicLine",
  "check",
  "guide.generic.host",
  "guide.generic.grimoire",
  "guide.generic.check",
  "guide.player",
  "guide.public",
  "guide.confirm",
  "guide.bmr.host",
  "guide.bmr.grimoire",
  "guide.bmr.check",
  "guide.sv.host",
  "guide.sv.grimoire",
  "guide.sv.check",
];

test("storyteller guidance rows stay semantically equal in ru, en and az", () => {
  const missing = missingTranslations();
  const problems = translationProblems();
  for (const lang of ["en", "ru", "az"]) {
    assert.deepEqual(
      missing[lang].filter((key) => GUIDE_KEYS.includes(key)),
      [],
      `${lang} is missing a guidance key`,
    );
    for (const key of GUIDE_KEYS) {
      setUiLang(lang);
      const text = t(key);
      assert.ok(text && text !== key, `${lang}:${key} is translated`);
    }
  }
  assert.deepEqual(
    problems.filter((problem) => GUIDE_KEYS.some((key) => problem.endsWith(":" + key))),
    [],
  );
  setUiLang("ru");
});
