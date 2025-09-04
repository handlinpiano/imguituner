import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box } from '@mui/material';
import { type RegionMetadata, type StrikeState } from '@/app/wasm/audio_processor_wrapper';

interface LissajousPoint {
  x: number;
  y: number;
}

interface LissajousPlotProps {
  regionMetadata: RegionMetadata;
  noteFrequency: number;
  colorScheme: string;
  zenMode?: boolean;
  onPreviousNote?: () => void;
  onNextNote?: () => void;
  onPrevOctave?: () => void;
  onNextOctave?: () => void;
  strikeState: StrikeState;
  numPointsBase: number;
  numPointsMultiplier: number;
  freqScaling: number;
  centsRange: number;
  curveFactor?: number;
  showLines?: boolean;
}

const LissajousPlot: React.FC<LissajousPlotProps> = ({
  regionMetadata,
  noteFrequency,
  colorScheme,
  zenMode = false,
  onPreviousNote,
  onNextNote,
  onPrevOctave,
  onNextOctave,
  strikeState,
  numPointsBase,
  numPointsMultiplier,
  freqScaling,
  centsRange,
  curveFactor = 0.3,
  showLines = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastPointsRef = useRef<LissajousPoint[]>([]);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [overlay, setOverlay] = useState<{ visible: boolean; quadrant: number }>({
    visible: false,
    quadrant: -1,
  });
  const [frozenPoints, setFrozenPoints] = useState<LissajousPoint[]>([]);
  const lastStrikeStateRef = useRef<StrikeState>('WAITING');
  const shouldFreezeRef = useRef<boolean>(false);

  // Constants and calculated values
  const _totalPoints = numPointsBase * numPointsMultiplier;
  const BASE_OSCILLATION = 47; // Base frequency for visualization
  const Y_SCALE_RANGE = 0.95;

  const generateVisualization = useCallback((metadata: RegionMetadata): LissajousPoint[] => {
    // Recalculate _totalPoints here to ensure it uses the latest values
    const currentTotalPoints = numPointsBase * numPointsMultiplier;
    
    if (!metadata || !metadata.peakFrequency) {
      return lastPointsRef.current.length > 0
        ? lastPointsRef.current
        : Array(currentTotalPoints).fill({ x: 0, y: 0 });
    }

    const peakFreq = metadata.peakFrequency;
    const centsDiff = 1200 * Math.log2(peakFreq / noteFrequency);

    // Enhanced frequency calculation based on MATLAB approach
    const baseFreq = BASE_OSCILLATION;
    const freqOffset = (centsDiff / centsRange) * freqScaling;
    // Use negative scaling for intuitive rotation direction
    const testFreq = baseFreq - freqOffset;

    // Calculate phase offset based on cents difference to align starting point with tuning indicator
    // Clamp cents difference to the range of ±centsRange
    const clampedCentsDiff = Math.max(-centsRange, Math.min(centsRange, centsDiff));
    // Calculate angle: 0 cents at top (-π/2), positive cents clockwise
    const indicatorAngle = -Math.PI / 2 + (clampedCentsDiff / centsRange) * Math.PI;
    // Convert angle to phase offset (0 to 1)
    const phaseOffset = (indicatorAngle + Math.PI / 2) / (2 * Math.PI);

    const points: LissajousPoint[] = [];
    const timeScale = 1.0 / currentTotalPoints;

    // Generate smoother points with phase consideration and offset
    for (let t = 0; t < currentTotalPoints; t++) {
      const time = t * timeScale;
      // Apply phase offset to both x and y to start at the indicator position
      const x = Math.cos(2 * Math.PI * baseFreq * time + indicatorAngle);
      const y = Math.sin(2 * Math.PI * testFreq * time + indicatorAngle);
      points.push({ x, y });
    }

    lastPointsRef.current = points;

    console.log('Generated points:', {
      peakFreq,
      noteFrequency,
      centsDiff,
      baseFreq,
      testFreq,
      phaseOffset,
      indicatorAngle,
      pointsLength: points.length,
      firstPoint: points[0],
      currentTotalPoints
    });

    return points;
  }, [noteFrequency, numPointsBase, numPointsMultiplier, freqScaling, centsRange]);

  const drawVisualization = useCallback(
    (points: LissajousPoint[]): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Get canvas dimensions
      const { width, height } = canvas;
      const centerX = width / 2;
      const centerY = height / 2;
      const scale = Math.min(width, height) * 0.4;

      // Clear canvas with type-safe context
      ctx.clearRect(0, 0, width, height);

      // Draw axes with consistent opacity format
      const axisOpacity = 0.133; // Equivalent to 22 in hex
      ctx.strokeStyle =
        colorScheme === 'rainbow'
          ? `rgba(0, 255, 0, ${axisOpacity})`
          : `rgba(33, 150, 243, ${axisOpacity})`;
      ctx.lineWidth = 1;

      // Horizontal center line
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Vertical center line
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, height);
      ctx.stroke();

      // Draw scale circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, scale * Y_SCALE_RANGE, 0, 2 * Math.PI);
      ctx.stroke();

      // Calculate cents difference for tuning indicator
      const peakFreq = regionMetadata?.peakFrequency || 0;
      const centsDiff = peakFreq > 0 ? 1200 * Math.log2(peakFreq / noteFrequency) : 0;
      
      // Calculate indicator position
      let indicatorX = centerX;
      let indicatorY = centerY - scale * Y_SCALE_RANGE * 1.1; // Default to top (0 cents)
      let _indicatorColor = 'rgba(0, 255, 0, 0.8)'; // Default color
      
      if (peakFreq > 0) {
        // Clamp cents difference to the range of ±centsRange
        const clampedCentsDiff = Math.max(-centsRange, Math.min(centsRange, centsDiff));
        
        // Calculate angle: 0 cents at top (-π/2), positive cents clockwise
        const angle = -Math.PI / 2 + (clampedCentsDiff / centsRange) * Math.PI;
        
        // Calculate position on the circle
        const indicatorRadius = scale * Y_SCALE_RANGE * 1.1; // Slightly outside the main circle
        indicatorX = centerX + indicatorRadius * Math.cos(angle);
        indicatorY = centerY + indicatorRadius * Math.sin(angle);
        
        // Color based on how close to perfect tuning (0 cents)
        const absCentsDiff = Math.abs(centsDiff);
        if (absCentsDiff < 2) {
          // Green for very close to perfect tuning
          _indicatorColor = 'rgba(0, 255, 0, 0.8)';
        } else if (absCentsDiff < 5) {
          // Yellow for close
          _indicatorColor = 'rgba(255, 255, 0, 0.8)';
        } else {
          // Red for far off
          _indicatorColor = 'rgba(255, 0, 0, 0.8)';
        }
        
        // Draw reference markers for tuning
        if (showLines) {
          // Draw reference lines at specific cent intervals
          const centMarkers = [-20, -10, -5, 0, 5, 10, 20];
          centMarkers.forEach(cents => {
            const markerAngle = -Math.PI / 2 + (cents / centsRange) * Math.PI;
            const markerRadius = scale * Y_SCALE_RANGE * 1.05;
            const markerX = centerX + markerRadius * Math.cos(markerAngle);
            const markerY = centerY + markerRadius * Math.sin(markerAngle);
            
            // Draw small marker
            ctx.beginPath();
            ctx.arc(markerX, markerY, 3, 0, 2 * Math.PI);
            ctx.fillStyle = cents === 0 
              ? 'rgba(0, 255, 0, 0.8)' 
              : `rgba(200, 200, 200, ${cents % 10 === 0 ? 0.8 : 0.5})`;
            ctx.fill();
            
            // Add text for major markers
            if (cents % 10 === 0) {
              const labelRadius = markerRadius + 15;
              const labelX = centerX + labelRadius * Math.cos(markerAngle);
              const labelY = centerY + labelRadius * Math.sin(markerAngle);
              
              ctx.font = cents === 0 ? 'bold 12px Arial' : '10px Arial';
              ctx.fillStyle = cents === 0 
                ? 'rgba(0, 255, 0, 0.8)' 
                : 'rgba(200, 200, 200, 0.8)';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${cents > 0 ? '+' : ''}${cents}¢`, labelX, labelY);
            }
          });
        }
      }

      // Draw frozen pattern if it exists
      if (frozenPoints.length > 0) {
        console.log('Drawing frozen pattern:', {
          length: frozenPoints.length,
          firstPoint: frozenPoints[0],
          lastPoint: frozenPoints[frozenPoints.length - 1],
        });

        ctx.strokeStyle = `rgba(237, 108, 2, 0.5)`; // Material UI warning color with 0.5 opacity
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        // Draw curved frozen pattern
        drawCurvedPath(ctx, frozenPoints, centerX, centerY, scale * Y_SCALE_RANGE, curveFactor);
        
        ctx.closePath();
        ctx.stroke();
      }

      // Set line style for live visualization
      const baseMagnitude = regionMetadata?.peakMagnitude || 0;
      const envelopeMin = regionMetadata?.envelopeMin || 0;
      const envelopeMax = regionMetadata?.envelopeMax || 100;

      // Calculate relative magnitude position between min and max
      const magnitudeRange = envelopeMax - envelopeMin;
      const relativeStrength =
        magnitudeRange > 0 ? (baseMagnitude - envelopeMin) / magnitudeRange : 0;

      // Calculate opacity with sharp transition at 0.1
      const THRESHOLD = 0.1;
      const opacity =
        relativeStrength >= THRESHOLD ? 1.0 : Math.pow(relativeStrength / THRESHOLD, 3);

      // Apply color with opacity
      const baseColor = colorScheme === 'rainbow' ? '0, 255, 0' : '33, 150, 243';
      ctx.strokeStyle = `rgba(${baseColor}, ${opacity})`;

      // Calculate line width (1-6 pixels)
      const normalizedMagnitude = Math.min(Math.max(relativeStrength, 0.2), 1);
      const lineWidth = 1 + normalizedMagnitude * 5;
      ctx.lineWidth = lineWidth;

      // Draw live Lissajous figure with curves
      ctx.beginPath();
      
      // Draw curved live pattern
      drawCurvedPath(ctx, points, centerX, centerY, scale * Y_SCALE_RANGE, curveFactor);
      
      ctx.closePath();
      ctx.stroke();
      
      // Draw a small marker at the starting point of the pattern
      if (points.length > 0) {
        const firstPoint = points[0];
        const startX = centerX + firstPoint.x * scale * Y_SCALE_RANGE;
        const startY = centerY + firstPoint.y * scale * Y_SCALE_RANGE;
        
        ctx.beginPath();
        ctx.arc(startX, startY, 4, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.8})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(0, 0, 0, ${opacity * 0.5})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      
      // Draw the tuning indicator (on top of everything else)
      if (peakFreq > 0) {
        // Clamp cents difference to the range of ±centsRange
        const clampedCentsDiff = Math.max(-centsRange, Math.min(centsRange, centsDiff));
        
        // Color based on how close to perfect tuning (0 cents)
        const absCentsDiff = Math.abs(centsDiff);
        let _baseIndicatorColor;
        if (absCentsDiff < 2) {
          // Green for very close to perfect tuning
          _baseIndicatorColor = '0, 255, 0';
        } else if (absCentsDiff < 5) {
          // Yellow for close
          _baseIndicatorColor = '255, 255, 0';
        } else {
          // Red for far off
          _baseIndicatorColor = '255, 0, 0';
        }
        
        // Apply the same opacity transformation as the pattern
        const _indicatorColor = `rgba(${_baseIndicatorColor}, ${opacity * 0.8})`;
        
        // Only draw the indicator if there's enough signal (opacity > 0.1)
        if (opacity > 0.1) {
          // Draw a line from center to the indicator
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(indicatorX, indicatorY);
          ctx.strokeStyle = _indicatorColor;
          ctx.lineWidth = Math.max(1, lineWidth * 0.8); // Scale line width with signal strength
          ctx.stroke();
          
          // Draw the indicator circle
          ctx.beginPath();
          ctx.arc(indicatorX, indicatorY, 8, 0, 2 * Math.PI);
          ctx.fillStyle = _indicatorColor;
          ctx.fill();
          ctx.strokeStyle = `rgba(0, 0, 0, ${opacity * 0.5})`;
          ctx.lineWidth = 1;
          ctx.stroke();
          
          // Draw cents value text
          ctx.font = 'bold 14px Arial';
          ctx.fillStyle = _indicatorColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // Position text outside the indicator
          const textRadius = scale * Y_SCALE_RANGE * 1.1 + 20;
          const angle = -Math.PI / 2 + (clampedCentsDiff / centsRange) * Math.PI;
          const textX = centerX + textRadius * Math.cos(angle);
          const textY = centerY + textRadius * Math.sin(angle);
          
          // Format cents value with sign and decimal places
          const centsText = `${centsDiff >= 0 ? '+' : ''}${centsDiff.toFixed(1)}¢`;
          ctx.fillText(centsText, textX, textY);
        }
      }
    },
    [colorScheme, frozenPoints, regionMetadata, curveFactor, noteFrequency, centsRange, showLines]
  );

  // Helper function to draw curved paths
  const drawCurvedPath = (
    ctx: CanvasRenderingContext2D,
    points: LissajousPoint[],
    centerX: number,
    centerY: number,
    scale: number,
    curveFactor: number
  ): void => {
    if (points.length < 2) return;

    // Convert points to canvas coordinates
    const canvasPoints = points.map(({ x, y }) => ({
      x: centerX + x * scale,
      y: centerY + y * scale,
    }));

    // Start the path
    ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);

    // For each point (except first and last), calculate control points and draw curves
    for (let i = 0; i < canvasPoints.length - 1; i++) {
      const current = canvasPoints[i];
      const next = canvasPoints[i + 1];
      
      // Get the point after next (or wrap around to the beginning)
      const afterNext = canvasPoints[i + 2] || canvasPoints[0];
      
      // Calculate control points
      const controlPoint1 = {
        x: current.x + (next.x - current.x) * curveFactor,
        y: current.y + (next.y - current.y) * curveFactor,
      };
      
      const controlPoint2 = {
        x: next.x - (afterNext.x - current.x) * curveFactor,
        y: next.y - (afterNext.y - current.y) * curveFactor,
      };
      
      // Draw cubic Bezier curve
      ctx.bezierCurveTo(
        controlPoint1.x,
        controlPoint1.y,
        controlPoint2.x,
        controlPoint2.y,
        next.x,
        next.y
      );
    }
    
    // Connect the last point to the first with a curve
    if (points.length > 2) {
      const last = canvasPoints[canvasPoints.length - 1];
      const first = canvasPoints[0];
      const second = canvasPoints[1];
      
      const controlPoint1 = {
        x: last.x + (first.x - last.x) * curveFactor,
        y: last.y + (first.y - last.y) * curveFactor,
      };
      
      const controlPoint2 = {
        x: first.x - (second.x - last.x) * curveFactor,
        y: first.y - (second.y - last.y) * curveFactor,
      };
      
      ctx.bezierCurveTo(
        controlPoint1.x,
        controlPoint1.y,
        controlPoint2.x,
        controlPoint2.y,
        first.x,
        first.y
      );
    }
  };

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window);
  }, []);

  // Add a new effect to handle canvas resizing and maintain 1:1 aspect ratio
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      // Get container dimensions
      const containerRect = container.getBoundingClientRect();
      
      // Determine the size for a square canvas (use the smaller dimension)
      const size = Math.min(containerRect.width, containerRect.height);
      
      // Set canvas dimensions to maintain 1:1 aspect ratio
      canvas.width = size * window.devicePixelRatio;
      canvas.height = size * window.devicePixelRatio;
      
      // Set the CSS dimensions to match the container's available space
      // while maintaining the aspect ratio
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      
      // Center the canvas in the container
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto';
      
      // Force a redraw
      if (regionMetadata) {
        const points = generateVisualization(regionMetadata);
        drawVisualization(points);
      }
    };

    // Initial sizing
    handleResize();
    
    // Add resize listener
    window.addEventListener('resize', handleResize);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [regionMetadata, drawVisualization, generateVisualization]);

  const handleQuadrantInteraction = useCallback(
    (event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.preventDefault();

      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      if (!rect) return;

      const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
      const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

      // Calculate position relative to the canvas
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      // Calculate relative position (0-1)
      const relX = x / rect.width;
      const relY = y / rect.height;

      // Determine quadrant
      const isLeftSide = relX < 0.5;
      const isTopHalf = relY < 0.5;

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
    const animate = () => {
      if (regionMetadata) {
        const points = generateVisualization(regionMetadata);
        drawVisualization(points);
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [regionMetadata, noteFrequency, colorScheme, frozenPoints, drawVisualization, generateVisualization]);

  // Update effect to handle strike state transitions
  useEffect(() => {
    if (strikeState === 'MONITORING' && lastStrikeStateRef.current !== 'MONITORING') {
      // If we just entered MONITORING state
      if (!shouldFreezeRef.current) {
        // First time entering MONITORING - freeze the pattern
        console.log('Entering monitoring state - freezing pattern');
        
        // Generate a new pattern with current settings instead of using lastPointsRef
        // This ensures the frozen pattern uses the current settings for detail and smoothness
        if (regionMetadata && regionMetadata.peakFrequency) {
          const newFrozenPoints = generateVisualization(regionMetadata);
          console.log('Freezing pattern with settings:', {
            numPointsBase,
            numPointsMultiplier,
            curveFactor,
            _totalPoints: numPointsBase * numPointsMultiplier
          });
          setFrozenPoints(newFrozenPoints);
        } else {
          setFrozenPoints([...lastPointsRef.current]);
        }
        
        shouldFreezeRef.current = true;
      } else {
        // Second time entering MONITORING - unfreeze
        console.log('Re-entering monitoring state - unfreezing pattern');
        setFrozenPoints([]);
        shouldFreezeRef.current = false;
      }
    } else if (strikeState !== 'MONITORING') {
      // Reset the freeze flag when we leave MONITORING state
      shouldFreezeRef.current = false;
    }

    lastStrikeStateRef.current = strikeState;
  }, [strikeState, regionMetadata, numPointsBase, numPointsMultiplier, curveFactor, generateVisualization]);

  // Effect to regenerate frozen pattern when pattern settings change while in MONITORING state
  useEffect(() => {
    // Only regenerate if we're in MONITORING state and have a frozen pattern
    if (strikeState === 'MONITORING' && frozenPoints.length > 0 && regionMetadata && regionMetadata.peakFrequency) {
      console.log('Pattern settings changed - regenerating frozen pattern with:', {
        numPointsBase,
        numPointsMultiplier,
        curveFactor
      });
      const newFrozenPoints = generateVisualization(regionMetadata);
      setFrozenPoints(newFrozenPoints);
    }
  }, [numPointsBase, numPointsMultiplier, curveFactor, strikeState, regionMetadata, frozenPoints, generateVisualization]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        position: 'relative',
        bgcolor: zenMode ? 'transparent' : 'background.paper',
        touchAction: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onTouchStart={handleQuadrantInteraction}
      {...(!isTouchDevice ? { onClick: handleQuadrantInteraction } : {})}
    >
      <Box
        sx={{
          position: 'relative',
          width: 'fit-content',
          height: 'fit-content',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
          }}
        />
        {[0, 1, 2, 3].map(quadrant => (
          <Box
            key={quadrant}
            sx={{
              position: 'absolute',
              width: '50%',
              height: '50%',
              left: quadrant % 2 === 0 ? '25%' : '75%',
              top: quadrant < 2 ? '25%' : '75%',
              transform: 'translate(-50%, -50%)',
              transition: 'background-color 0.2s',
              backgroundColor:
                overlay.visible && overlay.quadrant === quadrant
                  ? 'rgba(255, 255, 255, 0.1)'
                  : 'transparent',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        ))}
      </Box>
    </Box>
  );
};

export default LissajousPlot;
