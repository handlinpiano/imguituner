'use client';
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Box, useTheme, Typography } from '@mui/material';
import { styled } from '@mui/system';
import { HarmonicCaptureService } from '@/services/harmonicCaptureService';
import { beatMinimizerIntegration } from '@/services/beatMinimizerIntegration';
import { getTuningSession } from '@/models/TuningSession';
import { scaleBFromA3, reportA3ForArchetype } from '@/utils/piano-inharmonicity';

interface HarmonicDeviationPlotProps {
  sessionId?: string;
  selectedNote?: string;
  zenMode: boolean;
  colorScheme: string;
  onPreviousNote: () => void;
  onNextNote: () => void;
  onPrevOctave: () => void;
  onNextOctave: () => void;
}

interface HarmonicDataPoint {
  harmonicNumber: number;
  centsDeviation: number;
  magnitude: number;
  isValid: boolean;
  actualFrequency?: number;
  idealFrequency?: number;
  rawMagnitude?: number;
  isEstimated?: boolean; // when coming from best approx and was synthesized
}

interface CaptureSeriesData {
  captureIndex: number;
  dataPoints: HarmonicDataPoint[];
  timestamp: number;
  isHighQuality: boolean;
}

interface BestApproximationSeriesData {
  dataPoints: HarmonicDataPoint[];
}

// Styled Components
const StyledCanvas = styled('canvas')({
  width: '100%',
  height: '100%',
  display: 'block',
  minHeight: '300px',
  '@media (max-width: 768px) and (orientation: portrait)': {
    minHeight: '250px',
  },
  position: 'relative',
  top: 0,
  left: 0,
  touchAction: 'none',
});

const PlotContainer = styled(Box)({
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '300px',
  '@media (max-width: 768px) and (orientation: portrait)': {
    minHeight: '250px',
  },
  touchAction: 'none',
  cursor: 'pointer',
});

// Helper function to calculate harmonic note names
const calculateHarmonicNoteName = (baseNote: string, harmonicNumber: number): string => {
  if (!baseNote || harmonicNumber < 1) return '';

  // Parse base note (e.g., "A3" -> note: "A", octave: 3)
  const noteMatch = baseNote.match(/^([A-G][#b]?)([0-9])$/);
  if (!noteMatch) return '';

  const [, noteName, octaveStr] = noteMatch;
  const baseOctave = parseInt(octaveStr, 10);

  // Convert note to MIDI number for easier calculation
  const noteToMidi = (note: string, octave: number): number => {
    const noteOffsets: { [key: string]: number } = {
      C: 0,
      'C#': 1,
      Db: 1,
      D: 2,
      'D#': 3,
      Eb: 3,
      E: 4,
      F: 5,
      'F#': 6,
      Gb: 6,
      G: 7,
      'G#': 8,
      Ab: 8,
      A: 9,
      'A#': 10,
      Bb: 10,
      B: 11,
    };
    return (octave + 1) * 12 + (noteOffsets[note] || 0);
  };

  // Convert MIDI number back to note name
  const midiToNote = (midi: number): string => {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    const noteIndex = midi % 12;
    return noteNames[noteIndex] + octave;
  };

  // Calculate harmonic frequency ratio and convert to semitones
  const baseMidi = noteToMidi(noteName, baseOctave);
  const harmonicSemitones = 12 * Math.log2(harmonicNumber);
  const harmonicMidi = Math.round(baseMidi + harmonicSemitones);

  return midiToNote(harmonicMidi);
};

const HarmonicDeviationPlot: React.FC<HarmonicDeviationPlotProps> = ({
  sessionId,
  selectedNote,
  zenMode,
  colorScheme: _colorScheme,
  onPreviousNote,
  onNextNote,
  onPrevOctave,
  onNextOctave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const theme = useTheme();
  const [captureSeriesData, setCaptureSeriesData] = useState<CaptureSeriesData[]>([]);
  const [bestApproximationData, setBestApproximationData] =
    useState<BestApproximationSeriesData | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [overlay, setOverlay] = useState<{ visible: boolean; quadrant: number }>({
    visible: false,
    quadrant: -1,
  });

  // Calculate inharmonicity coefficient B from measured data
  const calculateInharmonicityCoefficient = useCallback(
    (dataPoints: HarmonicDataPoint[]): number | null => {
      if (dataPoints.length < 2) return null;

      // Use least squares fitting to find B from: cents = 1200 * log2(sqrt(1 + B*n^2))
      // Rearranging: B = (2^(cents/1200))^2 - 1) / n^2

      let sumB = 0;
      let validPoints = 0;

      dataPoints.forEach(point => {
        if (point.harmonicNumber > 1 && point.centsDeviation > 0) {
          // Skip fundamental and negative values
          // Calculate B from this data point
          const centsRatio = point.centsDeviation / 1200; // Convert cents to ratio
          const frequencyRatio = Math.pow(2, centsRatio); // 2^(cents/1200)
          const B =
            (frequencyRatio * frequencyRatio - 1) / (point.harmonicNumber * point.harmonicNumber);

          if (B > 0 && B < 0.001) {
            // Sanity check - reasonable B values for pianos
            sumB += B;
            validPoints++;
          }
        }
      });

      return validPoints > 0 ? sumB / validPoints : null;
    },
    []
  );

  // Calculate standard theoretical inharmonicity using measured B coefficient
  const calculateStandardInharmonicity = useCallback(
    (harmonicNumber: number, B: number): number => {
      if (harmonicNumber === 1) return 0; // Fundamental has no deviation

      // Standard inharmonicity formula: cents = 1200 * log2(sqrt(1 + B*n^2))
      const ratio = Math.sqrt(1 + B * harmonicNumber * harmonicNumber);
      const cents = 1200 * Math.log2(ratio);

      return cents;
    },
    []
  );

  // Compute predicted inharmonicity (archetype-based) from session pianoConfig
  const computePredictedCents = useCallback(
    (harmonics: number[]): number[] => {
      if (!sessionId || !selectedNote) return [];
      const session = getTuningSession(sessionId);
      const cfg = session?.pianoConfig?.inharmonicity as
        | { B_A3?: number; gamma?: number }
        | undefined;
      if (!cfg || typeof cfg.B_A3 !== 'number' || !(cfg.B_A3 > 0)) return [];

      // Use temperament/ET fallback for f0 reference
      const f0 = beatMinimizerIntegration.getFallbackFrequency(selectedNote);
      if (!(f0 > 0)) return [];

      const gamma = typeof cfg.gamma === 'number' ? cfg.gamma : 2;
      const B_note = scaleBFromA3(cfg.B_A3 as number, f0, 220, gamma);
      return harmonics.map(h => calculateStandardInharmonicity(h, B_note));
    },
    [sessionId, selectedNote, calculateStandardInharmonicity]
  );

  // Compute predicted inharmonicity for a specific archetype (e.g., 'concert_grand' or 'spinet')
  const computeArchetypePredictedCents = useCallback(
    (harmonics: number[], archetypeKey: 'concert_grand' | 'spinet'): number[] => {
      if (!sessionId || !selectedNote) return [];
      const session = getTuningSession(sessionId);
      const cfg = session?.pianoConfig?.inharmonicity as { gamma?: number } | undefined;

      // Use temperament (power-of-3) fallback for f0 reference (non-ET per system design)
      const f0 = beatMinimizerIntegration.getFallbackFrequency(selectedNote);
      if (!(f0 > 0)) return [];

      const gamma = typeof cfg?.gamma === 'number' ? cfg.gamma : 2;
      const B_A3 = reportA3ForArchetype(archetypeKey).B;
      const B_note = scaleBFromA3(B_A3, f0, 220, gamma);
      return harmonics.map(h => calculateStandardInharmonicity(h, B_note));
    },
    [sessionId, selectedNote, calculateStandardInharmonicity]
  );

  // Per-harmonic search window (cents) visualization helper
  const _getSearchWindowCents = useCallback((harmonicNumber: number): number => {
    if (harmonicNumber <= 1) return 0; // H1 no band
    if (harmonicNumber <= 4) return 25; // H2-H4
    if (harmonicNumber <= 6) return 30; // H5-H6
    return 35; // H7-H8
  }, []);

  // Psychoacoustic scaling function - matches FrameBasedHarmonicDisplay method
  const psychoacousticScale = useCallback((magnitudes: number[]): number[] => {
    if (magnitudes.length === 0) return [];

    // Find the maximum magnitude for normalization
    const maxMagnitude = Math.max(...magnitudes);
    if (maxMagnitude <= 0) return magnitudes.map(() => 0);

    // Apply psychoacoustic scaling (log10 with perceptual weighting)
    const scaled = magnitudes.map(mag => {
      if (mag <= 0) return 0;

      // Normalize to 0-1 range first
      const normalized = mag / maxMagnitude;

      // Apply psychoacoustic log scaling (Weber-Fechner law approximation)
      // Uses log10 with offset to handle quiet sounds better
      const logScaled = Math.log10(normalized * 9 + 1); // Maps 0-1 to 0-1 logarithmically

      return Math.max(0, Math.min(1, logScaled));
    });

    // Re-normalize so strongest = 1.0 (matches Beat Minimizer approach)
    const maxScaled = Math.max(...scaled);
    return maxScaled > 0 ? scaled.map(s => s / maxScaled) : scaled;
  }, []);

  // Compute weighted median (by raw magnitude) helper
  const computeWeightedMedian = useCallback(
    (values: number[], weights: number[]): number | null => {
      if (values.length === 0 || weights.length !== values.length) return null;
      const entries = values.map((v, i) => ({ v, w: Math.max(0, weights[i]) }));
      const totalWeight = entries.reduce((s, e) => s + e.w, 0);
      if (totalWeight <= 0) return null;
      // Sort by value
      entries.sort((a, b) => a.v - b.v);
      let cumulative = 0;
      for (const e of entries) {
        cumulative += e.w;
        if (cumulative >= totalWeight / 2) {
          return e.v;
        }
      }
      return entries[entries.length - 1]?.v ?? null;
    },
    []
  );

  // Compute B using per-harmonic volume-weighted median of cents, then average across harmonics
  const _computeWeightedMedianBFromCaptures = useCallback((): number | null => {
    if (!captureSeriesData || captureSeriesData.length === 0) return null;

    const perHarmonicBs: number[] = [];
    for (let harmonicNumber = 2; harmonicNumber <= 8; harmonicNumber++) {
      const centsSamples: number[] = [];
      const weightSamples: number[] = [];

      captureSeriesData.forEach(series => {
        const dp = series.dataPoints.find(p => p.harmonicNumber === harmonicNumber && p.isValid);
        if (dp && typeof dp.centsDeviation === 'number') {
          const rawMag = dp.rawMagnitude ?? 0;
          if (rawMag > 0 && dp.centsDeviation > 0) {
            centsSamples.push(dp.centsDeviation);
            weightSamples.push(rawMag);
          }
        }
      });

      const medianCents = computeWeightedMedian(centsSamples, weightSamples);
      if (medianCents !== null) {
        const centsRatio = medianCents / 1200;
        const freqRatio = Math.pow(2, centsRatio);
        const B = (freqRatio * freqRatio - 1) / (harmonicNumber * harmonicNumber);
        if (B > 0 && B < 0.001) {
          perHarmonicBs.push(B);
        }
      }
    }

    if (perHarmonicBs.length === 0) return null;
    const avgB = perHarmonicBs.reduce((s, b) => s + b, 0) / perHarmonicBs.length;
    return avgB;
  }, [captureSeriesData, computeWeightedMedian]);

  // Calculate quality score for a capture (same logic as harmonicCaptureService)
  const calculateCaptureQualityScore = useCallback((capture: any): number => {
    // Weighted magnitude score: H1=8, H2=7, H3=6, ..., H8=1
    let magnitudeScore = 0;
    const weights = [8, 7, 6, 5, 4, 3, 2, 1]; // H1 through H8

    capture.harmonics.forEach((harmonic: any, index: number) => {
      if (harmonic.isValid && index < 8) {
        magnitudeScore += harmonic.magnitude_median * weights[index];
      }
    });

    // Calculate total deviation (lower is better, so we'll invert it for scoring)
    let totalDeviation = 0;
    let validCount = 0;

    capture.harmonics.forEach((harmonic: any) => {
      if (harmonic.isValid) {
        totalDeviation += harmonic.ratio_std;
        validCount++;
      }
    });

    // Avoid division by zero
    const avgDeviation = validCount > 0 ? totalDeviation / validCount : 0;

    // Combine scores: high magnitude good, low deviation good
    const score = magnitudeScore - avgDeviation;

    return score;
  }, []);

  // Extract harmonic deviation data from all captures and best approximation
  const extractHarmonicData = useCallback(() => {
    if (!sessionId || !selectedNote) {
      setCaptureSeriesData([]);
      setBestApproximationData(null);
      return;
    }

    const captures = HarmonicCaptureService.getCapturesForNote(sessionId, selectedNote);
    const bestApprox = HarmonicCaptureService.getBestApproximation(sessionId, selectedNote);

    if (captures.length === 0) {
      setCaptureSeriesData([]);
      setBestApproximationData(null);
      return;
    }

    // Score all captures to identify quality
    const scoredCaptures = captures.map((capture, index) => ({
      capture,
      score: calculateCaptureQualityScore(capture),
      originalIndex: index,
    }));

    // Sort by score to find quality threshold (top 3-5 like best approximation)
    const sortedByScore = [...scoredCaptures].sort((a, b) => b.score - a.score);
    const topCount = Math.min(5, sortedByScore.length);
    const qualityThreshold = topCount > 0 ? sortedByScore[topCount - 1].score : 0;

    // Process all captures (up to 25 most recent) with quality info
    const recentCaptures = scoredCaptures.slice(-25); // Align with analysis window
    const captureSeriesArray: CaptureSeriesData[] = [];

    recentCaptures.forEach((scoredCapture, captureIndex) => {
      const capture = scoredCapture.capture;
      const isHighQuality = scoredCapture.score >= qualityThreshold;
      const dataPoints: HarmonicDataPoint[] = [];

      // Omit absolute Hz mapping when a measured fundamental is not explicitly provided

      // Collect all raw magnitudes for psychoacoustic scaling
      const allRawMagnitudes: number[] = [];
      capture.harmonics.forEach(h => {
        if (h.isValid && h.magnitude_median > 0) {
          allRawMagnitudes.push(h.magnitude_median);
        }
      });

      // Apply psychoacoustic scaling to this capture's magnitudes
      const scaledMagnitudes = psychoacousticScale(allRawMagnitudes);
      let scaledMagnitudeIndex = 0;

      // Process H1-H8
      for (
        let harmonicIndex = 0;
        harmonicIndex < Math.min(8, capture.harmonics.length);
        harmonicIndex++
      ) {
        const harmonic = capture.harmonics[harmonicIndex];
        const harmonicNumber = harmonicIndex + 1; // H1, H2, H3, etc.

        if (harmonic && harmonic.isValid && harmonic.ratio_mean > 0) {
          let centsDeviation = 0;

          if (harmonicNumber === 1) {
            // H1 is the reference, deviation is 0
            centsDeviation = 0;
          } else {
            // Calculate cents deviation from perfect harmonic ratio
            const idealRatio = harmonicNumber;
            centsDeviation = 1200 * Math.log2(harmonic.ratio_mean / idealRatio);
            // Enforce non-negative inharmonicity for display (discard negative dips)
            centsDeviation = Math.max(0, centsDeviation);
          }

          // Use psychoacoustically scaled magnitude for line drawing, but store raw for dot sizing
          const scaledMagnitude =
            harmonic.magnitude_median > 0 ? scaledMagnitudes[scaledMagnitudeIndex] || 0 : 0;
          if (harmonic.magnitude_median > 0) {
            scaledMagnitudeIndex++;
          }

          const dp: HarmonicDataPoint = {
            harmonicNumber,
            centsDeviation,
            magnitude: scaledMagnitude, // Keep scaled for line consistency
            isValid: true,
            rawMagnitude: harmonic.magnitude_median, // Add raw magnitude for dot sizing
          };
          // Only attach Hz when we have a trustworthy fundamental (not ET). Currently omitted.
          dataPoints.push(dp);
        }
      }

      if (dataPoints.length > 0) {
        captureSeriesArray.push({
          captureIndex,
          dataPoints,
          timestamp: Date.now(), // Could use actual capture timestamp if available
          isHighQuality,
        });
      }
    });

    setCaptureSeriesData(captureSeriesArray);

    // Process best approximation data (only show after 3+ captures)
    if (bestApprox && bestApprox.ratios && bestApprox.ratios.length > 0 && captures.length >= 3) {
      const bestDataPoints: HarmonicDataPoint[] = [];

      bestApprox.ratios.forEach(([ratio, magnitude], index) => {
        const harmonicNumber = index + 1;

        if (ratio && magnitude && typeof ratio === 'number' && typeof magnitude === 'number') {
          let centsDeviation = 0;

          if (harmonicNumber === 1) {
            // H1 is the reference, deviation is 0
            centsDeviation = 0;
          } else {
            // Calculate cents deviation from perfect harmonic ratio
            const idealRatio = harmonicNumber;
            centsDeviation = 1200 * Math.log2(ratio / idealRatio);
            // Enforce non-negative for best-approx display
            centsDeviation = Math.max(0, centsDeviation);
          }

          const dp: HarmonicDataPoint = {
            harmonicNumber,
            centsDeviation,
            magnitude,
            isValid: true,
            isEstimated:
              HarmonicCaptureService.getBestApproximation(sessionId!, selectedNote!)?.estimated?.[
                index
              ] || false,
          };
          bestDataPoints.push(dp);
        }
      });

      if (bestDataPoints.length > 0) {
        setBestApproximationData({ dataPoints: bestDataPoints });
      } else {
        setBestApproximationData(null);
      }
    } else {
      setBestApproximationData(null);
    }
  }, [sessionId, selectedNote, psychoacousticScale, calculateCaptureQualityScore]);

  // Update harmonic data when dependencies change
  useEffect(() => {
    extractHarmonicData();
  }, [extractHarmonicData]);

  // Draw the line chart
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    if (captureSeriesData.length === 0 && !bestApproximationData) {
      // Draw "No data" message
      ctx.fillStyle = theme.palette.text.secondary;
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('No harmonic data available', width / 2, height / 2);
      ctx.fillText('Strike a key to capture data', width / 2, height / 2 + 25);
      return;
    }

    // Chart dimensions with margins
    const margin = { top: 40, right: 50, bottom: 80, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Calculate dynamic Y-axis range: -5 to highest reading (max 50 cents)
    let maxDeviation = 10; // Default minimum of 10 cents for readability

    // Find the highest deviation across all data
    captureSeriesData.forEach(series => {
      series.dataPoints.forEach(point => {
        maxDeviation = Math.max(maxDeviation, point.centsDeviation);
      });
    });

    if (bestApproximationData) {
      bestApproximationData.dataPoints.forEach(point => {
        maxDeviation = Math.max(maxDeviation, point.centsDeviation);
      });
    }

    // Cap at 50 cents maximum, round up to nearest 5 for nice grid lines
    const yMax = Math.min(50, Math.ceil(maxDeviation / 5) * 5);
    const yRange = [-5, yMax];

    // Color scheme
    const isDark = theme.palette.mode === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = theme.palette.text.primary;
    const zeroLineColor = isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)';

    // Colors for different capture series (10 colors for up to 10 captures)
    const captureColors = [
      isDark ? 'rgba(77, 195, 247, 0.3)' : 'rgba(25, 118, 210, 0.3)', // Blue
      isDark ? 'rgba(129, 199, 132, 0.3)' : 'rgba(56, 142, 60, 0.3)', // Green
      isDark ? 'rgba(255, 167, 38, 0.3)' : 'rgba(239, 108, 0, 0.3)', // Orange
      isDark ? 'rgba(244, 143, 177, 0.3)' : 'rgba(194, 24, 91, 0.3)', // Pink
      isDark ? 'rgba(179, 157, 219, 0.3)' : 'rgba(123, 31, 162, 0.3)', // Purple
      isDark ? 'rgba(255, 193, 7, 0.3)' : 'rgba(255, 152, 0, 0.3)', // Amber
      isDark ? 'rgba(121, 85, 72, 0.3)' : 'rgba(78, 52, 46, 0.3)', // Brown
      isDark ? 'rgba(96, 125, 139, 0.3)' : 'rgba(55, 71, 79, 0.3)', // Blue Grey
      isDark ? 'rgba(255, 112, 67, 0.3)' : 'rgba(216, 67, 21, 0.3)', // Deep Orange
      isDark ? 'rgba(174, 213, 129, 0.3)' : 'rgba(104, 159, 56, 0.3)', // Light Green
    ];

    // Best approximation color (highlighted)
    const bestApproxColor = isDark ? '#26C6DA' : '#0097A7'; // Teal - distinct from warnings

    // Standard inharmonicity color (reference)
    const standardInharmonicityColor = isDark ? '#9C27B0' : '#7B1FA2'; // Purple - theoretical reference

    // Helper functions - add padding so bars don't touch edges
    const xPadding = chartWidth * 0.05; // 5% padding on each side
    const usableChartWidth = chartWidth - 2 * xPadding;
    const xScale = (harmonicNum: number) =>
      margin.left + xPadding + ((harmonicNum - 1) / 7) * usableChartWidth;
    const yScale = (cents: number) =>
      margin.top + chartHeight - ((cents - yRange[0]) / (yRange[1] - yRange[0])) * chartHeight;

    // Draw background
    ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(margin.left, margin.top, chartWidth, chartHeight);

    // Draw grid lines (horizontal - cents)
    // Only major grid lines at 0 and every 10 cents
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;

    // Grid line at 0 cents (always show)
    const y0 = yScale(0);
    ctx.beginPath();
    ctx.moveTo(margin.left, y0);
    ctx.lineTo(margin.left + chartWidth, y0);
    ctx.stroke();

    // Grid lines every 10 cents (but not at 0 since we already drew it)
    for (let cents = 10; cents <= yMax; cents += 10) {
      const y = yScale(cents);
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + chartWidth, y);
      ctx.stroke();
    }

    // Draw grid lines (vertical - harmonics)
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    for (let h = 1; h <= 8; h++) {
      const x = xScale(h);
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + chartHeight);
      ctx.stroke();
    }

    // Draw zero line (perfect tuning)
    ctx.strokeStyle = zeroLineColor;
    ctx.lineWidth = 2;
    const zeroY = yScale(0);
    ctx.beginPath();
    ctx.moveTo(margin.left, zeroY);
    ctx.lineTo(margin.left + chartWidth, zeroY);
    ctx.stroke();

    // First pass: Draw composite magnitude bars (background)
    const deviationPoints: {
      seriesIndex: number;
      x: number;
      y: number;
      harmonicNum: number;
      magnitude: number;
      isHighQuality: boolean;
    }[] = [];

    // Calculate composite magnitudes for background bars
    const compositeMagnitudes: { [harmonicNum: number]: number } = {};

    for (let harmonicNum = 1; harmonicNum <= 8; harmonicNum++) {
      let totalMagnitude = 0;
      let count = 0;

      // Collect magnitudes from all high-quality captures
      captureSeriesData.forEach(series => {
        if (series.isHighQuality) {
          const dataPoint = series.dataPoints.find(p => p.harmonicNumber === harmonicNum);
          if (dataPoint) {
            totalMagnitude += dataPoint.magnitude;
            count++;
          }
        }
      });

      // Add best approximation if available
      if (bestApproximationData) {
        const dataPoint = bestApproximationData.dataPoints.find(
          p => p.harmonicNumber === harmonicNum
        );
        if (dataPoint) {
          totalMagnitude += dataPoint.magnitude;
          count++;
        }
      }

      compositeMagnitudes[harmonicNum] = count > 0 ? totalMagnitude / count : 0;
    }

    // Removed shaded search band behind bars per user request

    // Draw background magnitude bars
    for (let harmonicNum = 1; harmonicNum <= 8; harmonicNum++) {
      const harmonicX = xScale(harmonicNum);
      const compositeMagnitude = compositeMagnitudes[harmonicNum];

      if (compositeMagnitude > 0) {
        const bottomY = yScale(Math.max(yRange[0], 0));
        const barHeight = compositeMagnitude * (bottomY - margin.top) * 0.8;
        const barWidth = 20; // Fixed width for background bars

        // Draw light background bar
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(harmonicX - barWidth / 2, bottomY - barHeight, barWidth, barHeight);

        // Add subtle border
        ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(harmonicX - barWidth / 2, bottomY - barHeight, barWidth, barHeight);
      }
    }

    // Second pass: Draw individual capture dots on top
    for (let harmonicNum = 1; harmonicNum <= 8; harmonicNum++) {
      const harmonicX = xScale(harmonicNum);

      // Draw capture series dots
      captureSeriesData.forEach((series, seriesIndex) => {
        const dataPoint = series.dataPoints.find(p => p.harmonicNumber === harmonicNum);
        if (dataPoint) {
          const color = captureColors[seriesIndex % captureColors.length];
          const deviationY = yScale(
            Math.max(yRange[0], Math.min(yRange[1], dataPoint.centsDeviation))
          );

          // Draw circle dot - size based on magnitude with more dramatic scaling
          // Use the psychoacoustically scaled magnitude for proportionate sizing
          const minRadius = 2; // Much smaller minimum
          const maxRadius = 14; // Larger maximum
          const radius = minRadius + (maxRadius - minRadius) * dataPoint.magnitude;

          // Fade out low quality captures
          const opacity = series.isHighQuality ? 1.0 : 0.2;

          ctx.globalAlpha = opacity;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(harmonicX, deviationY, radius, 0, 2 * Math.PI);
          ctx.fill();

          // Add border for high quality captures
          if (series.isHighQuality) {
            ctx.strokeStyle = isDark ? '#FFF' : '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          ctx.globalAlpha = 1.0; // Reset opacity

          // Store deviation point for connecting lines
          deviationPoints.push({
            seriesIndex,
            x: harmonicX,
            y: deviationY,
            harmonicNum,
            magnitude: dataPoint.magnitude,
            isHighQuality: series.isHighQuality,
          });
        }
      });

      // Draw best approximation dot (prominent)
      if (bestApproximationData) {
        const dataPoint = bestApproximationData.dataPoints.find(
          p => p.harmonicNumber === harmonicNum
        );
        if (dataPoint) {
          const deviationY = yScale(
            Math.max(yRange[0], Math.min(yRange[1], dataPoint.centsDeviation))
          );

          // Draw larger dot for best approximation - already psychoacoustically scaled
          const minRadius = 3; // Slightly larger minimum for prominence
          const maxRadius = 16; // Larger maximum for best approximation
          const radius = minRadius + (maxRadius - minRadius) * dataPoint.magnitude;

          // Estimated markers are drawn hollow; measured as filled
          const isEstimated = (dataPoint as any).isEstimated === true;
          // Suspect if estimated or very low magnitude
          const suspect = isEstimated || (dataPoint.magnitude ?? 0) < 0.12;
          const suspectColor = isDark ? '#FFB74D' : '#F57C00';
          ctx.beginPath();
          ctx.arc(harmonicX, deviationY, radius, 0, 2 * Math.PI);
          if (isEstimated) {
            ctx.strokeStyle = suspect ? suspectColor : bestApproxColor;
            ctx.lineWidth = 2;
            ctx.stroke();
          } else {
            ctx.fillStyle = bestApproxColor;
            ctx.fill();
            ctx.strokeStyle = suspect ? suspectColor : isDark ? '#FFF' : '#000';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // Store best approximation deviation point for connecting lines
          deviationPoints.push({
            seriesIndex: -1, // Special index for best approximation
            x: harmonicX,
            y: deviationY,
            harmonicNum,
            magnitude: dataPoint.magnitude,
            isHighQuality: true,
          });
        }
      }
    }

    // Predicted curve (archetype-based): purple dashed (band already drawn behind bars)
    {
      const harmonics = Array.from({ length: 8 }, (_, i) => i + 1);
      const predictedCents = computePredictedCents(harmonics);
      if (predictedCents.length === 8) {
        ctx.strokeStyle = standardInharmonicityColor;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        harmonics.forEach((h, i) => {
          const x = xScale(h);
          const y = yScale(Math.max(yRange[0], Math.min(yRange[1], predictedCents[i])));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Min/Max predicted curves from archetype extremes
    {
      const harmonics = Array.from({ length: 8 }, (_, i) => i + 1);

      // Min (concert grand) - typically lowest inharmonicity
      const minPred = computeArchetypePredictedCents(harmonics, 'concert_grand');
      if (minPred.length === 8) {
        const minColor = isDark ? '#4CAF50' : '#2E7D32';
        ctx.strokeStyle = minColor;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        harmonics.forEach((h, i) => {
          const x = xScale(h);
          const y = yScale(Math.max(yRange[0], Math.min(yRange[1], minPred[i])));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Max (spinet) - typically highest inharmonicity
      const maxPred = computeArchetypePredictedCents(harmonics, 'spinet');
      if (maxPred.length === 8) {
        const maxColor = isDark ? '#EF5350' : '#C62828';
        ctx.strokeStyle = maxColor;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        harmonics.forEach((h, i) => {
          const x = xScale(h);
          const y = yScale(Math.max(yRange[0], Math.min(yRange[1], maxPred[i])));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Measured curve (aggregate of captures): blue solid, segmented (no line through gaps)
    {
      const harmonics = Array.from({ length: 8 }, (_, i) => i + 1);
      const agg: Array<number | null> = harmonics.map(() => null);
      harmonics.forEach(h => {
        let sum = 0;
        let wsum = 0;
        captureSeriesData.forEach(series => {
          if (!series.isHighQuality) return;
          const dp = series.dataPoints.find(p => p.harmonicNumber === h);
          if (dp && dp.isValid) {
            const w = Math.max(0.0001, dp.magnitude);
            sum += w * Math.max(0, dp.centsDeviation); // clamp negative
            wsum += w;
          }
        });
        if (wsum > 0) agg[h - 1] = sum / wsum;
      });

      ctx.strokeStyle = '#1976d2';
      ctx.lineWidth = 3;
      let started = false;
      harmonics.forEach(h => {
        const v = agg[h - 1];
        const x = xScale(h);
        if (v == null) {
          if (started) {
            ctx.stroke();
            started = false;
          }
          return;
        }
        const y = yScale(Math.max(yRange[0], Math.min(yRange[1], v)));
        if (!started) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      if (started) ctx.stroke();
    }

    // Best approximation curve (baseline teal, overlay suspect segments in orange)
    if (bestApproximationData) {
      const allBest = deviationPoints
        .filter(point => point.seriesIndex === -1)
        .sort((a, b) => a.harmonicNum - b.harmonicNum);

      if (allBest.length > 1) {
        // 1) Draw baseline continuous teal line
        ctx.strokeStyle = bestApproxColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        let started = false;
        allBest.forEach(p => {
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        });
        if (started) ctx.stroke();

        // 2) Overlay suspect segments (estimated or very low magnitude)
        const suspectColor = isDark ? '#FFB74D' : '#F57C00';
        const points = allBest.map(p => {
          const dp = bestApproximationData.dataPoints.find(
            d => d.harmonicNumber === p.harmonicNum
          ) as any;
          const isEstimated = dp?.isEstimated === true;
          const lowMag = (p.magnitude || 0) < 0.12;
          return { x: p.x, y: p.y, suspect: isEstimated || lowMag };
        });

        ctx.strokeStyle = suspectColor;
        ctx.lineWidth = 4.5;
        ctx.setLineDash([6, 4]);
        let segStarted = false;
        ctx.beginPath();
        points.forEach((pt, idx) => {
          if (pt.suspect) {
            if (!segStarted) {
              // Start a new suspect segment at this point
              ctx.moveTo(pt.x, pt.y);
              segStarted = true;
            } else {
              ctx.lineTo(pt.x, pt.y);
            }
          } else if (segStarted) {
            // Close current suspect segment at the last suspect point and reset
            ctx.stroke();
            ctx.beginPath();
            segStarted = false;
          }
          // If last point is suspect and we are in a segment, stroke it
          if (idx === points.length - 1 && segStarted) {
            ctx.stroke();
            ctx.beginPath();
            segStarted = false;
          }
        });
        ctx.setLineDash([]);
      }
    }

    // Draw axes
    ctx.strokeStyle = textColor;
    ctx.lineWidth = 2;

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + chartHeight);
    ctx.stroke();

    // X-axis
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top + chartHeight);
    ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight);
    ctx.stroke();

    // Labels
    ctx.fillStyle = textColor;
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';

    // X-axis labels (harmonic numbers and note names)
    ctx.textAlign = 'center';
    for (let h = 1; h <= 8; h++) {
      const x = xScale(h);

      // Harmonic number
      ctx.fillText(`H${h}`, x, margin.top + chartHeight + 20);

      // Note name (if we have a selected note) - place in unused negative space
      if (selectedNote) {
        const noteName = calculateHarmonicNoteName(selectedNote, h);
        if (noteName) {
          // Color code based on harmonic relationship to equal temperament
          // H1, H2, H4, H8 = octaves (exact)
          // H3, H6 = perfect fifths (within ~2 cents)
          // H5, H7 = far off in ET (need orange/red warning)
          const isCloseToET = [1, 2, 3, 4, 6, 8].includes(h);
          const textColor = isCloseToET
            ? isDark
              ? '#E0E0E0'
              : '#424242' // Normal color for close harmonics
            : isDark
              ? '#FF9800'
              : '#F57C00'; // Orange for harmonics far off in ET (5, 7)

          // Place note names at -1 cent line (in the unused negative space)
          const noteNameY = yScale(-1);

          ctx.fillStyle = textColor;
          ctx.font = '14px Arial'; // Slightly larger font
          ctx.fillText(noteName, x, noteNameY);
          ctx.font = '12px Arial'; // Reset font size
          ctx.fillStyle = theme.palette.text.primary; // Reset color
        }
      }
    }

    // Y-axis labels (cents)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Always label -5 cents
    const y_neg5_label = yScale(-5);
    ctx.fillText('-5¢', margin.left - 10, y_neg5_label);

    // Labels every 10 cents from 0 to yMax
    for (let cents = 0; cents <= yMax; cents += 10) {
      const y = yScale(cents);
      ctx.fillText(`${cents === 0 ? '0' : '+' + cents}¢`, margin.left - 10, y);
    }

    // Add intermediate labels for better precision if range is small
    if (yMax <= 20) {
      for (let cents = 5; cents <= yMax; cents += 10) {
        const y = yScale(cents);
        ctx.fillText(`+${cents}¢`, margin.left - 10, y);
      }
    }

    // Axis titles
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // X-axis title
    ctx.fillText('Harmonic Number', width / 2, height - 15);

    // Y-axis title (rotated)
    ctx.save();
    ctx.translate(20, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Cents Deviation | Dot Size = Magnitude', 0, 0);
    ctx.restore();

    // Title
    if (selectedNote) {
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`Inharmonicity & Magnitude - ${selectedNote}`, width / 2, 10);
    }

    // Add legend (compact for small screens)
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const legendY = margin.top + 10;
    const isCompactLegend = chartWidth < 640;
    ctx.fillStyle = textColor;

    // Short descriptor
    ctx.fillText('Bars avg | Dots strikes', margin.left, legendY);

    // Helper to draw a small line sample with label
    const drawLegendItem = (
      x: number,
      y: number,
      label: string,
      color: string,
      dash: number[] | null
    ) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x, y + 6);
      ctx.lineTo(x + 24, y + 6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.fillStyle = textColor;
      ctx.fillText(label, x + 30, y);
    };

    const row1Y = legendY + 18;
    const row2Y = legendY + 36;
    const col1X = margin.left;
    const col2X = margin.left + 140;
    const col3X = margin.left + 280;

    const minColor = isDark ? '#4CAF50' : '#2E7D32';
    const maxColor = isDark ? '#EF5350' : '#C62828';

    // Row 1: Pred, Meas, Best
    drawLegendItem(col1X, row1Y, 'Pred', standardInharmonicityColor, [8, 4]);
    drawLegendItem(col2X, row1Y, 'Meas', '#1976d2', null);
    drawLegendItem(col3X, row1Y, 'Best', bestApproxColor, null);

    // Row 2: Min, Max
    drawLegendItem(col1X, row2Y, 'Min', minColor, [6, 6]);
    drawLegendItem(col2X, row2Y, 'Max', maxColor, [2, 6]);

    if (!isCompactLegend && bestApproximationData) {
      ctx.fillStyle = textColor;
      ctx.fillText('Using last 25 captures', margin.left, legendY + 54);
    }

    // Calculate and display Hz deviations list only in non-compact view
    if (!isCompactLegend) {
      const dataSource =
        bestApproximationData ||
        (captureSeriesData.length > 0 ? captureSeriesData[captureSeriesData.length - 1] : null);

      if (dataSource) {
        const harmonicDeviations: {
          harmonicNumber: number;
          hzDeviation: number;
          absDeviation: number;
        }[] = [];

        dataSource.dataPoints.forEach(point => {
          if (
            point.harmonicNumber >= 2 &&
            point.harmonicNumber <= 8 &&
            point.actualFrequency &&
            point.idealFrequency
          ) {
            const hzDeviation = point.actualFrequency - point.idealFrequency;
            harmonicDeviations.push({
              harmonicNumber: point.harmonicNumber,
              hzDeviation: hzDeviation,
              absDeviation: Math.abs(hzDeviation),
            });
          }
        });

        harmonicDeviations.sort((a, b) => a.absDeviation - b.absDeviation);
        const best5 = harmonicDeviations.slice(0, 5);

        if (best5.length > 0) {
          ctx.font = 'bold 12px Arial';
          ctx.fillStyle = textColor;
          ctx.fillText('5 Best Hz Deviations (H2-H8):', margin.left, legendY + 70);

          ctx.font = '11px monospace';
          best5.forEach((harmonic, index) => {
            const sign = harmonic.hzDeviation >= 0 ? '+' : '';
            const text = `H${harmonic.harmonicNumber}: ${sign}${harmonic.hzDeviation.toFixed(2)} Hz`;

            if (Math.abs(harmonic.hzDeviation) < 0.5) {
              ctx.fillStyle = isDark ? '#4CAF50' : '#2E7D32';
            } else if (Math.abs(harmonic.hzDeviation) < 1.0) {
              ctx.fillStyle = isDark ? '#FFC107' : '#F57C00';
            } else {
              ctx.fillStyle = isDark ? '#FF5722' : '#D32F2F';
            }

            ctx.fillText(text, margin.left + 10, legendY + 85 + index * 13);
          });
        }
      }
    }
  }, [
    captureSeriesData,
    bestApproximationData,
    theme,
    selectedNote,
    calculateStandardInharmonicity,
    calculateInharmonicityCoefficient,
    computePredictedCents,
    computeArchetypePredictedCents,
  ]);

  // Handle canvas resize
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    drawChart();
  }, [drawChart]);

  // Initialize canvas and start animation
  useEffect(() => {
    handleResize();

    const resizeObserver = new ResizeObserver(handleResize);
    if (canvasRef.current?.parentElement) {
      resizeObserver.observe(canvasRef.current.parentElement);
    }

    return () => {
      resizeObserver.disconnect();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [handleResize]);

  // Redraw on data changes
  useEffect(() => {
    drawChart();
  }, [drawChart]);

  // Check if touch device
  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window);
  }, []);

  // Handle quadrant interactions for navigation
  const handleQuadrantInteraction = useCallback(
    (event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      if (zenMode) return; // Disable in zen mode

      event.stopPropagation();
      event.preventDefault();

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
      const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const centerX = rect.width / 2;
      const isLeftSide = x < centerX;
      const isTopHalf = y < rect.height / 2;

      const quadrant = isTopHalf ? (isLeftSide ? 0 : 1) : isLeftSide ? 2 : 3;

      setOverlay({ visible: true, quadrant });

      requestAnimationFrame(() => {
        if (isTopHalf) {
          if (isLeftSide) {
            onPrevOctave();
          } else {
            onNextOctave();
          }
        } else {
          if (isLeftSide) {
            onPreviousNote();
          } else {
            onNextNote();
          }
        }

        setTimeout(() => {
          setOverlay({ visible: false, quadrant: -1 });
        }, 200);
      });
    },
    [zenMode, onNextNote, onNextOctave, onPrevOctave, onPreviousNote]
  );

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (zenMode) return; // Disable navigation in zen mode

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          onPreviousNote();
          break;
        case 'ArrowRight':
          event.preventDefault();
          onNextNote();
          break;
        case 'ArrowUp':
          event.preventDefault();
          onNextOctave();
          break;
        case 'ArrowDown':
          event.preventDefault();
          onPrevOctave();
          break;
      }
    };

    if (!zenMode) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [zenMode, onPreviousNote, onNextNote, onPrevOctave, onNextOctave]);

  return (
    <PlotContainer
      ref={containerRef}
      onTouchStart={handleQuadrantInteraction}
      {...(!isTouchDevice ? { onClick: handleQuadrantInteraction } : {})}
    >
      <StyledCanvas ref={canvasRef} />
      {!zenMode && captureSeriesData.length === 0 && !bestApproximationData && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Strike a piano key to capture harmonic data
          </Typography>
        </Box>
      )}
      {/* Quadrant overlays for visual feedback */}
      {[0, 1, 2, 3].map(quadrant => (
        <Box
          key={quadrant}
          sx={{
            position: 'absolute',
            width: '50%',
            height: '50%',
            left: quadrant % 2 === 0 ? 0 : '50%',
            top: quadrant < 2 ? 0 : '50%',
            transition: 'background-color 0.2s',
            backgroundColor:
              overlay.visible && overlay.quadrant === quadrant
                ? 'rgba(255, 255, 255, 0.1)'
                : 'transparent',
            pointerEvents: 'none',
          }}
        />
      ))}
    </PlotContainer>
  );
};

export default HarmonicDeviationPlot;
