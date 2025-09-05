import React from 'react';
import { Box, Paper, Typography, Chip, Stack } from '@mui/material';
import { strikeFrequencyTracker } from '@/services/strikeFrequencyTracker';

interface SpectrumDebugOverlayProps {
  currentNote: string;
  isVisible: boolean;
  strikeState?: string;
  peakFrequency?: number;
  noteFrequency?: number;
  bellCurveWidth?: number;
}

const SpectrumDebugOverlay: React.FC<SpectrumDebugOverlayProps> = ({
  currentNote,
  isVisible,
  strikeState,
  peakFrequency,
  noteFrequency,
  bellCurveWidth = 0,
}) => {
  if (!isVisible) return null;

  // Get strike frequency data
  const firstStrike = strikeFrequencyTracker.getFirstStrike(currentNote);
  const recentStrikes = strikeFrequencyTracker.getRecentStrikes(currentNote);
  const hasStrikes = strikeFrequencyTracker.hasStrikes(currentNote);
  const summary = strikeFrequencyTracker.getSummary();

  // Get all notes with strike data
  const notesWithStrikes = Object.keys(summary).filter(note => summary[note].recentCount > 0);

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'absolute',
        top: 10,
        right: 10,
        p: 2,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        color: 'white',
        minWidth: 300,
        maxWidth: 400,
        zIndex: 9999,
        border: '2px solid #00ff00',
        fontFamily: 'monospace',
      }}
    >
      <Typography variant="h6" sx={{ color: '#00ff00', mb: 1 }}>
        🐛 Spectrum Debug (Shift+O)
      </Typography>

      <Stack spacing={1}>
        {/* Current Note Info */}
        <Box>
          <Typography variant="subtitle2" sx={{ color: '#ffff00' }}>
            Current Note: {currentNote}
          </Typography>
          <Typography variant="caption" sx={{ color: '#888' }}>
            Target: {noteFrequency?.toFixed(2)} Hz | Peak: {peakFrequency?.toFixed(2)} Hz
          </Typography>
        </Box>

        {/* Strike State */}
        <Box>
          <Typography variant="subtitle2" sx={{ color: '#00ffff' }}>
            Strike State:{' '}
            <Chip
              label={strikeState || 'UNKNOWN'}
              size="small"
              sx={{
                backgroundColor:
                  strikeState === 'MONITORING'
                    ? '#00ff00'
                    : strikeState === 'ATTACK'
                      ? '#ffff00'
                      : '#888',
                color: 'black',
              }}
            />
          </Typography>
        </Box>

        {/* Strike Frequency History */}
        <Box>
          <Typography variant="subtitle2" sx={{ color: '#ff00ff' }}>
            Strike History for {currentNote}:
          </Typography>
          <Typography variant="caption" component="div" sx={{ pl: 1 }}>
            <span style={{ color: hasStrikes ? '#00ff00' : '#ff0000' }}>
              Has Strikes: {hasStrikes ? 'YES' : 'NO'}
            </span>
          </Typography>
          <Typography variant="caption" component="div" sx={{ pl: 1 }}>
            <span style={{ color: '#ffff00' }}>
              First Strike: {firstStrike ? `${firstStrike.toFixed(2)} Hz` : 'null'}
            </span>
          </Typography>
          <Typography variant="caption" component="div" sx={{ pl: 1, color: '#00ff00' }}>
            Recent Strikes ({recentStrikes.length}):
          </Typography>
          {recentStrikes.map((freq, idx) => (
            <Typography
              key={idx}
              variant="caption"
              component="div"
              sx={{
                pl: 2,
                color: `rgba(0, 255, 0, ${1.0 - idx * 0.18})`,
              }}
            >
              [{idx}]: {freq.toFixed(2)} Hz
            </Typography>
          ))}
        </Box>

        {/* Position Debugging */}
        <Box>
          <Typography variant="subtitle2" sx={{ color: '#00ffff' }}>
            Position Debug:
          </Typography>
          <Typography variant="caption" component="div" sx={{ pl: 1 }}>
            Note Frequency: {noteFrequency != null ? `${noteFrequency.toFixed(2)} Hz` : 'N/A'}
          </Typography>
          <Typography variant="caption" component="div" sx={{ pl: 1 }}>
            Bell Curve Width: {bellCurveWidth}
          </Typography>
          {firstStrike && (
            <>
              <Typography variant="caption" component="div" sx={{ pl: 1, color: '#ffff00' }}>
                First Strike Position: {firstStrike.toFixed(2)} Hz
              </Typography>
              <Typography variant="caption" component="div" sx={{ pl: 1, color: '#ffff00' }}>
                Cents from Target:{' '}
                {noteFrequency && noteFrequency > 0
                  ? (1200 * Math.log2(firstStrike / noteFrequency)).toFixed(1)
                  : 'N/A'}
              </Typography>
            </>
          )}
          {recentStrikes.length > 0 && recentStrikes[0] > 0 && (
            <>
              <Typography variant="caption" component="div" sx={{ pl: 1, color: '#00ff00' }}>
                Latest Strike: {recentStrikes[0].toFixed(2)} Hz
              </Typography>
              <Typography variant="caption" component="div" sx={{ pl: 1, color: '#00ff00' }}>
                Cents from Target:{' '}
                {noteFrequency && noteFrequency > 0
                  ? (1200 * Math.log2(recentStrikes[0] / noteFrequency)).toFixed(1)
                  : 'N/A'}
              </Typography>
            </>
          )}
        </Box>

        {/* All Notes with Strikes */}
        <Box>
          <Typography variant="subtitle2" sx={{ color: '#ffa500' }}>
            All Notes with Strikes:
          </Typography>
          {notesWithStrikes.length > 0 ? (
            notesWithStrikes.map(note => (
              <Typography key={note} variant="caption" component="div" sx={{ pl: 1 }}>
                {note}: {summary[note].recentCount} strikes
                {summary[note].firstStrike && ` (first: ${summary[note].firstStrike.toFixed(1)}Hz)`}
              </Typography>
            ))
          ) : (
            <Typography variant="caption" sx={{ pl: 1, color: '#888' }}>
              No strikes recorded yet
            </Typography>
          )}
        </Box>

        {/* Test Functions */}
        <Box sx={{ borderTop: '1px solid #444', pt: 1, mt: 1 }}>
          <Typography variant="caption" sx={{ color: '#888' }}>
            Console Commands:
          </Typography>
          <Typography variant="caption" component="div" sx={{ pl: 1, fontSize: '10px' }}>
            window.testStrikeLines() - Add test strikes
          </Typography>
          <Typography variant="caption" component="div" sx={{ pl: 1, fontSize: '10px' }}>
            window.strikeFrequencyTracker.clearAll() - Clear all
          </Typography>
          <Typography variant="caption" component="div" sx={{ pl: 1, fontSize: '10px' }}>
            window.strikeFrequencyTracker.recordStrike(&quot;{currentNote}&quot;, freq)
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
};

export default SpectrumDebugOverlay;
