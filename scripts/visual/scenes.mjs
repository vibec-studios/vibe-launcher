export const VARIANTS = {
  "v1-dark": {},
  "v2-light": { "vl.mock.design": "v2", "vl.mock.theme": "light" },
  pixel: { "vl.mock.theme": "pixel" },
};

const INSTANCE = "survival";
const SERVER = "survival-smp";
const INSTANCE_TABS = ["content", "resourcepacks", "shaders", "worlds", "servers", "backups", "logs", "files", "settings"];
const SERVER_TABS = ["console", "settings", "players", "addons", "worlds", "files", "connection"];
const SETTINGS_TABS = ["general", "appearance", "java", "game", "downloads", "storage", "vibe", "privacy", "updates", "about"];

const PAGES = {
  home: "#/",
  instances: "#/instances",
  discover: "#/discover",
  modsets: "#/modsets",
  accounts: "#/accounts",
  skins: "#/skins",
  stats: "#/stats",
  screenshots: "#/screenshots",
  servers: "#/servers",
  social: "#/social",
};

const DIALOGS = [
  {
    name: "dialog-new-instance",
    path: "#/",
    act: async (ui) => {
      await ui.click(ui.button("Neue Instanz"));
      await ui.dialog();
    },
  },
  {
    name: "dialog-import",
    path: "#/",
    act: async (ui) => {
      await ui.click(ui.button("Importieren"));
      await ui.dialog();
    },
  },
  {
    name: "dialog-install",
    path: "#/discover",
    act: async (ui) => {
      await ui.click(ui.button("Installieren"));
      await ui.click(ui.button("Version und Instanz wählen …"));
      await ui.dialog();
    },
  },
  {
    name: "dialog-skin-editor",
    path: "#/skins",
    act: async (ui) => {
      await ui.click(ui.button("Skin-Editor"));
      await ui.dialog();
    },
  },
  {
    name: "dialog-remote-add",
    path: "#/servers",
    act: async (ui) => {
      await ui.click(ui.page.getByTitle("Server auf einem anderen PC oder Server steuern").first());
      await ui.dialog();
    },
  },
  {
    name: "dialog-afk-start",
    path: "#/instances/vanilla",
    flags: { "vl.mock.afk": "" },
    act: async (ui) => {
      await ui.click(ui.page.getByTestId("afk-split").first());
      await ui.click(ui.menuItem("Im Hintergrund starten (AFK)"));
      await ui.dialog();
    },
  },
];

export function scenes() {
  const list = Object.entries(PAGES).map(([name, path]) => ({ name: `page-${name}`, path }));
  for (const tab of INSTANCE_TABS) list.push({ name: `instance-${tab}`, path: `#/instances/${INSTANCE}?tab=${tab}` });
  for (const tab of SERVER_TABS) list.push({ name: `server-${tab}`, path: `#/servers/${SERVER}?tab=${tab}` });
  for (const tab of SETTINGS_TABS) list.push({ name: `settings-${tab}`, path: `#/settings?tab=${tab}`, act: (ui) => ui.dialog() });
  list.push(...DIALOGS);
  list.push({ name: "console", file: "console.html", flags: { "vl.mock.sessions": INSTANCE } });
  return list;
}
