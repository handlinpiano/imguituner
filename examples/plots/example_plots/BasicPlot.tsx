import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useTheme } from '@mui/material';
import { styled } from '@mui/system';
import { alpha } from '@mui/material/styles';
import type {
  RegionMetadata,
  StrikeState,
  StrikeMeasurement,
} from '@/app/wasm/audio_processor_wrapper';
import { colorSchemes, interpolateColor, getPlotLineColors } from '../colorSchemes/colorSchemes';
import { usePlotSettings } from '../../settings/contexts/PlotSettingsContext';

const StyledCanvas = styled('canvas')({
  width: '100%',
  height: '100%',
  display: 'block',
  minHeight: '200px',
  '@media (max-width: 768px) and (orientation: portrait)': {
    minHeight: '150px', // Smaller minimum height for mobile portrait
  },
});

const StyledSvg = styled('svg')({
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'none',
});

interface BasicPlotProps {
  regionData: Float32Array;
  regionMetadata: RegionMetadata;
  noteFrequency: number;
  colorScheme: string;
  bellCurveWidth: number;
  onPreviousNote: () => void;
  onNextNote: () => void;
  onPrevOctave: () => void;
  onNextOctave: () => void;
  strikeState: StrikeState;
  strikeMeasurement: StrikeMeasurement | null;
  strikeMeasurementFrequency: number | null;
  strikeMeasurementMagnitude: number;
}

const BasicPlot: React.FC<BasicPlotProps> = ({
  regionMetadata,
  noteFrequency,
  colorScheme,
  bellCurveWidth,
  onPreviousNote,
  onNextNote,
  onPrevOctave,
  onNextOctave,
  strikeState,
  strikeMeasurement,
  strikeMeasurementFrequency,
  strikeMeasurementMagnitude,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const { settings } = usePlotSettings();
  const animationFrameRef = useRef<number | undefined>(undefined);
  const [quadrantOverlay, setQuadrantOverlay] = useState<{ visible: boolean; quadrant: number }>({
    visible: false,
    quadrant: 0,
  });

  // State for strike measurements
  const [lastStrikeFrequency, setLastStrikeFrequency] = useState<number | null>(null);
  const [_lastStrikeMeasurement, setLastStrikeMeasurement] = useState<StrikeMeasurement | null>(
    null
  );

  // Update lastStrikeFrequency when a new measurement comes in
  useEffect(() => {
    if (strikeMeasurementFrequency !== null && strikeMeasurementFrequency > 0) {
      setLastStrikeFrequency(strikeMeasurementFrequency);
    }
  }, [strikeMeasurementFrequency]);

  // Update lastStrikeMeasurement when a valid measurement is received
  useEffect(() => {
    if (strikeMeasurement && strikeMeasurement.frequency > 0) {
      setLastStrikeMeasurement(strikeMeasurement);
    }
  }, [strikeMeasurement]);

  // Previous values for smooth animation
  const prevValuesRef = useRef({
    centsDeviation: 0,
    confidence: 0,
  });

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

  // Get color scheme
  const getSchemeColor = useCallback(
    (t: number): [number, number, number] => {
      const scheme = colorSchemes.find(s => s.name === colorScheme) || colorSchemes[0];
      t = Math.max(0, Math.min(1, t)); // Clamp between 0 and 1

      // Find the color stops we're between
      for (let i = 0; i < scheme.stops.length - 1; i++) {
        const currentStop = scheme.stops[i];
        const nextStop = scheme.stops[i + 1];
        if (t <= nextStop.position) {
          const localT = (t - currentStop.position) / (nextStop.position - currentStop.position);
          return interpolateColor(currentStop.color, nextStop.color, localT);
        }
      }
      return scheme.stops[scheme.stops.length - 1].color;
    },
    [colorScheme]
  );

  // Apply fisheye transformation (matching the shader in SpectrumPlot)
  const getXPosition = useCallback(
    (freq: number) => {
      if (!freq || freq <= 0) {
        return 50;
      }

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

  const drawTuningIndicator = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Get canvas dimensions
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const centerY = height / 2;

    // Calculate cents deviation
    const centsDeviation =
      regionMetadata.peakFrequency > 0
        ? 1200 * Math.log2(regionMetadata.peakFrequency / noteFrequency)
        : 0;

    // Smooth the cents deviation
    prevValuesRef.current.centsDeviation +=
      (centsDeviation - prevValuesRef.current.centsDeviation) * 0.15;
    prevValuesRef.current.confidence +=
      (regionMetadata.peakConfidence - prevValuesRef.current.confidence) * 0.15;

    // Calculate normalized position based on tuning range (use ±20 cents as default range)
    const tuningRange = 20;
    const normalizedDeviation = prevValuesRef.current.centsDeviation / tuningRange;
    // Clamp between -1 and 1 for display purposes
    const clampedDeviation = Math.max(-1, Math.min(1, normalizedDeviation));

    // Get colors from scheme
    const deviationColor = getSchemeColor(Math.abs(clampedDeviation));
    const inTuneColor = getSchemeColor(0.8); // Use a high value in the scheme for "in tune"
    const baseColor = getSchemeColor(0.2); // Use a low value in the scheme for base color

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw background
    const isInTune = Math.abs(prevValuesRef.current.centsDeviation) <= 1;
    ctx.fillStyle = isInTune
      ? `rgba(${inTuneColor[0] * 255}, ${inTuneColor[1] * 255}, ${inTuneColor[2] * 255}, 0.1)`
      : `rgba(${baseColor[0] * 255}, ${baseColor[1] * 255}, ${baseColor[2] * 255}, 0.1)`;
    ctx.fillRect(0, 0, width, height);

    // Draw reference lines
    ctx.strokeStyle = alpha(theme.palette.text.secondary, 0.2);
    ctx.setLineDash([5, 5]);

    // Draw center line at the target frequency position
    const targetX = (width * getXPosition(noteFrequency)) / 100;
    ctx.beginPath();
    ctx.moveTo(targetX, 0);
    ctx.lineTo(targetX, height);
    ctx.stroke();

    // Draw range lines and markers
    ctx.setLineDash([]);
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = alpha(theme.palette.text.secondary, 0.6);

    // Draw cents markers
    const markers = [-20, -15, -10, -5, -2, 2, 5, 10, 15, 20];
    markers.forEach(cents => {
      // Convert cents to frequency
      const freq = noteFrequency * Math.pow(2, cents / 1200);
      // Apply fisheye transformation using the same function as for the SVG elements
      const x = (width * getXPosition(freq)) / 100;

      // Draw marker line
      ctx.beginPath();
      ctx.strokeStyle = alpha(theme.palette.text.secondary, 0.1);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Draw cents value
      ctx.fillStyle = alpha(theme.palette.text.secondary, 0.4);
      ctx.font = '12px Arial';
      if (cents > 0) {
        ctx.textAlign = 'left';
        ctx.fillText(`+${cents}`, x + 2, height - 20);
      } else if (cents < 0) {
        ctx.textAlign = 'right';
        ctx.fillText(`${cents}`, x - 2, height - 20);
      }
    });

    // Calculate triangle positions based on deviation
    // Convert cents deviation to frequency
    const deviationFreq = noteFrequency * Math.pow(2, prevValuesRef.current.centsDeviation / 1200);
    // Apply fisheye transformation
    const transformedX = (width * getXPosition(deviationFreq)) / 100;

    const triangleSize = height * 0.15;
    const triangleSpacing = triangleSize * 0.2;
    const innerTriangleSize = triangleSize * 1;
    const innerTriangleSpacing = triangleSpacing * 0.5;

    // Draw moving triangles with scheme color
    // Left triangle (pointing right)
    ctx.beginPath();
    ctx.moveTo(transformedX - triangleSpacing, centerY);
    ctx.lineTo(transformedX - triangleSpacing - triangleSize, centerY + triangleSize / 2);
    ctx.lineTo(transformedX - triangleSpacing - triangleSize, centerY - triangleSize / 2);
    ctx.closePath();
    ctx.fillStyle = `rgba(${deviationColor[0] * 255}, ${deviationColor[1] * 255}, ${deviationColor[2] * 255}, ${prevValuesRef.current.confidence})`;
    ctx.fill();

    // Right triangle (pointing left)
    ctx.beginPath();
    ctx.moveTo(transformedX + triangleSpacing, centerY);
    ctx.lineTo(transformedX + triangleSpacing + triangleSize, centerY + triangleSize / 2);
    ctx.lineTo(transformedX + triangleSpacing + triangleSize, centerY - triangleSize / 2);
    ctx.closePath();
    ctx.fillStyle = `rgba(${deviationColor[0] * 255}, ${deviationColor[1] * 255}, ${deviationColor[2] * 255}, ${prevValuesRef.current.confidence})`;
    ctx.fill();

    // Draw inner triangles (fixed pair) with base color
    // Top triangle (pointing down)
    ctx.beginPath();
    ctx.moveTo(targetX, centerY - innerTriangleSpacing);
    ctx.lineTo(targetX - innerTriangleSize / 2, centerY - innerTriangleSpacing - innerTriangleSize);
    ctx.lineTo(targetX + innerTriangleSize / 2, centerY - innerTriangleSpacing - innerTriangleSize);
    ctx.closePath();
    ctx.fillStyle = `rgba(${baseColor[0] * 255}, ${baseColor[1] * 255}, ${baseColor[2] * 255}, 0.5)`;
    ctx.fill();

    // Bottom triangle (pointing up)
    ctx.beginPath();
    ctx.moveTo(targetX, centerY + innerTriangleSpacing);
    ctx.lineTo(targetX + innerTriangleSize / 2, centerY + innerTriangleSpacing + innerTriangleSize);
    ctx.lineTo(targetX - innerTriangleSize / 2, centerY + innerTriangleSpacing + innerTriangleSize);
    ctx.closePath();
    ctx.fillStyle = `rgba(${baseColor[0] * 255}, ${baseColor[1] * 255}, ${baseColor[2] * 255}, 0.5)`;
    ctx.fill();

    // Draw cents deviation text with scheme color
    const isPositive = prevValuesRef.current.centsDeviation > 0;
    ctx.font = 'bold 48px Arial';
    ctx.fillStyle = `rgba(${deviationColor[0] * 255}, ${deviationColor[1] * 255}, ${deviationColor[2] * 255}, 0.3)`;
    ctx.textAlign = isPositive ? 'left' : 'right';
    ctx.textBaseline = 'top';
    const padding = 40;

    const textX = isPositive ? padding : width - padding;
    const textY = padding;

    const absValue = Math.abs(prevValuesRef.current.centsDeviation);
    const formattedValue = absValue < 10 ? `0${absValue.toFixed(1)}` : absValue.toFixed(1);
    ctx.fillText(`${isPositive ? '+' : '-'}${formattedValue}¢`, textX, textY);

    // Continue animation
    animationFrameRef.current = requestAnimationFrame(drawTuningIndicator);
  }, [theme, noteFrequency, regionMetadata, getSchemeColor, getXPosition]);

  // Handle quadrant click for note switching
  const handleQuadrantClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // Determine which quadrant was clicked
      const quadrant =
        x < rect.width / 2 ? (y < rect.height / 2 ? 1 : 3) : y < rect.height / 2 ? 2 : 4;

      // Show overlay
      setQuadrantOverlay({ visible: true, quadrant });

      // Trigger the appropriate action
      switch (quadrant) {
        case 1: // Top-left: Previous octave
          onPrevOctave();
          break;
        case 2: // Top-right: Next octave
          onNextOctave();
          break;
        case 3: // Bottom-left: Previous note
          onPreviousNote();
          break;
        case 4: // Bottom-right: Next note
          onNextNote();
          break;
      }

      // Hide overlay after a short delay
      setTimeout(() => {
        setQuadrantOverlay({ visible: false, quadrant: 0 });
      }, 300);
    },
    [onPreviousNote, onNextNote, onPrevOctave, onNextOctave]
  );

  const drawFrequencyLines = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Get plot line colors based on the selected color scheme
    const plotLineColors = getPlotLineColors(settings.colorScheme, theme.palette.mode === 'dark');

    // Clear existing lines
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    // Draw target frequency line (vertical line in the center)
    const targetLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    targetLine.setAttribute('x1', '50%');
    targetLine.setAttribute('y1', '0%');
    targetLine.setAttribute('x2', '50%');
    targetLine.setAttribute('y2', '100%');
    targetLine.setAttribute('stroke', plotLineColors.primary);
    targetLine.setAttribute('stroke-width', '2');
    svg.appendChild(targetLine);

    // Draw peak frequency line (red line)
    if (regionMetadata.peakFrequency > 0 && settings.showPeakFrequencyLine) {
      const peakCents = 1200 * Math.log2(regionMetadata.peakFrequency / noteFrequency);
      const peakX = 50 + peakCents / 2.4; // Scale to fit in view

      const peakLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      peakLine.setAttribute('x1', `${peakX}%`);
      peakLine.setAttribute('y1', '0%');
      peakLine.setAttribute('x2', `${peakX}%`);
      peakLine.setAttribute('y2', '100%');
      peakLine.setAttribute('stroke', '#cc0000'); // Keep the red color for peak frequency
      peakLine.setAttribute('stroke-width', '2');
      peakLine.setAttribute('stroke-opacity', '0.8');
      svg.appendChild(peakLine);
    }

    // Note: Legacy frequency stability measurement display has been removed
    // Strike detection now uses magnitude-only trigger system

    // Draw strike state indicator
    const stateCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    stateCircle.setAttribute('cx', '97%');
    stateCircle.setAttribute('cy', '50%');
    stateCircle.setAttribute('r', '8');
    stateCircle.setAttribute('fill', getStrikeStateColor());
    stateCircle.setAttribute('opacity', '0.6');
    svg.appendChild(stateCircle);
  }, [
    noteFrequency,
    regionMetadata,
    theme.palette,
    getStrikeStateColor,
    settings.showPeakFrequencyLine,
    settings.colorScheme,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set up high DPI canvas
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    // Start animation
    drawTuningIndicator();

    // Draw frequency lines
    drawFrequencyLines();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawTuningIndicator, drawFrequencyLines]);

  // Add another useEffect to update frequency lines when relevant props change
  useEffect(() => {
    drawFrequencyLines();
  }, [
    drawFrequencyLines,
    regionMetadata,
    lastStrikeFrequency,
    strikeMeasurementMagnitude,
    settings.showPeakFrequencyLine,
    settings.showStrikeStateLine,
  ]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onClick={handleQuadrantClick}
    >
      <StyledCanvas ref={canvasRef} />

      {/* SVG overlay for indicators */}
      <StyledSvg ref={svgRef} preserveAspectRatio="none" />

      {/* Quadrant overlay for navigation */}
      {quadrantOverlay.visible && (
        <div
          style={{
            position: 'absolute',
            top: quadrantOverlay.quadrant === 1 || quadrantOverlay.quadrant === 2 ? 0 : '50%',
            left: quadrantOverlay.quadrant === 1 || quadrantOverlay.quadrant === 3 ? 0 : '50%',
            width: '50%',
            height: '50%',
            backgroundColor: alpha(theme.palette.primary.main, 0.1),
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
};

export default React.memo(BasicPlot);
