// Define a type for color stop
export interface ColorStop {
  position: number; // 0 to 1
  color: [number, number, number]; // RGB values 0-1
}

// Define the type for a color scheme
export interface ColorScheme {
  name: string;
  stops: ColorStop[];
  isColorBlindFriendly: boolean;
}

// Define the type for plot line colors
export interface PlotLineColors {
  primary: string;
  secondary: string;
}

// Helper function to interpolate between two colors
export function interpolateColor(
  color1: [number, number, number],
  color2: [number, number, number],
  factor: number
): [number, number, number] {
  return [
    color1[0] + (color2[0] - color1[0]) * factor,
    color1[1] + (color2[1] - color1[1]) * factor,
    color1[2] + (color2[2] - color1[2]) * factor,
  ];
}

// Define color schemes
export const colorSchemes: ColorScheme[] = [
  {
    name: 'Grayscale',
    isColorBlindFriendly: true,
    stops: [
      { position: 0.0, color: [0.1, 0.1, 0.1] }, // Near black
      { position: 0.5, color: [0.5, 0.5, 0.5] }, // Mid gray
      { position: 1.0, color: [1.0, 1.0, 1.0] }, // White
    ],
  },
  {
    name: 'Jet',
    isColorBlindFriendly: false,
    stops: [
      { position: 0.0, color: [0, 0, 0.5] }, // Dark blue
      { position: 0.25, color: [0, 0.5, 1] }, // Light blue
      { position: 0.5, color: [0, 1, 0] }, // Green
      { position: 0.75, color: [1, 1, 0] }, // Yellow
      { position: 1.0, color: [1, 0, 0] }, // Red
    ],
  },
  {
    name: 'Viridis',
    isColorBlindFriendly: true,
    stops: [
      { position: 0.0, color: [0.267, 0.005, 0.329] },
      { position: 0.25, color: [0.253, 0.265, 0.529] },
      { position: 0.5, color: [0.127, 0.567, 0.551] },
      { position: 0.75, color: [0.369, 0.787, 0.382] },
      { position: 1.0, color: [0.993, 0.906, 0.144] },
    ],
  },
  {
    name: 'Thermal',
    isColorBlindFriendly: true,
    stops: [
      { position: 0.0, color: [0, 0, 0] }, // Black
      { position: 0.3, color: [0.5, 0, 0] }, // Dark red
      { position: 0.6, color: [1, 0.5, 0] }, // Orange
      { position: 0.8, color: [1, 0.8, 0.2] }, // Yellow
      { position: 1.0, color: [1, 1, 1] }, // White
    ],
  },
  {
    name: 'Batlow',
    isColorBlindFriendly: true,
    stops: [
      { position: 0.0, color: [0.005, 0.089, 0.209] },
      { position: 0.25, color: [0.107, 0.288, 0.399] },
      { position: 0.5, color: [0.458, 0.444, 0.444] },
      { position: 0.75, color: [0.796, 0.555, 0.322] },
      { position: 1.0, color: [0.993, 0.747, 0.009] },
    ],
  },
];

// --- Color utilities ---
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (p2: number, q2: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
    if (t < 1 / 2) return q2;
    if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
    return p2;
  };
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${hex(toByte(r))}${hex(toByte(g))}${hex(toByte(b))}`;
}

function complementaryHexOf(highRgb01: [number, number, number], isDarkMode: boolean): string {
  const [h, s, _l] = rgbToHsl(highRgb01[0], highRgb01[1], highRgb01[2]);
  const compH = (h + 0.5) % 1.0; // 180° opposite
  // Ensure vivid enough saturation for visibility
  const compS = Math.max(0.6, s);
  // Pick lightness to contrast canvas: lighter on dark, darker on light
  const targetL = isDarkMode ? 0.8 : 0.25;
  const [r, g, b] = hslToRgb(compH, compS, targetL);
  return rgbToHex(r, g, b);
}

function secondaryHexOf(highRgb01: [number, number, number], isDarkMode: boolean): string {
  const [h, s, _l] = rgbToHsl(highRgb01[0], highRgb01[1], highRgb01[2]);
  const compH = (h + 0.5) % 1.0;
  const compS = Math.max(0.45, Math.min(0.7, s));
  const targetL = isDarkMode ? 0.65 : 0.35; // less dominant than primary
  const [r, g, b] = hslToRgb(compH, compS, targetL);
  return rgbToHex(r, g, b);
}

function pickBaseColorForComplement(scheme: ColorScheme): [number, number, number] | null {
  if (!scheme || !scheme.stops || scheme.stops.length === 0) return null;
  let best: [number, number, number] | null = null;
  let bestS = -1;
  // Scan from the end to prefer high-magnitude hues
  for (let i = scheme.stops.length - 1; i >= 0; i--) {
    const c = scheme.stops[i].color;
    const [, s] = rgbToHsl(c[0], c[1], c[2]);
    if (s >= 0.2) {
      // Good saturation – use immediately
      return c;
    }
    if (s > bestS) {
      bestS = s;
      best = c;
    }
  }
  // Fallback to the most saturated we saw (might be near gray)
  return best;
}

// Helper function to get contrasting colors for plot lines based on the selected color scheme
export function getPlotLineColors(colorSchemeName: string, isDarkMode: boolean): PlotLineColors {
  const scheme =
    colorSchemes.find(s => s.name === colorSchemeName) ||
    colorSchemes.find(s => s.name === 'Viridis') ||
    colorSchemes[0];

  // Prefer a saturated hue near the high-magnitude end; fallback to best available
  const base = pickBaseColorForComplement(scheme) || [1, 1, 1];

  // If the base is essentially gray (very low saturation), fall back to luminance-based contrast
  const [, s, l] = rgbToHsl(base[0], base[1], base[2]);
  if (s < 0.08) {
    const primary = l > 0.6 ? '#111111' : '#ffffff';
    const secondary =
      l > 0.6 ? (isDarkMode ? '#aaaaaa' : '#555555') : isDarkMode ? '#dddddd' : '#888888';
    return { primary, secondary };
  }

  // Use complementary color so it's on the opposite side of the wheel
  const primary = complementaryHexOf(base as [number, number, number], isDarkMode);
  const secondary = secondaryHexOf(base as [number, number, number], isDarkMode);

  return { primary, secondary };
}

// Update the helper function to handle missing schemes
export function getColorSchemeGLSL(colorSchemeName: string): string {
  const scheme =
    colorSchemes.find(s => s.name === colorSchemeName) ||
    colorSchemes.find(s => s.name === 'Viridis') ||
    colorSchemes[0];

  if (!scheme) {
    console.error(
      `No color scheme found for ${colorSchemeName}, and no fallback schemes available`
    );
    return `
    vec3 getSchemeColor(float t) {
      return vec3(t, t, t);
    }`;
  }

  // Generate the color stops as a series of if-else statements with interpolation
  const stops = scheme.stops
    .map((stop, index) => {
      if (index === scheme.stops.length - 1) return '';
      const nextStop = scheme.stops[index + 1];
      return `
    if (t < ${nextStop.position.toFixed(3)}) {
      float localT = (t - ${stop.position.toFixed(3)}) / (${(nextStop.position - stop.position).toFixed(3)});
      vec3 color1 = vec3(${stop.color[0].toFixed(3)}, ${stop.color[1].toFixed(3)}, ${stop.color[2].toFixed(3)});
      vec3 color2 = vec3(${nextStop.color[0].toFixed(3)}, ${nextStop.color[1].toFixed(3)}, ${nextStop.color[2].toFixed(3)});
      return mix(color1, color2, localT);
    }`;
    })
    .join('\n    ');

  return `
  vec3 getSchemeColor(float t) {
    // Clamp input to 0-1 range
    t = clamp(t, 0.0, 1.0);
    
    ${stops}
    // Return last color if t >= last stop
    return vec3(${scheme.stops[scheme.stops.length - 1].color.map(c => c.toFixed(3)).join(', ')});
  }

  vec4 getColorForMagnitude(float magnitude, float threshold, bool isZenMode) {
    // Threshold disabled: always derive color from scheme; zen mode is grayscale
    if (isZenMode) {
      return magnitude > 0.0 ? vec4(1.0, 1.0, 1.0, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
    }
    return vec4(getSchemeColor(magnitude), 1.0);
  }`;
}
