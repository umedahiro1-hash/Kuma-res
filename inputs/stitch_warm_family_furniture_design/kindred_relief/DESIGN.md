---
name: Kumamoto Kizuna
colors:
  surface: '#f8faf6'
  surface-dim: '#d9dad7'
  surface-bright: '#f8faf6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f0'
  surface-container: '#edeeeb'
  surface-container-high: '#e7e9e5'
  surface-container-highest: '#e1e3df'
  on-surface: '#191c1a'
  on-surface-variant: '#3f4943'
  inverse-surface: '#2e312f'
  inverse-on-surface: '#f0f1ed'
  outline: '#6f7a72'
  outline-variant: '#bec9c0'
  surface-tint: '#266a4c'
  primary: '#005135'
  on-primary: '#ffffff'
  primary-container: '#25694b'
  on-primary-container: '#a1e6c0'
  inverse-primary: '#90d5b0'
  secondary: '#645d54'
  on-secondary: '#ffffff'
  secondary-container: '#ebe1d5'
  on-secondary-container: '#6a635a'
  tertiary: '#763200'
  on-tertiary: '#ffffff'
  tertiary-container: '#944918'
  on-tertiary-container: '#ffcdb4'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#acf2cb'
  primary-fixed-dim: '#90d5b0'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#015236'
  secondary-fixed: '#ebe1d5'
  secondary-fixed-dim: '#cfc5ba'
  on-secondary-fixed: '#201b14'
  on-secondary-fixed-variant: '#4c463d'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#ffb68e'
  on-tertiary-fixed: '#331200'
  on-tertiary-fixed-variant: '#763301'
  background: '#f8faf6'
  on-background: '#191c1a'
  surface-variant: '#e1e3df'
  cream-bg: '#F9F7F2'
  forest-deep: '#0A5238'
  mustard-accent: '#D97706'
  soft-terracotta: '#C2410C'
  divider-line: '#E5E7E9'
  muted-gray: '#6A7178'
  charcoal-text: '#191C1A'
typography:
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '800'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 26px
    fontWeight: '800'
    lineHeight: 32px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-sm:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 24px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Hanken Grotesk
    fontSize: 15px
    fontWeight: '700'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  stack-gap: 12px
  section-gap: 32px
  touch-target-min: 48px
---

## Brand & Style
The brand personality is **altruistic, community-focused, and calming**. It aims to evoke a sense of safety and mutual support during times of need. The target audience includes local residents looking to help or be helped, requiring a UI that feels accessible, trustworthy, and non-commercial.

The design style is **Modern Tactile with a hint of Neo-Folk**. It combines clean, systematic Material Design 3 principles with a warm, organic color palette. It uses soft shadows and subtle borders to create a "physical bulletin board" feel that is approachable and organized.

## Colors
The palette is grounded in **Forest Green** (Primary) and **Cream** (Background), symbolizing growth and stability. 

- **Primary (Forest Green):** Used for key actions, brand identity, and "Offer" statuses.
- **Secondary (Warm Stone):** Used for neutral containers and secondary labels.
- **Tertiary (Terracotta/Orange):** Used for "Request" actions and urgent highlights to provide clear visual distinction from offers.
- **Background (Cream):** A soft `#F9F7F2` replaces pure white to reduce eye strain and feel more organic/inviting.
- **Status Colors:** Success is green-toned; Errors/Urgency use red; Progress/Muted states use the secondary stone-gray.

## Typography
The system uses a two-font approach. **Hanken Grotesk** is used for headlines and labels to provide a sharp, modern, and high-legibility look. **Be Vietnam Pro** is used for body text, offering a warm and friendly reading experience that performs well in dense information layouts. 

Key characteristics include heavy weights (800) for large headers to establish hierarchy, and generous line-heights (1.5x) for body copy to ensure accessibility for a broad age demographic.

## Layout & Spacing
The system follows a **Fixed Grid** philosophy for its primary content area (max-width 640px/sm) to maintain a focused, "mobile-first" feel even on larger screens. 

- **Vertical Rhythm:** A base unit of 8px is used. Gaps between related items (stacks) are typically 12px, while major sections are separated by 32px.
- **Horizontal Margins:** 16px on mobile devices, increasing to 32px or centered alignment on tablets/desktop.
- **Touch Targets:** All interactive elements maintain a minimum height/width of 48px to ensure ease of use during stressful situations or for older users.

## Elevation & Depth
Depth is communicated through **Tonal Layering and Soft Ambient Shadows**:

- **Level 0 (Background):** `cream-bg` (#F9F7F2) is the base canvas.
- **Level 1 (Cards):** Surface containers use pure white (`#ffffff`) with a very soft, tinted shadow (`rgba(100, 93, 84, 0.08)`) and a `1px` border (`#E5E7E9`).
- **Level 2 (Active/Floating):** Floating Action Buttons (FAB) and system bars use a higher elevation with a slightly more pronounced shadow to indicate they sit above the scrollable content.
- **Interactive States:** Cards use a subtle `scale(0.98)` transform on press rather than a shadow change to maintain a tactile, physical feel.

## Shapes
The shape language is **Rounded and Friendly**. 

- **Standard Containers:** Use 12px (rounded-xl) for cards and main sections.
- **Buttons/Chips:** Use full pills (9999px) for category filters and primary actions to make them feel inviting and distinct from content containers.
- **Small Elements:** Icons and small badges use 4px or 8px rounding to maintain consistency without becoming overly bubbly.

## Components
- **Buttons:** Primary buttons are pill-shaped with high-contrast text. The FAB is large, using `soft-terracotta` to stand out as the primary utility.
- **Chips/Badges:** Status badges (e.g., "ゆずります") use rectangular shapes with 4px-6px rounding and background colors from the fixed-palette to indicate categories without cluttering the UI.
- **Segmented Control:** A group of buttons within a `surface-container-high` wrapper, using a white "lifted" card style for the active state.
- **Cards:** White backgrounds, soft borders, and generous 20px padding. They feature a clear vertical hierarchy: Tags -> Title -> Metadata -> Footer.
- **Checkboxes:** Standard square format with 4px rounding, using the `forest-deep` color for the active state to reinforce the primary brand color.
- **Bottom Navigation:** A persistent bar for mobile with a prominent central action using the primary green, emphasizing the core "Support" mission.