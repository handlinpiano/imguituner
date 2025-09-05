// Circle configuration modes for ConcentricCirclePlot
// Each mode uses different mathematical progressions for movement ranges and tolerances

export interface CircleConfig {
  movementRange: number;
  lockingTolerance: number;
  color: string;
  radius: number;
}

export type CircleMode = 'fibonacci' | 'powers-of-2' | 'decimal' | 'guild-standard' | 'pitch-raise';

// Fibonacci scaling for radii - scaled much larger for visibility
// Making largest circle very prominent and visible, scaling others proportionally
// Original: [144, 89, 55, 34, 21, 13, 8] -> Scaled up significantly
const fibonacciRadii = [200, 124, 76, 47, 29, 18, 11];

// Color scheme (consistent across all modes)
const colors = [
  '#CC0000', // Deep Red
  '#0099CC', // Cyan
  '#00CC33', // Bright Green
  '#CC6600', // Orange
  '#9900CC', // Purple
  '#FFD700', // Gold
  '#FF1493', // Deep Pink
];

// Fibonacci/Golden Ratio progression (φ⁻¹ ≈ 0.618)
const fibonacciConfig: CircleConfig[] = [
  { movementRange: 120, lockingTolerance: 10, color: colors[0], radius: fibonacciRadii[0] },
  { movementRange: 74, lockingTolerance: 6.2, color: colors[1], radius: fibonacciRadii[1] },
  { movementRange: 46, lockingTolerance: 3.8, color: colors[2], radius: fibonacciRadii[2] },
  { movementRange: 28, lockingTolerance: 2.4, color: colors[3], radius: fibonacciRadii[3] },
  { movementRange: 17, lockingTolerance: 1.5, color: colors[4], radius: fibonacciRadii[4] },
  { movementRange: 11, lockingTolerance: 0.3, color: colors[5], radius: fibonacciRadii[5] },
  { movementRange: 6.8, lockingTolerance: 0.18, color: colors[6], radius: fibonacciRadii[6] },
];

// Powers of 2 progression
const powersOf2Config: CircleConfig[] = [
  { movementRange: 120, lockingTolerance: 12.8, color: colors[0], radius: fibonacciRadii[0] }, // ~128 capped at 120
  { movementRange: 64, lockingTolerance: 6.4, color: colors[1], radius: fibonacciRadii[1] },
  { movementRange: 32, lockingTolerance: 3.2, color: colors[2], radius: fibonacciRadii[2] },
  { movementRange: 16, lockingTolerance: 1.6, color: colors[3], radius: fibonacciRadii[3] },
  { movementRange: 8, lockingTolerance: 0.8, color: colors[4], radius: fibonacciRadii[4] },
  { movementRange: 4, lockingTolerance: 0.4, color: colors[5], radius: fibonacciRadii[5] },
  { movementRange: 2, lockingTolerance: 0.2, color: colors[6], radius: fibonacciRadii[6] },
];

// Decimal progression
const decimalConfig: CircleConfig[] = [
  { movementRange: 100, lockingTolerance: 10, color: colors[0], radius: fibonacciRadii[0] },
  { movementRange: 50, lockingTolerance: 5, color: colors[1], radius: fibonacciRadii[1] },
  { movementRange: 20, lockingTolerance: 2, color: colors[2], radius: fibonacciRadii[2] },
  { movementRange: 10, lockingTolerance: 1, color: colors[3], radius: fibonacciRadii[3] },
  { movementRange: 5, lockingTolerance: 0.5, color: colors[4], radius: fibonacciRadii[4] },
  { movementRange: 2.5, lockingTolerance: 0.25, color: colors[5], radius: fibonacciRadii[5] },
  { movementRange: 1, lockingTolerance: 0.1, color: colors[6], radius: fibonacciRadii[6] },
];

// Guild Standard configuration (3 circles with specific tolerances)
// Movement ranges are roughly 10x the locking tolerances: 0.5*50=25, 2.5*20=50, 5*24=120
const guildStandardConfig: CircleConfig[] = [
  { movementRange: 120, lockingTolerance: 5, color: colors[0], radius: fibonacciRadii[0] },
  { movementRange: 50, lockingTolerance: 2.5, color: colors[1], radius: fibonacciRadii[1] },
  { movementRange: 25, lockingTolerance: 0.5, color: colors[2], radius: fibonacciRadii[2] },
];

// Pitch Raise configuration (only the second and third circles from Guild Standard)
const pitchRaiseConfig: CircleConfig[] = [
  { movementRange: 120, lockingTolerance: 5, color: colors[0], radius: fibonacciRadii[0] },
  { movementRange: 50, lockingTolerance: 2.5, color: colors[1], radius: fibonacciRadii[1] },
];

export const circleConfigurations: Record<CircleMode, CircleConfig[]> = {
  fibonacci: fibonacciConfig,
  'powers-of-2': powersOf2Config,
  decimal: decimalConfig,
  'guild-standard': guildStandardConfig,
  'pitch-raise': pitchRaiseConfig,
};

export function getCircleConfig(mode: CircleMode): CircleConfig[] {
  return circleConfigurations[mode] || fibonacciConfig;
}
