'use client';
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Box, useTheme } from '@mui/material';
import { styled } from '@mui/system';
import { RegionMetadata, StrikeState, StrikeMeasurement } from '@/app/wasm/audio_processor_wrapper';
import { usePlotSettings } from '../../settings/contexts/PlotSettingsContext';
import { getCircleConfig, CircleConfig } from './circleConfigurations';

// Safe check for browser environment
const isBrowser = typeof window !== 'undefined';

// Styled components
const StyledSvg = styled('svg')({
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'none',
  zIndex: 2,
});

// Types
export interface ConcentricPlotProps {
  regionMetadata: RegionMetadata;
  noteFrequency: number;
  bellCurveWidth?: number;
  onPrevOctave?: () => void;
  onNextOctave?: () => void;
  onPreviousNote?: () => void;
  onNextNote?: () => void;
  strikeState: StrikeState;
  strikeMeasurement: StrikeMeasurement | null;
}

const ConcentricPlot: React.FC<ConcentricPlotProps> = ({
  regionMetadata,
  noteFrequency,
  bellCurveWidth = 4.0,
  onPrevOctave,
  onNextOctave,
  onPreviousNote,
  onNextNote,
  strikeState,
  strikeMeasurement: _strikeMeasurement,
}) => {
  const theme = useTheme();
  const { settings } = usePlotSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [overlay, setOverlay] = useState<{ visible: boolean; quadrant: number }>({
    visible: false,
    quadrant: -1,
  });

  // Get the current circle configuration based on user settings
  const CIRCLE_CONFIG = getCircleConfig(settings.circleMode);

  // Generate dynamic reference lines based on current circle configuration
  const generateReferenceLines = useCallback(() => {
    return CIRCLE_CONFIG.map((config, index) => {
      // Calculate position for this movement range
      const leftPercent = ((120 - config.movementRange) / 240) * 100;
      const rightPercent = ((120 + config.movementRange) / 240) * 100;

      return {
        leftPos: `${leftPercent}%`,
        rightPos: `${rightPercent}%`,
        value: config.movementRange,
        color: config.color,
        textY: `${15 - index * 2}%`, // Stagger text vertically
      };
    });
  }, [CIRCLE_CONFIG]);

  const referenceLines = generateReferenceLines();

  // Function to convert frequency to x position within a specific circle's range
  const getXPositionForCircle = useCallback(
    (freq: number, movementRange: number) => {
      // Convert frequency to cents relative to target
      const cents = 1200 * Math.log2(freq / noteFrequency);

      // Convert to normalized position (0 to 1) within this circle's range
      const normalizedPos = (cents + movementRange) / (2 * movementRange);

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

  // Function to check if frequency is within a specific tolerance
  const isWithinTolerance = useCallback(
    (freq: number, toleranceCents: number) => {
      const cents = Math.abs(1200 * Math.log2(freq / noteFrequency));
      return cents <= toleranceCents;
    },
    [noteFrequency]
  );

  // Get circle position for a specific circle configuration
  const getCirclePosition = useCallback(
    (config: CircleConfig) => {
      const peakFreq = regionMetadata.peakFrequency;

      if (peakFreq <= 0) {
        return 50; // Center if no valid frequency
      }

      // Check if within locking tolerance - if so, lock to center
      if (isWithinTolerance(peakFreq, config.lockingTolerance)) {
        return 50; // Center position (locked)
      }

      // Otherwise, move within this circle's range
      return getXPositionForCircle(peakFreq, config.movementRange);
    },
    [regionMetadata.peakFrequency, isWithinTolerance, getXPositionForCircle]
  );

  // Find the lowest (most precise) locked-in cents value
  const getLowestLockedCents = useCallback(() => {
    const peakFreq = regionMetadata.peakFrequency;

    if (peakFreq <= 0) {
      return null;
    }

    // Find all configurations we're locked into, then return the one with smallest tolerance
    const lockedConfigs = CIRCLE_CONFIG.filter(config =>
      isWithinTolerance(peakFreq, config.lockingTolerance)
    );

    if (lockedConfigs.length === 0) {
      return null;
    }

    // Return the config with the smallest (most precise) tolerance we're locked into
    return lockedConfigs.reduce((smallest, current) =>
      current.lockingTolerance < smallest.lockingTolerance ? current : smallest
    );
  }, [regionMetadata.peakFrequency, isWithinTolerance, CIRCLE_CONFIG]);

  const lowestLockedConfig = getLowestLockedCents();

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
    if (!isBrowser) return;
    setIsTouchDevice('ontouchstart' in window);
  }, []);

  useEffect(() => {
    if (!isBrowser) return;

    const resizeObserver = new ResizeObserver(entries => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        dimensionsRef.current = { width, height };
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: 'transparent',
        touchAction: 'none',
        overflow: 'hidden',
        padding: 0,
      }}
      onTouchStart={handleQuadrantInteraction}
      {...(!isTouchDevice ? { onClick: handleQuadrantInteraction } : {})}
    >
      <StyledSvg preserveAspectRatio="none">
        {/* Background track line */}
        <line
          x1="0%"
          y1="50%"
          x2="100%"
          y2="50%"
          stroke={theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'}
          strokeWidth="2"
        />

        {/* X-axis division lines for tolerance ranges */}
        {referenceLines.map((line, index) => (
          <React.Fragment key={index}>
            {/* Left line */}
            <line
              x1={line.leftPos}
              y1="0%"
              x2={line.leftPos}
              y2="100%"
              stroke={`${line.color}40`}
              strokeWidth="1"
            />
            <text
              x={line.leftPos}
              y={line.textY}
              fill={`${line.color}B3`}
              fontSize="8"
              textAnchor="middle"
            >
              -{line.value}¢
            </text>

            {/* Right line */}
            <line
              x1={line.rightPos}
              y1="0%"
              x2={line.rightPos}
              y2="100%"
              stroke={`${line.color}40`}
              strokeWidth="1"
            />
            <text
              x={line.rightPos}
              y={line.textY}
              fill={`${line.color}B3`}
              fontSize="8"
              textAnchor="middle"
            >
              +{line.value}¢
            </text>
          </React.Fragment>
        ))}

        {/* Center target indicator */}
        <line
          x1="50%"
          y1="25%"
          x2="50%"
          y2="75%"
          stroke={theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)'}
          strokeWidth="3"
        />
        <text
          x="50%"
          y="22%"
          fill={theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)'}
          fontSize="10"
          textAnchor="middle"
          fontWeight="bold"
        >
          0¢
        </text>

        {/* Circles with individual ranges and locking tolerances */}
        {CIRCLE_CONFIG.map((config, index) => {
          const xPos = getCirclePosition(config);
          const isLocked = isWithinTolerance(regionMetadata.peakFrequency, config.lockingTolerance);
          const isSmallestCircle = index === CIRCLE_CONFIG.length - 1; // Last circle is smallest/most precise

          // Calculate opacity based on signal strength (same logic as LissajousPlot)
          const baseMagnitude = regionMetadata?.peakMagnitude || 0;
          const envelopeMin = regionMetadata?.envelopeMin || 0;
          const envelopeMax = regionMetadata?.envelopeMax || 100;

          // Calculate relative magnitude position between min and max
          const magnitudeRange = envelopeMax - envelopeMin;
          const relativeStrength =
            magnitudeRange > 0 ? (baseMagnitude - envelopeMin) / magnitudeRange : 0;

          // Calculate opacity with sharp transition at 0.1
          const THRESHOLD = 0.1;
          const baseOpacity =
            relativeStrength >= THRESHOLD ? 1.0 : Math.pow(relativeStrength / THRESHOLD, 3);

          // Add subtle locked indicator - slight alpha reduction when locked (except for smallest circle)
          const lockedOpacityReduction = isLocked && !isSmallestCircle ? 0.25 : 0;
          const finalOpacity = Math.max(0.1, baseOpacity - lockedOpacityReduction);

          return (
            <React.Fragment key={index}>
              {/* Full vertical line for smallest circle (ultimate precision indicator) */}
              {isSmallestCircle && (
                <line
                  x1={`${xPos}%`}
                  y1="0%"
                  x2={`${xPos}%`}
                  y2="100%"
                  stroke={isSmallestCircle ? '#000000' : config.color}
                  strokeWidth="2"
                  strokeOpacity={finalOpacity * 0.7}
                  strokeDasharray="4,2"
                />
              )}

              {/* Circle or Diamond shape */}
              {isSmallestCircle ? (
                // Regular circle for smallest circle with enhanced visibility line
                <circle
                  cx={`${xPos}%`}
                  cy="50%"
                  r={config.radius}
                  fill={isSmallestCircle ? '#000000' : config.color}
                  stroke={isSmallestCircle ? '#000000' : config.color}
                  strokeWidth="3"
                  opacity={finalOpacity * 0.9}
                />
              ) : (
                // Regular circle for other circles
                <circle
                  cx={`${xPos}%`}
                  cy="50%"
                  r={config.radius}
                  fill={config.color}
                  stroke={config.color}
                  strokeWidth="3"
                  opacity={finalOpacity * 0.9}
                />
              )}

              {/* Label showing locking tolerance only (more compact) */}
              <text
                x={`${xPos}%`}
                y={`${50 + config.radius + 8}%`}
                fill={config.color}
                fontSize="10"
                fontWeight="bold"
                textAnchor="middle"
                opacity={finalOpacity * 0.9}
              >
                ±{config.lockingTolerance}¢
              </text>
            </React.Fragment>
          );
        })}

        {/* Strike state indicator */}
        <circle
          cx="95%"
          cy="15%"
          r="8"
          fill={
            strikeState === 'WAITING'
              ? theme.palette.grey[500]
              : strikeState === 'ATTACK'
                ? theme.palette.warning.main
                : strikeState === 'MONITORING'
                  ? theme.palette.success.main
                  : theme.palette.grey[500]
          }
          opacity="0.8"
        />

        {/* Locked-in cents display */}
        {lowestLockedConfig !== null && (
          <g>
            <text
              x="50%"
              y="20%"
              fill={
                CIRCLE_CONFIG.indexOf(lowestLockedConfig) === CIRCLE_CONFIG.length - 1
                  ? '#000000'
                  : lowestLockedConfig.color
              }
              fontSize="24"
              fontWeight="bold"
              textAnchor="middle"
              opacity="0.9"
            >
              ±{lowestLockedConfig.lockingTolerance}¢
            </text>
            <text
              x="50%"
              y="25%"
              fill={
                CIRCLE_CONFIG.indexOf(lowestLockedConfig) === CIRCLE_CONFIG.length - 1
                  ? '#000000'
                  : lowestLockedConfig.color
              }
              fontSize="10"
              textAnchor="middle"
              opacity="0.7"
            >
              LOCKED
            </text>
          </g>
        )}
      </StyledSvg>

      {/* Quadrant overlays */}
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
    </Box>
  );
};

export default React.memo(ConcentricPlot);
