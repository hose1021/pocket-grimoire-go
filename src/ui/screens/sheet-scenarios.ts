// The role sheet's Travellers: each edition prints its own five, so the sheet
// shows the Travellers of the selected scenario instead of the TB five on
// every scenario.

export type SheetScenario = "tb" | "bmr" | "snv" | "all";

export const SCENARIO_TRAVELLERS: Record<SheetScenario, readonly string[]> = {
  tb: ["scapegoat", "gunslinger", "beggar", "bureaucrat", "thief"],
  bmr: ["apprentice", "bishop", "judge", "matron", "voudon"],
  snv: ["barista", "bonecollector", "butcher", "deviant", "harlot"],
  all: [
    "scapegoat",
    "gunslinger",
    "beggar",
    "bureaucrat",
    "thief",
    "apprentice",
    "bishop",
    "judge",
    "matron",
    "voudon",
    "barista",
    "bonecollector",
    "butcher",
    "deviant",
    "harlot",
  ],
};

export const ALL_TRAVELLER_IDS: readonly string[] = SCENARIO_TRAVELLERS.all;
