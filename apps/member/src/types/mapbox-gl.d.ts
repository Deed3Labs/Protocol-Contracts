declare module 'mapbox-gl' {
  export interface MapOptions {
    container: string | HTMLElement;
    style?: string;
    center?: [number, number];
    zoom?: number;
    maxPitch?: number;
    [key: string]: any;
  }

  export interface MarkerOptions {
    element?: HTMLElement;
    offset?: [number, number];
    [key: string]: any;
  }

  export interface PopupOptions {
    offset?: number | [number, number];
    [key: string]: any;
  }

  export interface GeolocateControlOptions {
    positionOptions?: {
      enableHighAccuracy?: boolean;
      timeout?: number;
      maximumAge?: number;
    };
    trackUserLocation?: boolean;
    showUserHeading?: boolean;
    [key: string]: any;
  }

  export interface FlyToOptions {
    center?: [number, number];
    zoom?: number;
    pitch?: number;
    bearing?: number;
    duration?: number;
  }

  export class Map {
    constructor(options: MapOptions);
    addControl(control: any, position?: string): this;
    remove(): void;
    on(event: string, listener: (event: any) => void): this;
    setConfigProperty(style: string, property: string, value: any): void;
    fitBounds(bounds: LngLatBounds, options?: any): void;
    flyTo(options: FlyToOptions): void;
    setPitch(pitch: number): void;
    setBearing(bearing: number): void;
  }

  export class Marker {
    constructor(options?: MarkerOptions);
    setLngLat(coordinates: [number, number]): this;
    setPopup(popup: Popup): this;
    addTo(map: Map): this;
    remove(): void;
  }

  export class Popup {
    constructor(options?: PopupOptions);
    setDOMContent(content: HTMLElement): this;
  }

  export class NavigationControl {
    constructor();
  }

  export class GeolocateControl {
    constructor(options?: GeolocateControlOptions);
  }

  export class LngLatBounds {
    constructor();
    extend(coordinates: [number, number]): this;
  }

  export const accessToken: string;
}

declare module 'mapbox-gl/dist/mapbox-gl.css'; 