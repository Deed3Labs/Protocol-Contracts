// MapLibre's own sheet, for the Field and Merchants maps' shadow root (fm2.tsx). A module of its own, imported only once
// a live map has loaded: its request names the package, which the checks block (e2e/pages.ts), and a static import
// in fm2.tsx would block the whole page with it. (Vite won't import the sheet lazily straight from the package.)
import css from 'maplibre-gl/dist/maplibre-gl.css?raw';

export default css;
