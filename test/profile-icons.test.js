'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').execFile);
const { ProfileStore } = require('../src/store');
const { BrowserManager } = require('../src/browser');

const inspectRuntimeIcon = `
ObjC.import('AppKit');
function run(args) {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  let app;
  for (let i=0;i<apps.count;i++) {
    const candidate=apps.objectAtIndex(i);
    if (candidate.bundleURL && ObjC.unwrap(candidate.bundleURL.path) === args[0]) { app=candidate; break; }
  }
  if (!app) throw new Error('Running application not registered');
  function render(image, scale) {
    scale = scale || 1;
    const canvas=$.NSImage.alloc.initWithSize($.NSMakeSize(128,128));
    canvas.lockFocus;
    image.drawInRectFromRectOperationFraction($.NSMakeRect(64*(1-scale),64*(1-scale),128*scale,128*scale),$.NSZeroRect,$.NSCompositingOperationSourceOver,1);
    canvas.unlockFocus;
    return $.NSBitmapImageRep.imageRepWithData(canvas.TIFFRepresentation).representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$({}));
  }
  const actual=render(app.icon);
  const expected=render($.NSImage.alloc.initWithContentsOfFile(args[0]+'/Contents/Resources/cike-profile.icns'));
  actual.writeToFileAtomically(args[1],true);
  expected.writeToFileAtomically(args[2],true);
  // macOS can apply color management and a padded glass frame to ICNS icons.
  // Compare the colored logo/number pixels across possible system scales;
  // neutral backgrounds and transparent padding are not branding evidence.
  const a=$.NSBitmapImageRep.imageRepWithData(actual);
  const source=$.NSImage.alloc.initWithContentsOfFile(args[0]+'/Contents/Resources/cike-profile.icns');
  let meanError=1;
  for (let scale=0.6;scale<=1.001;scale+=0.025) {
    const b=$.NSBitmapImageRep.imageRepWithData(render(source,scale));
    let error=0, count=0;
    for (let y=0;y<a.pixelsHigh;y+=4) for (let x=0;x<a.pixelsWide;x+=4) {
      const ac=a.colorAtXY(x,y).colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
      const bc=b.colorAtXY(x,y).colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
      const ar=ac.redComponent, ag=ac.greenComponent, ab=ac.blueComponent, aa=ac.alphaComponent;
      const br=bc.redComponent, bg=bc.greenComponent, bb=bc.blueComponent, ba=bc.alphaComponent;
      if ((Math.max(ar,ag,ab)-Math.min(ar,ag,ab))*aa<0.12 && (Math.max(br,bg,bb)-Math.min(br,bg,bb))*ba<0.12) continue;
      error += Math.abs(ar*aa+1-aa-(br*ba+1-ba))+Math.abs(ag*aa+1-aa-(bg*ba+1-ba))+Math.abs(ab*aa+1-aa-(bb*ba+1-ba));count+=3;
    }
    if (count) meanError=Math.min(meanError,error/count);
  }
  const expectedBitmap=$.NSBitmapImageRep.imageRepWithData(expected);
  const opaqueCanvas=[[0,0],[expectedBitmap.pixelsWide-1,0],[0,expectedBitmap.pixelsHigh-1],[expectedBitmap.pixelsWide-1,expectedBitmap.pixelsHigh-1]].every(p=>expectedBitmap.colorAtXY(p[0],p[1]).alphaComponent>0.99);
  return JSON.stringify({ matches: meanError < 0.12, meanError, opaqueCanvas });
}`;

test('macOS running application icon uses the numbered CIKE ICNS instead of the CfT catalog', { skip: process.platform !== 'darwin', timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-dock-icons-'));
  const store = new ProfileStore(dir);
  const manager = new BrowserManager(store, null, null, { startPage: false, downloadsDirectory: path.join(dir, 'downloads') });
  try {
    store.sequence = 124; // Check a realistic three-digit Dock label.
    const profile = store.create({ name: 'Dock icon regression' });
    await manager.open(profile.id);
    const bundle = path.join(dir, 'browsers/apps', `CIKE-${profile.sequence}-${profile.id}.app`);
    const { stdout: json } = await exec('/usr/bin/plutil', ['-convert','json','-o','-',path.join(bundle,'Contents/Info.plist')]);
    const info = JSON.parse(json);
    assert.equal(info.CFBundleIconName, undefined);
    assert.equal(info.CFBundleIconFile, 'cike-profile.icns');
    const actual = process.env.CIKE_ICON_EVIDENCE || path.join(dir,'runtime-icon.png');
    const { stdout } = await exec('/usr/bin/osascript', ['-l','JavaScript','-e',inspectRuntimeIcon,bundle,actual,actual+'.expected.png']);
    const result = JSON.parse(stdout);
    assert.equal(result.matches, true, `The running application must display the numbered CIKE icon (mean pixel error ${result.meanError})`);
    assert.equal(info.CFBundleDisplayName, `CIKE #${profile.sequence}`);
    assert.equal(result.opaqueCanvas, true, 'The icon canvas must be opaque edge-to-edge, with no inset tile or transparent border');
    await manager.close(profile.id);
    // Simulate a cached pre-fix clone. It must be regenerated automatically.
    const marker = bundle + '.json';
    const cache = JSON.parse(fs.readFileSync(marker));cache.revision=1;fs.writeFileSync(marker,JSON.stringify(cache));
    await exec('/usr/bin/plutil',['-replace','CFBundleIconName','-string','AppIcon',path.join(bundle,'Contents/Info.plist')]);
    await manager.open(profile.id);
    assert.equal(JSON.parse(fs.readFileSync(marker)).revision,3);
    const again = await exec('/usr/bin/osascript',['-l','JavaScript','-e',inspectRuntimeIcon,bundle,actual,path.join(dir,'expected-icon.png')]);
    assert.equal(JSON.parse(again.stdout).matches,true);
  } finally { await manager.closeAll();fs.rmSync(dir,{recursive:true,force:true}); }
});
