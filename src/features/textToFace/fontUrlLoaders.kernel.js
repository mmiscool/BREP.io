const hasImportMetaGlob = typeof import.meta !== 'undefined' && typeof import.meta.glob === 'function';

export const FONT_URL_LOADERS = hasImportMetaGlob
  ? import.meta.glob('../../assets/fonts/**/*.{ttf,otf,woff,woff2,ttc}', {
      eager: true,
      query: '?inline',
      import: 'default',
    })
  : Object.create(null);
