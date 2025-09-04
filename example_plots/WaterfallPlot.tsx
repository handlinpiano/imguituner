'use client';
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Box, useTheme } from '@mui/material';
import { styled } from '@mui/system';
import { RegionMetadata } from '@/app/wasm/audio_processor_wrapper';
import { colorSchemes, interpolateColor, getPlotLineColors } from '../colorSchemes/colorSchemes';
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

// Vertex shader: warp per-bin edges like SpectrumPlot, sampling uses unwarped texcoords
const vertexShaderSource = `
  attribute vec2 a_texPos; // x: texcoord in [0,1] for bin edge, y: clip-space Y (-1 or 1)
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
    float warpedX = fisheyeTransform(a_texPos.x);
    float clipX = warpedX * 2.0 - 1.0;
    gl_Position = vec4(clipX, a_texPos.y, 0.0, 1.0);
    // Pass unwarped texcoords so sampling maps bins correctly
    v_texCoord = vec2(a_texPos.x, (a_texPos.y + 1.0) * 0.5);
  }
`;

// Fragment shader: sample scrolling ring buffer with unwarped texcoords
const fragmentShaderSource = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_texture;
  uniform float u_scroll; // 0..1 write head position as fraction of height
  
  void main() {
    // Flip Y so v_texCoord.y=0 is top of screen, and offset by u_scroll (ring buffer)
    float y = fract(1.0 - v_texCoord.y + u_scroll);
    vec4 color = texture2D(u_texture, vec2(v_texCoord.x, y));
    gl_FragColor = color;
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

function buildStripe(width: number, bins: Float32Array | null, schemeName: string): Uint8Array {
  const stripe = new Uint8Array(Math.max(1, width) * 4);
  const scheme = colorSchemes.find(s => s.name === schemeName) || colorSchemes[0];
  const num = Math.max(1, width);
  for (let x = 0; x < num; x++) {
    const m = bins && x < bins.length ? Math.max(0, Math.min(1, bins[x])) : 0;
    let r = m,
      g = m,
      b = m;
    for (let i = 0; i < scheme.stops.length - 1; i++) {
      const s0 = scheme.stops[i];
      const s1 = scheme.stops[i + 1];
      if (m <= s1.position) {
        const localT = (m - s0.position) / (s1.position - s0.position || 1);
        const [rr, gg, bb] = interpolateColor(s0.color, s1.color, Math.max(0, Math.min(1, localT)));
        r = rr;
        g = gg;
        b = bb;
        break;
      }
    }
    const idx = x * 4;
    stripe[idx] = Math.floor(r * 255);
    stripe[idx + 1] = Math.floor(g * 255);
    stripe[idx + 2] = Math.floor(b * 255);
    stripe[idx + 3] = 255;
  }
  return stripe;
}

function buildFilledTextureData(width: number, height: number, stripe: Uint8Array): Uint8Array {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const full = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    full.set(stripe, row * w * 4);
  }
  return full;
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
  const bellCurveWidthRef = useRef<number>(4.0);
  const speedRef = useRef<number>(5);
  const refreshFpsRef = useRef<number>(60);
  const lastRafTimeRef = useRef<number>(0);
  const [overlay, setOverlay] = useState<{ visible: boolean; quadrant: number }>({
    visible: false,
    quadrant: -1,
  });
  const theme = useTheme();
  const { settings } = usePlotSettings();

  // Keep fisheye strength live without re-creating the draw loop
  useEffect(() => {
    bellCurveWidthRef.current = settings.bellCurveWidth ?? 4.0;
  }, [settings.bellCurveWidth]);

  // Keep speed in a ref so the draw loop identity does not change
  useEffect(() => {
    speedRef.current = speed ?? 5;
  }, [speed]);

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

      // Compute target update interval from speed (1..10 → ~10..100 fps)
      const fps = Math.max(1, Math.min(10, speedRef.current)) * 10;
      let intervalMs = 1000 / fps;
      const now = performance.now();

      // Estimate display refresh rate from RAF deltas and clamp effective FPS
      if (lastRafTimeRef.current === 0) {
        lastRafTimeRef.current = now;
      } else {
        const rafDelta = now - lastRafTimeRef.current;
        if (rafDelta > 0 && rafDelta < 1000) {
          const instFps = 1000 / rafDelta;
          // Exponential moving average to stabilize
          refreshFpsRef.current = refreshFpsRef.current * 0.9 + instFps * 0.1;
        }
        lastRafTimeRef.current = now;
      }
      const maxFps = Math.max(1, Math.min(240, refreshFpsRef.current || fps));
      const effectiveFps = Math.min(fps, maxFps);
      intervalMs = 1000 / effectiveFps;
      const timeDiff = now - lastUpdateRef.current;

      // If region width changed, reallocate row buffer and texture
      const currentWidth = regionDataRef.current?.length || texWidthRef.current;
      if (currentWidth !== texWidthRef.current || !stripeRef.current) {
        texWidthRef.current = Math.max(1, currentWidth);
        stripeRef.current = new Uint8Array(texWidthRef.current * 4);

        // Recreate texture with new width
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // Initialize texture with a filled baseline stripe so we don't scroll into white
        const initStripe = buildStripe(
          texWidthRef.current,
          regionDataRef.current || null,
          colorScheme
        );
        const initData = buildFilledTextureData(texWidthRef.current, TEX_HEIGHT, initStripe);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          texWidthRef.current,
          TEX_HEIGHT,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          initData
        );
        writeRowRef.current = 0;

        // Rebuild vertex buffer to create explicit triangles per bin (like Spectrum bars)
        // For each bin i, create two triangles forming a quad between edges i and i+1
        const columns = texWidthRef.current;
        const verts = new Float32Array(columns * 6 * 2); // 6 vertices per bin, each with (x,y)
        let ptr = 0;
        for (let i = 0; i < columns; i++) {
          const leftX = columns > 0 ? i / columns : 0;
          const rightX = columns > 0 ? (i + 1) / columns : 1;
          // Triangle 1: (left,-1) (right,-1) (left,1)
          verts[ptr++] = leftX;
          verts[ptr++] = -1.0;
          verts[ptr++] = rightX;
          verts[ptr++] = -1.0;
          verts[ptr++] = leftX;
          verts[ptr++] = 1.0;
          // Triangle 2: (left,1) (right,-1) (right,1)
          verts[ptr++] = leftX;
          verts[ptr++] = 1.0;
          verts[ptr++] = rightX;
          verts[ptr++] = -1.0;
          verts[ptr++] = rightX;
          verts[ptr++] = 1.0;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      }

      if (timeDiff >= intervalMs) {
        const stripe = stripeRef.current!;
        const bins = regionDataRef.current;
        const width = texWidthRef.current;

        // Resolve color scheme
        const scheme = colorSchemes.find(s => s.name === colorScheme) || colorSchemes[0];

        // Precompute current stripe colors once per frame from current magnitudes
        for (let x = 0; x < width; x++) {
          const m = bins && x < bins.length ? Math.max(0, Math.min(1, bins[x])) : 0;
          let r = m,
            g = m,
            b = m; // fallback grayscale
          for (let i = 0; i < scheme.stops.length - 1; i++) {
            const s0 = scheme.stops[i];
            const s1 = scheme.stops[i + 1];
            if (m <= s1.position) {
              const localT = (m - s0.position) / (s1.position - s0.position || 1);
              const [rr, gg, bb] = interpolateColor(
                s0.color,
                s1.color,
                Math.max(0, Math.min(1, localT))
              );
              r = rr;
              g = gg;
              b = bb;
              break;
            }
          }
          const idx = x * 4;
          stripe[idx] = Math.floor(r * 255);
          stripe[idx + 1] = Math.floor(g * 255);
          stripe[idx + 2] = Math.floor(b * 255);
          stripe[idx + 3] = 255;
        }

        // Compute how many rows we need to write to catch up to target rate
        // Cap writes per frame to avoid long stalls on tab refocus
        let rowsToWrite = Math.min(6, Math.floor(timeDiff / intervalMs));
        if (rowsToWrite < 1) rowsToWrite = 1;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        for (let r = 0; r < rowsToWrite; r++) {
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            writeRowRef.current % TEX_HEIGHT,
            width,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            stripe
          );
          writeRowRef.current = (writeRowRef.current + 1) % TEX_HEIGHT;
        }

        // Advance the timeline by the rows we emitted to keep rate accurate
        lastUpdateRef.current += rowsToWrite * intervalMs;
        if (now - lastUpdateRef.current > 100) {
          // In case of drift after tab suspend, snap to now to avoid huge backlog
          lastUpdateRef.current = now;
        }
      }

      // Draw full-screen quad with scroll offset
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Set uniforms
      const scrollLoc = gl.getUniformLocation(program, 'u_scroll');
      if (scrollLoc) gl.uniform1f(scrollLoc, (writeRowRef.current % TEX_HEIGHT) / TEX_HEIGHT);
      const fisheyeLoc = gl.getUniformLocation(program, 'u_bellCurveWidth');
      if (fisheyeLoc) gl.uniform1f(fisheyeLoc, bellCurveWidthRef.current);

      const texPosLoc = gl.getAttribLocation(program, 'a_texPos');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(texPosLoc);
      gl.vertexAttribPointer(texPosLoc, 2, gl.FLOAT, false, 0, 0);
      // Draw triangles: 6 vertices per column (two triangles per bin)
      const columns = texWidthRef.current;
      gl.drawArrays(gl.TRIANGLES, 0, columns * 6);

      animationFrameRef.current = requestAnimationFrame(drawWaterfall);
    },
    [colorScheme]
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
      const program = initShaderProgram(gl, vertexShaderSource, fragmentShaderSource);
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
      // Initialize texture with a filled baseline stripe so initial scroll has correct color
      const initStripe0 = buildStripe(TEX_WIDTH, regionDataRef.current || null, colorScheme);
      const initData0 = buildFilledTextureData(TEX_WIDTH, TEX_HEIGHT, initStripe0);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        TEX_WIDTH,
        TEX_HEIGHT,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        initData0
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

    // Start animation loop (drawWaterfall self-schedules)
    animationFrameRef.current = requestAnimationFrame(drawWaterfall);

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
  }, [drawWaterfall]);

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
              <line
                x1={`${getXPosition(noteFrequency)}%`}
                y1="0%"
                x2={`${getXPosition(noteFrequency)}%`}
                y2="100%"
                stroke={plotLineColors.primary}
                strokeWidth="2"
                strokeOpacity="0.8"
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
              {settings.showPeakFrequencyLine &&
                regionMetadata?.peakFrequency > 0 &&
                (regionMetadata?.peakMagnitude ?? 0) >= 0.1 && (
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
