import React, { useRef, useEffect, useCallback } from 'react';
import { useTheme } from '@mui/material';
import { styled } from '@mui/system';
import { alpha } from '@mui/material/styles';
import type { RegionMetadata } from '@/app/wasm/audio_processor_wrapper';
import { colorSchemes, interpolateColor } from '../colorSchemes/colorSchemes';

const StyledCanvas = styled('canvas')({
  width: '100%',
  height: '90px',
  display: 'block',
  '@media (max-width: 768px) and (orientation: portrait)': {
    height: '70px', // Smaller height for mobile portrait to fit better
  },
});

interface FineTuningIndicatorProps {
  regionData: Float32Array;
  regionMetadata: RegionMetadata;
  noteFrequency: number;
  tuningRange: 5 | 10 | 20;
  showTuningIndicator: boolean;
  colorScheme: string;
}

const FineTuningIndicator: React.FC<FineTuningIndicatorProps> = ({
  regionMetadata,
  noteFrequency,
  tuningRange,
  showTuningIndicator,
  colorScheme,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();

  // Animation frame reference
  const animationFrameRef = useRef<number | undefined>(undefined);

  // Previous values for smooth animation
  const prevValuesRef = useRef({
    centsDeviation: 0,
    confidence: 0,
  });

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

  const drawTuningIndicator = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showTuningIndicator) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Get canvas dimensions
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;
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

    // Calculate normalized position based on tuning range
    const normalizedDeviation = prevValuesRef.current.centsDeviation / tuningRange;
    // Clamp between -1 and 1 for display purposes
    const clampedDeviation = Math.max(-1, Math.min(1, normalizedDeviation));

    // Triangle dimensions
    const triangleSize = height * 0.4;
    const triangleSpacing = triangleSize * 0.2;
    const innerTriangleSize = triangleSize * 1;
    const innerTriangleSpacing = triangleSpacing * 0.5;

    // Get colors from scheme
    const deviationColor = getSchemeColor(Math.abs(clampedDeviation));
    const inTuneColor = getSchemeColor(0.8); // Use a high value in the scheme for "in tune"
    const baseColor = getSchemeColor(0.2); // Use a low value in the scheme for base color

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw background rectangle
    const isInTune = Math.abs(prevValuesRef.current.centsDeviation) <= 1;
    ctx.fillStyle = isInTune
      ? `rgba(${inTuneColor[0] * 255}, ${inTuneColor[1] * 255}, ${inTuneColor[2] * 255}, 0.1)`
      : `rgba(${baseColor[0] * 255}, ${baseColor[1] * 255}, ${baseColor[2] * 255}, 0.1)`;
    ctx.fillRect(0, 0, width, height);

    // Draw reference lines
    ctx.strokeStyle = alpha(theme.palette.text.secondary, 0.2);
    ctx.setLineDash([5, 5]);

    // Draw center line
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.stroke();

    // Draw range lines and markers
    ctx.setLineDash([]);
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = alpha(theme.palette.text.secondary, 0.6);

    const getCentsMarkers = (range: number) => {
      switch (range) {
        case 5:
          return [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];
        case 10:
          return [-10, -8, -6, -4, -2, 2, 4, 6, 8, 10];
        case 20:
          return [-20, -15, -10, -5, -2, 2, 5, 10, 15, 20];
        default:
          return [];
      }
    };

    const markers = getCentsMarkers(tuningRange);
    markers.forEach(cents => {
      const x = centerX + (width / 2) * (cents / tuningRange);
      // Draw marker line
      ctx.beginPath();
      ctx.strokeStyle = alpha(theme.palette.text.secondary, 0.1);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Draw cents value on alternating sides
      ctx.fillStyle = alpha(theme.palette.text.secondary, 0.4);
      ctx.font = '9px Arial';
      if (cents > 0) {
        ctx.textAlign = 'left';
        ctx.fillText(`+${cents}`, x + 2, height - 5);
      } else if (cents < 0) {
        ctx.textAlign = 'right';
        ctx.fillText(`${cents}`, x - 2, height - 5);
      }
    });

    // Calculate triangle positions based on deviation
    const offset = (width / 2) * clampedDeviation;

    // Draw outer triangles (moving pair) with scheme color
    // Left triangle (pointing right)
    ctx.beginPath();
    ctx.moveTo(centerX - triangleSpacing + offset, centerY);
    ctx.lineTo(centerX - triangleSpacing - triangleSize + offset, centerY + triangleSize / 2);
    ctx.lineTo(centerX - triangleSpacing - triangleSize + offset, centerY - triangleSize / 2);
    ctx.closePath();
    ctx.fillStyle = `rgba(${deviationColor[0] * 255}, ${deviationColor[1] * 255}, ${deviationColor[2] * 255}, ${prevValuesRef.current.confidence})`;
    ctx.fill();

    // Right triangle (pointing left)
    ctx.beginPath();
    ctx.moveTo(centerX + triangleSpacing + offset, centerY);
    ctx.lineTo(centerX + triangleSpacing + triangleSize + offset, centerY + triangleSize / 2);
    ctx.lineTo(centerX + triangleSpacing + triangleSize + offset, centerY - triangleSize / 2);
    ctx.closePath();
    ctx.fillStyle = `rgba(${deviationColor[0] * 255}, ${deviationColor[1] * 255}, ${deviationColor[2] * 255}, ${prevValuesRef.current.confidence})`;
    ctx.fill();

    // Draw inner triangles (fixed pair) with base color
    // Top triangle (pointing down)
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - innerTriangleSpacing);
    ctx.lineTo(centerX - innerTriangleSize / 2, centerY - innerTriangleSpacing - innerTriangleSize);
    ctx.lineTo(centerX + innerTriangleSize / 2, centerY - innerTriangleSpacing - innerTriangleSize);
    ctx.closePath();
    ctx.fillStyle = `rgba(${baseColor[0] * 255}, ${baseColor[1] * 255}, ${baseColor[2] * 255}, 0.5)`;
    ctx.fill();

    // Bottom triangle (pointing up)
    ctx.beginPath();
    ctx.moveTo(centerX, centerY + innerTriangleSpacing);
    ctx.lineTo(centerX + innerTriangleSize / 2, centerY + innerTriangleSpacing + innerTriangleSize);
    ctx.lineTo(centerX - innerTriangleSize / 2, centerY + innerTriangleSpacing + innerTriangleSize);
    ctx.closePath();
    ctx.fillStyle = `rgba(${baseColor[0] * 255}, ${baseColor[1] * 255}, ${baseColor[2] * 255}, 0.5)`;
    ctx.fill();

    // Draw cents deviation text with scheme color
    const isPositive = prevValuesRef.current.centsDeviation > 0;
    ctx.font = 'bold 36px Arial';
    ctx.fillStyle = `rgba(${deviationColor[0] * 255}, ${deviationColor[1] * 255}, ${deviationColor[2] * 255}, 0.3)`;
    ctx.textAlign = isPositive ? 'left' : 'right';
    ctx.textBaseline = 'top';
    const padding = 20;

    const textX = isPositive ? padding : width - padding;
    const textY = padding;

    const absValue = Math.abs(prevValuesRef.current.centsDeviation);
    const formattedValue = absValue < 10 ? `0${absValue.toFixed(1)}` : absValue.toFixed(1);
    ctx.fillText(`${isPositive ? '+' : '-'}${formattedValue}¢`, textX, textY);

    // Draw range indicator
    ctx.font = '12px Arial';
    ctx.fillStyle = alpha(theme.palette.text.secondary, 0.4);
    ctx.textAlign = 'right';
    ctx.fillText(`±${tuningRange}¢`, width - 10, height - 10);

    // Continue animation
    animationFrameRef.current = requestAnimationFrame(drawTuningIndicator);
  }, [theme, noteFrequency, tuningRange, showTuningIndicator, regionMetadata, getSchemeColor]);

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

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawTuningIndicator]);

  if (!showTuningIndicator) return null;

  return <StyledCanvas ref={canvasRef} />;
};

export default React.memo(FineTuningIndicator, (prevProps, nextProps) => {
  return (
    prevProps.regionData === nextProps.regionData &&
    prevProps.regionMetadata === nextProps.regionMetadata &&
    prevProps.noteFrequency === nextProps.noteFrequency &&
    prevProps.tuningRange === nextProps.tuningRange &&
    prevProps.showTuningIndicator === nextProps.showTuningIndicator &&
    prevProps.colorScheme === nextProps.colorScheme
  );
});
