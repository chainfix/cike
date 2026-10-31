ObjC.import('AppKit');
function run(args) {
  const image = $.NSImage.alloc.initWithSize($.NSMakeSize(1024, 1024));
  image.lockFocus;
  // Fill the complete square. macOS supplies the outer icon mask; adding our
  // own inset rounded tile creates a second frame and shrinks the artwork.
  $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.98, 0.98, 0.99, 1).setFill;
  $.NSBezierPath.bezierPathWithRect($.NSMakeRect(0, 0, 1024, 1024)).fill;
  const base = $.NSImage.alloc.initWithContentsOfFile(args[0]);
  if (!base || base.isValid !== true) throw new Error('Cannot load CIKE logo');
  // Crop the source icon's baked-in transparent margins and rounded tile.
  const source = base.size;
  base.drawInRectFromRectOperationFraction($.NSMakeRect(112, 48, 800, 625), $.NSMakeRect(source.width * 0.125, source.height * 0.1953125, source.width * 0.75, source.height * 0.5859375), $.NSCompositingOperationSourceOver, 1);
  const number = $(args[1]);
  let fontSize = 320;
  const attrs = $.NSMutableDictionary.alloc.init;
  attrs.setObjectForKey($.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.06, 0.19, 0.36, 1), $.NSForegroundColorAttributeName);
  let size;
  do {
    attrs.setObjectForKey($.NSFont.boldSystemFontOfSize(fontSize), $.NSFontAttributeName);
    size = number.sizeWithAttributes(attrs);
    fontSize -= 8;
  } while (size.width > 880 && fontSize > 32);
  number.drawAtPointWithAttributes($.NSMakePoint(512 - size.width / 2, 860 - size.height / 2), attrs);
  image.unlockFocus;
  const bitmap = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  const data = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  if (!data.writeToFileAtomically(args[2], true)) throw new Error('Cannot write profile icon');
}
