'use client';
import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Box, useTheme, Theme, Button, Typography } from '@mui/material';
import { styled } from '@mui/system';
import { getPlotLineColors } from '../colorSchemes/colorSchemes';
import { RegionMetadata, StrikeState, StrikeMeasurement } from '@/app/wasm/audio_processor_wrapper';
import { usePlotSettings } from '../../settings/contexts/PlotSettingsContext';

// Styled components
const StyledCanvas = styled('canvas')({
  width: '100%',
  height: '100%',
  display: 'block',
  minHeight: '200px',
  position: 'absolute',
  top: 0,
  left: 0,
  touchAction: 'none',
  zIndex: 1,
});

const StyledSvg = styled('svg')({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: 2,
});

// Types
export interface MeasurementPlotProps {
  regionData: Float32Array[];
  regionMetadata: RegionMetadata[];
  harmonics: number[];
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
  magnitudeThreshold?: number;
  strikeState: StrikeState;
  strikeMeasurementFrequency?: number | null;
  strikeMeasurement?: StrikeMeasurement | null;
  startingNote?: string;
  _thresholdPercentage?: number;
  _zenMode?: boolean;
}

interface FrequencyLinesProps {
  noteFrequency: number;
  showLines: boolean;
  theme: Theme;
  bellCurveWidth: number;
  frozenPeakData: Array<{
    peakFrequency: number;
    peakMagnitude: number;
    harmonicNumber: number;
  }> | null;
  harmonics: number[];
  peakFrequencies: number[];
  strikeState?: StrikeState;
  strikeMeasurementFrequency?: number | null;
  strikeMeasurement?: StrikeMeasurement | null;
  showPeakFrequencyLine: boolean;
  showStrikeStateLine: boolean;
  plotSettings: any;
}

const FrequencyLines: React.FC<FrequencyLinesProps> = ({
  noteFrequency,
  showLines,
  theme,
  bellCurveWidth,
  frozenPeakData,
  harmonics: _harmonics,
  peakFrequencies: _peakFrequencies,
  strikeState: _strikeState,
  strikeMeasurementFrequency: _strikeMeasurementFrequency,
  strikeMeasurement: _strikeMeasurement,
  showPeakFrequencyLine: _showPeakFrequencyLine,
  showStrikeStateLine: _showStrikeStateLine,
  plotSettings,
}) => {
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

  // Function to get the X position for peak data display
  const getPeakXPosition = useCallback(
    (peak: { peakFrequency: number; harmonicNumber: number; normalizedFrequency: number }) => {
      const normalizedFreq = peak.peakFrequency / peak.harmonicNumber;
      return getXPosition(normalizedFreq);
    },
    [getXPosition]
  );

  // Calculate cents deviation from target frequency
  const calculateCentsDeviation = useCallback(
    (freq: number, harmonicNumber: number = 1) => {
      // Calculate the expected frequency for this harmonic
      const expectedFreq = noteFrequency * harmonicNumber;
      // Calculate cents deviation from the expected frequency
      return 1200 * Math.log2(freq / expectedFreq);
    },
    [noteFrequency]
  );

  // Format cents deviation with appropriate sign and precision
  const formatCentsDeviation = (cents: number) => {
    const sign = cents >= 0 ? '+' : '';
    return `${sign}${cents.toFixed(1)}¢`;
  };

  // Get harmonic color
  const getHarmonicColor = (harmonicIndex: number) => {
    switch (harmonicIndex) {
      case 0:
        return 'rgba(255, 0, 0, 1.0)'; // Red for fundamental
      case 1:
        return 'rgba(0, 204, 0, 1.0)'; // Bright green for 2nd harmonic
      case 2:
        return 'rgba(0, 102, 255, 1.0)'; // Blue for 3rd harmonic
      default:
        return 'rgba(242, 242, 0, 1.0)'; // Yellow for any other harmonics
    }
  };

  // Get color based on cents deviation - piano technician specific
  const getCentsDeviationColor = (cents: number) => {
    const absCents = Math.abs(cents);

    if (absCents < 2.0) {
      return 'rgba(0, 255, 0, 0.8)'; // Green for very close (< 2 cents)
    } else if (absCents < 5.0) {
      return 'rgba(255, 255, 0, 0.8)'; // Yellow for slight deviation (2-5 cents)
    } else if (absCents < 10.0) {
      return 'rgba(255, 128, 0, 0.8)'; // Orange for moderate deviation (5-10 cents)
    } else {
      return 'rgba(255, 0, 0, 0.8)'; // Red for significant deviation (> 10 cents)
    }
  };

  // Get color based on deviation from ideal harmonic
  const getDeviationColor = (actualRatio: number, idealRatio: number) => {
    // Calculate deviation percentage
    const deviation = Math.abs((actualRatio - idealRatio) / idealRatio) * 100;

    if (deviation < 0.5) {
      return 'rgba(0, 255, 0, 0.8)'; // Green for very close
    } else if (deviation < 1.0) {
      return 'rgba(255, 255, 0, 0.8)'; // Yellow for slight deviation
    } else if (deviation < 2.0) {
      return 'rgba(255, 128, 0, 0.8)'; // Orange for moderate deviation
    } else {
      return 'rgba(255, 0, 0, 0.8)'; // Red for significant deviation
    }
  };

  // Prepare peak data to display
  const peaksToDisplay = useMemo(() => {
    // Only display frozen peak data when available
    if (frozenPeakData) {
      // Find the fundamental frequency (first harmonic)
      const fundamental = frozenPeakData.find(peak => peak.harmonicNumber === 1);
      const fundamentalFreq = fundamental?.peakFrequency || noteFrequency;

      return frozenPeakData.map(peak => {
        // Calculate cents deviation from the expected frequency for this harmonic
        const centsDeviation = calculateCentsDeviation(peak.peakFrequency, peak.harmonicNumber);
        const formattedCents = formatCentsDeviation(centsDeviation);

        // Calculate the normalized frequency (frequency divided by harmonic number)
        const normalizedFrequency = peak.peakFrequency / peak.harmonicNumber;

        // Calculate the actual ratio to the fundamental
        const actualRatio = peak.peakFrequency / fundamentalFreq;
        // Use 3 decimal places to show small deviations
        const formattedRatio = actualRatio.toFixed(3);

        // Calculate deviation from ideal harmonic
        const idealRatio = peak.harmonicNumber;
        const ratioDeviation = actualRatio - idealRatio;
        // Use 3 decimal places for deviation too
        const formattedDeviation =
          ratioDeviation >= 0 ? `+${ratioDeviation.toFixed(3)}` : ratioDeviation.toFixed(3);
        const deviationColor = getDeviationColor(actualRatio, idealRatio);

        // Get color based on cents deviation
        const centsDeviationColor = getCentsDeviationColor(centsDeviation);

        return {
          ...peak,
          normalizedFrequency,
          centsDeviation,
          formattedCents,
          actualRatio,
          formattedRatio,
          idealRatio,
          ratioDeviation,
          formattedDeviation,
          deviationColor,
          centsDeviationColor,
          isFrozen: true,
        };
      });
    }

    // If no frozen data, don't display anything
    return [];
  }, [frozenPeakData, calculateCentsDeviation, noteFrequency]);

  // Get plot line colors based on the selected color scheme
  const plotLineColors = getPlotLineColors(plotSettings.colorScheme, theme.palette.mode === 'dark');

  return (
    <StyledSvg preserveAspectRatio="none">
      {/* Peak frequency lines */}
      {peaksToDisplay.map(peak => (
        <React.Fragment key={`peak-${peak.harmonicNumber}`}>
          {/* Peak frequency line - Thicker and solid */}
          <line
            x1={`${getPeakXPosition(peak)}%`}
            y1="0%"
            x2={`${getPeakXPosition(peak)}%`}
            y2="100%"
            stroke={getHarmonicColor(peak.harmonicNumber - 1)}
            strokeWidth="3" // Increase thickness
            strokeOpacity="1.0" // Full opacity
            // Remove dashed pattern
          />

          {/* Cents deviation display - staggered vertically */}
          <text
            x={`${getPeakXPosition(peak) + 3}%`}
            y={`${10 + (peak.harmonicNumber % 3) * 8}%`} // Staggered position based on harmonic number
            fill={peak.centsDeviationColor}
            fontSize="16" // Increase font size
            fontWeight="bold"
            textAnchor="start"
            dominantBaseline="middle"
            style={{ textShadow: '0px 0px 4px rgba(0, 0, 0, 1.0)' }} // Enhanced text shadow
          >
            {`${peak.formattedCents}`}
          </text>

          {/* Harmonic number indicator - staggered vertically */}
          <text
            x={`${getPeakXPosition(peak) + 3}%`}
            y={`${25 + (peak.harmonicNumber % 3) * 8}%`} // Staggered position based on harmonic number
            fill={getHarmonicColor(peak.harmonicNumber - 1)}
            fontSize="14" // Increase font size
            fontWeight="bold"
            textAnchor="start"
            dominantBaseline="middle"
            style={{ textShadow: '0px 0px 4px rgba(0, 0, 0, 1.0)' }} // Enhanced text shadow
          >
            {`H${peak.harmonicNumber}`}
          </text>

          {/* Peak magnitude indicator - thicker */}
          <g>
            {/* Vertical line showing magnitude */}
            <line
              x1={`${getPeakXPosition(peak)}%`}
              y1={`${(1 - peak.peakMagnitude) * 100}%`}
              x2={`${getPeakXPosition(peak)}%`}
              y2="100%"
              stroke={getHarmonicColor(peak.harmonicNumber - 1)}
              strokeWidth="3" // Increase thickness
              strokeOpacity="0.8" // More visible
            />

            {/* Circle at peak position - larger */}
            <circle
              cx={`${getPeakXPosition(peak)}%`}
              cy={`${(1 - peak.peakMagnitude) * 100}%`}
              r="6" // Increase radius
              fill={getHarmonicColor(peak.harmonicNumber - 1)}
              stroke="white" // White outline for better visibility
              strokeWidth="2" // Thicker outline
              opacity="1.0" // Full opacity
            />

            {/* Magnitude percentage label - larger */}
            <text
              x={`${getPeakXPosition(peak) - 3}%`}
              y={`${(1 - peak.peakMagnitude) * 100 - 5}%`}
              fill="white"
              fontSize="12" // Increase font size
              textAnchor="end"
              dominantBaseline="middle"
              style={{ textShadow: '0px 0px 4px rgba(0, 0, 0, 1.0)' }} // Enhanced text shadow
            >
              {`${Math.round(peak.peakMagnitude * 100)}%`}
            </text>
          </g>
        </React.Fragment>
      ))}

      {/* Target frequency line - thicker */}
      <line
        x1={`${getXPosition(noteFrequency)}%`}
        y1="0%"
        x2={`${getXPosition(noteFrequency)}%`}
        y2="100%"
        stroke={plotLineColors.primary}
        strokeWidth="3" // Increase thickness
      />

      {/* Harmonic Analysis Legend - Moved to middle left */}
      {peaksToDisplay.length > 0 && (
        <g>
          {/* Background for legend */}
          <rect
            x="5%"
            y="30%"
            width="30%"
            height={`${6 + peaksToDisplay.length * 5}%`}
            fill="rgba(0, 0, 0, 0.7)"
            rx="5"
            ry="5"
          />

          {/* Legend title */}
          <text x="6%" y="33%" fill="white" fontSize="10" fontWeight="bold">
            Harmonic Analysis
          </text>

          {/* Column headers */}
          <text x="7%" y="36%" fill="white" fontSize="9" fontWeight="bold">
            H#
          </text>

          <text x="15%" y="36%" fill="white" fontSize="9" fontWeight="bold">
            Cents
          </text>

          <text x="24%" y="36%" fill="white" fontSize="9" fontWeight="bold">
            Ratio
          </text>

          <text x="29%" y="36%" fill="white" fontSize="9" fontWeight="bold">
            Mag
          </text>

          {/* Legend entries - Three columns: Harmonic #, Cents, Ratio */}
          {peaksToDisplay.map((peak, index) => (
            <g key={`legend-${peak.harmonicNumber}`}>
              {/* Harmonic number */}
              <text
                x="7%"
                y={`${38 + index * 4}%`}
                fill={getHarmonicColor(peak.harmonicNumber - 1)}
                fontSize="10"
                fontWeight="bold"
                dominantBaseline="middle"
              >
                {`${peak.harmonicNumber}`}
              </text>

              {/* Cents deviation */}
              <text
                x="15%"
                y={`${38 + index * 4}%`}
                fill={peak.centsDeviationColor}
                fontSize="10"
                fontWeight="bold"
                dominantBaseline="middle"
              >
                {peak.formattedCents}
              </text>

              {/* Ratio */}
              <text
                x="24%"
                y={`${38 + index * 4}%`}
                fill="white"
                fontSize="9"
                dominantBaseline="middle"
              >
                {`${peak.formattedRatio}×`}
              </text>

              {/* Magnitude */}
              <text
                x="29%"
                y={`${38 + index * 4}%`}
                fill="white"
                fontSize="9"
                dominantBaseline="middle"
              >
                {`${Math.round(peak.peakMagnitude * 100)}%`}
              </text>
            </g>
          ))}
        </g>
      )}

      {/* Cents markers for piano tuning */}
      {showLines && (
        <>
          {/* -50 cents line */}
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, -50 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, -50 / 1200))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.5"
            strokeDasharray="5,5"
          />

          {/* -25 cents line */}
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, -25 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, -25 / 1200))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.3"
            strokeDasharray="3,3"
          />

          {/* -10 cents line */}
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, -10 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, -10 / 1200))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.5"
          />
          {/* -5 cents line */}
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, -5 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, -5 / 1200))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.3"
          />
          {/* +5 cents line */}
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, 5 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, 5 / 1200))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.3"
          />
          {/* +10 cents line */}
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, 10 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, 10 / 1200))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.5"
          />

          {/* +25 cents line */}
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, 25 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, 25 / 1200))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.3"
            strokeDasharray="3,3"
          />

          {/* +50 cents line */}
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, 50 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, 50 / 1200))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.5"
            strokeDasharray="5,5"
          />

          {/* Cents labels */}
          <text
            x={`${getXPosition(noteFrequency * Math.pow(2, -50 / 1200))}%`}
            y="95%"
            fill={plotLineColors.secondary}
            fontSize="10"
            textAnchor="middle"
          >
            -50¢
          </text>

          <text
            x={`${getXPosition(noteFrequency * Math.pow(2, -25 / 1200))}%`}
            y="95%"
            fill={theme.palette.plotLines.secondary}
            fontSize="10"
            textAnchor="middle"
          >
            -25¢
          </text>

          <text
            x={`${getXPosition(noteFrequency * Math.pow(2, -10 / 1200))}%`}
            y="95%"
            fill={theme.palette.plotLines.secondary}
            fontSize="10"
            textAnchor="middle"
          >
            -10¢
          </text>
          <text
            x={`${getXPosition(noteFrequency)}%`}
            y="95%"
            fill={theme.palette.plotLines.primary}
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
          >
            0¢
          </text>
          <text
            x={`${getXPosition(noteFrequency * Math.pow(2, 10 / 1200))}%`}
            y="95%"
            fill={theme.palette.plotLines.secondary}
            fontSize="10"
            textAnchor="middle"
          >
            +10¢
          </text>

          <text
            x={`${getXPosition(noteFrequency * Math.pow(2, 25 / 1200))}%`}
            y="95%"
            fill={theme.palette.plotLines.secondary}
            fontSize="10"
            textAnchor="middle"
          >
            +25¢
          </text>

          <text
            x={`${getXPosition(noteFrequency * Math.pow(2, 50 / 1200))}%`}
            y="95%"
            fill={theme.palette.plotLines.secondary}
            fontSize="10"
            textAnchor="middle"
          >
            +50¢
          </text>
        </>
      )}
    </StyledSvg>
  );
};

FrequencyLines.displayName = 'FrequencyLines';

// Fix the vertex shader source function
const getVertexShaderSource = (_colorSchemeName: string) => `
  attribute vec2 a_position;
  uniform float u_bellCurveWidth;
  uniform float u_totalBars;
  uniform int u_harmonicIndex;
  
  varying vec4 v_color;
  
  float fisheyeTransform(float x) {
    float normalizedX = (x - 0.5) * 2.0;
    float distortion = u_bellCurveWidth;
    float transformed = sign(normalizedX) * abs(normalizedX) / (1.0 + abs(normalizedX) * distortion);
    transformed = transformed * (1.0 + distortion);
    return transformed * 0.5 + 0.5;
  }
  
  void main() {
    // a_position.x is normalized bin index (0-1)
    // a_position.y is magnitude
    
    float transformedX = fisheyeTransform(a_position.x);
    float clipSpaceX = transformedX * 2.0 - 1.0;
    float clipSpaceY = -1.0 + 2.0 * a_position.y;
    
    gl_Position = vec4(clipSpaceX, clipSpaceY, 0, 1);
    
    // Color based on harmonic number - with more distinct colors
    if (u_harmonicIndex == 0) {
      v_color = vec4(1.0, 0.0, 0.0, 1.0); // Bright red for fundamental
    } else if (u_harmonicIndex == 1) {
      v_color = vec4(0.0, 0.8, 0.0, 1.0); // Bright green for 2nd harmonic
    } else if (u_harmonicIndex == 2) {
      v_color = vec4(0.0, 0.4, 1.0, 1.0); // Blue for 3rd harmonic
    } else {
      // Use yellow for any additional harmonics
      v_color = vec4(0.95, 0.95, 0.0, 1.0);
    }
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec4 v_color;
  
  void main() {
    gl_FragColor = v_color;
  }
`;

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

function createAndSetupMainProgram(gl: WebGLRenderingContext, vertexShaderSource: string) {
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
}

const MeasurementPlot: React.FC<MeasurementPlotProps> = ({
  regionData,
  regionMetadata,
  harmonics,
  _thresholdPercentage,
  onThresholdChange: _onThresholdChange,
  _zenMode,
  noteFrequency,
  showLines,
  bellCurveWidth = 4.0,
  onBellCurveWidthChange: _onBellCurveWidthChange,
  onPreviousNote,
  onNextNote,
  onPrevOctave,
  onNextOctave,
  onToggleLines: _onToggleLines,
  colorScheme,
  onColorSchemeChange: _onColorSchemeChange,
  magnitudeThreshold = 0.3,
  strikeState = 'WAITING',
  strikeMeasurementFrequency = null,
  strikeMeasurement = null,
  startingNote,
}) => {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const _mainPositionBufferRef = useRef<WebGLBuffer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [overlay, setOverlay] = useState<{ visible: boolean; quadrant: number }>({
    visible: false,
    quadrant: -1,
  });

  // Add state to track previous strike measurement and frozen peak data
  const [lastMeasurementId, setLastMeasurementId] = useState<string>('');
  const [frozenPeakData, setFrozenPeakData] = useState<Array<{
    peakFrequency: number;
    peakMagnitude: number;
    harmonicNumber: number;
  }> | null>(null);

  // Remove unused state
  const [showTemperamentCurve, setShowTemperamentCurve] = useState(false);

  // Add state for temperament calculation
  const [temperamentData, setTemperamentData] = useState<{
    fundamental: number | null;
    secondHarmonic: number | null;
    thirdHarmonic: number | null;
    isComplete: boolean;
  }>({
    fundamental: null,
    secondHarmonic: null,
    thirdHarmonic: null,
    isComplete: false,
  });

  // Add railsback canvas ref at the component level
  const railsbackCanvasRef = useRef<HTMLCanvasElement>(null);

  // Replace the handleShowTemperamentCurve function with useCallback
  const handleShowTemperamentCurve = useCallback(() => {
    setShowTemperamentCurve(true);
  }, []);

  // Replace the handleHideTemperamentCurve function with useCallback
  const handleHideTemperamentCurve = useCallback(() => {
    setShowTemperamentCurve(false);
  }, []);

  // Replace the temperamentData section and fix the hooks issue by moving handleStartTuningGeneration inside useMemo
  const temperamentDataWithActions = useMemo(() => {
    // Move handleStartTuningGeneration inside the useMemo to fix the dependency issue
    const handleStartTuningGeneration = () => {
      if (
        !temperamentData.isComplete ||
        !temperamentData.fundamental ||
        !temperamentData.secondHarmonic ||
        !temperamentData.thirdHarmonic
      ) {
        console.error('Cannot generate temperament curve: measurements not complete');
        return;
      }

      // For a starting note, calculate the 19-point temperament curve
      // The key points are:
      // 1. The fundamental should match the note itself
      // 2. The 2nd harmonic should match the octave
      // 3. The 3rd harmonic should match the octave + fifth

      const fundamental = temperamentData.fundamental; // e.g., A3 frequency

      // Calculate the expected equal temperament frequencies
      const etOctaveFreq = fundamental * 2; // Expected frequency of the octave in equal temperament
      const etFifthFreq = fundamental * 3; // Expected frequency of the perfect fifth (third harmonic)

      // Get the measured frequencies
      const measuredOctaveFreq = temperamentData.secondHarmonic; // Actual measured 2nd harmonic
      const measuredFifthFreq = temperamentData.thirdHarmonic; // Actual measured 3rd harmonic

      // Calculate the stretch in cents from ET
      // Using measured frequency / expected frequency to get the ratio
      const octaveStretchCents = 1200 * Math.log2(measuredOctaveFreq / etOctaveFreq);
      const fifthStretchCents = 1200 * Math.log2(measuredFifthFreq / etFifthFreq);

      console.log('Temperament curve parameters:', {
        startingNoteFreq: fundamental,
        etOctaveFreq,
        etFifthFreq,
        measuredOctaveFreq,
        measuredFifthFreq,
        octaveStretchCents,
        fifthStretchCents,
      });

      // Show the temperament curve visualization
      handleShowTemperamentCurve();

      // Now we would generate the full 19-point curve and proceed to tuning
      // This would typically call a function or dispatch an action to move to the next step
    };

    return {
      ...temperamentData,
      handleStartTuningGeneration,
    };
  }, [temperamentData, handleShowTemperamentCurve]);

  // Modify the useEffect hook for drawing the Railsback curve to focus on the temperament region and ensure curve is visible
  useEffect(() => {
    if (!showTemperamentCurve || !railsbackCanvasRef.current || !temperamentData.isComplete) return;

    const canvas = railsbackCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get required data for drawing
    const fundamental = temperamentData.fundamental!;
    const measuredOctaveFreq = temperamentData.secondHarmonic!;
    const measuredFifthFreq = temperamentData.thirdHarmonic!;
    const etOctaveFreq = fundamental * 2;
    const etFifthFreq = fundamental * 3;
    const octaveStretchCents = 1200 * Math.log2(measuredOctaveFreq / etOctaveFreq);
    const fifthStretchCents = 1200 * Math.log2(measuredFifthFreq / etFifthFreq);

    // Set canvas dimensions
    canvas.width = 600;
    canvas.height = 300;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate estimated note number for our starting note
    const baseKeyNumber = 49 - 12 * Math.log2(440 / fundamental);

    // Focus ONLY on the temperament range (19 notes)
    const minNote = Math.floor(baseKeyNumber);
    const maxNote = Math.ceil(baseKeyNumber + 19);
    const totalNotes = maxNote - minNote;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Temperament Stretch Curve', canvas.width / 2, 20);

    // Draw coordinate system
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;

    // X-axis at the bottom to represent 0 cents
    const xAxisY = canvas.height - 40;
    ctx.beginPath();
    ctx.moveTo(40, xAxisY);
    ctx.lineTo(canvas.width - 20, xAxisY);
    ctx.stroke();

    // Y-axis (left margin)
    ctx.beginPath();
    ctx.moveTo(40, 40);
    ctx.lineTo(40, xAxisY);
    ctx.stroke();

    // Note names for the temperament range
    const semitoneNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const getNoteName = (keyNumber: number) => {
      const noteIndex = (keyNumber - 1) % 12;
      const octave = Math.floor((keyNumber - 4) / 12);
      return `${semitoneNames[noteIndex]}${octave}`;
    };

    // Draw ALL note names in the temperament range
    const noteWidth = (canvas.width - 60) / totalNotes;

    for (let i = 0; i <= totalNotes; i++) {
      const keyNumber = minNote + i;
      const x = 40 + i * noteWidth;
      const noteName = getNoteName(keyNumber);

      // Rotate note names for better readability
      ctx.save();
      ctx.translate(x, xAxisY + 15);
      ctx.rotate(Math.PI / 4);
      ctx.textAlign = 'left';
      ctx.font = '10px Arial';
      ctx.fillText(noteName, 0, 0);
      ctx.restore();

      // Tick mark
      ctx.beginPath();
      ctx.moveTo(x, xAxisY - 5);
      ctx.lineTo(x, xAxisY + 5);
      ctx.stroke();
    }

    // NEW: Simplified Y-axis with values from 0 to 2 cents
    // The starting note is always at 0, octave at 1, fifth at 2
    const centValues = [0, 0.5, 1.0, 1.5, 2.0];

    // Height available for drawing (from top margin to x-axis)
    const drawingHeight = xAxisY - 40;

    centValues.forEach(cents => {
      // Calculate y position: 0 cents at the bottom, 2 cents at the top
      const y = xAxisY - (cents * drawingHeight) / 2.0;

      // Different styling for main points (0, 1, 2)
      const isMainPoint = cents === 0 || cents === 1.0 || cents === 2.0;
      ctx.fillStyle = isMainPoint ? '#fff' : '#aaa';
      ctx.font = isMainPoint ? 'bold 10px Arial' : '10px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(`+${cents.toFixed(1)}¢`, 35, y + 4);

      // Tick mark or grid line
      ctx.beginPath();
      ctx.strokeStyle = isMainPoint ? '#666' : 'rgba(102, 102, 102, 0.3)';
      ctx.setLineDash(isMainPoint ? [] : [3, 3]);
      ctx.moveTo(40, y);
      ctx.lineTo(canvas.width - 20, y);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // FIXED: Using Y scale of 0-2 with fixed points:
    // Start note (0,0), Octave (12,1), Fifth (19,2)

    // Normalize the stretch values from cents to our new 0-2 scale
    // We're mapping the octaveStretchCents to 1.0 and fifthStretchCents to 2.0
    // This is simplifying the presentation while maintaining the relative curve shape

    // Create the curve data for the 19 notes
    const railsbackData = Array.from({ length: totalNotes + 1 }, (_, i) => {
      const keyNumber = minNote + i;
      const noteDistance = keyNumber - baseKeyNumber;

      // For the fixed points:
      if (noteDistance === 0) return { keyNumber, noteDistance, normalizedStretch: 0 };
      if (noteDistance === 12) return { keyNumber, noteDistance, normalizedStretch: 1.0 };
      if (noteDistance === 19) return { keyNumber, noteDistance, normalizedStretch: 2.0 };

      // For points in between, use quadratic interpolation
      // Fit a quadratic curve y = ax² + bx + c through 3 points:
      // (0,0), (12,1), (19,2)

      // Set up the system:
      // 0 = c                  (from point 1)
      // 1 = 144a + 12b + c     (from point 2)
      // 2 = 361a + 19b + c     (from point 3)

      // Since c = 0:
      // 1 = 144a + 12b
      // 2 = 361a + 19b

      // Solving for a and b
      const a1 = 144;
      const b1 = 12;
      const c1 = 1;
      const a2 = 361;
      const b2 = 19;
      const c2 = 2;

      const det = a1 * b2 - a2 * b1;
      const a = (c1 * b2 - c2 * b1) / det;
      const b = (a1 * c2 - a2 * c1) / det;

      // Compute the normalized stretch (0-2 scale)
      const normalizedStretch = a * noteDistance * noteDistance + b * noteDistance;

      return {
        keyNumber,
        noteDistance,
        normalizedStretch,
      };
    });

    // Draw the curve
    if (ctx) {
      // Debug
      console.log(
        'Drawing curve with points:',
        railsbackData.filter(
          p => p.noteDistance === 0 || p.noteDistance === 12 || p.noteDistance === 19
        )
      );

      // Draw the temperament curve as a smooth line
      ctx.beginPath();
      ctx.strokeStyle = '#2196f3'; // Blue color
      ctx.lineWidth = 3;

      railsbackData.forEach((point, i) => {
        const x = 40 + point.noteDistance * noteWidth;
        const y = xAxisY - (point.normalizedStretch * drawingHeight) / 2.0;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Draw key points with larger, more visible markers
      [
        { noteDistance: 0, normalizedStretch: 0, color: '#ff0000', label: 'Start' }, // Starting note
        { noteDistance: 12, normalizedStretch: 1.0, color: '#00ff00', label: 'Oct' }, // Octave
        { noteDistance: 19, normalizedStretch: 2.0, color: '#ffff00', label: '5th' }, // Fifth
      ].forEach(point => {
        const x = 40 + point.noteDistance * noteWidth;
        const y = xAxisY - (point.normalizedStretch * drawingHeight) / 2.0;

        // Draw a larger circle
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = point.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Add label above the point
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(point.label, x, y - 15);

        // Calculate the actual cents value for display
        let actualCents = 0;
        if (point.noteDistance === 0) {
          actualCents = 0;
        } else if (point.noteDistance === 12) {
          actualCents = octaveStretchCents;
        } else if (point.noteDistance === 19) {
          actualCents = fifthStretchCents;
        }

        // Show the actual cents value
        ctx.fillText(`${actualCents.toFixed(1)}¢`, x, y + 20);
      });

      // Highlight the temperament octave area
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(40, canvas.height - 20);
      ctx.lineTo(40 + 12 * noteWidth, canvas.height - 20);
      ctx.stroke();

      // Highlight the temperament octave + fifth area
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.3)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(40 + 12 * noteWidth, canvas.height - 20);
      ctx.lineTo(40 + 19 * noteWidth, canvas.height - 20);
      ctx.stroke();

      // Add labels for temperament regions
      ctx.font = '10px Arial';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText('Temperament Octave', 40 + 6 * noteWidth, canvas.height - 25);
      ctx.fillText('Temperament Fifth', 40 + 15.5 * noteWidth, canvas.height - 25);
    }
  }, [showTemperamentCurve, temperamentData, railsbackCanvasRef]);

  // Modify the curve description text to be more specific about piano tuning
  const renderTemperamentCurveVisualization = () => {
    if (!temperamentData.isComplete || !temperamentData.fundamental) {
      return (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="h6">No measurement data available</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Play the starting note clearly to capture harmonic measurements first
          </Typography>
        </Box>
      );
    }

    const fundamental = temperamentData.fundamental;

    // Calculate the expected equal temperament frequencies
    const etOctaveFreq = fundamental * 2; // Expected frequency of the octave in equal temperament
    const etFifthFreq = fundamental * 3; // Expected frequency of the perfect fifth (third harmonic)

    // Get the measured frequencies
    const measuredOctaveFreq = temperamentData.secondHarmonic!; // Actual measured 2nd harmonic
    const measuredFifthFreq = temperamentData.thirdHarmonic!; // Actual measured 3rd harmonic

    // Calculate the stretch in cents from ET
    const octaveStretchCents = 1200 * Math.log2(measuredOctaveFreq / etOctaveFreq);
    const fifthStretchCents = 1200 * Math.log2(measuredFifthFreq / etFifthFreq);

    // Calculate ratios
    const idealOctaveRatio = 2.0;
    const idealFifthRatio = 3.0;
    const measuredOctaveRatio = measuredOctaveFreq / fundamental;
    const measuredFifthRatio = measuredFifthFreq / fundamental;

    // Calculate ratio deviation
    const octaveRatioDeviation = measuredOctaveRatio - idealOctaveRatio;
    const fifthRatioDeviation = measuredFifthRatio - idealFifthRatio;

    // Calculate inharmonicity coefficient (B) - approximate
    const inharmonicityCoefficient = (measuredOctaveRatio / idealOctaveRatio - 1) * 0.5;

    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" sx={{ mb: 2, textAlign: 'center' }}>
          Temperament from {startingNote || 'Starting Note'}
        </Typography>

        <Box sx={{ mb: 4, p: 2, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Harmonic Ratios
          </Typography>
          <Typography variant="body1">
            Octave Ratio: {measuredOctaveRatio.toFixed(4)}
            (Ideal: {idealOctaveRatio.toFixed(1)}, Deviation: {octaveRatioDeviation >= 0 ? '+' : ''}
            {octaveRatioDeviation.toFixed(4)})
          </Typography>
          <Typography variant="body1">
            Fifth Ratio: {measuredFifthRatio.toFixed(4)}
            (Ideal: {idealFifthRatio.toFixed(1)}, Deviation: {fifthRatioDeviation >= 0 ? '+' : ''}
            {fifthRatioDeviation.toFixed(4)})
          </Typography>
          <Typography variant="body2" sx={{ mt: 1, color: 'rgba(255,255,255,0.7)' }}>
            Inharmonicity Coefficient ≈ {(inharmonicityCoefficient * 1000).toFixed(2)} × 10⁻³
          </Typography>
        </Box>

        <Box sx={{ mb: 4, p: 2, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Calculated Stretch
          </Typography>
          <Typography variant="body1">
            Octave Stretch: {octaveStretchCents.toFixed(2)} cents
            {Math.abs(octaveStretchCents) < 3
              ? ' (Excellent)'
              : Math.abs(octaveStretchCents) < 5
                ? ' (Very Good)'
                : Math.abs(octaveStretchCents) < 10
                  ? ' (Good)'
                  : ' (Significant)'}
          </Typography>
          <Typography variant="body1">
            Fifth Stretch: {fifthStretchCents.toFixed(2)} cents
            {Math.abs(fifthStretchCents) < 3
              ? ' (Excellent)'
              : Math.abs(fifthStretchCents) < 5
                ? ' (Very Good)'
                : Math.abs(fifthStretchCents) < 10
                  ? ' (Good)'
                  : ' (Significant)'}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
            This creates a gentle variation on Equal Temperament that&apos;s custom-tuned to your
            piano&apos;s natural harmonics.
          </Typography>
        </Box>

        <Box sx={{ mb: 4, p: 2, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1, overflow: 'auto' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Temperament Curve
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <canvas
              ref={railsbackCanvasRef}
              style={{
                width: '100%',
                maxWidth: '600px',
                height: '300px',
                backgroundColor: 'rgba(0,0,0,0.3)',
                borderRadius: '4px',
              }}
            />
          </Box>
          <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
            The curve shows the optimal stretch for each note in the temperament section. Piano
            tuners establish this temperament zone first, then extend tuning to the rest of the
            piano.
          </Typography>
        </Box>

        <Box sx={{ mt: 4, textAlign: 'center' }}>
          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              // This would apply the temperament and continue to the tuning process
              console.log('Applying temperament curve and continuing to tuning');
              handleHideTemperamentCurve();
            }}
          >
            Apply Temperament and Continue
          </Button>
        </Box>
      </Box>
    );
  };

  // Update the header display to be more minimal
  const masterTuneModeHeader = useMemo(() => {
    if (!startingNote) return null;

    const statusText = temperamentData.isComplete
      ? '✓ Measurements complete'
      : 'Play note clearly to capture harmonics';

    return (
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '8px',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          zIndex: 50,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
          Starting Note: {startingNote}
        </Typography>

        <Typography
          variant="body2"
          sx={{
            color: temperamentData.isComplete ? '#4caf50' : 'white',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {temperamentData.isComplete && <span style={{ marginRight: '4px' }}>✓</span>}
          {statusText}
        </Typography>

        {temperamentData.isComplete && (
          <Button
            variant="contained"
            color="primary"
            size="small"
            onClick={temperamentDataWithActions.handleStartTuningGeneration}
          >
            Create Curve
          </Button>
        )}
      </Box>
    );
  }, [startingNote, temperamentData, temperamentDataWithActions]);

  // Use refs to store values that shouldn't trigger re-renders
  const regionMetadataRef = useRef(regionMetadata);
  const magnitudeThresholdRef = useRef(magnitudeThreshold);
  const harmonicsRef = useRef(harmonics);

  // Update refs when props change
  useEffect(() => {
    regionMetadataRef.current = regionMetadata;
  }, [regionMetadata]);

  useEffect(() => {
    magnitudeThresholdRef.current = magnitudeThreshold;
  }, [magnitudeThreshold]);

  useEffect(() => {
    harmonicsRef.current = harmonics;
  }, [harmonics]);

  // Effect to detect new strike measurements and freeze peak data
  useEffect(() => {
    // Skip if no measurement or invalid measurement
    if (!strikeMeasurement || !strikeMeasurement.isValid) return;

    // Create a unique ID for this measurement based on timestamp and frequency
    const measurementId = `${strikeMeasurement.timestamp.toFixed(3)}-${strikeMeasurement.frequency.toFixed(1)}`;

    // Skip if we've already processed this measurement
    if (measurementId === lastMeasurementId) return;

    console.log('New valid strike measurement detected:', {
      frequency: strikeMeasurement.frequency,
      magnitude: strikeMeasurement.magnitude,
      confidence: strikeMeasurement.confidence,
      measurementId,
    });

    // Capture peak data from all regions
    const peakData = regionMetadataRef.current
      .map((metadata, index) => {
        const harmonicNumber = harmonicsRef.current[index];

        // Process harmonic measurement data

        // Only include peaks with valid frequencies
        if (metadata.peakFrequency <= 0) {
          return null;
        }

        return {
          peakFrequency: metadata.peakFrequency,
          peakMagnitude: metadata.peakMagnitude,
          harmonicNumber: harmonicNumber,
        };
      })
      .filter(Boolean) as Array<{
      peakFrequency: number;
      peakMagnitude: number;
      harmonicNumber: number;
    }>;

    // Only update if we have data
    if (peakData.length > 0) {
      console.log('Freezing peak data based on strike measurement:', peakData);
      setFrozenPeakData(peakData);
      setLastMeasurementId(measurementId);

      // Extract temperament data from peak measurements
      const fundamental = peakData.find(p => p.harmonicNumber === 1);
      const secondHarmonic = peakData.find(p => p.harmonicNumber === 2);
      const thirdHarmonic = peakData.find(p => p.harmonicNumber === 3);

      if (fundamental && secondHarmonic && thirdHarmonic) {
        // Calculate confidence based on relative magnitudes
        const _totalMagnitude = peakData.reduce((sum, p) => sum + p.peakMagnitude, 0);
        const areMagnitudesValid = peakData.every(p => p.peakMagnitude > 0.15); // Each peak should be at least 15% magnitude

        // Only complete measurements if all harmonics have sufficient magnitude
        const isComplete = areMagnitudesValid;

        setTemperamentData({
          fundamental: fundamental.peakFrequency,
          secondHarmonic: secondHarmonic.peakFrequency,
          thirdHarmonic: thirdHarmonic.peakFrequency,
          isComplete,
        });

        if (isComplete) {
          console.log('Temperament measurements complete:', {
            fundamental: fundamental.peakFrequency,
            secondHarmonic: secondHarmonic.peakFrequency,
            thirdHarmonic: thirdHarmonic.peakFrequency,
          });
        } else {
          console.log(
            'Temperament measurements captured but need stronger signals for all harmonics'
          );
        }
      }
    } else {
      console.warn('No peak data found to freeze for strike measurement');
    }
  }, [strikeMeasurement, lastMeasurementId]);

  const resizeObserverCallback = useCallback((entries: ResizeObserverEntry[]) => {
    if (entries[0]) {
      const { width, height } = entries[0].contentRect;
      dimensionsRef.current = { width, height };
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

    if (!canvas || !gl || !program) return;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Enable blending for smoother lines
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Set line width (note: this has limitations in WebGL)
    gl.lineWidth(2.0);

    // Draw the spectrum for each harmonic
    regionData.forEach((data, harmonicIndex) => {
      // Use the program
      gl.useProgram(program);

      // Create line segments connecting the tops of the bins
      const numPoints = data.length;
      const positions = new Float32Array(numPoints * 2); // (x, y) for each point

      // Set up the positions (one for each bin)
      for (let i = 0; i < numPoints; i++) {
        const normalizedX = i / (numPoints - 1); // 0 to 1
        positions[i * 2] = normalizedX;
        positions[i * 2 + 1] = data[i]; // Magnitude
      }

      // Create and bind position buffer
      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

      // Get attribute and uniform locations
      const positionLoc = gl.getAttribLocation(program, 'a_position');

      // Set up position attribute
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      // Set uniforms
      gl.uniform1f(gl.getUniformLocation(program, 'u_totalBars'), data.length);
      gl.uniform1f(gl.getUniformLocation(program, 'u_bellCurveWidth'), bellCurveWidth);
      gl.uniform1i(gl.getUniformLocation(program, 'u_harmonicIndex'), harmonicIndex);

      // Draw the line strip
      gl.drawArrays(gl.LINE_STRIP, 0, numPoints);

      // Clean up
      gl.disableVertexAttribArray(positionLoc);
      gl.deleteBuffer(positionBuffer);
    });

    // Cleanup
    gl.disable(gl.BLEND);
  }, [regionData, bellCurveWidth]);

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

    drawSpectrum();
  }, [dimensionsRef, drawSpectrum, colorScheme]);

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

  useEffect(() => {
    drawSpectrum();
  }, [drawSpectrum]);

  const { settings } = usePlotSettings();

  // Get peak frequencies from regionMetadata
  const peakFrequencies = useMemo(() => {
    return regionMetadata.map(region => region.peakFrequency).filter(freq => freq > 0);
  }, [regionMetadata]);

  // Replace the bottom control panel with something simpler
  const bottomControlPanel = (
    <Box
      sx={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 1,
        borderTop: '1px solid rgba(255, 255, 255, 0.3)',
      }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
    >
      <Box sx={{ textAlign: 'center', color: 'white' }}>
        {temperamentData.isComplete ? (
          <Typography variant="body2">Ready to create temperament curve</Typography>
        ) : (
          <Typography variant="body2">
            Play the note clearly and sustain it until all harmonics are detected
          </Typography>
        )}
      </Box>
    </Box>
  );

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '200px',
        backgroundColor: 'transparent',
        touchAction: 'none',
        overflow: 'hidden',
        padding: 0,
      }}
      onTouchStart={handleQuadrantInteraction}
      {...(!isTouchDevice ? { onClick: handleQuadrantInteraction } : {})}
    >
      {/* Canvas is the bottom layer (z-index: 1) */}
      <StyledCanvas ref={canvasRef} />

      {/* SVG elements are the middle layer (z-index: 2) */}
      <FrequencyLines
        noteFrequency={noteFrequency}
        showLines={showLines}
        theme={theme}
        bellCurveWidth={bellCurveWidth}
        harmonics={harmonics}
        peakFrequencies={peakFrequencies}
        strikeState={strikeState}
        strikeMeasurementFrequency={strikeMeasurementFrequency}
        strikeMeasurement={strikeMeasurement}
        showPeakFrequencyLine={settings.showPeakFrequencyLine}
        showStrikeStateLine={settings.showStrikeStateLine}
        plotSettings={settings}
        frozenPeakData={frozenPeakData}
      />

      {/* Indicators and overlays (z-index: 5-20) */}
      {/* Frozen data indicator */}
      {frozenPeakData && frozenPeakData.length > 0 && (
        <Box
          sx={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            zIndex: 5,
          }}
        >
          <span style={{ fontSize: '16px' }}>⚓</span>
          <span>Frozen Peaks</span>
        </Box>
      )}

      {/* Saved data indicator */}
      {/* savedPeakData && savedPeakData.length > 0 && (
        <Box
          sx={{
            position: 'absolute',
            top: '40px',
            left: '10px',
            backgroundColor: 'rgba(0, 128, 0, 0.5)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            zIndex: 5,
          }}
        >
          <span style={{ fontSize: '16px' }}>💾</span>
          <span>Analysis Saved</span>
        </Box>
      )} */}

      {/* Quadrant overlays */}
      {[0, 1, 2, 3].map(quadrant => (
        <Box
          key={quadrant}
          sx={{
            position: 'absolute',
            width: '50%',
            height: '45%', // Reduced to make room for control panel
            left: quadrant % 2 === 0 ? 0 : '50%',
            top: quadrant < 2 ? 0 : '50%',
            transition: 'background-color 0.2s',
            backgroundColor:
              overlay.visible && overlay.quadrant === quadrant
                ? 'rgba(255, 255, 255, 0.1)'
                : 'transparent',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      ))}

      {overlay.visible && (
        <Box
          sx={{
            position: 'absolute',
            top: overlay.quadrant === 0 || overlay.quadrant === 1 ? 0 : '50%',
            left: overlay.quadrant === 0 || overlay.quadrant === 2 ? 0 : '50%',
            width: '50%',
            height: '45%', // Reduced to make room for control panel
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            fontSize: '1.5rem',
            fontWeight: 'bold',
            zIndex: 20,
          }}
        >
          {overlay.quadrant === 0 && 'Previous Note'}
          {overlay.quadrant === 1 && 'Next Note'}
          {overlay.quadrant === 2 && 'Previous Octave'}
          {overlay.quadrant === 3 && 'Next Octave'}
        </Box>
      )}

      {/* Control Panel - Top layer (z-index: 100) */}
      {bottomControlPanel}

      {/* Temperament Curve Visualization - Highest layer (z-index: 200) */}
      {showTemperamentCurve && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            borderRadius: 1,
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            color: 'white',
          }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onMouseMove={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <Button
              variant="contained"
              color="primary"
              size="small"
              onClick={handleHideTemperamentCurve}
            >
              Close
            </Button>
          </Box>

          <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
            {renderTemperamentCurveVisualization()}
          </Box>
        </Box>
      )}

      {/* Display Master Tune mode header */}
      {masterTuneModeHeader}
    </Box>
  );
};

export default React.memo(MeasurementPlot, (prevProps, nextProps) => {
  return (
    prevProps.regionData === nextProps.regionData &&
    prevProps.regionMetadata === nextProps.regionMetadata &&
    prevProps.thresholdPercentage === nextProps.thresholdPercentage &&
    prevProps.zenMode === nextProps.zenMode &&
    prevProps.noteFrequency === nextProps.noteFrequency &&
    prevProps.showLines === nextProps.showLines &&
    prevProps.bellCurveWidth === nextProps.bellCurveWidth &&
    prevProps.colorScheme === nextProps.colorScheme &&
    prevProps.magnitudeThreshold === nextProps.magnitudeThreshold &&
    prevProps.strikeState === nextProps.strikeState &&
    prevProps.strikeMeasurement === nextProps.strikeMeasurement &&
    prevProps.startingNote === nextProps.startingNote
  );
});
