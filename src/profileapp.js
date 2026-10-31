'use strict';
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').execFile);
const { privateDirectory, writeJSON, readJSON } = require('./privatefiles');
function findAppBundle(executable) {
  const end = executable.indexOf('.app/');
  return end < 0 ? null : executable.slice(0, end + 4);
}
function appsRoot(dataDir) { return path.join(dataDir, 'browsers', 'apps'); }
async function ensureProfileApp(dataDir, profile, executable) {
  if (process.platform !== 'darwin') return executable;
  const source = findAppBundle(executable);
  if (!source) return executable;
  const root = appsRoot(dataDir); privateDirectory(root);
  const destination = path.join(root, `CIKE-${profile.sequence}-${profile.id}.app`);
  const relative = path.relative(source, executable);
  const sourceStat = fs.statSync(executable);
  const identity = { source, size: sourceStat.size, mtime: sourceStat.mtimeMs, sequence: profile.sequence, revision: 3 };
  const marker = destination + '.json';
  if (JSON.stringify(readJSON(marker, null)) === JSON.stringify(identity) && fs.existsSync(path.join(destination, relative))) return path.join(destination, relative);
  const temporary = fs.mkdtempSync(path.join(root, '.profile-'));
  const bundle = path.join(temporary, path.basename(destination));
  try {
    // Copy-on-write APFS clones keep frameworks local to the bundle without
    // symlinked executable identity or multiplying physical disk use.
    try { await exec('/bin/cp', ['-cR', source, bundle], { timeout: 120000 }); }
    catch { fs.rmSync(bundle, { recursive: true, force: true }); await exec('/usr/bin/ditto', [source, bundle], { timeout: 120000 }); }
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    // macOS prefers the named asset catalog over CFBundleIconFile. CfT ships
    // CFBundleIconName=AppIcon, so changing only the ICNS leaves its Test icon.
    const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]);
    const originalInfo = JSON.parse(stdout);
    for (const key of ['CFBundleIconName', 'CFBundleIcons', 'CFBundleIcons~ipad']) {
      if (Object.hasOwn(originalInfo, key)) await exec('/usr/bin/plutil', ['-remove', key, plist]);
    }
    for (const [key, value] of Object.entries({ CFBundleIdentifier: `local.cike.browser.${profile.id}`, CFBundleName: `CIKE #${profile.sequence}`, CFBundleDisplayName: `CIKE #${profile.sequence}`, CFBundleIconFile: 'cike-profile.icns' })) {
      await exec('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
    }
    const png = path.join(temporary, 'icon.png');
    const baseIcon = path.join(temporary, 'base.png');
    // External system tools cannot read paths inside Electron's app.asar.
    fs.writeFileSync(baseIcon, fs.readFileSync(path.join(__dirname, '../electron/assets/icon.png')));
    const script = fs.readFileSync(path.join(__dirname, '../electron/profile-icon.js'), 'utf8');
    await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, baseIcon, String(profile.sequence), png], { timeout: 30000 });
    const iconset = path.join(temporary, 'profile.iconset'); fs.mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
      await exec('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), png, '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
    }
    await exec('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(bundle, 'Contents/Resources/cike-profile.icns')]);
    // Only this private clone is ad-hoc signed; preserve helper entitlements
    // and keep chromiumSandbox enabled. The downloaded original is untouched.
    await exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', bundle], { timeout: 120000 });
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { timeout: 30000 });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(bundle, destination);
    writeJSON(marker, identity);
    return path.join(destination, relative);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { ensureProfileApp, findAppBundle, appsRoot };
