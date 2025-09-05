'use client';
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Box, useTheme, Theme } from '@mui/material';
import { styled } from '@mui/system';
import SpectrumDebugOverlay from './SpectrumDebugOverlay';
import { getColorSchemeGLSL, getPlotLineColors } from '../colorSchemes/colorSchemes';
import {
  StrikeHistoryStore,
  InitialStrikeHistoryStore,
  harmonicCaptureService,
} from '@/services/harmonicCaptureService';
import {
  RegionMetadata,
  StrikeState,
  StrikeMeasurement,
  registerStrikeStartCallback,
} from '@/app/wasm/audio_processor_wrapper';
import { usePlotSettings } from '../../settings/contexts/PlotSettingsContext';
import {
  beatMinimizerIntegration,
  type BeatTargetLineData,
  type ReferenceHarmonicLine,
} from '@/services/beatMinimizerIntegration';
import { strikeFrequencyTracker } from '@/services/strikeFrequencyTracker';

// Types
export interface SpectrumPlotProps {
  regionData: Float32Array;
  regionMetadata: RegionMetadata;
  thresholdPercentage: number;
  onThresholdChange: (threshold: number) => void;
  zenMode: boolean;
  noteFrequency: number;
  showLines: boolean;
  bellCurveWidth?: number;
  onBellCurveWidthChange?: (width: number) => void;
  onPreviousNote: () => void;
  onNextNote: () => void;
  onPrevOctave: () => void;
  onNextOctave: () => void;
  onToggleLines?: () => void;
  colorScheme: string;
  onColorSchemeChange?: (scheme: string) => void;
  peakMagnitude: number;
  magnitudeThreshold: number;
  strikeState: StrikeState;
  strikeMeasurement: StrikeMeasurement | null;
  selectedPartial?: number;
  // Beat minimization props
  sessionId?: string;
  currentNote?: string;
  pianoConfig?: any;
  // Reference harmonic lines
  showReferenceLines?: boolean;
  referenceLines?: ReferenceHarmonicLine[];
}

// Styled Components
const StyledCanvas = styled('canvas')({
  width: '100%',
  height: '100%',
  display: 'block',
  minHeight: '200px',
  '@media (max-width: 768px) and (orientation: portrait)': {
    minHeight: '150px', // Smaller minimum height for mobile portrait
  },
  position: 'relative',
  top: 0,
  left: 0,
  touchAction: 'none',
});

const StyledSvg = styled('svg')({
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'none',
});

// Temporary flag: render only the spectrum (no overlays, listeners, or interactions)
const SPECTRUM_ONLY = false;

// Modify vertex shader to handle peaks (threshold kept but set to 0 from JS)
const getVertexShaderSource = (colorSchemeName: string) => `
  attribute vec2 a_position;
  attribute float a_magnitude;
  attribute float a_index;
  
  uniform float u_totalBars;
  uniform float u_threshold;
  uniform bool u_zenMode;
  uniform float u_bellCurveWidth;
  uniform float u_peakBin;        // Peak bin location
  uniform float u_peakConfidence; // Peak confidence value
  
  varying vec4 v_color;
  
  float fisheyeTransform(float x) {
    float normalizedX = (x - 0.5) * 2.0;
    float distortion = u_bellCurveWidth;
    float transformed = sign(normalizedX) * abs(normalizedX) / (1.0 + abs(normalizedX) * distortion);
    transformed = transformed * (1.0 + distortion);
    return transformed * 0.5 + 0.5;
  }
  
  ${getColorSchemeGLSL(colorSchemeName)}
  
  void main() {
    float xPos = a_index / u_totalBars;
    float nextXPos = (a_index + 1.0) / u_totalBars;
    
    float transformedX = fisheyeTransform(xPos);
    float transformedNextX = fisheyeTransform(nextXPos);
    
    float clipSpaceX = transformedX * 2.0 - 1.0;
    float clipSpaceNextX = transformedNextX * 2.0 - 1.0;
    
    float barWidth = clipSpaceNextX - clipSpaceX;
    
    vec2 position = a_position;
    position.x = position.x * barWidth + clipSpaceX;
    
    if (position.y > -1.0) {
      position.y = -1.0 + (position.y + 1.0) * a_magnitude;
    }
    
    gl_Position = vec4(position, 0, 1);
    
    // Get base color using scheme; threshold is ignored in GLSL helper
    v_color = getColorForMagnitude(a_magnitude, u_threshold, u_zenMode);
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec4 v_color;
  
  void main() {
    gl_FragColor = v_color;
  }
`;

interface FrequencyLinesProps {
  noteFrequency: number;
  showLines: boolean;
  theme: Theme;
  bellCurveWidth: number;
  peakFrequency: number;
  peakMagnitude: number;
  strikeState: StrikeState;
  strikeMeasurement: StrikeMeasurement | null;
  showPeakFrequencyLine: boolean;
  plotSettings: any;
  selectedPartial?: number;
  // Beat minimization props
  sessionId?: string;
  currentNote?: string;
  pianoConfig?: any;
  // Reference harmonic lines
  showReferenceLines: boolean;
  referenceLines: ReferenceHarmonicLine[];
  // Strike line overlays
  strikeLines: Array<{
    timestamp: number;
    frequency: number;
    id: number;
    source?: 'event' | 'persisted' | 'fallback';
  }>;
}

const FrequencyLines: React.FC<FrequencyLinesProps> = ({
  noteFrequency,
  showLines,
  theme,
  bellCurveWidth,
  peakFrequency,
  peakMagnitude,
  strikeState,
  strikeMeasurement: _strikeMeasurement,
  showPeakFrequencyLine,
  plotSettings: _plotSettings,
  selectedPartial: _selectedPartial,
  sessionId,
  currentNote,
  pianoConfig,
  showReferenceLines,
  referenceLines,
  strikeLines,
}) => {
  const { settings } = usePlotSettings();
  const [strikeHistoryVersion, setStrikeHistoryVersion] = React.useState(0);
  const [debugStrikeLines, setDebugStrikeLines] = React.useState(false);

  React.useEffect(() => {
    try {
      setDebugStrikeLines(localStorage.getItem('strike-line-debug') === '1');
    } catch {}
  }, []);

  // Beat minimization state
  const [beatTargetLine, setBeatTargetLine] = useState<BeatTargetLineData | null>(null);

  // Freeze the peak frequency when we transition to MONITORING state
  const [_frozenPeakFrequency, setFrozenPeakFrequency] = React.useState<number | null>(null);
  const prevStrikeStateRef = React.useRef<StrikeState>(strikeState);

  React.useEffect(() => {
    // Capture peak frequency when transitioning from non-MONITORING to MONITORING
    if (prevStrikeStateRef.current !== 'MONITORING' && strikeState === 'MONITORING') {
      setFrozenPeakFrequency(peakFrequency);
    }
    prevStrikeStateRef.current = strikeState;
  }, [strikeState, peakFrequency]);

  // Update local state version when new strike measurements come in or when service emits
  React.useEffect(() => {
    setStrikeHistoryVersion(v => v + 1);
  }, [_strikeMeasurement?.timestamp]);

  // Also subscribe to capture events to refresh magenta line immediately on save
  React.useEffect(() => {
    const unsubscribe = harmonicCaptureService.onCaptureUpdate(() => {
      setStrikeHistoryVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  // Subscribe to strike frequency tracker updates
  React.useEffect(() => {
    const unsubscribe = strikeFrequencyTracker.subscribe(() => {
      // Force re-render when new strikes are recorded
      setStrikeHistoryVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  // Trigger re-render when strike frequency tracker data changes
  React.useEffect(() => {
    // Force update when current note changes or strikes are recorded
    setStrikeHistoryVersion(v => v + 1);
  }, [currentNote, _strikeMeasurement?.timestamp]);

  // Beat minimization effect
  React.useEffect(() => {
    if (!sessionId || !currentNote || !pianoConfig) {
      setBeatTargetLine(null);
      return;
    }

    // Update configuration if needed
    const baseFrequency = pianoConfig.temperament?.baseFrequency || 440;
    const temperamentPosition = pianoConfig.temperament?.startPosition || 7;
    beatMinimizerIntegration.updateConfiguration(baseFrequency, temperamentPosition, pianoConfig);

    try {
      // Check if note should use beat minimization
      const shouldUseBeat =
        beatMinimizerIntegration.referenceFinder.shouldUseBeatMinimization(currentNote);

      if (!shouldUseBeat) {
        // Note is in temperament region - no beat minimization needed
        setBeatTargetLine(null);
        return;
      }

      const targetData = beatMinimizerIntegration.getBeatTargetLine(currentNote, noteFrequency, {
        sessionId,
        minReferences: 2,
        qualityThreshold: 0.3,
        selectedPartial: _selectedPartial || 1,
      });

      setBeatTargetLine(targetData);
    } catch (error) {
      console.error('Error calculating beat target:', error);
      setBeatTargetLine(null);
    }
  }, [
    sessionId,
    currentNote,
    noteFrequency,
    pianoConfig,
    _selectedPartial,
    _strikeMeasurement?.timestamp,
  ]);

  // Get plot line colors based on the selected color scheme
  const plotLineColors = getPlotLineColors(settings.colorScheme, theme.palette.mode === 'dark');

  const getXPosition = useCallback(
    (freq: number) => {
      // Convert frequency to cents relative to target
      const cents = 1200 * Math.log2(freq / noteFrequency);
      // Convert cents to normalized position (-120 to +120 -> 0 to 1)
      const normalizedPos = (cents + 120) / 240;

      // Apply fisheye transformation (matching the shader)
      const normalizedX = (normalizedPos - 0.5) * 2.0;
      const distortion = bellCurveWidth;
      let transformed = normalizedX / (1.0 + Math.abs(normalizedX) * distortion);
      transformed = transformed * (1.0 + distortion);
      const transformedPos = (transformed + 1.0) * 0.5;

      return transformedPos * 100;
    },
    [noteFrequency, bellCurveWidth]
  );

  // Get strike state color
  const getStrikeStateColor = useCallback(() => {
    switch (strikeState) {
      case 'WAITING':
        return theme.palette.grey[500];
      case 'ATTACK':
        return theme.palette.warning.main;
      case 'MONITORING':
        return theme.palette.success.main;
      default:
        return theme.palette.grey[500];
    }
  }, [strikeState, theme]);

  // Retrieve first/last strike history for this note/session (display peak frequencies)
  const noteHistory = React.useMemo(() => {
    if (!sessionId || !currentNote) return null;
    try {
      return StrikeHistoryStore.getNoteHistory(sessionId, currentNote);
    } catch {
      return null;
    }
  }, [sessionId, currentNote, strikeHistoryVersion]);

  // Keeping last for any future use; suppress unused for first by renaming if needed
  const _lastStrikeDisplayFreq = noteHistory?.last?.displayPeakFrequency;

  // Initial strike history for UI-only neon cyan line
  const initialNoteHistory = React.useMemo(() => {
    if (!sessionId || !currentNote) return null;
    try {
      return InitialStrikeHistoryStore.getNoteHistory(sessionId, currentNote);
    } catch {
      return null;
    }
  }, [sessionId, currentNote, strikeHistoryVersion]);
  const _initialStrikeDisplayFreq =
    initialNoteHistory?.last?.displayPeakFrequency ||
    initialNoteHistory?.first?.displayPeakFrequency;

  return (
    <>
      <StyledSvg preserveAspectRatio="none">
        {/* Strike state indicator circle */}
        <circle cx="97%" cy="50%" r="8" fill={getStrikeStateColor()} opacity="0.6" />

        {/* Target frequency thick line representing ±0.5 cent accuracy zone */}
        <defs>
          <linearGradient id="targetZoneGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={plotLineColors.primary} stopOpacity="0.5" />
            <stop offset="50%" stopColor={plotLineColors.primary} stopOpacity="1.0" />
            <stop offset="100%" stopColor={plotLineColors.primary} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <rect
          x={`${getXPosition(noteFrequency * Math.pow(2, -0.5 / 1200))}%`}
          y="0%"
          width={`${getXPosition(noteFrequency * Math.pow(2, 0.5 / 1200)) - getXPosition(noteFrequency * Math.pow(2, -0.5 / 1200))}%`}
          height="100%"
          fill="url(#targetZoneGradient)"
        />
        {/* Center line for exact target frequency */}
        <line
          x1={`${getXPosition(noteFrequency)}%`}
          y1="0%"
          x2={`${getXPosition(noteFrequency)}%`}
          y2="100%"
          stroke={plotLineColors.primary}
          strokeWidth="1"
          strokeOpacity="0.8"
        />

        {showLines && (
          <>
            <line
              x1={`${getXPosition(noteFrequency * Math.pow(2, -100 / 1200))}%`}
              y1="0%"
              x2={`${getXPosition(noteFrequency * Math.pow(2, -100 / 1200))}%`}
              y2="100%"
              stroke={plotLineColors.secondary}
              strokeWidth="1"
              strokeOpacity="0.5"
              strokeDasharray="5,5"
            />
            <line
              x1={`${getXPosition(noteFrequency * Math.pow(2, -10 / 1200))}%`}
              y1="0%"
              x2={`${getXPosition(noteFrequency * Math.pow(2, -10 / 1200))}%`}
              y2="100%"
              stroke={plotLineColors.secondary}
              strokeWidth="1"
              strokeOpacity="0.5"
              strokeDasharray="5,5"
            />
            <line
              x1={`${getXPosition(noteFrequency * Math.pow(2, 10 / 1200))}%`}
              y1="0%"
              x2={`${getXPosition(noteFrequency * Math.pow(2, 10 / 1200))}%`}
              y2="100%"
              stroke={plotLineColors.secondary}
              strokeWidth="1"
              strokeOpacity="0.5"
              strokeDasharray="5,5"
            />
            <line
              x1={`${getXPosition(noteFrequency * Math.pow(2, 100 / 1200))}%`}
              y1="0%"
              x2={`${getXPosition(noteFrequency * Math.pow(2, 100 / 1200))}%`}
              y2="100%"
              stroke={plotLineColors.secondary}
              strokeWidth="1"
              strokeOpacity="0.5"
              strokeDasharray="5,5"
            />
          </>
        )}

        {/* Peak frequency line (drawn after center line so it's on top) */}
        {showPeakFrequencyLine && peakMagnitude >= 0.1 && (
          <line
            x1={`${getXPosition(peakFrequency)}%`}
            y1="0%"
            x2={`${getXPosition(peakFrequency)}%`}
            y2="100%"
            stroke="#cc0000"
            strokeWidth="4"
            strokeOpacity="0.8"
          />
        )}

        {/* Removed legacy green line (redundant) */}

        {/* Strike Frequency History Lines */}
        {currentNote &&
          (() => {
            // Get strike frequency history for current note
            const firstStrike = strikeFrequencyTracker.getFirstStrike(currentNote);
            const recentStrikes = strikeFrequencyTracker.getRecentStrikes(currentNote);

            // Debug logging - disabled to reduce spam
            // if (process.env.NODE_ENV === 'development') {
            //   console.log('Strike frequency lines for', currentNote, {
            //     firstStrike,
            //     recentStrikes,
            //     hasStrikes: strikeFrequencyTracker.hasStrikes(currentNote)
            //   });
            // }

            return (
              <>
                {/* Recent strikes FIRST - green with decreasing alpha (draw older/fainter lines first) */}
                {recentStrikes
                  .slice()
                  .reverse()
                  .map((frequency, reversedIndex) => {
                    if (frequency <= 0) return null;

                    // Calculate original index for alpha
                    const index = recentStrikes.length - 1 - reversedIndex;
                    // Most recent (index 0) has highest alpha, older strikes fade
                    const alpha = 1.0 - index * 0.18; // 1.0, 0.82, 0.64, 0.46, 0.28

                    return (
                      <line
                        key={`recent-strike-${index}`}
                        x1={`${getXPosition(frequency)}%`}
                        y1="0%"
                        x2={`${getXPosition(frequency)}%`}
                        y2="100%"
                        stroke="#00ff00"
                        strokeWidth={index === 0 ? '2.5' : '1.5'} // Thicker for most recent
                        strokeOpacity={alpha}
                        style={{ zIndex: 100 - index }} // Higher z-index for more recent
                      />
                    );
                  })}

                {/* First strike line LAST - bright yellow (draw on top) */}
                {firstStrike && firstStrike > 0 && (
                  <line
                    x1={`${getXPosition(firstStrike)}%`}
                    y1="0%"
                    x2={`${getXPosition(firstStrike)}%`}
                    y2="100%"
                    stroke="#ffff00"
                    strokeWidth="2.5"
                    strokeOpacity="1.0"
                    strokeDasharray="3,3" // Dashed to distinguish from green lines
                    style={{ zIndex: 110 }} // Highest z-index
                  />
                )}
              </>
            );
          })()}

        {/* Beat minimization target line */}
        {beatTargetLine && beatTargetLine.isVisible && (
          <>
            <line
              x1={`${getXPosition(beatTargetLine.frequency)}%`}
              y1="0%"
              x2={`${getXPosition(beatTargetLine.frequency)}%`}
              y2="100%"
              stroke="#ff6600"
              strokeWidth="4"
              strokeOpacity="1.0"
            />
            {/* Confidence indicator */}
            <circle
              cx={`${getXPosition(beatTargetLine.frequency)}%`}
              cy="10%"
              r="6"
              fill="#ff6600"
              opacity="1.0"
            />
          </>
        )}

        {/* Reference harmonic lines */}
        {showReferenceLines && referenceLines.length > 0 && (
          <>
            {referenceLines.map((line, index) => (
              <g key={`ref-line-${index}`}>
                <line
                  x1={`${getXPosition(line.frequency)}%`}
                  y1="0%"
                  x2={`${getXPosition(line.frequency)}%`}
                  y2="100%"
                  stroke={line.color}
                  strokeWidth="1.5"
                  strokeOpacity={String(typeof line.alpha === 'number' ? line.alpha : 0.7)}
                />
                {/* Magnitude indicator dot */}
                <circle
                  cx={`${getXPosition(line.frequency)}%`}
                  cy={`${90 - Math.min(1, line.magnitude) * 80}%`}
                  r="6"
                  fill={line.color}
                  opacity={String(typeof line.alpha === 'number' ? line.alpha : 0.9)}
                  stroke="white"
                  strokeWidth="1"
                />
                {/* Magnitude display only */}
                <text
                  x={`${getXPosition(line.frequency)}%`}
                  y="15%"
                  fill={line.color}
                  fontSize="11"
                  textAnchor="middle"
                  opacity="0.9"
                  fontWeight="bold"
                >
                  {(line.magnitude * 100).toFixed(0)}%
                </text>
              </g>
            ))}
          </>
        )}

        {/* Current strike snapshot(s) (persistent until next) - DISABLED: Using new color-coded history lines instead */}
        {false &&
          strikeLines &&
          strikeLines.length > 0 &&
          strikeLines.map(line => {
            // Calculate cents difference from target
            const centsFromTarget = 1200 * Math.log2(line.frequency / noteFrequency);
            const isVeryClose = Math.abs(centsFromTarget) <= 0.5;

            return (
              <g key={`strike-${line.id}`}>
                {/* Dual outline for very close strikes */}
                {isVeryClose && (
                  <>
                    {/* Black outline */}
                    <line
                      x1={`${getXPosition(line.frequency)}%`}
                      y1="0%"
                      x2={`${getXPosition(line.frequency)}%`}
                      y2="100%"
                      stroke="#000000"
                      strokeWidth="8"
                      strokeOpacity="0.8"
                    />
                    {/* White outline */}
                    <line
                      x1={`${getXPosition(line.frequency)}%`}
                      y1="0%"
                      x2={`${getXPosition(line.frequency)}%`}
                      y2="100%"
                      stroke="#ffffff"
                      strokeWidth="6"
                      strokeOpacity="0.8"
                    />
                  </>
                )}
                <line
                  x1={`${getXPosition(line.frequency)}%`}
                  y1="0%"
                  x2={`${getXPosition(line.frequency)}%`}
                  y2="100%"
                  stroke={isVeryClose ? '#00ffaa' : '#00ff88'}
                  strokeWidth={isVeryClose ? '4' : '3'}
                  strokeOpacity="1.0"
                  strokeDasharray={
                    debugStrikeLines ? (line.source === 'event' ? undefined : '8,3') : undefined
                  }
                />
                {debugStrikeLines && (
                  <text
                    x={`${getXPosition(line.frequency)}%`}
                    y="8%"
                    fill={isVeryClose ? '#00ffaa' : '#00ff88'}
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {line.source === 'event' ? 'E' : 'P'}
                  </text>
                )}
              </g>
            );
          })}
        {/* Fallback: render from strikeMeasurement if no strikeLines present - DISABLED: Using new color-coded history lines instead */}
        {false &&
          (!strikeLines || strikeLines.length === 0) &&
          _strikeMeasurement &&
          ([_strikeMeasurement] as const).map(m => {
            if (!m || !(m as any).isValid || m.frequency <= 0) return null;

            // Calculate cents difference from target
            const centsFromTarget = 1200 * Math.log2(m.frequency / noteFrequency);
            const isVeryClose = Math.abs(centsFromTarget) <= 0.5;

            return (
              <g key={`strike-fallback`}>
                {/* Dual outline for very close strikes */}
                {isVeryClose && (
                  <>
                    {/* Black outline */}
                    <line
                      x1={`${getXPosition(m.frequency)}%`}
                      y1="0%"
                      x2={`${getXPosition(m.frequency)}%`}
                      y2="100%"
                      stroke="#000000"
                      strokeWidth="8"
                      strokeOpacity="0.8"
                    />
                    {/* White outline */}
                    <line
                      x1={`${getXPosition(m.frequency)}%`}
                      y1="0%"
                      x2={`${getXPosition(m.frequency)}%`}
                      y2="100%"
                      stroke="#ffffff"
                      strokeWidth="6"
                      strokeOpacity="0.8"
                    />
                  </>
                )}
                <line
                  x1={`${getXPosition(m.frequency)}%`}
                  y1="0%"
                  x2={`${getXPosition(m.frequency)}%`}
                  y2="100%"
                  stroke={isVeryClose ? '#00ffaa' : '#00ff88'}
                  strokeWidth={isVeryClose ? '4' : '3'}
                  strokeOpacity="1.0"
                  strokeDasharray={debugStrikeLines ? '3,3' : undefined}
                />
                {debugStrikeLines && (
                  <text
                    x={`${getXPosition(m.frequency)}%`}
                    y="8%"
                    fill={isVeryClose ? '#00ffaa' : '#00ff88'}
                    fontSize="10"
                    textAnchor="middle"
                  >
                    F
                  </text>
                )}
              </g>
            );
          })}
      </StyledSvg>
    </>
  );
};

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    console.error('Failed to create shader');
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) {
    console.error('Failed to create program');
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

const createAndSetupMainProgram = (gl: WebGLRenderingContext, vertexShaderSource: string) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  if (!vertexShader || !fragmentShader) {
    console.error('Failed to create shaders');
    return null;
  }

  const program = createProgram(gl, vertexShader, fragmentShader);
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  return program;
};

const SpectrumPlot: React.FC<SpectrumPlotProps> = ({
  regionData,
  regionMetadata,
  thresholdPercentage: _thresholdPercentage,
  zenMode,
  noteFrequency,
  showLines,
  onPreviousNote,
  onNextNote,
  onPrevOctave,
  onNextOctave,
  colorScheme,
  strikeState,
  strikeMeasurement,
  selectedPartial,
  sessionId,
  currentNote,
  pianoConfig,
  showReferenceLines = false,
  referenceLines = [],
}) => {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const mainPositionBufferRef = useRef<WebGLBuffer | null>(null);
  const magnitudeBufferRef = useRef<WebGLBuffer | null>(null);
  const indexBufferRef = useRef<WebGLBuffer | null>(null);
  const allocatedMagnitudeBytesRef = useRef<number>(0);
  const instancedExtRef = useRef<ANGLE_instanced_arrays | null>(null);
  const attribLocsRef = useRef<{
    position: number;
    magnitude: number;
    index: number;
  } | null>(null);
  const uniformLocsRef = useRef<{
    totalBars: WebGLUniformLocation | null;
    threshold: WebGLUniformLocation | null;
    zenMode: WebGLUniformLocation | null;
    bellCurveWidth: WebGLUniformLocation | null;
    peakBin: WebGLUniformLocation | null;
    peakConfidence: WebGLUniformLocation | null;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [overlay, setOverlay] = useState<{ visible: boolean; quadrant: number }>({
    visible: false,
    quadrant: -1,
  });
  const { settings } = usePlotSettings();

  // Current strike snapshot (persists until next strike)
  const [currentStrikeLine, setCurrentStrikeLine] = useState<{
    timestamp: number;
    frequency: number;
    id: number;
    source?: 'event' | 'persisted';
  } | null>(null);

  // Removed persisted fallback capture; rely solely on strike-start callback for immediacy
  const prevStrikeStateRef = useRef<StrikeState>(strikeState);
  useEffect(() => {
    prevStrikeStateRef.current = strikeState;
  }, [strikeState]);

  // Keyboard handler for debug overlay (Shift+O)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'O') {
        setShowDebugOverlay(prev => !prev);
        console.log('Debug overlay toggled');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Register strike start callback once
  useEffect(() => {
    if (SPECTRUM_ONLY) return;
    const cb = (evt: { timestamp: number; frequency: number; strikeId: number }) => {
      // Snapshot at strike; persist until replaced by next strike
      const nowSec = performance.now() / 1000;
      setCurrentStrikeLine({
        timestamp: nowSec,
        frequency: evt.frequency,
        id: evt.strikeId,
        source: 'event',
      });

      // Persist for analytics / later use
      try {
        if (sessionId && currentNote && evt.frequency > 0) {
          harmonicCaptureService.logStrikeEvent(
            sessionId,
            currentNote,
            evt.frequency,
            evt.strikeId,
            evt.timestamp
          );
        }
      } catch {}
    };
    registerStrikeStartCallback(cb);
  }, [sessionId, currentNote]);

  // Removed persisted initialization; strike-start callback will emit immediately

  const resizeObserverCallback = useCallback((entries: ResizeObserverEntry[]) => {
    if (entries[0]) {
      const { width, height } = entries[0].contentRect;
      dimensionsRef.current = { width, height };
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const newW = Math.max(1, Math.floor(width * dpr));
        const newH = Math.max(1, Math.floor(height * dpr));
        if (canvas.width !== newW || canvas.height !== newH) {
          canvas.width = newW;
          canvas.height = newH;
          if (glRef.current) {
            glRef.current.viewport(0, 0, newW, newH);
          }
        }
      }
      if (glRef.current && programRef.current) {
        // Redraw after resize without re-initializing GL
        requestAnimationFrame(() => drawSpectrum());
      }
    }
  }, []);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(resizeObserverCallback);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    return () => resizeObserver.disconnect();
  }, [resizeObserverCallback]);

  const drawSpectrum = useCallback(() => {
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const program = programRef.current;
    const mainBuffer = mainPositionBufferRef.current;
    if (!canvas || !gl || !program || !mainBuffer) return;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const ext = instancedExtRef.current;
    if (!ext) return;

    // Draw main spectrum
    gl.useProgram(program);

    // Use region data directly - it's already processed by WASM
    const magnitudes = regionData;

    // Set up uniforms for the shader
    const uniformLocs = uniformLocsRef.current;
    if (!uniformLocs) return;
    gl.uniform1f(uniformLocs.totalBars, magnitudes.length);
    gl.uniform1i(uniformLocs.zenMode, zenMode ? 1 : 0);
    gl.uniform1f(uniformLocs.bellCurveWidth, settings.bellCurveWidth);
    // Eliminate threshold-based shading to avoid per-frame sorting
    // Set above 1.0 so no bars trigger the orange overlay in the shader
    gl.uniform1f(uniformLocs.threshold, 1.1);

    // Add peak detection uniforms
    gl.uniform1f(uniformLocs.peakBin, regionMetadata.peakBin);
    gl.uniform1f(uniformLocs.peakConfidence, regionMetadata.peakConfidence);

    // Update dynamic magnitudes buffer only
    if (!magnitudeBufferRef.current) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, magnitudeBufferRef.current);
    // Ensure capacity (in case length changed unexpectedly)
    const requiredBytes = magnitudes.byteLength;
    if (allocatedMagnitudeBytesRef.current < requiredBytes) {
      gl.bufferData(gl.ARRAY_BUFFER, requiredBytes, gl.DYNAMIC_DRAW);
      allocatedMagnitudeBytesRef.current = requiredBytes;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, magnitudes);

    ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, magnitudes.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }, [regionData, regionMetadata, zenMode, settings.bellCurveWidth]);

  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = dimensionsRef.current.width * dpr;
    canvas.height = dimensionsRef.current.height * dpr;

    // Always recreate the WebGL context when color scheme changes
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }
    glRef.current = gl;

    const program = createAndSetupMainProgram(gl, getVertexShaderSource(colorScheme));
    if (!program) return;

    // Clean up old program if it exists
    if (programRef.current) {
      gl.deleteProgram(programRef.current);
    }
    programRef.current = program;

    // Acquire instancing extension once
    const ext = gl.getExtension('ANGLE_instanced_arrays');
    if (!ext) {
      console.error('ANGLE_instanced_arrays not supported');
      return;
    }
    instancedExtRef.current = ext;

    // Cache attribute and uniform locations
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const magnitudeLoc = gl.getAttribLocation(program, 'a_magnitude');
    const indexLoc = gl.getAttribLocation(program, 'a_index');
    if (positionLoc === -1 || magnitudeLoc === -1 || indexLoc === -1) {
      console.error('Failed to get attribute locations');
      return;
    }
    attribLocsRef.current = {
      position: positionLoc,
      magnitude: magnitudeLoc,
      index: indexLoc,
    };
    uniformLocsRef.current = {
      totalBars: gl.getUniformLocation(program, 'u_totalBars'),
      threshold: gl.getUniformLocation(program, 'u_threshold'),
      zenMode: gl.getUniformLocation(program, 'u_zenMode'),
      bellCurveWidth: gl.getUniformLocation(program, 'u_bellCurveWidth'),
      peakBin: gl.getUniformLocation(program, 'u_peakBin'),
      peakConfidence: gl.getUniformLocation(program, 'u_peakConfidence'),
    };

    // Delete previous buffer if any to avoid GPU memory leaks
    if (mainPositionBufferRef.current) {
      gl.deleteBuffer(mainPositionBufferRef.current);
    }
    const mainBuffer = gl.createBuffer();
    mainPositionBufferRef.current = mainBuffer;

    if (mainBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mainBuffer);
      const vertices = new Float32Array([
        -1,
        -1, // Bottom left
        1,
        -1, // Bottom right
        -1,
        1, // Top left
        -1,
        1, // Top left
        1,
        -1, // Bottom right
        1,
        1, // Top right
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      // Bind a_position once
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(positionLoc);
    }

    // Create or reuse magnitude buffer and set attribute once
    if (magnitudeBufferRef.current) {
      gl.deleteBuffer(magnitudeBufferRef.current);
    }
    magnitudeBufferRef.current = gl.createBuffer();
    if (!magnitudeBufferRef.current) {
      console.error('Failed to create magnitude buffer');
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, magnitudeBufferRef.current);
    const initialBytes = regionData.length * 4;
    gl.bufferData(gl.ARRAY_BUFFER, initialBytes, gl.DYNAMIC_DRAW);
    allocatedMagnitudeBytesRef.current = initialBytes;
    gl.vertexAttribPointer(magnitudeLoc, 1, gl.FLOAT, false, 0, 0);
    ext.vertexAttribDivisorANGLE(magnitudeLoc, 1);
    gl.enableVertexAttribArray(magnitudeLoc);

    // Create or reuse static index buffer and set attribute once
    if (indexBufferRef.current) {
      gl.deleteBuffer(indexBufferRef.current);
    }
    indexBufferRef.current = gl.createBuffer();
    if (!indexBufferRef.current) {
      console.error('Failed to create index buffer');
      return;
    }
    const indexArray = new Float32Array(regionData.length);
    for (let i = 0; i < indexArray.length; i++) indexArray[i] = i;
    gl.bindBuffer(gl.ARRAY_BUFFER, indexBufferRef.current);
    gl.bufferData(gl.ARRAY_BUFFER, indexArray, gl.STATIC_DRAW);
    gl.vertexAttribPointer(indexLoc, 1, gl.FLOAT, false, 0, 0);
    ext.vertexAttribDivisorANGLE(indexLoc, 1);
    gl.enableVertexAttribArray(indexLoc);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    drawSpectrum();
    // Cleanup on unmount or scheme change: delete GL resources
    return () => {
      const glCtx = glRef.current;
      if (!glCtx) return;
      if (programRef.current) {
        glCtx.deleteProgram(programRef.current);
        programRef.current = null as unknown as WebGLProgram;
      }
      if (mainPositionBufferRef.current) {
        glCtx.deleteBuffer(mainPositionBufferRef.current);
        mainPositionBufferRef.current = null;
      }
      if (magnitudeBufferRef.current) {
        glCtx.deleteBuffer(magnitudeBufferRef.current);
        magnitudeBufferRef.current = null;
        allocatedMagnitudeBytesRef.current = 0;
      }
      if (indexBufferRef.current) {
        glCtx.deleteBuffer(indexBufferRef.current);
        indexBufferRef.current = null;
      }
      instancedExtRef.current = null;
      attribLocsRef.current = null;
      uniformLocsRef.current = null;
    };
  }, [colorScheme]);

  // Rebuild buffers only when the number of bars changes
  useEffect(() => {
    const gl = glRef.current;
    const ext = instancedExtRef.current;
    if (!gl || !ext) return;

    // Ensure magnitude buffer capacity matches
    const requiredBytes = regionData.length * 4;
    if (magnitudeBufferRef.current) {
      if (allocatedMagnitudeBytesRef.current !== requiredBytes) {
        gl.bindBuffer(gl.ARRAY_BUFFER, magnitudeBufferRef.current);
        gl.bufferData(gl.ARRAY_BUFFER, requiredBytes, gl.DYNAMIC_DRAW);
        allocatedMagnitudeBytesRef.current = requiredBytes;
      }
    }

    // Rebuild indices when count changes
    if (indexBufferRef.current) {
      const indexArray = new Float32Array(regionData.length);
      for (let i = 0; i < indexArray.length; i++) indexArray[i] = i;
      gl.bindBuffer(gl.ARRAY_BUFFER, indexBufferRef.current);
      gl.bufferData(gl.ARRAY_BUFFER, indexArray, gl.STATIC_DRAW);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }, [regionData.length]);

  const handleQuadrantInteraction = useCallback(
    (event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
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
          if (isLeftSide && onPrevOctave) {
            onPrevOctave();
          } else if (!isLeftSide && onNextOctave) {
            onNextOctave();
          }
        } else {
          if (isLeftSide && onPreviousNote) {
            onPreviousNote();
          } else if (!isLeftSide && onNextNote) {
            onNextNote();
          }
        }

        setTimeout(() => {
          setOverlay({ visible: false, quadrant: -1 });
        }, 200);
      });
    },
    [onNextNote, onNextOctave, onPrevOctave, onPreviousNote]
  );

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window);
  }, []);

  // Remove debug logging for peak frequency
  useEffect(() => {
    drawSpectrum();
  }, [drawSpectrum]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        padding: 0,
        touchAction: 'none',
      }}
      onTouchStart={SPECTRUM_ONLY ? undefined : handleQuadrantInteraction}
      {...(!isTouchDevice && !SPECTRUM_ONLY ? { onClick: handleQuadrantInteraction } : {})}
    >
      <StyledCanvas ref={canvasRef} />
      {!SPECTRUM_ONLY && (
        <>
          {/* Debug Overlay */}
          <SpectrumDebugOverlay
            currentNote={currentNote || 'Unknown'}
            isVisible={showDebugOverlay}
            strikeState={strikeState}
            peakFrequency={regionMetadata.peakFrequency}
            noteFrequency={noteFrequency}
            bellCurveWidth={settings.bellCurveWidth}
          />
          <FrequencyLines
            noteFrequency={noteFrequency}
            showLines={showLines}
            theme={theme}
            bellCurveWidth={settings.bellCurveWidth}
            peakFrequency={regionMetadata.peakFrequency}
            peakMagnitude={regionMetadata.peakMagnitude}
            strikeState={strikeState}
            strikeMeasurement={strikeMeasurement}
            showPeakFrequencyLine={settings.showPeakFrequencyLine}
            plotSettings={settings}
            selectedPartial={selectedPartial}
            sessionId={sessionId}
            currentNote={currentNote}
            pianoConfig={pianoConfig}
            showReferenceLines={showReferenceLines}
            referenceLines={referenceLines}
            strikeLines={currentStrikeLine ? [currentStrikeLine] : []}
          />
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
        </>
      )}
    </Box>
  );
};

export default React.memo(SpectrumPlot, (prevProps, nextProps) => {
  return (
    prevProps.regionData === nextProps.regionData &&
    prevProps.regionMetadata === nextProps.regionMetadata &&
    prevProps.thresholdPercentage === nextProps.thresholdPercentage &&
    prevProps.zenMode === nextProps.zenMode &&
    prevProps.noteFrequency === nextProps.noteFrequency &&
    prevProps.showLines === nextProps.showLines &&
    prevProps.colorScheme === nextProps.colorScheme &&
    prevProps.strikeState === nextProps.strikeState &&
    prevProps.strikeMeasurement?.frequency === nextProps.strikeMeasurement?.frequency &&
    prevProps.strikeMeasurement?.magnitude === nextProps.strikeMeasurement?.magnitude
  );
});
