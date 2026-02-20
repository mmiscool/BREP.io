import { existsSync, readFileSync, realpathSync } from "fs";
import path from "path";
import { createRequire } from "module";

export const LOCAL_LICENSE_SCAN_SOURCE =
  "installed node_modules graph (dependencies + optionalDependencies)";

const normalizeAuthor = (author) => {
  if (!author) return "";
  if (typeof author === "string") return author.trim();
  if (typeof author === "object") {
    const name = String(author.name ?? "").trim();
    const email = String(author.email ?? "").trim();
    if (name && email) return `${name} <${email}>`;
    return name || email;
  }
  return "";
};

const normalizeLicense = (license, licenses) => {
  if (typeof license === "string" && license.trim()) return license.trim();
  if (license && typeof license === "object") {
    const type = String(license.type ?? license.name ?? "").trim();
    if (type) return type;
  }
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object") {
          return String(entry.type ?? entry.name ?? "").trim();
        }
        return "";
      })
      .filter(Boolean);
    if (types.length) return types.join(" OR ");
  }
  return "UNKNOWN";
};

const normalizeHomepage = (homepage, repository) => {
  if (typeof homepage === "string" && homepage.trim()) return homepage.trim();
  if (typeof repository === "string" && repository.trim()) return repository.trim();
  if (repository && typeof repository === "object") {
    const repoUrl = String(repository.url ?? "").trim();
    if (repoUrl) return repoUrl;
  }
  return "";
};

const listRuntimeDependencies = (pkgJson) =>
  Array.from(
    new Set([
      ...Object.keys(pkgJson?.dependencies ?? {}),
      ...Object.keys(pkgJson?.optionalDependencies ?? {}),
    ])
  );

const resolvePackageJsonFrom = (rootDir, fromDir, depName) => {
  let searchFromDir = fromDir;
  try {
    searchFromDir = realpathSync(fromDir);
  } catch {
    searchFromDir = fromDir;
  }

  const localCandidate = path.join(searchFromDir, "node_modules", depName, "package.json");
  if (existsSync(localCandidate)) return localCandidate;

  const rootCandidate = path.join(rootDir, "node_modules", depName, "package.json");
  if (existsSync(rootCandidate)) return rootCandidate;

  try {
    const requireFrom = createRequire(path.join(searchFromDir, "__resolver__.js"));
    const resolved = requireFrom.resolve(`${depName}/package.json`);
    if (existsSync(resolved)) return resolved;
  } catch {
    // Ignore unresolved packages here; caller decides whether absence is fatal.
  }

  return "";
};

const addPackageSummary = (packagesByKey, pkgJson) => {
  const name = String(pkgJson.name ?? "unknown").trim();
  const version = String(pkgJson.version ?? "").trim();
  const key = `${name}@${version}`;
  const existing = packagesByKey.get(key);
  if (existing) return;

  packagesByKey.set(key, {
    name,
    versions: version ? [version] : [],
    license: normalizeLicense(pkgJson.license, pkgJson.licenses),
    author: normalizeAuthor(pkgJson.author),
    homepage: normalizeHomepage(pkgJson.homepage, pkgJson.repository),
    description: String(pkgJson.description ?? "").trim(),
  });
};

const buildLicenseMap = (packagesByKey) => {
  const data = {};
  for (const pkg of packagesByKey.values()) {
    const licenseKey = pkg.license || "UNKNOWN";
    if (!data[licenseKey]) data[licenseKey] = [];
    data[licenseKey].push(pkg);
  }
  for (const packages of Object.values(data)) {
    packages.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return data;
};

export const collectDependencyLicenseData = ({ cwd = process.cwd(), logger = console } = {}) => {
  const rootPackageJsonPath = path.join(cwd, "package.json");
  if (!existsSync(rootPackageJsonPath)) {
    throw new Error(`Missing package.json at ${rootPackageJsonPath}`);
  }

  const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf-8"));
  const rootRuntimeDeps = Object.keys(rootPackageJson.dependencies ?? {});
  const queue = [];

  for (const depName of rootRuntimeDeps) {
    const depPackageJsonPath = resolvePackageJsonFrom(cwd, cwd, depName);
    if (!depPackageJsonPath) {
      throw new Error(
        `Could not resolve installed production dependency "${depName}". Run "pnpm install" and retry.`
      );
    }
    queue.push(depPackageJsonPath);
  }

  const visitedPackageJsonPaths = new Set();
  const packagesByKey = new Map();

  while (queue.length) {
    const packageJsonPath = queue.shift();
    if (!packageJsonPath || visitedPackageJsonPaths.has(packageJsonPath)) continue;
    visitedPackageJsonPaths.add(packageJsonPath);

    let pkgJson;
    try {
      pkgJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    } catch (error) {
      const message = String(error?.message ?? error);
      throw new Error(`Failed to parse ${packageJsonPath}: ${message}`);
    }

    addPackageSummary(packagesByKey, pkgJson);

    const packageDir = path.dirname(packageJsonPath);
    const childDeps = listRuntimeDependencies(pkgJson);
    for (const childDepName of childDeps) {
      const childPackageJsonPath = resolvePackageJsonFrom(cwd, packageDir, childDepName);
      if (!childPackageJsonPath) continue;
      if (!visitedPackageJsonPaths.has(childPackageJsonPath)) {
        queue.push(childPackageJsonPath);
      }
    }
  }

  const data = buildLicenseMap(packagesByKey);
  const count = Object.values(data).reduce(
    (total, list) => total + (Array.isArray(list) ? list.length : 0),
    0
  );
  if (!count && rootRuntimeDeps.length > 0) {
    throw new Error(
      "No installed production dependencies were discovered while building the license report."
    );
  }

  if (logger?.log) {
    logger.log(`[licenses] Collected ${count} production dependencies from local node_modules.`);
  }

  return {
    data,
    sourceLabel: LOCAL_LICENSE_SCAN_SOURCE,
  };
};
