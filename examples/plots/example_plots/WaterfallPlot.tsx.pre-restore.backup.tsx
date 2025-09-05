'use client';
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Box, useTheme } from '@mui/material';
import { styled } from '@mui/system';
import { RegionMetadata } from '@/app/wasm/audio_processor_wrapper';
import { getPlotLineColors, getColorSchemeGLSL } from '../colorSchemes/colorSchemes';
import { usePlotSettings } from '../../settings/contexts/PlotSettingsContext';

interface WaterfallPlotProps {
  regionData: Float32Array;
  regionMetadata: RegionMetadata;
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
  speed?: number;
  onSpeedChange?: (speed: number) => void;
  colorScheme: string;
  onColorSchemeChange?: (scheme: string) => void;
}

const StyledCanvas = styled('canvas')({
  width: '100%',
  height: '100%',
  display: 'block',
  position: 'relative',
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

// Vertex shader with fisheye applied to X in texture coordinates (prevents aliasing in FS)
const vertexShaderSource = `
  attribute vec2 a_position;
  varying vec2 v_texCoord;
  uniform float u_bellCurveWidth;

  float fisheyeTransform(float x) {
    float normalizedX = (x - 0.5) * 2.0;
    float distortion = u_bellCurveWidth;
    float transformed = sign(normalizedX) * abs(normalizedX) / (1.0 + abs(normalizedX) * distortion);
    transformed = transformed * (1.0 + distortion);
    return transformed * 0.5 + 0.5;
  }

  void main() {
    gl_Position = vec4(a_position, 0, 1);
    // map clip-space to [0,1] then apply fisheye on X only
    float texX = (a_position.x + 1.0) * 0.5;
    float texY = (a_position.y + 1.0) * 0.5;
    v_texCoord = vec2(fisheyeTransform(texX), texY);
  }
`;

const getFragmentShaderSource = (colorSchemeName: string) => `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_texture;   // LUMINANCE (magnitude in .r)
  uniform float u_scroll;        // 0..1 write head position as fraction of height
  uniform float u_texWidth;      // texture width (bins)

  ${getColorSchemeGLSL(colorSchemeName)}

  void main() {
    float y = fract(1.0 - v_texCoord.y + u_scroll);
    float x = v_texCoord.x;
    // 3-tap smoothing along X to reduce aliasing without thick bars
    float dx = 1.0 / max(u_texWidth, 1.0);
    float m0 = texture2D(u_texture, vec2(x, y)).r;
    float mL = texture2D(u_texture, vec2(clamp(x - dx, 0.0, 1.0), y)).r;
    float mR = texture2D(u_texture, vec2(clamp(x + dx, 0.0, 1.0), y)).r;
    float mag = m0 * 0.5 + 0.25 * (mL + mR);
    gl_FragColor = vec4(getSchemeColor(mag), 1.0);
  }
`;

function initShaderProgram(
  gl: WebGLRenderingContext,
  vsSource: string,
  fsSource: string
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create shader program');

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Unable to initialize shader program: ${error}`);
  }

  return program;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${error}`);
  }

  return shader;
}

const WaterfallPlot: React.FC<WaterfallPlotProps> = ({
  regionData,
  regionMetadata,
  speed = 5,
  colorScheme,
  noteFrequency,
  showLines,
  onPreviousNote,
  onNextNote,
  onPrevOctave,
  onNextOctave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const regionDataRef = useRef<Float32Array>(new Float32Array(0));
  const stripeRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastUpdateRef = useRef<number>(0);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const writeRowRef = useRef<number>(0);
  const texWidthRef = useRef<number>(256);
  const texHeightRef = useRef<number>(512);
  const [overlay, setOverlay] = useState<{ visible: boolean; quadrant: number }>({
    visible: false,
    quadrant: -1,
  });
  const theme = useTheme();
  const { settings } = usePlotSettings();

  const handleQuadrantInteraction = useCallback(
    (event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.preventDefault();

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clientX = 'touches' in event ? event.touches[0].clientX : (event as any).clientX;
      const clientY = 'touches' in event ? event.touches[0].clientY : (event as any).clientY;

      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const centerX = rect.width / 2;
      const isLeftSide = x < centerX;
      const isTopHalf = y < rect.height / 2;

      const quadrant = isTopHalf ? (isLeftSide ? 0 : 1) : isLeftSide ? 2 : 3;
      setOverlay({ visible: true, quadrant });

      requestAnimationFrame(() => {
        if (isTopHalf) {
          if (isLeftSide) {
            if (onPrevOctave) onPrevOctave();
          } else {
            if (onNextOctave) onNextOctave();
          }
        } else {
          if (isLeftSide) {
            if (onPreviousNote) onPreviousNote();
          } else {
            if (onNextNote) onNextNote();
          }
        }
        setTimeout(() => setOverlay({ visible: false, quadrant: -1 }), 200);
      });
    },
    [onNextNote, onPreviousNote, onNextOctave, onPrevOctave]
  );

  const resizeObserverCallback = useCallback((entries: ResizeObserverEntry[]) => {
    if (!entries[0]) return;
    const { width, height } = entries[0].contentRect;
    dimensionsRef.current = { width, height };
    const canvas = canvasRef.current;
    const gl = glRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const newW = Math.max(1, Math.floor(width * dpr));
    const newH = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width = newW;
      canvas.height = newH;
      canvas.style.width = `${Math.max(0, Math.floor(width))}px`;
      canvas.style.height = `${Math.max(0, Math.floor(height))}px`;
      if (gl) {
        gl.viewport(0, 0, newW, newH);
      }
    }
  }, []);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(resizeObserverCallback);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    return () => resizeObserver.disconnect();
  }, [resizeObserverCallback]);

  const drawWaterfall = useCallback(
    (_time: number) => {
      const canvas = canvasRef.current;
      const gl = glRef.current;
      const program = programRef.current;
      const buffer = bufferRef.current;
      const texture = textureRef.current;
      if (!canvas || !gl || !program || !buffer || !texture) return;
      const TEX_HEIGHT = texHeightRef.current;

      // Compute target update interval from speed (1..10 → ~5..50 fps)
      const fps = Math.max(1, Math.min(10, speed)) * 5;
      const intervalMs = 1000 / fps;
      const now = performance.now();
      const timeDiff = now - lastUpdateRef.current;

      // If region width changed, reallocate row buffer and texture
      const currentWidth = regionDataRef.current?.length || texWidthRef.current;
      if (currentWidth !== texWidthRef.current || !stripeRef.current) {
        texWidthRef.current = Math.max(1, currentWidth);
        stripeRef.current = new Uint8Array(texWidthRef.current);

        // Recreate texture with new width
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.LUMINANCE,
          texWidthRef.current,
          TEX_HEIGHT,
          0,
          gl.LUMINANCE,
          gl.UNSIGNED_BYTE,
          null
        );
        writeRowRef.current = 0;
      }

      if (timeDiff >= intervalMs) {
        const stripe = stripeRef.current!;
        const bins = regionDataRef.current;
        const width = texWidthRef.current;

        // No CPU-side color scheme usage; mapping happens in shader

        // Fill stripe from current magnitudes with normalization (no gamma)
        const maxMag = Math.max(1e-6, regionMetadata?.envelopeMax || 1);
        for (let x = 0; x < width; x++) {
          const raw = bins && x < bins.length ? bins[x] / maxMag : 0;
          stripe[x] = Math.floor(Math.max(0, Math.min(1, raw)) * 255);
        }

        // Write the stripe at current write row (ring buffer)
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          writeRowRef.current % TEX_HEIGHT,
          width,
          1,
          gl.LUMINANCE,
          gl.UNSIGNED_BYTE,
          stripe
        );

        writeRowRef.current = (writeRowRef.current + 1) % TEX_HEIGHT;
        lastUpdateRef.current = now;
      }

      // Draw full-screen quad with scroll offset
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Set uniforms
      const scrollLoc = gl.getUniformLocation(program, 'u_scroll');
      gl.uniform1f(scrollLoc, (writeRowRef.current % TEX_HEIGHT) / TEX_HEIGHT);

      // Ensure texture unit and binding are active for draw
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      const posLoc = gl.getAttribLocation(program, 'a_position');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animationFrameRef.current = requestAnimationFrame(drawWaterfall);
    },
    [speed, colorScheme]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('No canvas ref!');
      return;
    }

    // Force initial size if dimensions not set
    const width = dimensionsRef.current.width || 500;
    const height = dimensionsRef.current.height || 300;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    if (!glRef.current) {
      const gl = canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: false,
        preserveDrawingBuffer: false,
      });
      if (!gl) {
        console.error('WebGL not supported');
        return;
      }
      glRef.current = gl;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    }

    const gl = glRef.current;

    // Create shader program
    try {
      const program = initShaderProgram(
        gl,
        vertexShaderSource,
        getFragmentShaderSource(colorScheme)
      );
      programRef.current = program;
      gl.useProgram(program);
      const samplerLoc = gl.getUniformLocation(program, 'u_texture');
      if (samplerLoc) gl.uniform1i(samplerLoc, 0);

      // Create texture
      const TEX_WIDTH = texWidthRef.current;
      const TEX_HEIGHT = texHeightRef.current;
      const texture = gl.createTexture();
      if (!texture) throw new Error('Failed to create texture');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        TEX_WIDTH,
        TEX_HEIGHT,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        null
      );
      textureRef.current = texture;

      // Create vertex buffer for full-screen quad
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Failed to create buffer');
      bufferRef.current = buffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    } catch (error) {
      console.error('WebGL initialization error:', error);
      return;
    }

    // Start animation loop
    const loop = (t: number) => {
      drawWaterfall(t);
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    animationFrameRef.current = requestAnimationFrame(loop);

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (gl) {
        if (programRef.current) gl.deleteProgram(programRef.current);
        if (bufferRef.current) gl.deleteBuffer(bufferRef.current);
        if (textureRef.current) gl.deleteTexture(textureRef.current);
      }
    };
  }, [drawWaterfall, colorScheme]);

  // Keep latest data in ref
  useEffect(() => {
    regionDataRef.current = regionData;
  }, [regionData]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        padding: 0,
      }}
      onTouchStart={handleQuadrantInteraction}
      onClick={handleQuadrantInteraction}
    >
      <StyledCanvas ref={canvasRef} />
      <StyledSvg preserveAspectRatio="none">
        {(() => {
          const plotLineColors = getPlotLineColors(
            settings.colorScheme,
            theme.palette.mode === 'dark'
          );
          const getXPosition = (freq: number) => {
            const cents = 1200 * Math.log2(freq / noteFrequency);
            const normalizedPos = (cents + 120) / 240;
            const normalizedX = (normalizedPos - 0.5) * 2.0;
            const distortion = settings.bellCurveWidth ?? 4.0;
            let transformed = normalizedX / (1.0 + Math.abs(normalizedX) * distortion);
            transformed = transformed * (1.0 + distortion);
            const transformedPos = (transformed + 1.0) * 0.5;
            return transformedPos * 100;
          };
          return (
            <>
              <defs>
                <linearGradient id="wfTargetZoneGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={plotLineColors.primary} stopOpacity="0.5" />
                  <stop offset="50%" stopColor={plotLineColors.primary} stopOpacity="1.0" />
                  <stop offset="100%" stopColor={plotLineColors.primary} stopOpacity="0.5" />
                </linearGradient>
              </defs>
              {/* Minimal center target line (thin and subtle) */}
              <line
                x1={`${getXPosition(noteFrequency)}%`}
                y1="0%"
                x2={`${getXPosition(noteFrequency)}%`}
                y2="100%"
                stroke={plotLineColors.primary}
                strokeWidth="0.75"
                strokeOpacity="0.35"
              />
              {showLines && (
                <>
                  <line
                    x1={`${getXPosition(noteFrequency * Math.pow(2, -100 / 1200))}%`}
                    y1="0%"
                    x2={`${getXPosition(noteFrequency * Math.pow(2, -100 / 1200))}%`}
                    y2="100%"
                    stroke={plotLineColors.secondary}
                    strokeWidth="1"
                    strokeOpacity="0.5"
                    strokeDasharray="5,5"
                  />
                  <line
                    x1={`${getXPosition(noteFrequency * Math.pow(2, -10 / 1200))}%`}
                    y1="0%"
                    x2={`${getXPosition(noteFrequency * Math.pow(2, -10 / 1200))}%`}
                    y2="100%"
                    stroke={plotLineColors.secondary}
                    strokeWidth="1"
                    strokeOpacity="0.5"
                    strokeDasharray="5,5"
                  />
                  <line
                    x1={`${getXPosition(noteFrequency * Math.pow(2, 10 / 1200))}%`}
                    y1="0%"
                    x2={`${getXPosition(noteFrequency * Math.pow(2, 10 / 1200))}%`}
                    y2="100%"
                    stroke={plotLineColors.secondary}
                    strokeWidth="1"
                    strokeOpacity="0.5"
                    strokeDasharray="5,5"
                  />
                  <line
                    x1={`${getXPosition(noteFrequency * Math.pow(2, 100 / 1200))}%`}
                    y1="0%"
                    x2={`${getXPosition(noteFrequency * Math.pow(2, 100 / 1200))}%`}
                    y2="100%"
                    stroke={plotLineColors.secondary}
                    strokeWidth="1"
                    strokeOpacity="0.5"
                    strokeDasharray="5,5"
                  />
                </>
              )}
              {settings.showPeakFrequencyLine && regionMetadata?.peakFrequency > 0 && (
                <line
                  x1={`${getXPosition(regionMetadata.peakFrequency)}%`}
                  y1="0%"
                  x2={`${getXPosition(regionMetadata.peakFrequency)}%`}
                  y2="100%"
                  stroke="#cc0000"
                  strokeWidth="3"
                  strokeOpacity="0.8"
                />
              )}
            </>
          );
        })()}
      </StyledSvg>
      {[0, 1, 2, 3].map(q => (
        <Box
          key={q}
          sx={{
            position: 'absolute',
            width: '50%',
            height: '50%',
            left: q % 2 === 0 ? 0 : '50%',
            top: q < 2 ? 0 : '50%',
            transition: 'background-color 0.2s',
            backgroundColor:
              overlay.visible && overlay.quadrant === q ? 'rgba(255,255,255,0.08)' : 'transparent',
            pointerEvents: 'none',
          }}
        />
      ))}
    </Box>
  );
};

export default React.memo(WaterfallPlot, (prevProps, nextProps) => {
  return (
    prevProps.regionData === nextProps.regionData &&
    prevProps.regionMetadata === nextProps.regionMetadata &&
    prevProps.speed === nextProps.speed
  );
});
