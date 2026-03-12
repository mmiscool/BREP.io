export const DEFAULT_IMAGE_INSERT_WIDTH_IN = 3.2;
export const DEFAULT_IMAGE_INSERT_HEIGHT_IN = 2.0;
export const MAX_IMAGE_INSERT_HEIGHT_IN = 2.4;

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/&amp;/giu, "&");
}

export function getDefaultPlacedImageSizeIn(naturalWidth, naturalHeight) {
  const widthPx = Math.max(0, toFiniteNumber(naturalWidth, 0));
  const heightPx = Math.max(0, toFiniteNumber(naturalHeight, 0));
  if (!widthPx || !heightPx) {
    return {
      widthIn: DEFAULT_IMAGE_INSERT_WIDTH_IN,
      heightIn: DEFAULT_IMAGE_INSERT_HEIGHT_IN,
    };
  }

  const aspect = Math.max(1e-6, widthPx / heightPx);
  let widthIn = DEFAULT_IMAGE_INSERT_WIDTH_IN;
  let heightIn = widthIn / aspect;
  if (heightIn > MAX_IMAGE_INSERT_HEIGHT_IN) {
    heightIn = MAX_IMAGE_INSERT_HEIGHT_IN;
    widthIn = heightIn * aspect;
  }
  return { widthIn, heightIn };
}

export function resolveClipboardImageSource({ html = "", plainText = "" } = {}) {
  const candidates = [];
  const htmlText = String(html || "");
  const imgSrcPattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu;
  let match = imgSrcPattern.exec(htmlText);
  while (match) {
    candidates.push(decodeHtmlAttribute(match[1] || match[2] || match[3] || ""));
    match = imgSrcPattern.exec(htmlText);
  }
  candidates.push(String(plainText || "").trim());

  for (const candidate of candidates) {
    const src = String(candidate || "").trim();
    if (/^data:image\//iu.test(src)) return src;
  }
  return "";
}
