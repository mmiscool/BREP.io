import {
  DEFAULT_IMAGE_INSERT_HEIGHT_IN,
  DEFAULT_IMAGE_INSERT_WIDTH_IN,
  getDefaultPlacedImageSizeIn,
  resolveClipboardImageSource,
} from '../UI/sheets/sheetMediaUtils.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export async function test_sheet_clipboard_image_utils() {
  const defaultSize = getDefaultPlacedImageSizeIn(0, 0);
  assert(defaultSize.widthIn === DEFAULT_IMAGE_INSERT_WIDTH_IN, 'Expected missing media width to use the default insert width.');
  assert(defaultSize.heightIn === DEFAULT_IMAGE_INSERT_HEIGHT_IN, 'Expected missing media height to use the default insert height.');

  const landscape = getDefaultPlacedImageSizeIn(1600, 800);
  assert(Math.abs(landscape.widthIn - DEFAULT_IMAGE_INSERT_WIDTH_IN) < 1e-9, 'Expected wide images to keep the default insert width.');
  assert(Math.abs(landscape.heightIn - 1.6) < 1e-9, 'Expected wide images to preserve aspect ratio.');

  const portrait = getDefaultPlacedImageSizeIn(600, 1600);
  assert(Math.abs(portrait.heightIn - 2.4) < 1e-9, 'Expected tall images to clamp to the maximum insert height.');
  assert(Math.abs(portrait.widthIn - 0.9) < 1e-9, 'Expected tall images to preserve aspect ratio after clamping.');

  const htmlSrc = resolveClipboardImageSource({
    html: '<div><img alt="clip" src="data:image/png;base64,AAAA" /></div>',
    plainText: '',
  });
  assert(htmlSrc === 'data:image/png;base64,AAAA', 'Expected image clipboard HTML to expose its data URL.');

  const plainSrc = resolveClipboardImageSource({
    html: '<div>not an image</div>',
    plainText: 'data:image/jpeg;base64,BBBB',
  });
  assert(plainSrc === 'data:image/jpeg;base64,BBBB', 'Expected plain-text data URLs to be accepted as clipboard images.');

  const remoteSrc = resolveClipboardImageSource({
    html: '<img src="https://example.com/example.png" />',
    plainText: '',
  });
  assert(remoteSrc === '', 'Expected remote clipboard image URLs to be ignored so pasted sheets stay self-contained.');
}
