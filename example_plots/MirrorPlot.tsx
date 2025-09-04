'use client';
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Box, useTheme } from '@mui/material';
import { styled } from '@mui/system';
import { Theme } from '@mui/material/styles';
import { getColorSchemeGLSL, getPlotLineColors } from '../colorSchemes/colorSchemes';
import { RegionMetadata, StrikeState, StrikeMeasurement } from '@/app/wasm/audio_processor_wrapper';
import { usePlotSettings } from '../../settings/contexts/PlotSettingsContext';
import { useHarmonicFundamental } from '../../../hooks/useHarmonicFundamental';

export interface MirrorPlotProps {
  regionData: Float32Array;
  regionMetadata?: RegionMetadata;
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
  peakFrequency?: number;
  peakMagnitude?: number;
  magnitudeThreshold?: number;
  strikeState?: StrikeState;
  strikeMeasurement?: StrikeMeasurement | null;
}

interface FrequencyLinesProps {
  noteFrequency: number;
  showLines: boolean;
  theme: Theme;
  bellCurveWidth: number;
  peakFrequency?: number;
  strikeState?: StrikeState;
  strikeMeasurement?: StrikeMeasurement | null;
  showPeakFrequencyLine: boolean;
  showStrikeStateLine: boolean;
  plotSettings: any;
}

const StyledCanvas = styled('canvas')({
  width: '100%',
  height: '100%',
  display: 'block',
  aspectRatio: '16/9',
  minHeight: '200px',
  position: 'absolute',
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
  
  ${getColorSchemeGLSL(colorSchemeName || 'Viridis')}
  
  vec4 getColor(float magnitude, float threshold) {
    if (u_zenMode) {
      return magnitude >= threshold 
        ? vec4(1.0, 1.0, 1.0, 1.0)
        : vec4(0.5, 0.5, 0.5, 1.0);
    }
    
    if (magnitude >= threshold) {
      return vec4(1.0, 0.6, 0.0, 1.0);
    }
    
    return vec4(getSchemeColor(magnitude), 1.0);
  }
  
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
    
    // Mirror the y position with bell curve magnitude
    if (position.y > 0.0) {
      // Upper half
      position.y = position.y * a_magnitude;
    } else {
      // Lower half
      position.y = position.y * a_magnitude;
    }
    
    gl_Position = vec4(position, 0, 1);
    v_color = getColor(a_magnitude, u_threshold);
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec4 v_color;
  
  void main() {
    gl_FragColor = v_color;
  }
`;

const FrequencyLines: React.FC<FrequencyLinesProps> = ({
  noteFrequency,
  showLines,
  theme,
  bellCurveWidth,
  peakFrequency,
  strikeState,
  strikeMeasurement,
  showPeakFrequencyLine,
  showStrikeStateLine,
  plotSettings,
}) => {
  // Use harmonic fundamental data instead of complex strike measurement system
  const { fundamentalFrequency, hasValidMeasurement } = useHarmonicFundamental(300);

  // Also check strike measurement for immediate harmonic capture frequency
  const strikeFundamental = strikeMeasurement?.frequency;
  // Priority system: harmonicFundamental || strikeFundamental || peakFrequency
  const displayFrequency = fundamentalFrequency || strikeFundamental || peakFrequency;

  // Get plot line colors based on the selected color scheme
  const plotLineColors = getPlotLineColors(plotSettings.colorScheme, theme.palette.mode === 'dark');

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

  const centToFreq = useCallback(
    (cents: number) => {
      return noteFrequency * Math.pow(2, cents / 1200);
    },
    [noteFrequency]
  );

  // Get strike state color
  const getStrikeStateColor = useCallback(() => {
    if (!strikeState) return theme.palette.grey[500];

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

  return (
    <StyledSvg preserveAspectRatio="none">
      {/* Strike state indicator circle */}
      {strikeState && <circle cx="97%" cy="50%" r="8" fill={getStrikeStateColor()} opacity="0.6" />}

      {/* Peak frequency line */}
      {showPeakFrequencyLine && peakFrequency && peakFrequency > 0 && (
        <line
          x1={`${getXPosition(peakFrequency)}%`}
          y1="0%"
          x2={`${getXPosition(peakFrequency)}%`}
          y2="100%"
          stroke="#cc0000"
          strokeWidth="2"
          strokeOpacity="0.8"
        />
      )}

      {/* Target frequency line */}
      <line
        x1={`${getXPosition(noteFrequency)}%`}
        y1="0%"
        x2={`${getXPosition(noteFrequency)}%`}
        y2="100%"
        stroke={plotLineColors.primary}
        strokeWidth="2"
      />

      {showLines && (
        <>
          <line
            x1={`${getXPosition(centToFreq(-100))}%`}
            y1="0%"
            x2={`${getXPosition(centToFreq(-100))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.5"
            strokeDasharray="5,5"
          />
          <line
            x1={`${getXPosition(centToFreq(-10))}%`}
            y1="0%"
            x2={`${getXPosition(centToFreq(-10))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.5"
            strokeDasharray="5,5"
          />
          <line
            x1={`${getXPosition(centToFreq(10))}%`}
            y1="0%"
            x2={`${getXPosition(centToFreq(10))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.5"
            strokeDasharray="5,5"
          />
          <line
            x1={`${getXPosition(centToFreq(100))}%`}
            y1="0%"
            x2={`${getXPosition(centToFreq(100))}%`}
            y2="100%"
            stroke={plotLineColors.secondary}
            strokeWidth="1"
            strokeOpacity="0.5"
            strokeDasharray="5,5"
          />
        </>
      )}

      {/* Harmonic fundamental line (green indicator) */}
      {showStrikeStateLine &&
        (hasValidMeasurement || strikeState === 'MONITORING') &&
        displayFrequency && (
          <line
            x1={`${getXPosition(displayFrequency)}%`}
            y1="0%"
            x2={`${getXPosition(displayFrequency)}%`}
            y2="100%"
            stroke="#00ff00"
            strokeWidth="3"
            strokeOpacity="0.9"
          />
        )}
    </StyledSvg>
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

const MirrorPlot: React.FC<MirrorPlotProps> = ({
  regionData,
  regionMetadata,
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
  peakFrequency = 0,
  peakMagnitude: _peakMagnitude,
  magnitudeThreshold: _magnitudeThreshold,
  strikeState = 'WAITING',
  strikeMeasurement = null,
}) => {
  const theme = useTheme();
  const { settings } = usePlotSettings();
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

    const ext = gl.getExtension('ANGLE_instanced_arrays');
    if (!ext) return;

    // Clean up any previous attribute state
    const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    for (let i = 0; i < maxAttribs; i++) {
      gl.disableVertexAttribArray(i);
    }

    // Draw main spectrum
    gl.useProgram(program);

    // Use region data directly
    const magnitudes = regionData;

    // Calculate threshold based on maximum magnitude
    const sortedMagnitudes = [...magnitudes].sort((a, b) => b - a);
    const maxMagnitude = sortedMagnitudes[0];
    const threshold = maxMagnitude * (1.0 - thresholdPercentage);

    // Set up attributes and uniforms for spectrum
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const magnitudeLoc = gl.getAttribLocation(program, 'a_magnitude');
    const indexLoc = gl.getAttribLocation(program, 'a_index');

    if (positionLoc === -1 || magnitudeLoc === -1 || indexLoc === -1) {
      console.error('Failed to get attribute locations');
      return;
    }

    gl.uniform1f(gl.getUniformLocation(program, 'u_totalBars'), magnitudes.length);
    gl.uniform1f(gl.getUniformLocation(program, 'u_threshold'), threshold);
    gl.uniform1i(gl.getUniformLocation(program, 'u_zenMode'), zenMode ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(program, 'u_bellCurveWidth'), bellCurveWidth);

    // Set peak detection uniforms if regionMetadata is available
    if (regionMetadata) {
      gl.uniform1f(gl.getUniformLocation(program, 'u_peakBin'), regionMetadata.peakBin);
      gl.uniform1f(
        gl.getUniformLocation(program, 'u_peakConfidence'),
        regionMetadata.peakConfidence
      );
    } else {
      gl.uniform1f(gl.getUniformLocation(program, 'u_peakBin'), 0);
      gl.uniform1f(gl.getUniformLocation(program, 'u_peakConfidence'), 0);
    }

    // Draw spectrum bars
    gl.bindBuffer(gl.ARRAY_BUFFER, mainPositionBufferRef.current);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const instanceBuffer = gl.createBuffer();
    if (!instanceBuffer) {
      console.error('Failed to create instance buffer');
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    const instanceData = new Float32Array(magnitudes.length * 2);
    for (let i = 0; i < magnitudes.length; i++) {
      instanceData[i * 2] = magnitudes[i];
      instanceData[i * 2 + 1] = i;
    }
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(magnitudeLoc);
    gl.vertexAttribPointer(magnitudeLoc, 1, gl.FLOAT, false, 8, 0);
    ext.vertexAttribDivisorANGLE(magnitudeLoc, 1);

    gl.enableVertexAttribArray(indexLoc);
    gl.vertexAttribPointer(indexLoc, 1, gl.FLOAT, false, 8, 4);
    ext.vertexAttribDivisorANGLE(indexLoc, 1);

    ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, magnitudes.length);

    // Cleanup spectrum drawing state
    gl.disableVertexAttribArray(positionLoc);
    gl.disableVertexAttribArray(magnitudeLoc);
    gl.disableVertexAttribArray(indexLoc);
    gl.deleteBuffer(instanceBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }, [regionData, regionMetadata, zenMode, bellCurveWidth, thresholdPercentage]);

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

  // Add effect to redraw when peak frequency or strike detection data changes
  useEffect(() => {
    if (glRef.current && programRef.current) {
      drawSpectrum();
    }
  }, [drawSpectrum, regionMetadata, peakFrequency, strikeState, strikeMeasurement]);

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

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        aspectRatio: '16/9',
        minHeight: '200px',
        touchAction: 'none',
      }}
      onTouchStart={handleQuadrantInteraction}
      {...(!isTouchDevice ? { onClick: handleQuadrantInteraction } : {})}
    >
      <StyledCanvas ref={canvasRef} />
      <FrequencyLines
        noteFrequency={noteFrequency}
        showLines={showLines}
        theme={theme}
        bellCurveWidth={bellCurveWidth}
        peakFrequency={peakFrequency}
        strikeState={strikeState}
        strikeMeasurement={strikeMeasurement}
        showPeakFrequencyLine={settings.showPeakFrequencyLine}
        showStrikeStateLine={settings.showStrikeStateLine}
        plotSettings={settings}
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
    </Box>
  );
};

export default React.memo(MirrorPlot, (prevProps, nextProps) => {
  return (
    prevProps.regionData === nextProps.regionData &&
    prevProps.thresholdPercentage === nextProps.thresholdPercentage &&
    prevProps.zenMode === nextProps.zenMode &&
    prevProps.noteFrequency === nextProps.noteFrequency &&
    prevProps.showLines === nextProps.showLines &&
    prevProps.bellCurveWidth === nextProps.bellCurveWidth &&
    prevProps.colorScheme === nextProps.colorScheme &&
    prevProps.strikeState === nextProps.strikeState &&
    prevProps.strikeMeasurement?.frequency === nextProps.strikeMeasurement?.frequency &&
    prevProps.strikeMeasurement?.magnitude === nextProps.strikeMeasurement?.magnitude
  );
});
