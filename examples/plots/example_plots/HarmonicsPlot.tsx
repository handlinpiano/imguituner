'use client';
import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Box, useTheme, Theme, Button } from '@mui/material';
import { styled } from '@mui/system';
import { getColorSchemeGLSL, getPlotLineColors } from '../colorSchemes/colorSchemes';
import { RegionMetadata, StrikeState, StrikeMeasurement } from '@/app/wasm/audio_processor_wrapper';
import InharmonicityCorrection from '../InharmonicityCorrection';
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
export interface HarmonicsPlotProps {
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
        return 'rgba(255, 0, 0, 0.8)'; // Red for fundamental
      case 1:
        return 'rgba(255, 128, 0, 0.8)'; // Orange for 2nd harmonic
      case 2:
        return 'rgba(255, 255, 0, 0.8)'; // Yellow for 3rd harmonic
      case 3:
        return 'rgba(0, 255, 0, 0.8)'; // Green for 4th harmonic
      case 4:
        return 'rgba(0, 128, 255, 0.8)'; // Light blue for 6th harmonic
      default:
        return 'rgba(128, 0, 128, 0.8)'; // Purple for any other harmonics
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
          {/* Peak frequency line */}
          <line
            x1={`${getPeakXPosition(peak)}%`}
            y1="0%"
            x2={`${getPeakXPosition(peak)}%`}
            y2="100%"
            stroke={getHarmonicColor(peak.harmonicNumber - 1)}
            strokeWidth="2"
            strokeOpacity="0.8"
            strokeDasharray="5,3" // Dashed pattern to indicate frozen state
          />

          {/* Cents deviation display */}
          <text
            x={`${getPeakXPosition(peak) + 3}%`}
            y="10%"
            fill={peak.centsDeviationColor}
            fontSize="14"
            fontWeight="bold"
            textAnchor="start"
            dominantBaseline="middle"
            style={{ textShadow: '0px 0px 2px rgba(0, 0, 0, 0.7)' }}
          >
            {`${peak.formattedCents}`}
          </text>

          {/* Harmonic number indicator */}
          <text
            x={`${getPeakXPosition(peak) + 3}%`}
            y="20%"
            fill={getHarmonicColor(peak.harmonicNumber - 1)}
            fontSize="12"
            fontWeight="bold"
            textAnchor="start"
            dominantBaseline="middle"
            style={{ textShadow: '0px 0px 2px rgba(0, 0, 0, 0.7)' }}
          >
            {`H${peak.harmonicNumber}`}
          </text>

          {/* Peak magnitude indicator */}
          <g>
            {/* Vertical line showing magnitude */}
            <line
              x1={`${getPeakXPosition(peak)}%`}
              y1={`${(1 - peak.peakMagnitude) * 100}%`}
              x2={`${getPeakXPosition(peak)}%`}
              y2="100%"
              stroke={getHarmonicColor(peak.harmonicNumber - 1)}
              strokeWidth="2"
              strokeOpacity="0.4"
            />

            {/* Circle at peak position */}
            <circle
              cx={`${getPeakXPosition(peak)}%`}
              cy={`${(1 - peak.peakMagnitude) * 100}%`}
              r="4"
              fill={getHarmonicColor(peak.harmonicNumber - 1)}
              stroke="black"
              strokeWidth="1"
              opacity="0.8"
            />

            {/* Magnitude percentage label */}
            <text
              x={`${getPeakXPosition(peak) - 3}%`}
              y={`${(1 - peak.peakMagnitude) * 100 - 5}%`}
              fill="white"
              fontSize="9"
              textAnchor="end"
              dominantBaseline="middle"
              style={{ textShadow: '0px 0px 2px rgba(0, 0, 0, 0.7)' }}
            >
              {`${Math.round(peak.peakMagnitude * 100)}%`}
            </text>
          </g>
        </React.Fragment>
      ))}

      {/* Target frequency line */}
      <line
        x1={`${getXPosition(noteFrequency)}%`}
        y1="0%"
        x2={`${getXPosition(noteFrequency)}%`}
        y2="100%"
        stroke={plotLineColors.primary}
        strokeWidth="2"
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

// Modify vertex shader to handle peaks and harmonics
const getVertexShaderSource = (colorSchemeName: string) => `
  attribute vec2 a_position;
  attribute float a_magnitude;
  attribute float a_index;
  attribute float a_harmonic;  // New attribute for harmonic number
  
  uniform float u_totalBars;
  uniform float u_threshold;
  uniform bool u_zenMode;
  uniform float u_bellCurveWidth;
  uniform float u_peakBin;
  uniform float u_peakConfidence;
  
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
    
    // Get base color based on harmonic
    vec4 harmonicColor;
    float harmonicIndex = a_harmonic;
    
    if (harmonicIndex == 0.0) {
      harmonicColor = vec4(1.0, 0.0, 0.0, 1.0);  // Red for fundamental
    } else if (harmonicIndex == 1.0) {
      harmonicColor = vec4(1.0, 0.5, 0.0, 1.0);  // Orange for 2nd harmonic
    } else if (harmonicIndex == 2.0) {
      harmonicColor = vec4(1.0, 1.0, 0.0, 1.0);  // Yellow for 3rd harmonic
    } else if (harmonicIndex == 3.0) {
      harmonicColor = vec4(0.0, 1.0, 0.0, 1.0);  // Green for 4th harmonic
    } else if (harmonicIndex == 4.0) {
      harmonicColor = vec4(0.0, 0.5, 1.0, 1.0);  // Light blue for 6th harmonic
    } else {
      harmonicColor = vec4(0.5, 0.0, 1.0, 1.0);  // Purple for any other harmonics
    }
    
    // Blend with magnitude-based color
    vec4 magnitudeColor = getColorForMagnitude(a_magnitude, u_threshold, u_zenMode);
    v_color = mix(magnitudeColor, harmonicColor, 0.5);
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

const HarmonicsPlot: React.FC<HarmonicsPlotProps> = ({
  regionData,
  regionMetadata,
  harmonics,
  thresholdPercentage,
  onThresholdChange: _onThresholdChange,
  zenMode,
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
}) => {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const mainPositionBufferRef = useRef<WebGLBuffer | null>(null);
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

        // Process harmonic data

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
    const mainBuffer = mainPositionBufferRef.current;
    if (!canvas || !gl || !program || !mainBuffer) return;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const ext = gl.getExtension('ANGLE_instanced_arrays');
    if (!ext) return;

    // Clean up any previous attribute state
    const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    for (let i = 0; i < maxAttribs; i++) {
      gl.disableVertexAttribArray(i);
    }

    // Draw main spectrum
    gl.useProgram(program);

    // Calculate threshold based on current maximum magnitude
    const maxMagnitude = Math.max(...regionData.map(data => [...data].sort((a, b) => b - a)[0]));
    const threshold = maxMagnitude * (1.0 - thresholdPercentage);

    // Set up attributes and uniforms for spectrum
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const magnitudeLoc = gl.getAttribLocation(program, 'a_magnitude');
    const indexLoc = gl.getAttribLocation(program, 'a_index');
    const harmonicLoc = gl.getAttribLocation(program, 'a_harmonic');

    if (positionLoc === -1 || magnitudeLoc === -1 || indexLoc === -1 || harmonicLoc === -1) {
      console.error('Failed to get attribute locations');
      return;
    }

    // Draw spectrum bars for each harmonic
    gl.bindBuffer(gl.ARRAY_BUFFER, mainBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    regionData.forEach((data, harmonicIndex) => {
      const instanceBuffer = gl.createBuffer();
      if (!instanceBuffer) {
        console.error('Failed to create instance buffer');
        return;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      const instanceData = new Float32Array(data.length * 3); // 3 values per instance: magnitude, index, harmonic
      for (let i = 0; i < data.length; i++) {
        instanceData[i * 3] = data[i];
        instanceData[i * 3 + 1] = i;
        instanceData[i * 3 + 2] = harmonicIndex;
      }
      gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);

      // Set up uniforms for the shader
      gl.uniform1f(gl.getUniformLocation(program, 'u_totalBars'), data.length);
      gl.uniform1i(gl.getUniformLocation(program, 'u_zenMode'), zenMode ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, 'u_bellCurveWidth'), bellCurveWidth);
      gl.uniform1f(gl.getUniformLocation(program, 'u_threshold'), threshold);
      gl.uniform1f(gl.getUniformLocation(program, 'u_envelopeMax'), maxMagnitude);
      gl.uniform1f(
        gl.getUniformLocation(program, 'u_envelopeMin'),
        regionMetadataRef.current[harmonicIndex].envelopeMin
      );

      // Add peak detection uniforms
      gl.uniform1f(
        gl.getUniformLocation(program, 'u_peakBin'),
        regionMetadataRef.current[harmonicIndex].peakBin
      );
      gl.uniform1f(
        gl.getUniformLocation(program, 'u_peakConfidence'),
        regionMetadataRef.current[harmonicIndex].peakConfidence
      );

      gl.enableVertexAttribArray(magnitudeLoc);
      gl.vertexAttribPointer(magnitudeLoc, 1, gl.FLOAT, false, 12, 0);
      ext.vertexAttribDivisorANGLE(magnitudeLoc, 1);

      gl.enableVertexAttribArray(indexLoc);
      gl.vertexAttribPointer(indexLoc, 1, gl.FLOAT, false, 12, 4);
      ext.vertexAttribDivisorANGLE(indexLoc, 1);

      gl.enableVertexAttribArray(harmonicLoc);
      gl.vertexAttribPointer(harmonicLoc, 1, gl.FLOAT, false, 12, 8);
      ext.vertexAttribDivisorANGLE(harmonicLoc, 1);

      ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, data.length);

      // Cleanup
      gl.deleteBuffer(instanceBuffer);
    });

    // Final cleanup
    gl.disableVertexAttribArray(positionLoc);
    gl.disableVertexAttribArray(magnitudeLoc);
    gl.disableVertexAttribArray(indexLoc);
    gl.disableVertexAttribArray(harmonicLoc);
  }, [regionData, thresholdPercentage, zenMode, bellCurveWidth]);

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
    }

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

  const [showInharmonicityCorrection, setShowInharmonicityCorrection] = useState(false);
  const [savedPeakData, setSavedPeakData] = useState<Array<{
    peakFrequency: number;
    peakMagnitude: number;
    harmonicNumber: number;
  }> | null>(null);

  // Function to handle saving the current peak data
  const handleSaveAnalysis = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (frozenPeakData && frozenPeakData.length > 0) {
        setSavedPeakData([...frozenPeakData]);
        console.log('Analysis saved:', frozenPeakData);
      }
    },
    [frozenPeakData]
  );

  // Function to handle showing the analysis
  const handleShowAnalysis = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowInharmonicityCorrection(true);
  }, []);

  // Function to handle hiding the analysis
  const handleHideAnalysis = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowInharmonicityCorrection(false);
  }, []);

  // Determine which peak data to use for analysis
  const analysisData = useMemo(() => {
    return savedPeakData || frozenPeakData;
  }, [savedPeakData, frozenPeakData]);

  const { settings } = usePlotSettings();

  // Get peak frequencies from regionMetadata
  const peakFrequencies = useMemo(() => {
    return regionMetadata.map(region => region.peakFrequency).filter(freq => freq > 0);
  }, [regionMetadata]);

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
      {savedPeakData && savedPeakData.length > 0 && (
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
      )}

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
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '10%',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          zIndex: 100,
          padding: 1,
          borderTop: '1px solid rgba(255, 255, 255, 0.3)',
        }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()}
      >
        <Button
          variant="contained"
          color="success"
          size="small"
          onClick={handleSaveAnalysis}
          disabled={!frozenPeakData || frozenPeakData.length === 0}
          sx={{ minWidth: '120px' }}
        >
          Save Analysis
        </Button>

        <Button
          variant="contained"
          color="primary"
          size="small"
          onClick={handleShowAnalysis}
          disabled={!frozenPeakData && !savedPeakData}
          sx={{ minWidth: '120px' }}
        >
          Show Analysis
        </Button>
      </Box>

      {/* Inharmonicity Correction - Highest layer (z-index: 200) */}
      {showInharmonicityCorrection && (
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
          }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onMouseMove={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <Button variant="contained" color="primary" size="small" onClick={handleHideAnalysis}>
              Close Analysis
            </Button>
          </Box>

          <Box sx={{ flex: 1, overflow: 'hidden' }}>
            <InharmonicityCorrection
              frozenPeakData={analysisData}
              noteFrequency={noteFrequency}
              testMode={!analysisData || analysisData.length === 0}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default React.memo(HarmonicsPlot, (prevProps, nextProps) => {
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
    prevProps.strikeMeasurement === nextProps.strikeMeasurement
  );
});
