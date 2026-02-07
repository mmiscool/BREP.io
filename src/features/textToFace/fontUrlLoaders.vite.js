export const FONT_URL_LOADERS = import.meta.glob(
  '../../assets/fonts/**/*.{ttf,otf,woff,woff2,ttc}',
  { query: '?url', import: 'default' }
);
