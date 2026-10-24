import { describe, expect, test } from 'bun:test';
import { DEFAULT_STYLE, mapRequest, mapStyle, mapToken, mapboxUrl } from './map';

/* The map's style from env (Phase 7d): OpenFreeMap unless set; a Mapbox style's token on Mapbox's requests only. */

describe('the map’s style', () => {
  test('OpenFreeMap unless the env says otherwise', () => {
    expect(mapStyle({})).toBe(DEFAULT_STYLE);
    expect(mapStyle({ VITE_MAP_STYLE_URL: ' mapbox://styles/clear/abc ' })).toBe('mapbox://styles/clear/abc');
  });

  test('only a public token: a secret one is never used', () => {
    expect(mapToken({ VITE_MAPBOX_TOKEN: 'pk.public' })).toBe('pk.public');
    expect(mapToken({ VITE_MAPBOX_TOKEN: 'sk.secret' })).toBeNull();
    expect(mapToken({})).toBeNull();
  });

  test('Mapbox’s own addresses become the API’s', () => {
    expect(mapboxUrl('mapbox://styles/clear/abc')).toBe('https://api.mapbox.com/styles/v1/clear/abc');
    expect(mapboxUrl('mapbox://sprites/clear/abc@2x.json')).toBe('https://api.mapbox.com/styles/v1/clear/abc/sprite@2x.json');
    expect(mapboxUrl('mapbox://sprites/clear/abc.png')).toBe('https://api.mapbox.com/styles/v1/clear/abc/sprite.png');
    expect(mapboxUrl('mapbox://fonts/clear/Open Sans Regular/0-255.pbf')).toBe('https://api.mapbox.com/fonts/v1/clear/Open Sans Regular/0-255.pbf');
    expect(mapboxUrl('mapbox://mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2')).toBe('https://api.mapbox.com/v4/mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2.json?secure');
  });

  test('the token goes on Mapbox’s requests and nobody else’s', () => {
    const e = { VITE_MAPBOX_TOKEN: 'pk.public' };
    expect(mapRequest('mapbox://styles/clear/abc', e).url).toBe('https://api.mapbox.com/styles/v1/clear/abc?access_token=pk.public');
    expect(mapRequest('https://api.mapbox.com/v4/x.json?secure', e).url).toBe('https://api.mapbox.com/v4/x.json?secure&access_token=pk.public');
    expect(mapRequest('https://api.mapbox.com/x?access_token=pk.other', e).url).toBe('https://api.mapbox.com/x?access_token=pk.other');
    expect(mapRequest('https://tiles.openfreemap.org/styles/positron', e).url).toBe('https://tiles.openfreemap.org/styles/positron');
    // no token: Mapbox's addresses are still turned into the API's, with nothing added
    expect(mapRequest('mapbox://styles/clear/abc', {}).url).toBe('https://api.mapbox.com/styles/v1/clear/abc');
  });
});
