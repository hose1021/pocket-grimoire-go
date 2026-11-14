import { t } from "../ui/i18n/strings.ts";
import { roleById } from "../infrastructure/catalog/role-catalog.ts";
import type { NightStep } from "../core/model/types.ts";

export interface Guide {
  host: string | undefined;
  player: string;
  grimoire: string;
  publicLine: string;
  check: string;
}

// Missing keys fall back to `t()`'s own default, so a role without a dedicated
// guide still shows the generic instruction set instead of a raw key.
function key(id: string | null | undefined, part: string, fallback: string): string {
  const found = t("guide." + id + "." + part);
  return found.startsWith("guide.") ? t(fallback) : found;
}

export function guideFor(step: NightStep): Guide {
  if (step.bmr || step.sv) {
    const fallback = step.sv ? "guide.sv" : "guide.bmr";
    const role = step.roleId ? roleById(step.roleId) : null;
    if (step.kind === "system") {
      const id = step.system || "";
      return {
        host: key(id, "host", fallback + ".host"),
        player: t("guide.player"),
        grimoire: key(id, "grimoire", fallback + ".grimoire"),
        publicLine: t("guide.public"),
        check: key(id, "check", fallback + ".check"),
      };
    }
    if (step.roleId === "lunatic") {
      // The Lunatic believes they are a Demon: run their attack as the Demon
      // in play, then tell the real Demon what the Lunatic chose.
      return {
        host: t("guide.lunatic.host"),
        player: t("guide.player"),
        grimoire: t("guide.lunatic.grimoire"),
        publicLine: t("guide.public"),
        check: t("guide.lunatic.check"),
      };
    }
    return {
      host: role ? role.ability : t(fallback + ".host"),
      player: t("guide.player"),
      grimoire: t(fallback + ".grimoire"),
      publicLine: t("guide.public"),
      check: t(fallback + ".check"),
    };
  }
  const id = step.kind === "system" ? step.system : step.roleId;
  return {
    host: key(id, "host", "guide.generic.host"),
    player: t("guide.player"),
    grimoire: key(id, "grimoire", "guide.generic.grimoire"),
    publicLine: t("guide.public"),
    check: step.kind === "system" ? t("guide.confirm") : key(id, "check", "guide.generic.check"),
  };
}
