// @effect-diagnostics nodeBuiltinImport:off - Standalone frontend launcher owns no T3 server or database.
// @effect-diagnostics globalFetch:off - Checks the existing loopback server before Vite startup.
// @effect-diagnostics globalConsole:off - Prints developer startup details outside an Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { createServer } from "vite-plus";
import {
  DEV_PROXIED_PATH_PREFIXES,
  DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES,
} from "@t3tools/shared/devProxy";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const directory = NodePath.join(root, ".workspace-client");
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const explicitServer = argument("--server");
const runtime = explicitServer
  ? null
  : (JSON.parse(
      await NodeFSP.readFile(
        NodePath.join(NodeOS.homedir(), ".t3/userdata/server-runtime.json"),
        "utf8",
      ),
    ) as {
      port: number;
    });
const target = new URL(explicitServer ?? `http://127.0.0.1:${runtime!.port}`);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
  throw new Error("Workspace development attaches only to a local T3 server.");
const descriptorResponse = await fetch(new URL("/.well-known/t3/environment", target));
if (!descriptorResponse.ok)
  throw new Error("Native T3 is not reachable. Start it normally, then reopen T3 Workspace.");
const descriptor = (await descriptorResponse.json()) as {
  serverVersion: string;
  environmentId: string;
};
const supportedVersion = "0.1.10-nightly.20261113.4643";
if (descriptor.serverVersion !== supportedVersion)
  throw new Error(
    `Native T3 is ${descriptor.serverVersion}; this fork is verified against ${supportedVersion}. Check client compatibility before continuing.`,
  );
const port = Number(argument("--port") ?? "5760");
await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
  T3CODE_SINGLE_ORIGIN_DEV: "1",
  T3CODE_PORT: target.port,
  T3_WORKSPACE_CACHE_DIR: NodePath.join(directory, "summaries"),
  APP_VERSION: supportedVersion,
  PORT: String(port),
  HOST: "127.0.0.1",
});
const server = await createServer({
  root: NodePath.join(root, "apps/web"),
  configFile: NodePath.join(root, "apps/web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: Object.fromEntries(
      DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
        prefix,
        {
          target: target.origin,
          changeOrigin: !DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES.has(prefix),
          ...(prefix === "/api" || prefix === "/ws" ? { ws: true } : {}),
        },
      ]),
    ),
  },
});
await server.listen();
const url = `http://127.0.0.1:${port}/pull-requests?view=work`;
await NodeFSP.writeFile(
  NodePath.join(directory, "runtime.json"),
  JSON.stringify({
    pid: process.pid,
    url,
    backend: target.origin,
    environmentId: descriptor.environmentId,
    serverVersion: descriptor.serverVersion,
  }),
);
console.log(
  `T3 Workspace: ${url}\nShared server: ${target.origin}\nUI changes hot reload. Native T3 is not managed by this launcher.`,
);
process.send?.({ type: "workspace-ready", directory: NodePath.join(directory, "summaries") });

let desktop: ReturnType<typeof NodeChildProcess.spawn> | undefined;
if (!process.argv.includes("--web")) {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone frontend launcher has no Effect runtime.
  if (NodeOS.platform() !== "darwin")
    throw new Error(
      "The packaged workspace client currently targets macOS. Use --web on this platform.",
    );
  const require = NodeModule.createRequire(NodePath.join(root, "apps/desktop/package.json"));
  const electronDirectory = NodePath.dirname(require.resolve("electron/package.json"));
  const electronApp = NodePath.join(electronDirectory, "dist/Electron.app");
  if (!NodeFS.existsSync(electronApp))
    NodeChildProcess.execFileSync(
      process.execPath,
      [NodePath.join(root, "apps/desktop/scripts/ensure-electron-runtime.mjs")],
      { cwd: root, stdio: "inherit" },
    );
  const bundle = NodePath.join(directory, "T3 Workspace.app");
  if (!NodeFS.existsSync(bundle)) {
    await NodeFSP.cp(electronApp, bundle, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    const executable = NodePath.join(bundle, "Contents/MacOS/Electron");
    await NodeFSP.rename(executable, NodePath.join(bundle, "Contents/MacOS/T3 Workspace"));
    for (const [key, value] of Object.entries({
      CFBundleExecutable: "T3 Workspace",
      CFBundleName: "T3 Workspace",
      CFBundleDisplayName: "T3 Workspace",
      CFBundleIdentifier: "com.cole.t3.workspace",
    }))
      NodeChildProcess.execFileSync("plutil", [
        "-replace",
        key,
        "-string",
        value,
        NodePath.join(bundle, "Contents/Info.plist"),
      ]);
    NodeChildProcess.execFileSync("plutil", [
      "-remove",
      "ElectronAsarIntegrity",
      NodePath.join(bundle, "Contents/Info.plist"),
    ]);
  }
  const resources = NodePath.join(bundle, "Contents/Resources");
  const appSource = NodePath.join(directory, "desktop-source");
  await NodeFSP.mkdir(appSource, { recursive: true });
  await NodeFSP.cp(
    NodePath.join(root, "scripts/workspace-client-shell.cjs"),
    NodePath.join(appSource, "main.cjs"),
  );
  await NodeFSP.writeFile(
    NodePath.join(appSource, "package.json"),
    JSON.stringify({ name: "t3-workspace", version: "0.1.0", main: "main.cjs" }),
  );
  const asar = await import("@electron/asar");
  await asar.createPackage(appSource, NodePath.join(resources, "app.asar"));
  await NodeFSP.writeFile(
    NodePath.join(resources, "workspace-client.json"),
    JSON.stringify({
      directory,
      url,
      profile: NodePath.join(directory, "browser-profile"),
      root,
      node: process.execPath,
      launcher: NodePath.join(root, "scripts/workspace-client.ts"),
      backend: target.origin,
      port,
      path: process.env.PATH,
      cacheDirectory: NodePath.join(directory, "summaries"),
    }),
  );
  NodeChildProcess.execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], {
    stdio: "ignore",
  });
  const desktopEnvironment = { ...process.env };
  delete desktopEnvironment.ELECTRON_RUN_AS_NODE;
  desktop = NodeChildProcess.spawn(NodePath.join(bundle, "Contents/MacOS/T3 Workspace"), [], {
    env: desktopEnvironment,
    stdio: "inherit",
  });
}

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  desktop?.kill("SIGTERM");
  await server.close();
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
