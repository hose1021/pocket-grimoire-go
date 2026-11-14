// Setup screens show a rejection in the UI language: the existing `error.N`
// keys win over the engine's Russian message, and the dynamic per-role codes
// map to a generic key plus the catalog label.
import test from "node:test";
import assert from "node:assert/strict";

import { setUiLang } from "../i18n/strings.ts";
import { commandRejectionText, setupProblemKey, setupProblemText } from "./setup-messages.ts";

test("a rejected setup command renders the localized error.N reason", () => {
  setUiLang("az");
  const result = {
    status: "rejected" as const,
    reason: "Сначала соберите мешок.",
    errorCode: "error.34",
    errors: null,
  };
  assert.equal(commandRejectionText(result), "Əvvəl rolları paylayın.");
});

test("a translated code wins over the engine message", () => {
  setUiLang("en");
  assert.equal(
    setupProblemText({ code: "error.34", message: "Сначала соберите мешок." }),
    "Deal the roles first.",
  );
});

test("a code without a key falls back to the engine message", () => {
  setUiLang("en");
  assert.equal(
    setupProblemText({
      code: "engine.code.without.key",
      message: "Выберите красную селёдку Гадалки.",
    }),
    "Выберите красную селёдку Гадалки.",
  );
});

test("a dynamic information code maps to the generic key and the role label", () => {
  const label = (id: string) => (id === "washerwoman" ? "Washerwoman" : id);
  assert.deepEqual(setupProblemKey("info-washerwoman", { roleLabel: label }), {
    key: "error.info",
    vars: { role: "Washerwoman" },
  });
  assert.deepEqual(setupProblemKey("info-pair-washerwoman", { roleLabel: label }), {
    key: "error.info-pair",
    vars: { role: "Washerwoman" },
  });
  assert.deepEqual(setupProblemKey("info-true-washerwoman", { roleLabel: label }), {
    key: "error.info-true",
    vars: { role: "Washerwoman" },
  });
  assert.deepEqual(setupProblemKey("drunk-info-team", { roleLabel: label }), {
    key: "error.drunk-info-team",
    vars: {},
  });
  assert.deepEqual(setupProblemKey("drunk-info-washerwoman", { roleLabel: label }), {
    key: "error.drunk-info",
    vars: { role: "Washerwoman" },
  });
});

test("a team code carries the localized team and the caller's totals", () => {
  setUiLang("ru");
  assert.deepEqual(setupProblemKey("team-outsider", { vars: { count: 0, required: 1 } }), {
    key: "error.team",
    vars: { team: "Изгои", count: 0, required: 1 },
  });
});

test("an existing error.N code stays direct", () => {
  assert.deepEqual(setupProblemKey("error.47"), { key: "error.47", vars: {} });
});

test("a model-carried role id is rendered as a label", () => {
  assert.deepEqual(
    setupProblemKey("bluffs-team", {
      roleLabel: (id) => (id === "imp" ? "Imp" : id),
      vars: { role: "imp" },
    }),
    { key: "error.bluffs-team", vars: { role: "Imp" } },
  );
});
