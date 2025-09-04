'use client';
import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { styled } from '@mui/system';
import {
  getRegionPeakFrequency,
  StrikeState,
  StrikeMeasurement,
} from '@/app/wasm/audio_processor_wrapper';
import { useTheme } from '@mui/material/styles';

// Safe check for browser environment
const isBrowser = typeof window !== 'undefined';

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
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'none',
  zIndex: 2,
});

// Types
interface CalibrationPlotProps {
  regionData: Float32Array[];
  noteFrequency: number;
  bellCurveWidth?: number;
  onPrevOctave?: () => void;
  onNextOctave?: () => void;
  onPreviousNote?: () => void;
  onNextNote?: () => void;
  strikeState: StrikeState;
  strikeMeasurement: StrikeMeasurement | null;
}

interface FrequencyLinesProps {
  noteFrequency: number;
  showLines: boolean;
  bellCurveWidth: number;
  selectedHarmonics: number[];
  regionData: Float32Array[];
  strikeState: StrikeState;
  strikeMeasurement: StrikeMeasurement | null;
  strikeMeasurementFrequency: number | null;
}

const FrequencyLines: React.FC<FrequencyLinesProps> = ({
  noteFrequency,
  showLines,
  bellCurveWidth,
  selectedHarmonics,
  regionData,
  strikeState,
  strikeMeasurement,
  strikeMeasurementFrequency,
}) => {
  const theme = useTheme();

  // Get colors based on theme mode
  const getColors = () => {
    const isDark = theme.palette.mode === 'dark';
    return {
      centsLine: isDark ? 'rgba(255, 255, 255, 0.3)' : '#000000',
      targetLine: isDark ? 'rgba(255, 255, 255, 0.5)' : '#000000',
      strikeLine: isDark ? 'rgba(255, 255, 255, 0.7)' : '#000000',
      strikeLineStable: isDark ? 'rgba(255, 255, 255, 0.9)' : '#000000',
      strikeLineUnstable: isDark ? 'rgba(255, 255, 255, 0.5)' : '#000000',
      strikeLineStableFade: isDark ? 'rgba(255, 255, 255, 0.3)' : '#000000',
      strikeLineUnstableFade: isDark ? 'rgba(255, 255, 255, 0.2)' : '#000000',
    };
  };

  const colors = getColors();

  const [_lastStrikeFrequency, setLastStrikeFrequency] = useState<number | null>(null);
  const [lastStrikeMeasurement, setLastStrikeMeasurement] = useState<StrikeMeasurement | null>(
    null
  );

  // Update lastStrikeMeasurement when a valid measurement is received
  useEffect(() => {
    if (!isBrowser) return; // Skip on server

    if (strikeMeasurement && strikeMeasurement.frequency > 0) {
      console.log('FrequencyLines: strikeMeasurement received:', strikeMeasurement);

      // Only update if we have a valid frequency or if we don't already have a measurement
      if (strikeMeasurement.frequency > 0 || !lastStrikeMeasurement) {
        console.log('FrequencyLines: updating lastStrikeMeasurement');

        // Create a deep copy to ensure state updates properly
        const measurementCopy = {
          ...strikeMeasurement,
        };

        setLastStrikeMeasurement(measurementCopy as StrikeMeasurement);

        // Log the state after update to verify
        setTimeout(() => {
          console.log('FrequencyLines: lastStrikeMeasurement after update:', lastStrikeMeasurement);
        }, 0);
      }
    }
  }, [strikeMeasurement, lastStrikeMeasurement]);

  // Update lastStrikeFrequency when a new measurement comes in
  useEffect(() => {
    if (strikeMeasurementFrequency !== null && strikeMeasurementFrequency > 0) {
      console.log(
        'FrequencyLines: strikeMeasurementFrequency updated:',
        strikeMeasurementFrequency
      );
      setLastStrikeFrequency(strikeMeasurementFrequency);
    }
  }, [strikeMeasurementFrequency]);

  // Log strike state changes
  useEffect(() => {
    console.log('FrequencyLines: strikeState:', strikeState);
  }, [strikeState]);

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

  // Get harmonic color for calibration - A octaves
  const getOctaveColor = (octaveIndex: number) => {
    switch (octaveIndex) {
      case 0: // A0
        return '#CC0000'; // Deep Red
      case 1: // A1
        return '#0099CC'; // Cyan
      case 2: // A2
        return '#00CC33'; // Bright Green
      case 3: // A3
        return '#CC6600'; // Orange
      case 4: // A4
        return '#9900CC'; // Purple
      case 5: // A5
        return '#0066CC'; // Blue
      case 6: // A6
        return '#CCCC00'; // Dark Yellow
      case 7: // A7
        return '#CC3366'; // Magenta
      default:
        return '#CCCCCC'; // Gray (fallback)
    }
  };

  // Calculate peak frequency for a given octave
  const getPeakFrequency = (octaveIndex: number) => {
    const data = regionData[octaveIndex];
    if (!data || data.length === 0) return null;

    // Get the peak frequency directly from the audio processor
    const peakFreq = getRegionPeakFrequency(octaveIndex);
    if (peakFreq <= 0) return null;

    return peakFreq;
  };

  return (
    <StyledSvg preserveAspectRatio="none">
      {/* Target frequency line */}
      <line
        x1={`${getXPosition(noteFrequency)}%`}
        y1="0%"
        x2={`${getXPosition(noteFrequency)}%`}
        y2="100%"
        stroke={colors.targetLine}
        strokeWidth="2"
        strokeOpacity="0.8"
      />

      {/* Live peak frequency lines for each selected octave */}
      {selectedHarmonics.map(octaveNumber => {
        const octaveIndex = octaveNumber - 1; // Convert 1-8 to 0-7
        const peakFreq = getPeakFrequency(octaveIndex);
        if (!peakFreq) return null;

        return (
          <React.Fragment key={`peak-${octaveNumber}`}>
            <line
              x1={`${getXPosition(peakFreq)}%`}
              y1="0%"
              x2={`${getXPosition(peakFreq)}%`}
              y2="100%"
              stroke={getOctaveColor(octaveIndex)}
              strokeWidth="2"
              strokeOpacity="0.8"
              strokeDasharray="5,3"
            />
            <text
              x={`${getXPosition(peakFreq) + 3}%`}
              y="10%"
              fill={getOctaveColor(octaveIndex)}
              fontSize="14"
              fontWeight="bold"
              textAnchor="start"
              dominantBaseline="middle"
              style={{ textShadow: '0px 0px 2px rgba(0, 0, 0, 0.7)' }}
            >
              {`A${octaveIndex}`}
            </text>
          </React.Fragment>
        );
      })}

      {showLines && (
        <>
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, -100 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, -100 / 1200))}%`}
            y2="100%"
            stroke={colors.centsLine}
            strokeWidth="1"
            strokeOpacity="0.3"
            strokeDasharray="5,5"
          />
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, -10 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, -10 / 1200))}%`}
            y2="100%"
            stroke={colors.centsLine}
            strokeWidth="1"
            strokeOpacity="0.3"
            strokeDasharray="5,5"
          />
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, 10 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, 10 / 1200))}%`}
            y2="100%"
            stroke={colors.centsLine}
            strokeWidth="1"
            strokeOpacity="0.3"
            strokeDasharray="5,5"
          />
          <line
            x1={`${getXPosition(noteFrequency * Math.pow(2, 100 / 1200))}%`}
            y1="0%"
            x2={`${getXPosition(noteFrequency * Math.pow(2, 100 / 1200))}%`}
            y2="100%"
            stroke={colors.centsLine}
            strokeWidth="1"
            strokeOpacity="0.3"
            strokeDasharray="5,5"
          />
        </>
      )}
    </StyledSvg>
  );
};

// Vertex shader for calibration display - A octaves
const vertexShaderSource = `
  attribute vec2 a_position;
  attribute float a_magnitude;
  attribute float a_index;
  attribute float a_octave;
  
  uniform float u_totalBars;
  uniform float u_bellCurveWidth;
  
  varying vec4 v_color;
  
  float fisheyeTransform(float x) {
    float normalizedX = (x - 0.5) * 2.0;
    float distortion = u_bellCurveWidth;
    float transformed = sign(normalizedX) * abs(normalizedX) / (1.0 + abs(normalizedX) * distortion);
    transformed = transformed * (1.0 + distortion);
    return transformed * 0.5 + 0.5;
  }
  
  vec4 getOctaveColor(float octave) {
    int o = int(octave);
    if (o == 1) return vec4(0.8, 0.0, 0.0, 1.0);      // A0 - Deep Red
    if (o == 2) return vec4(0.0, 0.6, 0.8, 1.0);      // A1 - Cyan
    if (o == 3) return vec4(0.0, 0.8, 0.2, 1.0);      // A2 - Bright Green
    if (o == 4) return vec4(0.8, 0.4, 0.0, 1.0);      // A3 - Orange
    if (o == 5) return vec4(0.6, 0.0, 0.8, 1.0);      // A4 - Purple
    if (o == 6) return vec4(0.0, 0.4, 0.8, 1.0);      // A5 - Blue
    if (o == 7) return vec4(0.8, 0.8, 0.0, 1.0);      // A6 - Yellow
    if (o == 8) return vec4(0.8, 0.2, 0.4, 1.0);      // A7 - Magenta
    return vec4(0.7, 0.7, 0.7, 1.0);                  // Gray (fallback)
  }
  
  void main() {
    // Calculate the center position for this octave
    float octaveCenter = 0.5; // Center of the view
    float xPos = a_index / u_totalBars;
    float nextXPos = (a_index + 1.0) / u_totalBars;
    
    // Transform the positions using fisheye
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
    
    // Get color based on octave number
    v_color = getOctaveColor(a_octave);
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
  if (!isBrowser) return null; // Skip on server

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
  if (!isBrowser) return null; // Skip on server

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

const CalibrationPlot: React.FC<CalibrationPlotProps> = ({
  regionData,
  noteFrequency,
  bellCurveWidth = 4.0,
  onPrevOctave,
  onNextOctave,
  onPreviousNote,
  onNextNote,
  strikeState,
  strikeMeasurement,
}) => {
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
  const [showLines, _setShowLines] = useState(true);

  // Always show all A octaves (A0-A7)
  const selectedOctaves = useMemo(() => [1, 2, 3, 4, 5, 6, 7, 8], []); // All octaves always

  // Strike measurement state
  const [_lastStrikeFrequency, setLastStrikeFrequency] = useState<number | null>(null);

  // Update lastStrikeFrequency when a new measurement comes in
  useEffect(() => {
    if (strikeMeasurement && strikeMeasurement.frequency > 0) {
      setLastStrikeFrequency(strikeMeasurement.frequency);
    }
  }, [strikeMeasurement]);

  const drawSpectrum = useCallback(() => {
    if (!isBrowser) return; // Skip on server

    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    if (!programRef.current) {
      console.error('WebGL program is null');
      return;
    }

    const program = programRef.current;

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

    // Set up attributes and uniforms for spectrum
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const magnitudeLoc = gl.getAttribLocation(program, 'a_magnitude');
    const indexLoc = gl.getAttribLocation(program, 'a_index');
    const octaveLoc = gl.getAttribLocation(program, 'a_octave');

    if (positionLoc === -1 || magnitudeLoc === -1 || indexLoc === -1 || octaveLoc === -1) {
      console.error('Failed to get attribute locations');
      return;
    }

    // Draw spectrum bars for each selected octave
    gl.bindBuffer(gl.ARRAY_BUFFER, mainPositionBufferRef.current);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    selectedOctaves.forEach(octaveNumber => {
      const octaveIndex = octaveNumber - 1; // Convert 1-8 to 0-7
      if (octaveIndex >= regionData.length) {
        console.warn(`Skipping octave ${octaveNumber} - no data available (region ${octaveIndex})`);
        return;
      }

      const data = regionData[octaveIndex];
      if (!data || data.length === 0) {
        console.warn(`No data available for octave ${octaveNumber} (region ${octaveIndex})`);
        return;
      }

      // Check if the data has any non-zero values
      const maxValue = Math.max(...data);
      const minValue = Math.min(...data);
      if (maxValue === 0 && minValue === 0) {
        console.warn(`All zero values for octave ${octaveNumber} (region ${octaveIndex})`);
        return;
      }

      // Log data for debugging (commented out to reduce spam)
      // console.log(`Drawing octave ${octaveNumber} (region ${octaveIndex}):`, {
      //   dataLength: data.length,
      //   maxValue,
      //   minValue,
      // });

      const instanceBuffer = gl.createBuffer();
      if (!instanceBuffer) {
        console.error('Failed to create instance buffer');
        return;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      const instanceData = new Float32Array(data.length * 3);
      for (let i = 0; i < data.length; i++) {
        const magnitude = data[i];

        // No noise floor processing during calibration - just show raw data

        instanceData[i * 3] = magnitude;
        instanceData[i * 3 + 1] = i;
        instanceData[i * 3 + 2] = octaveNumber; // Keep original octave number for color
      }
      gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);

      // Set up uniforms for the shader
      gl.uniform1f(gl.getUniformLocation(program, 'u_totalBars'), data.length);
      gl.uniform1f(gl.getUniformLocation(program, 'u_bellCurveWidth'), bellCurveWidth);

      gl.enableVertexAttribArray(magnitudeLoc);
      gl.vertexAttribPointer(magnitudeLoc, 1, gl.FLOAT, false, 12, 0);
      ext.vertexAttribDivisorANGLE(magnitudeLoc, 1);

      gl.enableVertexAttribArray(indexLoc);
      gl.vertexAttribPointer(indexLoc, 1, gl.FLOAT, false, 12, 4);
      ext.vertexAttribDivisorANGLE(indexLoc, 1);

      gl.enableVertexAttribArray(octaveLoc);
      gl.vertexAttribPointer(octaveLoc, 1, gl.FLOAT, false, 12, 8);
      ext.vertexAttribDivisorANGLE(octaveLoc, 1);

      ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, data.length);

      // Cleanup
      gl.deleteBuffer(instanceBuffer);
    });

    // Final cleanup
    gl.disableVertexAttribArray(positionLoc);
    gl.disableVertexAttribArray(magnitudeLoc);
    gl.disableVertexAttribArray(indexLoc);
    gl.disableVertexAttribArray(octaveLoc);
  }, [regionData, selectedOctaves, bellCurveWidth]);

  useEffect(() => {
    if (!isBrowser) return; // Skip on server

    const dpr = window.devicePixelRatio || 1;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get the actual container dimensions from the container reference
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    dimensionsRef.current = { width: rect.width, height: rect.height };

    canvas.width = dimensionsRef.current.width * dpr;
    canvas.height = dimensionsRef.current.height * dpr;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }
    glRef.current = gl;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    if (!vertexShader || !fragmentShader) {
      console.error('Failed to create shaders');
      return;
    }

    const program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }

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

    // Add a resize observer to handle container size changes
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === container) {
          const { width, height } = entry.contentRect;
          dimensionsRef.current = { width, height };

          if (canvas) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;

            if (gl) {
              gl.viewport(0, 0, canvas.width, canvas.height);
              drawSpectrum();
            }
          }
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [drawSpectrum]);

  // No octave selection needed - always show all

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
    if (!isBrowser) return; // Skip on server
    setIsTouchDevice('ontouchstart' in window);
  }, []);

  // Octave colors are defined in the shader and FrequencyLines component

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
      {/* Simple calibration info bar */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '40px',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          padding: 1,
        }}
      >
        <Typography variant="body2" sx={{ color: 'white', textAlign: 'center' }}>
          🎵 All 8 A octaves (A0-A7) are being monitored automatically
        </Typography>
      </Box>

      {/* Canvas for spectrum display */}
      <StyledCanvas ref={canvasRef} />

      {/* Frequency lines */}
      <FrequencyLines
        noteFrequency={noteFrequency}
        showLines={showLines}
        bellCurveWidth={bellCurveWidth}
        selectedHarmonics={selectedOctaves}
        regionData={regionData}
        strikeState={strikeState}
        strikeMeasurement={strikeMeasurement}
        strikeMeasurementFrequency={_lastStrikeFrequency}
      />

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

export default React.memo(CalibrationPlot);
