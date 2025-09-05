'use client';
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Box, Button } from '@mui/material';
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
interface HarmonicPlotProps {
  regionData: Float32Array[];
  noteFrequency: number;
  bellCurveWidth?: number;
  _onBellCurveWidthChange?: (width: number) => void;
  _onToggleLines?: () => void;
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
  _strikeMeasurementMagnitude: number;
  _peakMagnitude: number;
  _magnitudeThreshold: number;
  _onPreviousNote: () => void;
  _onNextNote: () => void;
  _onPrevOctave: () => void;
  _onNextOctave: () => void;
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
  _strikeMeasurementMagnitude,
  _peakMagnitude,
  _magnitudeThreshold,
  _onPreviousNote,
  _onNextNote,
  _onPrevOctave,
  _onNextOctave,
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

  // Get harmonic color
  const getHarmonicColor = (harmonicIndex: number) => {
    switch (harmonicIndex) {
      case 0:
        return '#CC0000'; // Deep Red
      case 1:
        return '#0099CC'; // Cyan
      case 2:
        return '#00CC33'; // Bright Green
      case 3:
        return '#CC6600'; // Orange
      case 4:
        return '#9900CC'; // Purple
      case 5:
        return '#0066CC'; // Blue
      case 6:
        return '#CCCC00'; // Dark Yellow
      case 7:
        return '#CC3366'; // Magenta
      default:
        return '#CCCCCC'; // Gray (fallback)
    }
  };

  // Calculate peak frequency for a given harmonic
  const getPeakFrequency = (harmonicIndex: number) => {
    const data = regionData[harmonicIndex];
    if (!data || data.length === 0) return null;

    // Get the peak frequency directly from the audio processor
    const peakFreq = getRegionPeakFrequency(harmonicIndex);
    if (peakFreq <= 0) return null;

    // Normalize the peak frequency by dividing by the harmonic number (1-based)
    const harmonicNumber = harmonicIndex + 1;
    return peakFreq / harmonicNumber;
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

      {/* Strike measurement lines */}
      {lastStrikeMeasurement &&
        lastStrikeMeasurement.frequency > 0 &&
        selectedHarmonics.map(harmonicIndex => {
          const regionIndex = harmonicIndex - 1;
          const harmonicFreq = lastStrikeMeasurement.frequency * harmonicIndex;

          return (
            <line
              key={`strike-${harmonicIndex}`}
              x1={`${getXPosition(harmonicFreq)}%`}
              y1="0%"
              x2={`${getXPosition(harmonicFreq)}%`}
              y2="100%"
              stroke={getHarmonicColor(regionIndex)}
              strokeWidth="2"
              strokeOpacity="0.4"
            />
          );
        })}

      {/* Live peak frequency lines */}
      {selectedHarmonics.map(harmonicIndex => {
        const regionIndex = harmonicIndex - 1;
        const peakFreq = getPeakFrequency(regionIndex);
        if (!peakFreq) return null;

        return (
          <React.Fragment key={`peak-${harmonicIndex}`}>
            <line
              x1={`${getXPosition(peakFreq)}%`}
              y1="0%"
              x2={`${getXPosition(peakFreq)}%`}
              y2="100%"
              stroke={getHarmonicColor(regionIndex)}
              strokeWidth="2"
              strokeOpacity="0.8"
              strokeDasharray="5,3"
            />
            <text
              x={`${getXPosition(peakFreq) + 3}%`}
              y="10%"
              fill={getHarmonicColor(regionIndex)}
              fontSize="14"
              fontWeight="bold"
              textAnchor="start"
              dominantBaseline="middle"
              style={{ textShadow: '0px 0px 2px rgba(0, 0, 0, 0.7)' }}
            >
              {`H${harmonicIndex}`}
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

// Vertex shader for harmonic display
const vertexShaderSource = `
  attribute vec2 a_position;
  attribute float a_magnitude;
  attribute float a_index;
  attribute float a_harmonic;
  
  uniform float u_totalBars;
  uniform float u_bellCurveWidth;
  uniform float u_harmonicColors[8];  // Array of 8 harmonic colors
  
  varying vec4 v_color;
  
  float fisheyeTransform(float x) {
    float normalizedX = (x - 0.5) * 2.0;
    float distortion = u_bellCurveWidth;
    float transformed = sign(normalizedX) * abs(normalizedX) / (1.0 + abs(normalizedX) * distortion);
    transformed = transformed * (1.0 + distortion);
    return transformed * 0.5 + 0.5;
  }
  
  vec4 getHarmonicColor(float harmonic) {
    int h = int(harmonic);
    if (h == 1) return vec4(0.8, 0.0, 0.0, 1.0);      // Deep Red
    if (h == 2) return vec4(0.0, 0.6, 0.8, 1.0);      // Cyan
    if (h == 3) return vec4(0.0, 0.8, 0.2, 1.0);      // Bright Green
    if (h == 4) return vec4(0.8, 0.4, 0.0, 1.0);      // Orange
    if (h == 5) return vec4(0.6, 0.0, 0.8, 1.0);      // Purple
    if (h == 6) return vec4(0.0, 0.4, 0.8, 1.0);      // Blue
    if (h == 7) return vec4(0.8, 0.8, 0.0, 1.0);      // Yellow (darker)
    if (h == 8) return vec4(0.8, 0.2, 0.4, 1.0);      // Magenta
    return vec4(0.7, 0.7, 0.7, 1.0);                  // Gray (fallback)
  }
  
  void main() {
    // Calculate the center position for this harmonic
    float harmonicCenter = 0.5; // Center of the view
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
    
    // Get color based on harmonic number
    v_color = getHarmonicColor(a_harmonic);
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

const HarmonicPlot: React.FC<HarmonicPlotProps> = ({
  regionData,
  noteFrequency,
  bellCurveWidth = 4.0,
  _onBellCurveWidthChange,
  _onToggleLines,
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

  // State for selected harmonics - persist across note changes
  const [selectedHarmonics, setSelectedHarmonics] = useState<number[]>([1, 2, 3, 4, 5]); // Start with first 5 harmonics

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
    const harmonicLoc = gl.getAttribLocation(program, 'a_harmonic');

    if (positionLoc === -1 || magnitudeLoc === -1 || indexLoc === -1 || harmonicLoc === -1) {
      console.error('Failed to get attribute locations');
      return;
    }

    // Draw spectrum bars for each selected harmonic
    gl.bindBuffer(gl.ARRAY_BUFFER, mainPositionBufferRef.current);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    selectedHarmonics.forEach(harmonicIndex => {
      const regionIndex = harmonicIndex - 1; // Direct mapping: H1 -> region 0, H2 -> region 1, etc.
      if (regionIndex >= regionData.length) {
        console.warn(
          `Skipping harmonic ${harmonicIndex} - no data available (region ${regionIndex})`
        );
        return;
      }

      const data = regionData[regionIndex];
      if (!data || data.length === 0) {
        console.warn(`No data available for harmonic ${harmonicIndex} (region ${regionIndex})`);
        return;
      }

      // Check if the data has any non-zero values
      const maxValue = Math.max(...data);
      const minValue = Math.min(...data);
      if (maxValue === 0 && minValue === 0) {
        console.warn(`All zero values for harmonic ${harmonicIndex} (region ${regionIndex})`);
        return;
      }

      // Log data for debugging
      console.log(`Drawing harmonic ${harmonicIndex} (region ${regionIndex}):`, {
        dataLength: data.length,
        maxValue,
        minValue,
      });

      const instanceBuffer = gl.createBuffer();
      if (!instanceBuffer) {
        console.error('Failed to create instance buffer');
        return;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      const instanceData = new Float32Array(data.length * 3);
      for (let i = 0; i < data.length; i++) {
        instanceData[i * 3] = data[i];
        instanceData[i * 3 + 1] = i;
        instanceData[i * 3 + 2] = harmonicIndex; // Keep original harmonic number for color
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
  }, [regionData, selectedHarmonics, bellCurveWidth]);

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

  // Handle harmonic selection
  const handleHarmonicToggle = (harmonic: number, event: React.MouseEvent) => {
    // Stop propagation to prevent the quadrant interaction
    event.stopPropagation();

    setSelectedHarmonics(prev => {
      if (prev.includes(harmonic)) {
        // Remove harmonic if it's already selected
        return prev.filter(h => h !== harmonic);
      } else {
        // Add harmonic if not already selected
        return [...prev, harmonic].sort((a, b) => a - b);
      }
    });
  };

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
      {/* Harmonic selection buttons */}
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
          gap: 1,
          zIndex: 10,
          padding: 1,
        }}
        onClick={e => e.stopPropagation()} // Stop propagation on the entire button container
        onTouchStart={e => e.stopPropagation()} // Also stop touch events
      >
        {[1, 2, 3, 4, 5, 6, 7, 8].map(harmonic => (
          <Button
            key={harmonic}
            variant={selectedHarmonics.includes(harmonic) ? 'contained' : 'outlined'}
            color="primary"
            size="small"
            onClick={event => handleHarmonicToggle(harmonic, event)}
            sx={{
              minWidth: '40px',
              backgroundColor: selectedHarmonics.includes(harmonic)
                ? harmonic === 1
                  ? '#CC0000' // Deep Red
                  : harmonic === 2
                    ? '#0099CC' // Cyan
                    : harmonic === 3
                      ? '#00CC33' // Bright Green
                      : harmonic === 4
                        ? '#CC6600' // Orange
                        : harmonic === 5
                          ? '#9900CC' // Purple
                          : harmonic === 6
                            ? '#0066CC' // Blue
                            : harmonic === 7
                              ? '#CCCC00' // Dark Yellow
                              : '#CC3366' // Magenta
                : 'transparent',
              color: selectedHarmonics.includes(harmonic) ? 'white' : 'inherit',
              '&:hover': {
                backgroundColor: selectedHarmonics.includes(harmonic)
                  ? harmonic === 1
                    ? '#CC0000'
                    : harmonic === 2
                      ? '#0099CC'
                      : harmonic === 3
                        ? '#00CC33'
                        : harmonic === 4
                          ? '#CC6600'
                          : harmonic === 5
                            ? '#9900CC'
                            : harmonic === 6
                              ? '#0066CC'
                              : harmonic === 7
                                ? '#CCCC00'
                                : '#CC3366'
                  : 'rgba(255, 255, 255, 0.1)',
              },
            }}
          >
            {harmonic}
          </Button>
        ))}
      </Box>

      {/* Canvas for spectrum display */}
      <StyledCanvas ref={canvasRef} />

      {/* Frequency lines */}
      <FrequencyLines
        noteFrequency={noteFrequency}
        showLines={showLines}
        bellCurveWidth={bellCurveWidth}
        selectedHarmonics={selectedHarmonics}
        regionData={regionData}
        strikeState={strikeState}
        strikeMeasurement={strikeMeasurement}
        strikeMeasurementFrequency={_lastStrikeFrequency}
        _strikeMeasurementMagnitude={0}
        _peakMagnitude={0}
        _magnitudeThreshold={0}
        _onPreviousNote={onPreviousNote || (() => {})}
        _onNextNote={onNextNote || (() => {})}
        _onPrevOctave={onPrevOctave || (() => {})}
        _onNextOctave={onNextOctave || (() => {})}
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

export default React.memo(HarmonicPlot);
