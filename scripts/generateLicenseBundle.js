import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const run = (cmd) => execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const licensePath = path.join(rootDir, 'LICENSE.md');
const outputDir = path.join(rootDir, 'src', 'generated');
const outputPath = path.join(outputDir, 'licenseBundle.js');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const packageName = packageJson.name ?? 'package';
const packageLicense = packageJson.license ?? 'UNKNOWN';
const licenseText = readFileSync(licensePath, 'utf-8').trimEnd();

let data;
try {
  const raw = run('pnpm licenses list --prod --long --json');
  data = JSON.parse(raw);
} catch (error) {
  console.error('Failed to generate license bundle. Is pnpm installed and did you run `pnpm install`?');
  console.error(error?.message ?? error);
  process.exit(1);
}

const licenseKeys = Object.keys(data).sort((a, b) => a.localeCompare(b));
const countPackages = licenseKeys.reduce(
  (total, key) => total + (Array.isArray(data[key]) ? data[key].length : 0),
  0
);

const formatAuthor = (author) => {
  if (!author) return '';
  if (typeof author === 'string') return author.trim();
  if (typeof author === 'object') {
    return String(author.name ?? '').trim();
  }
  return '';
};

const formatPackageLine = (pkg) => {
  const name = String(pkg?.name ?? 'unknown');
  const versions = Array.isArray(pkg?.versions)
    ? Array.from(new Set(pkg.versions.map((v) => String(v))))
    : [];
  const versionText = versions.length ? `@${versions.join(', ')}` : '';
  const desc = pkg?.description ? ` — ${String(pkg.description)}` : '';
  const author = formatAuthor(pkg?.author);
  const authorText = author ? ` — Author: ${author}` : '';
  const homepage = pkg?.homepage ? ` — ${String(pkg.homepage)}` : '';
  return `- ${name}${versionText}${desc}${authorText}${homepage}`;
};

const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2', '.ttc']);
const FONT_LICENSE_RE = /(license|ofl|notice)/i;
const FONT_FAMILY_NAMES = {
  'ibm-plex': 'IBM Plex',
  liberation: 'Liberation',
  dejavu: 'DejaVu',
  noto: 'Noto',
  hack: 'Hack',
  ubuntu: 'Ubuntu',
  'libre-barcode': 'Libre Barcode',
};

const toTitleCase = (value = '') =>
  value
    .split(/[-_]+/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const detectFontLicenseId = (text = '', filename = '') => {
  const lower = String(text).toLowerCase();
  if (lower.includes('sil open font license') || lower.includes('open font license')) return 'OFL-1.1';
  if (lower.includes('ubuntu font licence') || lower.includes('ubuntu font license')) return 'Ubuntu Font Licence 1.0';
  if (lower.includes('bitstream vera')) return 'Bitstream Vera';
  if (lower.includes('expat') || lower.includes('mit license') || lower.includes('permission is hereby granted')) return 'MIT';
  if (lower.includes('apache license')) return 'Apache-2.0';
  if (lower.includes('creative commons')) return 'CC';
  if (lower.includes('affero general public license')) return 'AGPL';
  if (lower.includes('gnu general public license')) return 'GPL';
  if (String(filename).toLowerCase().includes('ofl')) return 'OFL-1.1';
  return 'UNKNOWN';
};

const collectFontFamilyDirs = (fontsRoot) => {
  const results = [];
  const entries = readdirSync(fontsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of entries) {
    const dirPath = path.join(fontsRoot, entry.name);
    const children = readdirSync(dirPath, { withFileTypes: true });
    const fileChildren = children.filter((child) => child.isFile());
    const hasFont = fileChildren.some((file) => FONT_EXTS.has(path.extname(file.name).toLowerCase()));
    const hasLicense = fileChildren.some((file) => FONT_LICENSE_RE.test(file.name));
    const hasMetadata = fileChildren.some((file) => file.name === 'METADATA.pb');
    if (hasFont || hasLicense || hasMetadata) {
      results.push({
        id: entry.name,
        dirPath,
      });
      continue;
    }

    const subdirs = children.filter((child) => child.isDirectory());
    for (const subdir of subdirs) {
      const subPath = path.join(dirPath, subdir.name);
      const subFiles = readdirSync(subPath, { withFileTypes: true }).filter((child) => child.isFile());
      const subHasFont = subFiles.some((file) => FONT_EXTS.has(path.extname(file.name).toLowerCase()));
      const subHasLicense = subFiles.some((file) => FONT_LICENSE_RE.test(file.name));
      const subHasMetadata = subFiles.some((file) => file.name === 'METADATA.pb');
      if (!subHasFont && !subHasLicense && !subHasMetadata) continue;
      results.push({
        id: path.join(entry.name, subdir.name),
        dirPath: subPath,
      });
    }
  }
  return results;
};

const loadFontLicenses = () => {
  const fontsRoot = path.join(rootDir, 'src', 'assets', 'fonts');
  if (!existsSync(fontsRoot)) {
    return { families: [], licenseIds: [] };
  }
  const families = [];
  const entries = collectFontFamilyDirs(fontsRoot);
  for (const entry of entries) {
    const familyDir = entry.dirPath;
    let metadataName = '';
    const metadataPath = path.join(familyDir, 'METADATA.pb');
    if (existsSync(metadataPath)) {
      const metadataText = readFileSync(metadataPath, 'utf-8');
      const match = metadataText.match(/^name:\s+"([^"]+)"/m);
      if (match) {
        metadataName = match[1].trim();
      }
    }
    const files = readdirSync(familyDir, { withFileTypes: true }).filter((f) => f.isFile());
    const fontFiles = files
      .filter((f) => FONT_EXTS.has(path.extname(f.name).toLowerCase()))
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b));
    const licenseFiles = files
      .filter((f) => FONT_LICENSE_RE.test(f.name))
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b));
    const licenseTexts = licenseFiles.map((file) => {
      const text = readFileSync(path.join(familyDir, file), 'utf-8').trimEnd();
      return { file, text };
    });
    const licenseIds = Array.from(
      new Set(licenseTexts.map((lic) => detectFontLicenseId(lic.text, lic.file)).filter(Boolean))
    );
    families.push({
      id: entry.id,
      name: metadataName || FONT_FAMILY_NAMES[entry.id] || toTitleCase(entry.id),
      fontFiles,
      licenseFiles,
      licenseIds,
      licenseTexts,
    });
  }
  families.sort((a, b) => a.name.localeCompare(b.name));
  const licenseIds = Array.from(
    new Set(families.flatMap((family) => family.licenseIds).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  return { families, licenseIds };
};

const lines = [];
lines.push(`${packageName} License`);
lines.push(`License: ${packageLicense}`);
lines.push('');
lines.push(licenseText);
lines.push('');
lines.push('Third-party licenses (production dependencies)');
lines.push(`${countPackages} packages • ${licenseKeys.length} license types`);
lines.push('Generated from: pnpm licenses list --prod --long --json');
lines.push('');

for (const licenseName of licenseKeys) {
  const list = Array.isArray(data[licenseName]) ? data[licenseName] : [];
  list.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
  lines.push(`${licenseName} (${list.length} package${list.length === 1 ? '' : 's'})`);
  for (const pkg of list) {
    lines.push(formatPackageLine(pkg));
  }
  lines.push('');
}

const fontLicenseData = loadFontLicenses();
lines.push('Font licenses (bundled assets)');
if (!fontLicenseData.families.length) {
  lines.push('No bundled font assets were found.');
} else {
  lines.push(
    `${fontLicenseData.families.length} font famil${
      fontLicenseData.families.length === 1 ? 'y' : 'ies'
    } • ${fontLicenseData.licenseIds.length} license type${
      fontLicenseData.licenseIds.length === 1 ? '' : 's'
    }`
  );
  for (const family of fontLicenseData.families) {
    const licenseLabel = family.licenseIds.length ? family.licenseIds.join(', ') : 'Unknown';
    lines.push(`${family.name} — ${licenseLabel}`);
    lines.push(`Fonts: ${family.fontFiles.length ? family.fontFiles.join(', ') : 'None found'}`);
    lines.push(
      `License files: ${family.licenseFiles.length ? family.licenseFiles.join(', ') : 'None found'}`
    );
    for (const lic of family.licenseTexts) {
      lines.push('');
      lines.push(`${lic.file}`);
      lines.push(lic.text);
    }
    lines.push('');
  }
}

const bundleText = lines.join('\n').trimEnd();
const output = `// Auto-generated by scripts/generateLicenseBundle.js
export const LICENSE_BUNDLE_TEXT = ${JSON.stringify(bundleText)};
`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, output, 'utf-8');
console.log(`Wrote ${outputPath}`);
