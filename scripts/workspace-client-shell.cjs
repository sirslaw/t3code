const { app, BrowserWindow, Menu, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const config = JSON.parse(
  fs.readFileSync(path.join(process.resourcesPath, "workspace-client.json"), "utf8"),
);
app.setName("T3 Workspace");
app.setPath("userData", config.profile);
const origin = new URL(config.url).origin;

async function ensureFrontend() {
  try {
    const response = await fetch(`${origin}/__workspace/client`, {
      signal: AbortSignal.timeout(1500),
    });
    const identity = await response.json();
    if (identity.directory === config.cacheDirectory) return;
  } catch {
    /* Start only this fork's frontend when its existing listener is unavailable. */
  }
  await new Promise((resolve, reject) => {
    const log = fs.openSync(path.join(config.directory, "frontend.log"), "a");
    const child = spawn(
      config.node,
      [config.launcher, "--web", "--server", config.backend, "--port", String(config.port)],
      {
        cwd: config.root,
        env: { ...process.env, PATH: config.path },
        stdio: ["ignore", log, log, "ipc"],
      },
    );
    fs.closeSync(log);
    let ready = false;
    child.once("message", (message) => {
      if (message.type === "workspace-ready" && message.directory === config.cacheDirectory) {
        ready = true;
        resolve();
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!ready)
        reject(
          new Error(
            `The workspace frontend stopped (${code}). See frontend.log in the fork's .workspace-client folder.`,
          ),
        );
    });
  });
}

app
  .whenReady()
  .then(async () => {
    await ensureFrontend();
    fs.writeFileSync(
      path.join(config.directory, "desktop-runtime.json"),
      JSON.stringify({
        pid: process.pid,
        packaged: app.isPackaged,
        url: config.url.split("#")[0],
        profile: config.profile,
        startedAt: new Date().toISOString(),
      }),
    );
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: "T3 Workspace", submenu: [{ role: "quit" }] },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "toggleDevTools" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
          ],
        },
        { role: "windowMenu" },
      ]),
    );
    const window = new BrowserWindow({
      width: 1440,
      height: 940,
      title: "T3 Workspace",
      backgroundColor: "#18181b",
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (new URL(url).origin === origin)
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
          },
        };
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    await window.loadURL(config.url);
  })
  .catch((error) => {
    require("electron").dialog.showErrorBox("Could not open T3 Workspace", error.message);
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
