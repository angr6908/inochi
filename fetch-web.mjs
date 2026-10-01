import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = "https://gitlab.com/api/v4/projects/angr6908%2Finochi/packages/generic/inochi-web";
const WEB_DIR = "/data/web";
const CURRENT = join(WEB_DIR, "current");
const RESTART = join(WEB_DIR, "restart");
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;

async function download(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (error) {
    throw new Error(`Could not reach GitLab (${error.cause?.code ?? error.message})`);
  }
  if (!res.ok) throw new Error(`GitLab returned HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function checked(version) {
  if (!VERSION.test(version)) throw new Error(`Invalid frontend version: ${version}`);
  return version;
}

async function latestVersion() {
  return checked(JSON.parse((await download(`${PACKAGES}/latest/latest.json`)).toString()).version);
}

async function install(version) {
  const bundle = await download(`${PACKAGES}/${version}/inochi-web.tar.gz`);
  const expected = (await download(`${PACKAGES}/${version}/inochi-web.tar.gz.sha256`)).toString().split(/\s+/)[0];
  if (createHash("sha256").update(bundle).digest("hex") !== expected) {
    throw new Error(`Checksum mismatch for frontend ${version}`);
  }

  const dir = join(WEB_DIR, version);
  const staging = `${dir}.partial`;
  const archive = `${staging}.tar.gz`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  writeFileSync(archive, bundle);
  execFileSync("tar", ["-xzf", archive, "-C", staging]);
  rmSync(archive);
  if (!existsSync(join(staging, "server.js"))) throw new Error(`Frontend ${version} has no server.js`);
  rmSync(dir, { recursive: true, force: true });
  renameSync(staging, dir);

  const link = `${CURRENT}.partial`;
  rmSync(link, { force: true });
  symlinkSync(version, link);
  renameSync(link, CURRENT);
}

function installedVersion() {
  try {
    return existsSync(join(CURRENT, "server.js")) ? readlinkSync(CURRENT) : null;
  } catch {
    return null;
  }
}

function removeExcept(...versions) {
  const keep = [...versions, "current", "restart"];
  for (const entry of readdirSync(WEB_DIR)) {
    if (!keep.includes(entry)) rmSync(join(WEB_DIR, entry), { recursive: true, force: true });
  }
}

async function replace(version, installed) {
  await install(version);
  removeExcept(version, installed);
}

async function main(mode) {
  mkdirSync(WEB_DIR, { recursive: true });
  const installed = installedVersion();
  const pinned = process.env.FRONTEND_VERSION || null;

  if (mode === "--check") {
    console.log(JSON.stringify({ installed, latest: await latestVersion(), pinned }));
    return;
  }

  if (mode === "--prune") {
    if (installed) removeExcept(installed);
    return;
  }

  if (mode === "--update") {
    if (pinned) throw new Error(`Pinned to ${pinned} by FRONTEND_VERSION`);
    const latest = await latestVersion();
    if (latest !== installed) {
      await replace(latest, installed);
      writeFileSync(RESTART, "");
    }
    console.log(JSON.stringify({ installed: latest }));
    return;
  }

  if (installed && (!pinned || pinned === installed)) return;
  const version = pinned ? checked(pinned) : await latestVersion();
  if (version !== installed) {
    await replace(version, installed);
    console.log(`[frontend] installed ${version}`);
  }
}

try {
  await main(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
