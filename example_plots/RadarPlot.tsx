import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Box, useTheme, useMediaQuery } from '@mui/material';
import { styled } from '@mui/system';
import { alpha } from '@mui/material/styles';
import { RegionMetadata, StrikeState, StrikeMeasurement } from '@/app/wasm/audio_processor_wrapper';
import { usePlotSettings } from '../../settings/contexts/PlotSettingsContext';
import { useHarmonicFundamental } from '../../../hooks/useHarmonicFundamental';

export interface RadarPlotProps {
  regionData: Float32Array;
  regionMetadata: RegionMetadata;
  thresholdPercentage: number;
  zenMode: boolean;
  showLines: boolean;
  noteFrequency: number;
  bellCurveWidth?: number;
  onBellCurveWidthChange?: (width: number) => void;
  onToggleLines?: () => void;
  onPrevOctave?: () => void;
  onNextOctave?: () => void;
  onPreviousNote?: () => void;
  onNextNote?: () => void;
  colorScheme?: string;
  onColorSchemeChange?: (scheme: string) => void;
  strikeState?: StrikeState;
  strikeMeasurement?: StrikeMeasurement | null;
  strikeMeasurementFrequency?: number | null;
  strikeMeasurementMagnitude?: number;
}

const StyledCanvas = styled('canvas')(({ theme }) => {
  const isDesktop = useMediaQuery(theme.breakpoints.up('sm'));
  return {
    width: '100%',
    height: '100%',
    border: isDesktop ? `1px solid ${theme.palette.mode === 'dark' ? 'white' : 'black'}` : 'none',
    display: 'block',
    touchAction: 'none',
    cursor: 'pointer',
  };
});

const RadarPlot: React.FC<RadarPlotProps> = memo(
  ({
    regionData,
    regionMetadata,
    zenMode,
    showLines,
    noteFrequency,
    bellCurveWidth = 4.0,
    onPrevOctave,
    onNextOctave,
    onPreviousNote,
    onNextNote,
    colorScheme = 'Viridis',
    strikeState = 'WAITING',
    strikeMeasurement = null,
    strikeMeasurementFrequency = null,
    strikeMeasurementMagnitude = 0,
  }) => {
    const theme = useTheme();
    const { settings } = usePlotSettings();

    // Use harmonic fundamental data instead of complex strike measurement system
    const { fundamentalFrequency, hasValidMeasurement } = useHarmonicFundamental(300);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [overlay, setOverlay] = useState<{ visible: boolean; quadrant: number }>({
      visible: false,
      quadrant: -1,
    });
    const [isTouchDevice, setIsTouchDevice] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const [lastStrikeFrequency, setLastStrikeFrequency] = useState<number | null>(null);
    const [lastStrikeMeasurement, setLastStrikeMeasurement] = useState<StrikeMeasurement | null>(
      null
    );

    // Move getSchemeColors outside and memoize it
    const getSchemeColors = useCallback(() => {
      // Ensure we're using the current colorScheme prop value
      const currentScheme = colorScheme || 'Viridis';
      switch (currentScheme) {
        case 'Grayscale':
          return {
            primary: 'rgba(200, 200, 200, 0.8)',
            secondary: 'rgba(150, 150, 150, 0.6)',
            text: 'rgba(220, 220, 220, 0.9)',
            highlight: 'rgba(255, 255, 255, 0.9)',
            gradientStops: [
              { pos: 0, color: 'rgba(255, 255, 255, 0.8)' },
              { pos: 0.3, color: 'rgba(200, 200, 200, 0.7)' },
              { pos: 0.6, color: 'rgba(150, 150, 150, 0.6)' },
              { pos: 1, color: 'rgba(50, 50, 50, 0.5)' },
            ],
          };
        case 'Jet':
          return {
            primary: 'rgba(0, 150, 255, 0.8)',
            secondary: 'rgba(0, 100, 255, 0.6)',
            text: 'rgba(200, 200, 255, 0.9)',
            highlight: 'rgba(255, 255, 255, 0.9)',
            gradientStops: [
              { pos: 0, color: 'rgba(0, 0, 255, 0.8)' },
              { pos: 0.3, color: 'rgba(0, 255, 255, 0.7)' },
              { pos: 0.5, color: 'rgba(0, 255, 0, 0.6)' },
              { pos: 0.7, color: 'rgba(255, 255, 0, 0.5)' },
              { pos: 1, color: 'rgba(255, 0, 0, 0.4)' },
            ],
          };
        case 'Thermal':
          return {
            primary: 'rgba(200, 50, 0, 0.9)',
            secondary: 'rgba(150, 50, 0, 0.8)',
            text: 'rgba(120, 30, 0, 0.95)',
            highlight: 'rgba(100, 20, 0, 1.0)',
            gradientStops: [
              { pos: 0, color: 'rgba(255, 255, 255, 0.8)' },
              { pos: 0.3, color: 'rgba(255, 200, 50, 0.7)' },
              { pos: 0.6, color: 'rgba(255, 100, 50, 0.6)' },
              { pos: 1, color: 'rgba(128, 0, 0, 0.5)' },
            ],
          };
        case 'Batlow':
          return {
            primary: 'rgba(64, 71, 108, 0.8)',
            secondary: 'rgba(167, 110, 89, 0.6)',
            text: 'rgba(242, 167, 63, 0.9)',
            highlight: 'rgba(255, 255, 255, 0.9)',
            gradientStops: [
              { pos: 0, color: 'rgba(0, 32, 81, 0.8)' },
              { pos: 0.3, color: 'rgba(64, 71, 108, 0.7)' },
              { pos: 0.6, color: 'rgba(167, 110, 89, 0.6)' },
              { pos: 1, color: 'rgba(242, 167, 63, 0.5)' },
            ],
          };
        case 'Viridis':
        default:
          return {
            primary: 'rgba(72, 35, 116, 0.8)',
            secondary: 'rgba(33, 145, 140, 0.6)',
            text: 'rgba(94, 201, 98, 0.9)',
            highlight: 'rgba(255, 255, 255, 0.9)',
            gradientStops: [
              { pos: 0, color: 'rgba(68, 1, 84, 0.8)' },
              { pos: 0.3, color: 'rgba(72, 35, 116, 0.7)' },
              { pos: 0.5, color: 'rgba(59, 82, 139, 0.6)' },
              { pos: 0.7, color: 'rgba(33, 145, 140, 0.5)' },
              { pos: 1, color: 'rgba(94, 201, 98, 0.4)' },
            ],
          };
      }
    }, [colorScheme]);

    // Initialize colorsRef with the current scheme
    const colorsRef = useRef(getSchemeColors());

    // Update colors ref when colorScheme changes
    useEffect(() => {
      colorsRef.current = getSchemeColors();
    }, [colorScheme, getSchemeColors]);

    // Update lastStrikeMeasurement when a valid measurement is received
    useEffect(() => {
      if (strikeMeasurement) {
        console.log('RadarPlot: strikeMeasurement received:', strikeMeasurement);

        // Only update if we have a valid frequency or if we don't already have a measurement
        if (strikeMeasurement.frequency > 0 || !lastStrikeMeasurement) {
          console.log('RadarPlot: updating lastStrikeMeasurement');
          // Create a deep copy to ensure state updates properly
          const measurementCopy = {
            ...strikeMeasurement,
          };

          setLastStrikeMeasurement(measurementCopy as StrikeMeasurement);

          // Log the state after update to verify
          setTimeout(() => {
            console.log('RadarPlot: lastStrikeMeasurement after update:', lastStrikeMeasurement);
          }, 0);
        }
      }
      // Important: We don't reset the measurement when it's null or zero
      // This allows us to keep displaying the last valid measurement
    }, [strikeMeasurement, lastStrikeMeasurement]);

    // Update lastStrikeFrequency when a new measurement comes in
    useEffect(() => {
      if (strikeMeasurementFrequency !== null && strikeMeasurementFrequency > 0) {
        console.log('RadarPlot: strikeMeasurementFrequency updated:', strikeMeasurementFrequency);
        setLastStrikeFrequency(strikeMeasurementFrequency);
      }
      // Important: We don't reset the frequency when it's null or zero
      // This allows us to keep displaying the last valid frequency
    }, [strikeMeasurementFrequency]);

    // Log strike state changes
    useEffect(() => {
      console.log('RadarPlot: strikeState:', strikeState);
    }, [strikeState]);

    // Add a helper function for the bell curve transformation
    const applyBellCurveDistortion = useCallback(
      (cents: number) => {
        // Convert cents to normalized position (-1 to 1)
        const normalizedCents = cents / 120;

        // Modified distortion formula to magnify center
        const distortion = bellCurveWidth;

        // If within ±10 cents (normalized ±0.083), apply magnification
        const centralRegion = 10 / 120; // ±10 cents normalized
        if (Math.abs(normalizedCents) <= centralRegion) {
          // Magnify the central region
          return cents * (1 + distortion);
        } else {
          // Compress outer regions to maintain continuity
          const sign = Math.sign(normalizedCents);
          const magnifiedCenter = centralRegion * (1 + distortion);
          const remainingSpace = 1 - magnifiedCenter;
          const normalizedOuterPosition =
            (Math.abs(normalizedCents) - centralRegion) / (1 - centralRegion);

          return (
            sign *
            // First get through the magnified center region
            (centralRegion * (1 + distortion) * 120 +
              // Then add the compressed outer region
              normalizedOuterPosition * remainingSpace * 120)
          );
        }
      },
      [bellCurveWidth]
    );

    // Memoize the drawRadar function
    const drawRadar = useCallback(() => {
      console.log('drawRadar recreated with:', {
        strikeState,
        lastStrikeFrequency,
        lastStrikeMeasurement,
        strikeMeasurementMagnitude,
      });

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas || !regionData || !regionMetadata) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const colors = colorsRef.current;

        // Clear the canvas with a transparent/white background
        ctx.clearRect(0, 0, dimensions.width, dimensions.height);

        // Fill the background with theme-appropriate color
        ctx.fillStyle = theme.palette.background.paper;
        ctx.fillRect(0, 0, dimensions.width, dimensions.height);

        // Center in both dimensions for true circle
        const centerX = dimensions.width / 2;
        const centerY = dimensions.height / 2;
        const maxRadius = Math.min(dimensions.width, dimensions.height) * 0.45;

        // Draw concentric circles with dynamic opacity
        const numCircles = 8;
        for (let i = 1; i <= numCircles; i++) {
          const radius = maxRadius * (i / numCircles);
          const opacity = 0.2 + (i / numCircles) * 0.3;

          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.strokeStyle = colors.secondary.replace(/[\d.]+\)$/, `${opacity})`);
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw cent markers (full circle)
        if (showLines) {
          const drawCentLine = (cents: number, label: string, isMainReference = false) => {
            // Apply bell curve distortion to the cents value
            const distortedCents = applyBellCurveDistortion(cents);

            // Convert to angle, starting from top (-π/2) and going clockwise
            const angle = -Math.PI / 2 + (distortedCents / 120) * Math.PI;
            const x = centerX + maxRadius * Math.cos(angle);
            const y = centerY + maxRadius * Math.sin(angle);

            // Draw the line
            ctx.beginPath();
            if (isMainReference) {
              // Make the zero line more prominent
              ctx.strokeStyle = colors.highlight;
              ctx.setLineDash([]);
              ctx.lineWidth = 2;
            } else if (Math.abs(cents) <= 10) {
              // Fine-tuning reference lines
              ctx.strokeStyle = colors.primary;
              ctx.setLineDash([2, 2]);
              ctx.lineWidth = 1;
            } else {
              // Outer reference lines
              ctx.strokeStyle = colors.secondary;
              ctx.setLineDash([5, 5]);
              ctx.lineWidth = 1;
            }
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Only draw labels for main reference points
            if (Math.abs(cents) >= 10 || cents === 0) {
              // Draw the label with better positioning
              ctx.fillStyle = colors.text;
              ctx.font = isMainReference ? 'bold 14px Arial' : '12px Arial';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              const textRadius = maxRadius + 20;
              const textX = centerX + textRadius * Math.cos(angle);
              const textY = centerY + textRadius * Math.sin(angle);

              // Rotate text for better readability
              ctx.save();
              ctx.translate(textX, textY);
              ctx.rotate(angle + Math.PI / 2);
              ctx.fillText(label, 0, 0);
              ctx.restore();
            }
          };

          // Draw all reference lines
          // First draw outer reference lines
          [-100, -50, -20].forEach(cents => {
            drawCentLine(cents, `${cents}¢`);
          });
          [20, 50, 100].forEach(cents => {
            drawCentLine(cents, `+${cents}¢`);
          });

          // Draw fine-tuning reference lines
          for (let cents = -10; cents <= 10; cents++) {
            if (cents === 0) {
              // Draw the main reference line last so it's on top
              continue;
            }
            drawCentLine(cents, `${cents > 0 ? '+' : ''}${cents}¢`);
          }

          // Draw the main reference line last so it's on top
          drawCentLine(0, '0¢', true);
        }

        // Draw the magnitude visualization
        ctx.beginPath();
        const totalPoints = regionData.length;

        // Create gradient for the fill
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
        if (zenMode) {
          gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
        } else {
          // Apply gradient stops from color scheme
          colors.gradientStops.forEach(stop => {
            gradient.addColorStop(stop.pos, stop.color);
          });
        }

        // Calculate frequency range and bin mapping
        const centRange = 120; // ±120 cents
        const referenceFreq = noteFrequency;
        const lowerFreq = Math.max(
          regionMetadata.startFrequency,
          referenceFreq * Math.pow(2, -centRange / 1200)
        );
        const upperFreq = Math.min(
          regionMetadata.endFrequency,
          referenceFreq * Math.pow(2, centRange / 1200)
        );

        // Find the corresponding bin indices
        const lowerBin = Math.floor(
          (lowerFreq - regionMetadata.startFrequency) / regionMetadata.frequencyPerBin
        );
        const upperBin = Math.ceil(
          (upperFreq - regionMetadata.startFrequency) / regionMetadata.frequencyPerBin
        );

        // Draw filled shape with bell curve distortion
        ctx.beginPath();
        for (let i = lowerBin; i <= upperBin && i < regionData.length; i++) {
          const freq = regionMetadata.startFrequency + i * regionMetadata.frequencyPerBin;
          // Clamp frequency to our valid range
          const clampedFreq = Math.max(lowerFreq, Math.min(upperFreq, freq));
          const cents = 1200 * Math.log2(clampedFreq / referenceFreq);
          // Apply bell curve distortion
          const distortedCents = applyBellCurveDistortion(cents);
          const angle = -Math.PI / 2 + (distortedCents / 120) * Math.PI;
          const magnitude = regionData[i];
          const radius = magnitude * maxRadius;

          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Add glow effect with distortion
        ctx.globalCompositeOperation = 'screen';
        ctx.beginPath();
        for (let i = 0; i < totalPoints; i++) {
          const freq = regionMetadata.startFrequency + i * regionMetadata.frequencyPerBin;
          const cents = 1200 * Math.log2(freq / referenceFreq);
          const distortedCents = applyBellCurveDistortion(cents);
          const angle = -Math.PI / 2 + (distortedCents / 120) * Math.PI;
          const magnitude = regionData[i];

          if (magnitude > 0.7) {
            const radius = magnitude * maxRadius;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);

            ctx.beginPath();
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, 20);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${magnitude * 0.5})`);
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = gradient;
            ctx.arc(x, y, 20, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over';

        // Draw peak frequency line (red line)
        if (regionMetadata.peakFrequency > 0 && settings.showPeakFrequencyLine) {
          const peakCents = 1200 * Math.log2(regionMetadata.peakFrequency / noteFrequency);
          const distortedPeakCents = applyBellCurveDistortion(peakCents);
          const peakAngle = -Math.PI / 2 + (distortedPeakCents / 120) * Math.PI;

          ctx.beginPath();
          ctx.strokeStyle = '#cc0000'; // Red color for peak frequency
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(
            centerX + maxRadius * 1.1 * Math.cos(peakAngle),
            centerY + maxRadius * 1.1 * Math.sin(peakAngle)
          );
          ctx.stroke();
        }

        // Draw harmonic fundamental line (green line)
        const strikeFundamental = strikeMeasurement?.frequency;
        const displayFrequency =
          fundamentalFrequency || strikeFundamental || regionMetadata.peakFrequency;

        if (
          settings.showStrikeStateLine &&
          (hasValidMeasurement || strikeState === 'MONITORING') &&
          displayFrequency
        ) {
          const strikeCents = 1200 * Math.log2(displayFrequency / noteFrequency);
          const distortedStrikeCents = applyBellCurveDistortion(strikeCents);
          const strikeAngle = -Math.PI / 2 + (distortedStrikeCents / 120) * Math.PI;

          ctx.beginPath();
          ctx.strokeStyle = '#00ff00'; // Green color for harmonic fundamental
          ctx.lineWidth = 3;
          ctx.setLineDash([]);
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(
            centerX + maxRadius * 1.1 * Math.cos(strikeAngle),
            centerY + maxRadius * 1.1 * Math.sin(strikeAngle)
          );
          ctx.stroke();
        }

        // Note: Legacy frequency stability measurement display has been removed
        // Strike detection now uses magnitude-only trigger system

        // Draw strike state indicator circle in the corner
        const strikeStateColor = (() => {
          console.log('Drawing strike state indicator:', strikeState);
          switch (strikeState) {
            case 'WAITING':
              return theme.palette.grey[500];
            case 'ATTACK':
              return theme.palette.warning.main;
            case 'MONITORING':
              return theme.palette.success.main;
            default:
              console.log('Unknown strike state:', strikeState);
              return theme.palette.grey[500];
          }
        })();

        ctx.beginPath();
        ctx.fillStyle = strikeStateColor;
        ctx.arc(dimensions.width - 15, dimensions.height / 2, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // Add ratio indicator with better visibility
        if (!zenMode) {
          ctx.font = 'bold 14px Arial';
          ctx.fillStyle = colors.text;
          ctx.textAlign = 'center';
          const ratio = (regionMetadata.envelopeMax / regionMetadata.envelopeMin).toFixed(1);
          ctx.fillText(`Signal Ratio: ${ratio}x`, centerX, dimensions.height - 20);
        }
      });
    }, [
      regionData,
      regionMetadata,
      dimensions,
      zenMode,
      showLines,
      noteFrequency,
      applyBellCurveDistortion,
      lastStrikeFrequency,
      lastStrikeMeasurement,
      strikeMeasurementMagnitude,
      strikeState,
      strikeMeasurement,
      fundamentalFrequency,
      hasValidMeasurement,
      theme.palette,
      settings.showPeakFrequencyLine,
      settings.showStrikeStateLine,
    ]);

    // Effect to trigger redraw when necessary
    useEffect(() => {
      if (dimensions.width === 0 || dimensions.height === 0) return;
      drawRadar();
    }, [drawRadar, dimensions.width, dimensions.height]);

    // Effect to trigger redraw when color scheme changes
    useEffect(() => {
      if (dimensions.width === 0 || dimensions.height === 0) return;
      // Cancel any pending animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // Schedule a new draw
      drawRadar();
    }, [colorScheme, drawRadar, dimensions.height, dimensions.width]);

    useEffect(() => {
      const resizeObserver = new ResizeObserver(entries => {
        if (entries[0]) {
          const { width, height } = entries[0].contentRect;
          setDimensions({ width, height });
        }
      });

      if (canvasRef.current) {
        resizeObserver.observe(canvasRef.current);
      }

      return () => {
        resizeObserver.disconnect();
      };
    }, []);

    // Create a separate effect for canvas setup
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const newWidth = dimensions.width * dpr;
      const newHeight = dimensions.height * dpr;

      // Only resize if dimensions actually changed
      if (canvas.width !== newWidth || canvas.height !== newHeight) {
        canvas.width = newWidth;
        canvas.height = newHeight;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(dpr, dpr);
        }
      }
    }, [dimensions.width, dimensions.height]);

    const handleQuadrantInteraction = useCallback(
      (event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
        // Prevent event bubbling
        event.stopPropagation();
        event.preventDefault();

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
        const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const isLeftSide = x < rect.width / 2;
        const isTopHalf = y < rect.height / 2;

        const quadrant = isTopHalf ? (isLeftSide ? 0 : 1) : isLeftSide ? 2 : 3;

        setOverlay({ visible: true, quadrant });

        // Use requestAnimationFrame to ensure smooth animation
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

          // Hide overlay after the action
          setTimeout(() => {
            setOverlay({ visible: false, quadrant: -1 });
          }, 200);
        });
      },
      [onPrevOctave, onNextOctave, onPreviousNote, onNextNote]
    );

    useEffect(() => {
      setIsTouchDevice('ontouchstart' in window);
    }, []);

    return (
      <Box
        ref={containerRef}
        sx={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'none',
          userSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
        onTouchStart={handleQuadrantInteraction}
        {...(!isTouchDevice ? { onClick: handleQuadrantInteraction } : {})}
      >
        <StyledCanvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%' }}
          sx={{ touchAction: 'none' }}
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
                  ? alpha(theme.palette.primary.main, 0.1)
                  : 'transparent',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        ))}
      </Box>
    );
  }
);

RadarPlot.displayName = 'RadarPlot';

export default RadarPlot;
