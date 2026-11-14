// Setup screens show every rejection in the UI language. The engine carries a
// stable code and a Russian message; a translated key wins over the message.
// The model does not carry interpolation values yet, so the screen supplies the
// ones it can see (counts) and this module derives the role label from the
// per-role information codes.
import { t } from "../i18n/strings.ts";
import { roleLabel } from "../../core/model/rules.ts";
import type { PreviewOutcome } from "../ports.ts";
import { rejectionOf, rejectionText } from "./table/helpers.ts";

export interface SetupProblem {
  code: string;
  message: string;
  /** Values the model itself carries for the placeholders. */
  vars?: Record<string, string | number>;
}

export interface SetupProblemContext {
  /** The catalog label for an information role; `roleLabel` in Russian otherwise. */
  roleLabel?: (id: string) => string;
  /** Values the caller can see, such as the player count or a team total. */
  vars?: Record<string, unknown>;
}

// The engine suffixes the information codes with the role id. The catalog key
// is generic and takes the label, so the UI never falls back to the Russian
// message just because the code is dynamic. Longest prefix first.
const INFO_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["drunk-info-team-", "error.drunk-info-team"],
  ["drunk-info-", "error.drunk-info"],
  ["info-pair-", "error.info-pair"],
  ["info-missing-", "error.info-missing"],
  ["info-team-", "error.info-team"],
  ["info-inplay-", "error.info-inplay"],
  ["info-true-", "error.info-true"],
  ["info-", "error.info"],
];

/** The catalog key and interpolation values for one setup problem code. */
export function setupProblemKey(
  code: string,
  context: SetupProblemContext = {},
): { key: string; vars: Record<string, unknown> } {
  const vars: Record<string, unknown> = { ...context.vars };
  const label = context.roleLabel ?? roleLabel;
  if (typeof vars.role === "string") vars.role = label(vars.role);
  if (code.startsWith("team-")) {
    vars.team = t(code.slice("team-".length));
    return { key: "error.team", vars };
  }
  if (code === "drunk-info-team") return { key: "error.drunk-info-team", vars };
  for (const [prefix, key] of INFO_PREFIXES) {
    if (!code.startsWith(prefix)) continue;
    const roleId = code.slice(prefix.length);
    if (roleId) vars.role = label(roleId);
    return { key, vars };
  }
  return { key: code.startsWith("error.") ? code : "error." + code, vars };
}

/** One setup or bag problem in the UI language, with no unresolved placeholder. */
export function setupProblemText(problem: SetupProblem, context: SetupProblemContext = {}): string {
  const { key, vars } = setupProblemKey(problem.code, {
    ...context,
    vars: { ...problem.vars, ...context.vars },
  });
  const localized = t(key, vars);
  // A missing key or a value the caller could not supply keeps the engine
  // message rather than printing a literal `{placeholder}`.
  return localized === key || /\{\w+\}/.test(localized) ? problem.message : localized;
}

/**
 * The visible reason for a rejected setup command (bag, deal, first night).
 * A catalog entry with a placeholder the caller cannot fill must not render
 * braces: the engine's own sentence wins instead.
 */
export function commandRejectionText(result: PreviewOutcome | null | undefined): string {
  const rejection = rejectionOf(result);
  if (!rejection) return "";
  const localized = rejectionText(rejection, t);
  if (!/\{\w+\}/.test(localized)) return localized;
  const message = rejection.text || "";
  if (message && !/\{\w+\}/.test(message)) return message;
  return message.replace(/\s*\{\w+\}/g, "").trim();
}
