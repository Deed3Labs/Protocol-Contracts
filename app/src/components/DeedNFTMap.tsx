import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, MapPin } from "lucide-react";
import type { DeedNFT } from '@/hooks/useDeedNFTData';
import { useDeedNFTContext } from '@/context/DeedNFTContext';

// Set Mapbox access token based on environment
// Use public token for development, private token for production
const getMapboxToken = () => {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_MAPBOX_PRIVATE_TOKEN || '';
  } else {
    return import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN || '';
  }
};

interface DeedNFTMapProps {
  deedNFTs: DeedNFT[];
  onDeedNFTSelect: (deedNFT: DeedNFT) => void;
  getAssetTypeLabel: (assetType: number) => string;
  getValidationStatus: (deedNFT: DeedNFT) => { status: string; color: string };
}

interface LocationData {
  latitude: number;
  longitude: number;
  address?: string;
}



// Helper function to get marker color based on asset type
const getMarkerColor = (assetType: number): string => {
  switch (assetType) {
    case 0: return '#10B981'; // Land - Green
    case 1: return '#3B82F6'; // Vehicle - Blue
    case 2: return '#8B5CF6'; // Estate - Purple
    case 3: return '#F59E0B'; // Equipment - Orange
    default: return '#6B7280'; // Default - Gray
  }
};

const DeedNFTMap: React.FC<DeedNFTMapProps> = ({
  deedNFTs,
  onDeedNFTSelect,
  getAssetTypeLabel,
  getValidationStatus
}) => {
  const { getLocationData } = useDeedNFTContext();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const [selectedDeedNFT, setSelectedDeedNFT] = useState<DeedNFT | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Detect theme changes
  useEffect(() => {
    const checkTheme = () => {
      const isDark = document.documentElement.classList.contains('dark');
      setIsDarkMode(isDark);
    };

    // Check initial theme
    checkTheme();

    // Watch for theme changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const mapboxToken = getMapboxToken();
    if (!mapboxToken) {
      console.error('Mapbox access token not found. Please set VITE_MAPBOX_PUBLIC_TOKEN for development or VITE_MAPBOX_PRIVATE_TOKEN for production in your environment variables.');
      return;
    }

    // Set the access token before creating the map
    (mapboxgl as any).accessToken = mapboxToken;
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/standard', // Using Mapbox Standard style
      center: [0, 0], // Center of the Earth (Prime Meridian, Equator)
      zoom: 11,
      maxPitch: 85, // Enable 3D viewing
      pitch: 60, // Set initial 3D angle for buildings
      bearing: 0 // North-facing view
    });

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Add geolocate control
    map.current.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true
        },
        trackUserLocation: true,
        showUserHeading: true
      }),
      'top-right'
    );

    map.current.on('load', () => {
      setMapLoaded(true);
      console.log('Map loaded successfully');
      
      // Try to get user's location and set map view
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            console.log('User location found:', { latitude, longitude });
            
            // Fly to user's location with 3D view
            map.current?.flyTo({
              center: [longitude, latitude],
              zoom: 11,
              pitch: 60,
              bearing: 0,
              duration: 2000
            });
          },
          (error) => {
            console.log('Could not get user location, using default view:', error);
            
            // Default to world view centered on Earth
            map.current?.flyTo({
              center: [0, 0], // Center of the Earth (Prime Meridian, Equator)
              zoom: 2,
              pitch: 60,
              bearing: 0,
              duration: 2000
            });
          },
          {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 300000 // 5 minutes
          }
        );
      } else {
        console.log('Geolocation not supported, using default view');
        
        // Default to world view centered on Earth
        map.current?.flyTo({
          center: [0, 0], // Center of the Earth (Prime Meridian, Equator)
          zoom: 2,
          pitch: 60,
          bearing: 0,
          duration: 2000
        });
      }
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Update markers when deedNFTs change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const processDeedNFTs = async () => {
      // Clear existing markers
      markers.current.forEach(marker => marker.remove());
      markers.current = [];

      // Process DeedNFTs with location data using contract traits
      const locationPromises = deedNFTs.map(async (deedNFT) => {
        const locationData = await getLocationData(deedNFT);
        if (locationData && locationData.latitude && locationData.longitude) {
          return { 
            deedNFT, 
            location: {
              latitude: locationData.latitude,
              longitude: locationData.longitude,
              address: locationData.address
            }
          };
        }
        return null;
      });

      const deedNFTsWithLocation = (await Promise.all(locationPromises))
        .filter(item => item !== null) as { deedNFT: DeedNFT; location: LocationData }[];

      console.log(`Found ${deedNFTsWithLocation.length} DeedNFTs with location data out of ${deedNFTs.length} total`);

      if (deedNFTsWithLocation.length === 0) {
        console.log('No DeedNFTs with location data found, defaulting to user location');
        
        // Try to get user's location and set map view
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const { latitude, longitude } = position.coords;
              console.log('User location found for default view:', { latitude, longitude });
              
              // Fly to user's location with 3D view
              map.current?.flyTo({
                center: [longitude, latitude],
                zoom: 11,
                pitch: 60,
                bearing: 0,
                duration: 2000
              });
            },
            (error) => {
              console.log('Could not get user location for default view:', error);
              
              // Default to world view centered on Earth
              map.current?.flyTo({
                center: [0, 0], // Center of the Earth (Prime Meridian, Equator)
                zoom: 2,
                pitch: 60,
                bearing: 0,
                duration: 2000
              });
            },
            {
              enableHighAccuracy: true,
              timeout: 5000,
              maximumAge: 300000 // 5 minutes
            }
          );
        } else {
          console.log('Geolocation not supported for default view');
          
          // Default to world view centered on Earth
          map.current?.flyTo({
            center: [0, 0], // Center of the Earth (Prime Meridian, Equator)
            zoom: 2,
            pitch: 60,
            bearing: 0,
            duration: 2000
          });
        }
        
        return;
      }

      // Create markers for each DeedNFT with location
      deedNFTsWithLocation.forEach(({ deedNFT, location }) => {
        if (!location) return;

        const validationStatus = getValidationStatus(deedNFT);
        const assetTypeLabel = getAssetTypeLabel(deedNFT.assetType);
        const markerColor = getMarkerColor(deedNFT.assetType);

        // Create custom marker element
        const markerEl = document.createElement('div');
        markerEl.className = 'custom-marker';
        markerEl.style.width = '24px';
        markerEl.style.height = '24px';
        markerEl.style.borderRadius = '50%';
        markerEl.style.backgroundColor = markerColor;
        markerEl.style.border = '2px solid white';
        markerEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        markerEl.style.cursor = 'pointer';
        markerEl.style.display = 'flex';
        markerEl.style.alignItems = 'center';
        markerEl.style.justifyContent = 'center';
        markerEl.style.fontSize = '12px';
        markerEl.style.fontWeight = 'bold';
        markerEl.style.color = 'white';
        markerEl.textContent = deedNFT.tokenId;

        // Create popup content
        const popupContent = document.createElement('div');
        popupContent.className = 'p-3 max-w-xs';
        popupContent.innerHTML = `
          <div class="font-semibold text-gray-900">${assetTypeLabel} #${deedNFT.tokenId}</div>
          <div class="text-sm text-gray-600 mt-1">${deedNFT.definition.length > 50 ? deedNFT.definition.substring(0, 50) + '...' : deedNFT.definition}</div>
          <div class="flex items-center mt-2">
            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
              validationStatus.color === "green" 
                ? "bg-green-100 text-green-700" 
                : "bg-yellow-100 text-yellow-700"
            }">
              ${validationStatus.status}
            </span>
          </div>
          ${location.address ? `<div class="text-xs text-gray-500 mt-1">📍 ${location.address}</div>` : ''}
        `;

        // Create marker
        const marker = new mapboxgl.Marker(markerEl)
          .setLngLat([location.longitude, location.latitude])
          .setPopup(new mapboxgl.Popup({ offset: 25 }).setDOMContent(popupContent))
          .addTo(map.current!);

        // Add click handler
        markerEl.addEventListener('click', () => {
          setSelectedDeedNFT(deedNFT);
          onDeedNFTSelect(deedNFT);
        });

        markers.current.push(marker);
      });

            // Fly to DeedNFTs with 3D view
      if (deedNFTsWithLocation.length > 0) {
        if (deedNFTsWithLocation.length === 1) {
          // Single DeedNFT: fly directly to it with 3D view
          const { location } = deedNFTsWithLocation[0];
          map.current?.flyTo({
            center: [location.longitude, location.latitude],
            zoom: 17,
            pitch: 60,
            bearing: 0,
            duration: 2000
          });
        } else {
          // Multiple DeedNFTs: calculate center and fly to it with 3D view
          let minLng = Infinity, maxLng = -Infinity;
          let minLat = Infinity, maxLat = -Infinity;
          
          deedNFTsWithLocation.forEach(({ location }) => {
            if (location) {
              minLng = Math.min(minLng, location.longitude);
              maxLng = Math.max(maxLng, location.longitude);
              minLat = Math.min(minLat, location.latitude);
              maxLat = Math.max(maxLat, location.latitude);
            }
          });
          
          const centerLng = (minLng + maxLng) / 2;
          const centerLat = (minLat + maxLat) / 2;
          const zoom = Math.min(11, Math.max(8, 16 - deedNFTsWithLocation.length)); // Adjust zoom based on number of DeedNFTs
          
          map.current?.flyTo({
            center: [centerLng, centerLat],
            zoom: zoom,
            pitch: 60,
            bearing: 0,
            duration: 2000
          });
        }
      }
    };

    processDeedNFTs();
  }, [deedNFTs, mapLoaded, getAssetTypeLabel, getValidationStatus, onDeedNFTSelect]);

      // Update map style configuration when loaded or theme changes
    useEffect(() => {
      if (!map.current || !mapLoaded) return;

      // Set light/dark preset based on theme
      const lightPreset = isDarkMode ? 'dusk' : 'day';
      map.current.setConfigProperty('basemap', 'lightPreset', lightPreset);
      
      // Show all 3D objects and labels
      map.current.setConfigProperty('basemap', 'show3dObjects', true);
      map.current.setConfigProperty('basemap', 'showPlaceLabels', true);
      map.current.setConfigProperty('basemap', 'showPointOfInterestLabels', true);
      
      // Set initial 3D view for buildings
      map.current.setPitch(60);
      map.current.setBearing(0);
    }, [mapLoaded, isDarkMode]);

  const mapboxToken = getMapboxToken();
  if (!mapboxToken) {
    return (
      <div className="w-full h-96 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center justify-center">
        <div className="text-center p-8">
          <MapPin className="w-8 h-8 mx-auto mb-4 text-yellow-600 dark:text-yellow-400" />
          <p className="text-yellow-800 dark:text-yellow-200 font-medium">
            Mapbox access token not configured
          </p>
          <p className="text-yellow-700 dark:text-yellow-300 text-sm mt-2">
            Please set VITE_MAPBOX_PUBLIC_TOKEN for development or VITE_MAPBOX_PRIVATE_TOKEN for production
          </p>
          <p className="text-yellow-600 dark:text-yellow-400 text-xs mt-2">
            Get your free access token from{' '}
            <a 
              href="https://account.mapbox.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="underline hover:text-yellow-500 dark:hover:text-yellow-300"
            >
              https://account.mapbox.com
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-96 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
      <div 
        ref={mapContainer} 
        className="w-full h-full"
      />
      
                {/* Map Controls Overlay - Hidden for now */}
          {/* <div className="absolute top-4 left-4 z-10">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-2 space-y-2">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Legend
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">Land</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">Vehicle</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">Estate</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">Equipment</span>
                </div>
              </div>
            </div>
          </div> */}

      {/* Selected DeedNFT Info */}
      {selectedDeedNFT && (
        <div className="absolute bottom-4 left-4 right-4 z-10">
          <Card className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    {getAssetTypeLabel(selectedDeedNFT.assetType)} #{selectedDeedNFT.tokenId}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    {selectedDeedNFT.definition}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge 
                      variant="secondary" 
                      className={`${
                        getValidationStatus(selectedDeedNFT).color === "green" 
                          ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                          : "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300"
                      }`}
                    >
                      {getValidationStatus(selectedDeedNFT).status}
                    </Badge>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Owner: {selectedDeedNFT.owner.substring(0, 6)}...{selectedDeedNFT.owner.substring(selectedDeedNFT.owner.length - 4)}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedDeedNFT(null)}
                  className="ml-2"
                >
                  <Eye className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default DeedNFTMap; 