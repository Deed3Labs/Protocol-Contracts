# DeedNFTMap Component

This component provides an interactive map view of T-Deeds using Mapbox GL JS v3 with the Mapbox Standard style.

## Setup

1. **Get a Mapbox Access Token**: 
   - Visit [https://account.mapbox.com](https://account.mapbox.com)
   - Create a free account and get your access token

2. **Configure Environment Variables**:
   Create a `.env` file in the `app` directory with:
   ```
   # Development token (for localhost)
   VITE_MAPBOX_PUBLIC_TOKEN=your_mapbox_public_token_here
   
   # Production token (for deployed app)
   VITE_MAPBOX_PRIVATE_TOKEN=your_mapbox_private_token_here
   ```
   
   **Note**: Use different tokens for development and production environments. The public token is used for localhost development, while the private token is used for production deployments.

## Features

- **Mapbox Standard Style**: Uses the latest Mapbox Standard style with 3D lighting and realistic rendering
- **Interactive Markers**: Color-coded markers for different asset types
- **Popup Information**: Click markers to see T-Deed details
- **Navigation Controls**: Built-in zoom, pan, and geolocation controls
- **Responsive Design**: Works on desktop and mobile devices

## Location Data Support

The map component looks for location data in T-Deed traits in the following order:

1. **Configuration JSON**: Parses the `configuration` field for:
   - `latitude` / `lat` / `lat_` / `lat_trait`
   - `longitude` / `lng` / `lng_` / `lng_trait`
   - `address` / `full_address` / `location` / `address_trait`

2. **Definition Field**: Extracts coordinates from the `definition` field if it contains coordinate patterns

## Asset Type Colors

- **Land (0)**: Green (#10B981)
- **Vehicle (1)**: Blue (#3B82F6)
- **Estate (2)**: Purple (#8B5CF6)
- **Equipment (3)**: Orange (#F59E0B)

## Map Controls

- **Navigation**: Zoom in/out, rotate, and tilt controls
- **Geolocation**: Find user's current location
- **Legend**: Shows color coding for different asset types
- **Selected T-Deed Info**: Bottom panel shows details of selected T-Deed

## Usage

The component is automatically included in the Explore page when:
- User is connected to wallet
- User is on the correct network
- T-Deeds are loaded
- At least one T-Deed has location data

## Customization

You can customize the map by modifying the `DeedNFTMap.tsx` component:

- Change default center coordinates
- Modify marker colors
- Add custom map controls
- Adjust popup content
- Change map style configuration 