export const OBSTACLE_CATALOG = [
  {
    type: "water_tank",
    label: "Water Tank",
    promptDescription: "cylindrical or rectangular roof water tank, including its base",
    color: "#ef4444",
    defaultShadowBufferM: 2,
  },
  {
    type: "ac_unit",
    label: "AC Unit",
    promptDescription: "outdoor air-conditioning condenser or mechanical unit",
    color: "#f97316",
    defaultShadowBufferM: 1,
  },
  {
    type: "vent_pipe",
    label: "Vent Pipe",
    promptDescription: "small pipe, plumbing vent, exhaust vent, or roof penetration",
    color: "#eab308",
    defaultShadowBufferM: 1,
  },
  {
    type: "chimney",
    label: "Chimney / Flue",
    promptDescription: "chimney, flue, tall exhaust stack, or raised roof vent",
    color: "#a855f7",
    defaultShadowBufferM: 2,
  },
  {
    type: "skylight",
    label: "Skylight",
    promptDescription: "glass skylight, translucent roof window, or daylight panel",
    color: "#3b82f6",
    defaultShadowBufferM: 0,
  },
  {
    type: "antenna",
    label: "Antenna",
    promptDescription: "TV antenna, radio antenna, or mast mounted on the roof",
    color: "#ec4899",
    defaultShadowBufferM: 1,
  },
  {
    type: "satellite_dish",
    label: "Satellite Dish",
    promptDescription: "round satellite dish or similar communications dish",
    color: "#d946ef",
    defaultShadowBufferM: 1,
  },
  {
    type: "parapet",
    label: "Parapet Wall",
    promptDescription: "parapet wall, raised roof edge, guard wall, or high curb",
    color: "#06b6d4",
    defaultShadowBufferM: 0,
  },
  {
    type: "roof_hatch",
    label: "Roof Hatch",
    promptDescription: "roof access hatch, service door, or access cover",
    color: "#14b8a6",
    defaultShadowBufferM: 1,
  },
  {
    type: "existing_solar_panel",
    label: "Existing Solar Panel",
    promptDescription: "existing PV module, solar thermal panel, or solar collector",
    color: "#2563eb",
    defaultShadowBufferM: 0,
  },
  {
    type: "cable_tray",
    label: "Cable Tray",
    promptDescription: "cable tray, conduit run, wire raceway, or service pipe bundle",
    color: "#64748b",
    defaultShadowBufferM: 0,
  },
  {
    type: "tree_shade",
    label: "Tree / Shade",
    promptDescription: "overhanging tree canopy or persistent shadow that blocks panel placement",
    color: "#16a34a",
    defaultShadowBufferM: 2,
  },
  {
    type: "other",
    label: "Other",
    promptDescription: "other fixed rooftop obstruction relevant to solar placement",
    color: "#6b7280",
    defaultShadowBufferM: 1,
  },
] as const;

export type ObstacleType = (typeof OBSTACLE_CATALOG)[number]["type"];

export const OBSTACLE_TYPES = OBSTACLE_CATALOG.map((item) => item.type);

export const OBSTACLE_BY_TYPE = Object.fromEntries(
  OBSTACLE_CATALOG.map((item) => [item.type, item])
) as Record<ObstacleType, (typeof OBSTACLE_CATALOG)[number]>;

const OBSTACLE_ALIASES: Record<string, ObstacleType> = {
  vent: "vent_pipe",
  pipe: "vent_pipe",
  exhaust_vent: "vent_pipe",
  flue: "chimney",
  chimney_flue: "chimney",
  satellite: "satellite_dish",
  dish: "satellite_dish",
  roof_access: "roof_hatch",
  access_hatch: "roof_hatch",
  solar_panel: "existing_solar_panel",
  pv_panel: "existing_solar_panel",
  conduit: "cable_tray",
  cable: "cable_tray",
  tree: "tree_shade",
  overhanging_tree: "tree_shade",
  shade: "tree_shade",
};

export function normalizeObstacleType(type: unknown): ObstacleType {
  if (typeof type !== "string") return "other";
  const key = type.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key in OBSTACLE_BY_TYPE) return key as ObstacleType;
  return OBSTACLE_ALIASES[key] ?? "other";
}

export function getObstacleDefinition(type: unknown) {
  return OBSTACLE_BY_TYPE[normalizeObstacleType(type)];
}

export function obstaclePromptList(): string {
  return OBSTACLE_CATALOG
    .map((item) => `- ${item.type}: ${item.promptDescription}`)
    .join("\n");
}
