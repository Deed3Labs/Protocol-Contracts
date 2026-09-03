# Font Files

This directory contains custom fonts for the Deed Protocol application.

## Font Files Structure

### Coolvetica Fonts
- **Directory**: `Coolvetica/`
- **Main File**: `coolvetica-compressed-hv.otf` (Coolvetica Compressed)
- **Usage**: Used for the "Deed Protocol" logo text and main page titles
- **Other Variants**: Regular, Italic, Condensed, Crammed

### General Sans Fonts
- **Directory**: `GeneralSans/`
- **Main Files**: 
  - `GeneralSans-Regular.otf` (default)
  - `GeneralSans-Medium.otf` (font-weight: 500)
  - `GeneralSans-Semibold.otf` (font-weight: 600)
  - `GeneralSans-Bold.otf` (font-weight: bold)
- **Usage**: Used as the default font throughout the application

## Font Loading

The fonts are loaded via CSS `@font-face` declarations in `src/index.css`:

```css
@font-face {
  font-family: 'Coolvetica Compressed';
  src: url('/fonts/Coolvetica/coolvetica-compressed-hv.otf') format('opentype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'General Sans';
  src: url('/fonts/GeneralSans/GeneralSans-Regular.otf') format('opentype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
```

## Usage in Components

- **Coolvetica Compressed**: Applied to "Deed Protocol" text in Header and main title in Home
- **General Sans**: Applied globally as the default font family

## Utility Classes

- `.font-coolvetica` - Applies Coolvetica Compressed font
- `.font-general` - Applies General Sans font 