# Piano Tuning Core Algorithm

## Core Parameters
```typescript
type NoteNumber = 1..88;  // A0=1 to C8=88
type FirstMeasuredNote = NoteNumber;  // Lowest non-wound string
```

## System Architecture
The tuning process is divided into three phases: temperament, bass, and treble. The temperament section follows a mathematically predetermined progression, while bass and treble sections require technician decision-making in selecting appropriate harmonic relationships.

## Phase Determination
```typescript
function determinePhase(note: NoteNumber, firstMeasured: FirstMeasuredNote): Phase {
    if (note < firstMeasured) return 'bass';
    if (note <= firstMeasured + 24) return 'temperament';
    return 'treble';
}
```

## Temperament Phase
Establishes base frequencies for notes between firstMeasured and firstMeasured+24. These notes follow a fixed mathematical progression once the firstMeasuredNote is established.

1. Initial Measurement:
```typescript
interface HarmonicMeasurement {
    noteNumber: NoteNumber;
    fundamental: number;      // Hz
    harmonics: {
        h2: number;          // Hz
        h3: number;          // Hz
        h4: number;          // Hz
    };
}

// For firstMeasured note (e.g., F3), measure fundamental and harmonics
const baseMeasurement = measureHarmonics(firstMeasured);

// Calculate target frequency using 4th harmonic relationship
const targetFreq = baseMeasurement.fundamental;
```

2. Fixed Points for Polynomial:
```typescript
interface TemperamentPoint {
    position: number;      // Semitones above firstMeasured
    frequency: number;     // Target Hz
}

const fixedPoints: TemperamentPoint[] = [
    { position: 0,  frequency: targetFreq },              // firstMeasured
    { position: 12, frequency: targetFreq * 2.0 },        // Octave
    { position: 19, frequency: targetFreq * 3.0 },        // Octave + fifth
    { position: 24, frequency: targetFreq * 4.0 }         // Two octaves
];
```

3. Polynomial Generation:
```typescript
// Returns function calculating frequency for any position 0-24 semitones above firstMeasured
// Using cubic spline interpolation between fixed points
const polynomial = generateTemperamentPolynomial(fixedPoints);

// Calculate all temperament targets
const temperamentTargets = new Map<NoteNumber, number>();
for (let i = 0; i <= 24; i++) {
    temperamentTargets.set(firstMeasured + i, polynomial(i));
}
```

## Treble Phase
For notes above firstMeasured+24, using previously tuned notes as references. The technician selects from available harmonic relationships for each note.

1. Harmonic Intervals:
```typescript
const TREBLE_INTERVALS = [
    { semitones: 12, harmonic: 2 },  // Octave
    { semitones: 19, harmonic: 3 },  // Octave + fifth
    { semitones: 24, harmonic: 4 }   // Two octaves
];
```

2. Reference Finding:
```typescript
function findTrebleReferences(noteNumber: NoteNumber): TuningTarget {
    const references = TREBLE_INTERVALS
        .map(interval => {
            const referenceNote = noteNumber - interval.semitones;
            const measurement = getMeasurement(referenceNote);
            return {
                sourceNote: referenceNote,
                harmonic: interval.harmonic,
                frequency: measurement.harmonics[`h${interval.harmonic}`]
            };
        })
        .filter(ref => ref.frequency !== undefined);

    return {
        noteNumber,
        frequency: references[0].frequency / references[0].harmonic,
        references
    };
}
```

## Bass Phase
For notes below firstMeasured. The technician selects appropriate harmonic relationships based on what's measurable for each note.

1. Available Harmonic Calculation:
```typescript
const BASS_INTERVALS = {
    H2: { semitones: 12, ratio: 2.0 },  // Octave
    H3: { semitones: 19, ratio: 3.0 },  // Octave + fifth
    H4: { semitones: 24, ratio: 4.0 },  // Two octaves
    H6: { semitones: 31, ratio: 6.0 },  // Two octaves + fifth
    H8: { semitones: 36, ratio: 8.0 }   // Three octaves
};

function getAvailableHarmonics(noteNumber: NoteNumber, firstMeasured: NoteNumber): number[] {
    const interval = firstMeasured - noteNumber;
    return Object.entries(BASS_INTERVALS)
        .filter(([_, data]) => data.semitones > interval)
        .map(([harmonic]) => parseInt(harmonic.slice(1)));
}
```

2. Bass Tuning Target:
```typescript
interface BassTarget {
    noteNumber: NoteNumber;
    harmonics: Array<{
        number: number;       // Which harmonic (2,3,4,6,8)
        frequency: number;    // Target frequency for this harmonic
    }>;
}

function calculateBassTarget(noteNumber: NoteNumber): BassTarget {
    const availableHarmonics = getAvailableHarmonics(noteNumber, firstMeasured);
    return {
        noteNumber,
        harmonics: availableHarmonics.map(h => ({
            number: h,
            frequency: calculateHarmonicTarget(noteNumber, h)
        }))
    };
}
```

## Tuning Sequence and Constraints

The system allows for several valid tuning sequences with specific constraints:

1. The temperament section follows a predetermined mathematical progression once the firstMeasuredNote is established.

2. The treble section (above firstMeasured+24) requires completion of the temperament section before tuning, as it relies on these reference frequencies.

3. The bass section (below firstMeasured) can be tuned after either:
   - Measuring only the firstMeasuredNote (minimum requirement)
   - Completing the temperament section (provides additional reference points)
   - Completing both temperament and treble sections

## Example Sequences:

1. Large Grand (firstMeasured = A2):
```
G2: All harmonics (2,3,4,6,8)
C2: Only 3,4,6,8 harmonics
G1: Only 4,6,8 harmonics
C1: Only 6,8 harmonics
A0: Only 8th harmonic
```

2. Spinet (firstMeasured = F3):
```
E3: All harmonics (2,3,4,6,8)
A2: Only 3,4,6,8 harmonics
E2: Only 4,6,8 harmonics
A1: Only 6,8 harmonics
A0: Only 8th harmonic
```