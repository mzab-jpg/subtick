---
name: Obsidian, Silver & Glacier
colors:
  surface: '#111317'
  surface-dim: '#111317'
  surface-bright: '#37393d'
  surface-container-lowest: '#0c0e11'
  surface-container-low: '#1a1c1f'
  surface-container: '#1e2023'
  surface-container-high: '#282a2d'
  surface-container-highest: '#333538'
  on-surface: '#e2e2e6'
  on-surface-variant: '#c4c7c9'
  inverse-surface: '#e2e2e6'
  inverse-on-surface: '#2f3034'
  outline: '#8e9194'
  outline-variant: '#44474a'
  surface-tint: '#c4c7ca'
  primary: '#ffffff'
  on-primary: '#2d3133'
  primary-container: '#e0e3e6'
  on-primary-container: '#626567'
  inverse-primary: '#5b5f61'
  secondary: '#91cdfb'
  on-secondary: '#00344e'
  secondary-container: '#00557d'
  on-secondary-container: '#8dc9f7'
  tertiary: '#ffffff'
  on-tertiary: '#2b3138'
  tertiary-container: '#dde3ec'
  on-tertiary-container: '#5f656d'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e0e3e6'
  primary-fixed-dim: '#c4c7ca'
  on-primary-fixed: '#191c1e'
  on-primary-fixed-variant: '#44474a'
  secondary-fixed: '#cae6ff'
  secondary-fixed-dim: '#91cdfb'
  on-secondary-fixed: '#001e30'
  on-secondary-fixed-variant: '#004b70'
  tertiary-fixed: '#dde3ec'
  tertiary-fixed-dim: '#c1c7d0'
  on-tertiary-fixed: '#161c23'
  on-tertiary-fixed-variant: '#41474f'
  background: '#111317'
  on-background: '#e2e2e6'
  surface-variant: '#333538'
typography:
  display:
    fontFamily: Space Grotesk
    fontSize: 3.75rem
    fontWeight: '500'
    lineHeight: 4.25rem
    letterSpacing: -0.04em
  display-mobile:
    fontFamily: Space Grotesk
    fontSize: 2.5rem
    fontWeight: '500'
    lineHeight: 3rem
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 2.5rem
    fontWeight: '500'
    lineHeight: 3rem
    letterSpacing: -0.03em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 1.875rem
    fontWeight: '500'
    lineHeight: 2.375rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 1.75rem
    fontWeight: '500'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Manrope
    fontSize: 1.125rem
    fontWeight: '400'
    lineHeight: 1.875rem
    letterSpacing: -0.01em
  body-md:
    fontFamily: Manrope
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.625rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Manrope
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: 0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: 0.04em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  space-2xs: 0.25rem
  space-xs: 0.5rem
  space-sm: 0.75rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
  space-3xl: 4.5rem
  space-4xl: 6rem
  gutter: 1.5rem
  margin-mobile: 1.25rem
  margin-desktop: 3rem
  max-content-width: 84rem
---

## Brand & Style

This design system expresses quiet authority, high-end editorial prestige, and modern technical refinement. It serves discerning readers, art directors, collectors, and architectural portfolios who expect content to feel monumental yet weightless. The emotional response is one of composure, focus, and deliberate luxury—reminiscent of bespoke horology, architectural monograph printing, and midnight gallery atmospheres.

The visual direction merges **Minimalism** and **Tactile Glassmorphism**:
- Deep, light-absorbing obsidian foundations remove digital glare and ground the interface.
- Metallic silver typography and razor-sharp chrome rules evoke precision-machined materials.
- Icy glacier accents highlight moments of interaction and data with cold, measured clarity.
- Extreme discipline around whitespace, micro-hairlines, and restrained motion guarantees that user-curated media remains the focal point.

## Colors

The palette leverages an uncompromising dark-mode scale structured to avoid eye fatigue while maintaining dynamic range.

- **Obsidian Dark Grounds**: `#0b0d10` acts as the root void. Layered surfaces graduate subtly to `#101317` (canvas base) and `#161a20` (elevated cards/panels), eliminating stark drop shadows in favor of tonal atmospheric depth.
- **Cool Metallics & Chrome**: `#f5f7fa` serves as the high-visibility primary element (primary buttons, active state highlights). Mid-tones scale through `#e2e5eb` for dominant text, `#9aa0a9` for secondary copy, `#4b535d` for subtle borders, and `#252a32` for structural hairline delimiters.
- **Glacier Accents**: `#76b2df` delivers vibrant yet cool energy for links, state badges, and indicators. `#a8d5f2` is reserved for delicate hover glows, while `#4a91c9` anchors focused rings and active indicators.

Avoid oversaturated bright colors; interactive states transition through luminescence and opacity shifts rather than hue shifts.

## Typography

The typographic hierarchy bridges high-concept design and absolute reading comfort.

- **Headlines (`Space Grotesk`)**: Provides an editorial, architectural silhouette. Its precise geometry feels engineered and modern without crossing into utilitarian rigidity.
- **Body (`Manrope`)**: Delivers an organic, balanced reading texture. Open letterforms and generous x-height prevent fatigue over sustained narrative reading on inky black surfaces.
- **Labels & Micro-data (`JetBrains Mono`)**: Adds an archival, curated dimension. Rendered with uppercase styling and expansive tracking, it frames projects, indices, dates, and technical details with museum-grade order.

## Layout & Spacing

The layout is built on a 12-column responsive fluid grid pinned within an ultra-wide max content container (`84rem`).

- **Grid Disciplines**: 12 columns on desktop (`>= 1024px`) with a fixed `1.5rem` gutter; 8 columns on tablet (`768px - 1023px`); 4 columns on mobile (`< 768px`).
- **Rhythm**: Vertical flow follows rhythmic groupings governed by generous multiples (`3rem` to `6rem`) to create an expansive, gallery-like cadence between editorial blocks.
- **Content Density**: Text blocks are capped at an optimal reading measure of 65–72 characters (max `42rem`), allowing wide margins for imagery and contextual metadata to breathe along the perimeter.

## Elevation & Depth

Visual hierarchy operates through atmospheric tonal steps and chrome containment rather than heavy drop shadows:

- **Surface Levels**:
  - `Base`: `#0b0d10` (the infinite floor).
  - `Surface-01`: `#101317` with a 1px perimeter border of `#252a32`.
  - `Surface-02 (Floated/Modals)`: `#161a20` supported by backdrop filtration (`backdrop-filter: blur(16px)`) and a hairline stroke of `#4b535d` at 40% opacity.
- **Cold Ambient Luminance**:
  - Overlays and primary focal cards use an ultra-diffused, ice-tinted aura: `0 20px 48px -12px rgba(118, 178, 223, 0.06)`.
- **Metallic Borders**:
  - Containers rely on crisp 1px borders. Interactive elements transition their borders from dark graphite `#252a32` to brushed silver `#9aa0a9`, and ultimately glacier `#76b2df` when focused.

## Shapes

The design system adheres to a disciplined, low-radius shape profile (`roundedness: 1`). 

- Standard inputs, buttons, and micro-badges leverage a subtle `0.25rem` (4px) curve, preserving architectural crispness without the severity of razor corners.
- Media tiles and narrative cards scale up to `0.5rem` (8px). 
- Pills or fully circular geometry are strictly prohibited, except for single-digit status pips and circular iconography. Sharp, deliberate contour lines mirror cut silver and polished stone.

## Components

### Buttons
- **Primary**: Background in pure metallic white `#f5f7fa`, text in deep obsidian `#0f1318`, font weight 600. On hover, background shifts to `#e2e5eb` accompanied by a soft glacier glow (`0 0 20px rgba(168, 213, 242, 0.2)`).
- **Secondary / Ghost**: Transparent background, 1px border in `#4b535d`, typography in `#e2e5eb`. On hover, border illuminates to `#9aa0a9` with an inky backing of `#161a20`.
- **Glacier Accent**: For signature interactions. Background in `#76b2df`, text in `#0b0d10`.

### Form Fields & Inputs
- Containers feature `#101317` surfaces encased in a 1px `#252a32` border.
- Text enters in `#f5f7fa`, with placeholder text rendered in `#4b535d`.
- Focus state: border shifts to `#76b2df`, matched by a non-blur outline ring `0 0 0 1px #76b2df`.
- Form labels utilize `label-sm` in `#9aa0a9`, positioned above the field with `0.5rem` spacing.

### Cards & Editorial Panels
- Assembled over `#101317` with 1px borders (`#252a32`).
- Inner content padding uses `space-lg` (1.5rem) to `space-xl` (2rem).
- Interactive cards elevate on hover via a smooth border brightening to `#4b535d` and a slight upward translate (-2px).

### Chips & Metadata Tags
- Height: 24px. Border-radius: 4px.
- Background: `#161a20`. Border: 1px solid `#252a32`.
- Text: `label-sm` in `#9aa0a9`. Active or selected chips transition border to `#76b2df` and text to `#a8d5f2`.

### Checkboxes & Radios
- Size: 16x16px boxes with 2px border radius (checkbox) or circular boundary (radio).
- Default: Border in `#4b535d`, background transparent.
- Checked: Background `#f5f7fa`, icon or dot in `#0b0d10`, with immediate cold glacier border glow `#76b2df`.

### Data Lists & Indices
- Divided by hairline chrome rules (`1px solid #252a32`).
- Row hover produces a subtle `#101317` background fill, with the index number shifting from `#4b535d` to `#76b2df`.