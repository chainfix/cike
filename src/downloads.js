'use strict';
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

// Set native preferences before launching the profile. Chromium's native
// download manager preserves filenames, numbers collisions and records the
// permanent path in chrome://downloads. CDP's `allow` policy overwrites names.
async function prepareDownloads(profileDirectory, directory = path.join(os.homedir(), 'Downloads')) {
  directory = path.resolve(directory);
  await fs.mkdir(directory, { recursive: true });
  const defaultDirectory = path.join(profileDirectory, 'Default');
  await fs.mkdir(defaultDirectory, { recursive: true });
  const filename = path.join(defaultDirectory, 'Preferences');
  let preferences = {};
  try { preferences = JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  preferences.download = {
    ...preferences.download,
    default_directory: directory,
    prompt_for_download: false,
    directory_upgrade: true,
  };
  const temporary = filename + '.cike-downloads';
  try {
    await fs.writeFile(temporary, JSON.stringify(preferences), { mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function configureDownloads(context) {
  const page = context.pages()[0] || await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    // Undo Playwright's allowAndName policy, which stores GUID-named artifacts
    // in a temporary directory. Native defaults apply to all tabs and popups.
    await session.send('Browser.setDownloadBehavior', { behavior: 'default' });
  } finally {
    await session.detach();
  }
}

module.exports = { prepareDownloads, configureDownloads };
