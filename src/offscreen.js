// ============================================================
//                    OFFSCREEN.JS
//            Modular Mid-Side Audio Processor
// ============================================================

// ============================================================
// SECTION 1: STATE & CONFIGURATION
// ============================================================

/**
 * Global state object holding all audio-related references
 */
const audioState = {
  context: null,        // AudioContext instance
  source: null,         // MediaStreamSource from tab
  stream: null,         // MediaStream from tab capture
  isProcessing: false   // Processing status flag
};

/**
 * Container for all audio processing nodes
 * Organized by processing stage for clarity
 */
const nodes = {
  // Stage 1: Input splitting
  splitter: null,

  // Stage 2: Mid signal creation
  leftToMid: null,
  rightToMid: null,
  midChannel: null,

  // Stage 3: Side signal creation
  leftToSide: null,
  rightToSideInv: null,
  sideChannel: null,

  // Stage 4: Mid processing
  //midHighPass: null,  пока решено было избавиться, см. заметки
  vocalNotch1: null,
  vocalNotch2: null,
  vocalNotch3: null,
  midGain: null,

  // Stage 5: Side processing
  //sideHighPass: null, пока решено было избавиться, см. заметки
  sideGain: null,

  // Stage 6: M/S to L/R decoding
  midToLeft: null,
  sideToLeft: null,
  leftOutput: null,
  midToRight: null,
  sideToRightInv: null,
  rightOutput: null,

  // Stage 7: Output EQ
  leftBass: null,
  leftTreble: null,
  rightBass: null,
  rightTreble: null,

  // Stage 8: Output
  leftVolume: null,
  rightVolume: null,
  merger: null,
  limiter: null
};

/**
 * Current settings with defaults
 * These control all aspects of the audio processing
 */
let settings = {};

const dbForNotchFilter = 25;
const dbForBassEQ = 18;


// ============================================================
// SECTION 2: MESSAGE HANDLING
// ============================================================

/**
 * Listen for messages from the popup or background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages meant for offscreen document
  if (message.target !== 'offscreen' && message.type !== 'update-settings') {
    return false;
  }

  switch (message.type) {
    case 'start-processing':
      handleStartProcessing(message.streamId, message.settings)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async

    case 'stop-processing':
      handleStopProcessing();
      sendResponse({ success: true });
      return false;

    case 'update-settings':
      handleUpdateSettings(message.settings);
      sendResponse({ success: true });
      return false;

    default:
      return false;
  }
});

//#region SECTION 3: MAIN CONTROL FUNCTIONS
/**
 * Start audio processing for a tab
 * @param {string} streamId - Chrome tab capture stream ID
 * @param {object} initialSettings - Initial processing settings
 */
async function handleStartProcessing(streamId, initialSettings) {
  // Clean up any existing processing
  if (audioState.isProcessing) {
    handleStopProcessing();
  }

  // Apply initial settings
  settings = { ...settings, ...initialSettings };

  try {
    // Step 1: Capture audio from tab
    await captureTabAudio(streamId);

    // Step 2: Create AudioContext
    createAudioContext();

    // Step 3: Create source node
    createSourceNode();

    // Step 4: Build processing chain
    buildProcessingChain();

    // Step 5: Connect all nodes
    connectAllNodes();

    audioState.isProcessing = true;
    console.log('✅ Mid-Side processing started successfully');

  } catch (error) {
    console.error('❌ Failed to start processing:', error);
    handleStopProcessing();
    throw error;
  }
}

/**
 * Stop all audio processing and clean up
 */
function handleStopProcessing() {
  console.log('🛑 Stopping audio processing...');

  disconnectAllNodes();
  stopMediaStream();
  closeAudioContext();
  resetState();

  console.log('✅ Audio processing stopped');
}

/**
 * Update processing settings in real-time
 * @param {object} newSettings - New settings to apply
 */
function handleUpdateSettings(newSettings) {
  settings = { ...settings, ...newSettings };

  if (!audioState.isProcessing || !audioState.context) {
    return;
  }

  applySettingsToNodes();
}
//#endregion

//#region SECTION 4: AUDIO CAPTURE
/**
 * Capture audio stream from browser tab
 * @param {string} streamId - Tab capture stream ID
 */
async function captureTabAudio(streamId) {
  console.log('🎤 Capturing tab audio...');

  audioState.stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  console.log('✅ Tab audio captured');
}

/**
 * Stop media stream tracks
 */
function stopMediaStream() {
  if (audioState.stream) {
    audioState.stream.getTracks().forEach(track => {
      track.stop();
      console.log(`  Stopped track: ${track.kind}`);
    });
    audioState.stream = null;
  }
}
//#endregion

//#region SECTION 5: AUDIO CONTEXT MANAGEMENT
/**
 * Create the AudioContext
 */
function createAudioContext() {
  console.log('🔊 Creating AudioContext...');
  audioState.context = new AudioContext();
  console.log(`✅ AudioContext created (sample rate: ${audioState.context.sampleRate}Hz)`);
}

/**
 * Create source node from media stream
 */
function createSourceNode() {
  console.log('📥 Creating source node...');
  audioState.source = audioState.context.createMediaStreamSource(audioState.stream);
  console.log('✅ Source node created');
}

/**
 * Close AudioContext
 */
function closeAudioContext() {
  if (audioState.context) {
    audioState.context.close();
    audioState.context = null;
  }
}

/**
 * Reset all state
 */
function resetState() {
  audioState.source = null;
  audioState.isProcessing = false;

  // Clear all node references
  Object.keys(nodes).forEach(key => {
    nodes[key] = null;
  });
}
//#endregion

//#region SECTION 6: BUILD PROCESSING CHAIN
/**
 * Build the complete processing chain by creating all nodes
 */
function buildProcessingChain() {
  console.log('🔧 Building processing chain...');
  
  /**
   * Stage 1: Input
   * Create the channel splitter
   * Splits stereo input into separate Left and Right channels
   */
  nodes.splitter = audioState.context.createChannelSplitter(2);
  console.log('  ✓ Splitter created');
  
  /**
   * Stage 2: Mid signal
   * Create nodes for Mid signal: Mid = (L + R) / 2
   * The Mid signal contains center-panned content (vocals, bass, kick)
   */
  // Left channel contribution (L × 0.5)
  nodes.leftToMid = audioState.context.createGain();
  nodes.leftToMid.gain.value = 0.5;

  // Right channel contribution (R × 0.5)
  nodes.rightToMid = audioState.context.createGain();
  nodes.rightToMid.gain.value = 0.5;

  // Summing node (outputs Mid = L×0.5 + R×0.5)
  nodes.midChannel = audioState.context.createGain();
  nodes.midChannel.gain.value = 1.0;
  console.log('  ✓ Mid signal nodes created');
  
  /**
   * Stage 3: Side signal
   * Create nodes for Side signal: Side = (L - R) / 2
   * The Side signal contains stereo-panned content (guitars, synths, effects)
   */
  // Left channel contribution (L × 0.5)
  nodes.leftToSide = audioState.context.createGain();
  nodes.leftToSide.gain.value = 0.5;

  // Right channel INVERTED (R × -0.5)
  // The negative value creates subtraction when summed
  nodes.rightToSideInv = audioState.context.createGain();
  nodes.rightToSideInv.gain.value = -0.5;

  // Summing node (outputs Side = L×0.5 + R×(-0.5) = (L-R)/2)
  nodes.sideChannel = audioState.context.createGain();
  nodes.sideChannel.gain.value = 1.0;
  console.log('  ✓ Side signal nodes created');
  
  /**
   * Stage 4: Mid processing
   * Create processing nodes for the Mid channel
   * This is where we reduce vocals by:
   * 1. High-pass filtering (remove low rumble)
   * 2. Notch filtering (cut vocal frequencies)
   * 3. Gain reduction (reduce overall center level)
   */
  createMidProcessingNodes();
  console.log('  ✓ Mid processing nodes created');
  
  /**
   * Stage 5: Side processing
   * Create processing nodes for the Side channel
   * Simpler than Mid - just high-pass and gain control
   */
  // High-pass filter: Remove very low frequencies
  // Bass should be mono (in Mid), so Side shouldn't have much
  // Пока решено было избавиться, см. заметки
  //nodes.sideHighPass = createHighPassFilter(settings.sideHP);

  // Side gain: Controls stereo width
  // > 1.0 = wider stereo, < 1.0 = narrower
  nodes.sideGain = audioState.context.createGain();
  nodes.sideGain.gain.value = settings.side;
  console.log('  ✓ Side processing nodes created');
  
  /**
   * Stage 6: Decoder
   * Create nodes to decode Mid/Side back to Left/Right
   *
   * Formulas:
   *   Left  = Mid + Side
   *   Right = Mid - Side
   */
  createDecoderNodes();
  console.log('  ✓ Decoder nodes created');
  
  /**
   * Stage 7: Output EQ
   * Create output EQ nodes for bass and treble adjustment
   * Applied to both channels to maintain stereo balance
   */
  // Left channel bass boost (lowshelf filter)
  nodes.leftBass = createBassFilter(settings.bass, settings.bassFreq);
  // Left channel treble control (highshelf filter)
  nodes.leftTreble = createTrebleFilter(settings.treble, settings.trebleFreq);
  // Right channel bass boost
  nodes.rightBass = createBassFilter(settings.bass, settings.bassFreq);
  // Right channel treble control
  nodes.rightTreble = createTrebleFilter(settings.treble, settings.trebleFreq);
  console.log('  ✓ Output EQ nodes created');
  
  /**
   * Stage 8: Output
   * Create final output stage nodes
   * Volume control, merger, and limiter
   */
  // Left channel volume
  nodes.leftVolume = audioState.context.createGain();
  nodes.leftVolume.gain.value = settings.volume;

  // Right channel volume
  nodes.rightVolume = audioState.context.createGain();
  nodes.rightVolume.gain.value = settings.volume;

  // Stereo merger (combines L and R into stereo output)
  nodes.merger = audioState.context.createChannelMerger(2);

  // Limiter (prevents clipping/distortion)
  nodes.limiter = createLimiter(settings.limiterThreshold);
  console.log('  ✓ Output nodes created');

  console.log('✅ Processing chain built');
}

function createMidProcessingNodes() {
  // High-pass filter: Remove frequencies below threshold
  // Helps prevent low-end rumble from the processing
  // Пока решено было избавиться, см. заметки
  //nodes.midHighPass = createHighPassFilter(settings.midHP);

  // Vocal notch filter 1: Cut around 1500 Hz (vocal body)
  nodes.vocalNotch1 = createNotchFilter(
      settings.notch1Freq,
      settings.notch1Gain,
      settings.notch1Q,
      settings.notchesLevel
  );

  // Vocal notch filter 2: Cut around 3000 Hz (vocal presence)
  nodes.vocalNotch2 = createNotchFilter(
      settings.notch2Freq,
      settings.notch2Gain,
      settings.notch2Q,
      settings.notchesLevel
  );

  // Vocal notch filter 3: Cut around 5000 Hz (vocal air)
  // This one is optional (disabled by default)
  nodes.vocalNotch3 = createNotchFilter(
      settings.notch3Freq,
      settings.notch3Gain,
      settings.notch3Q,
      settings.notchesLevel
  );

  // Mid gain: The main vocal reduction control
  nodes.midGain = audioState.context.createGain();
  nodes.midGain.gain.value = settings.mid;
}

/**
 * Create a high-pass filter
 * @param {number} frequency - Cutoff frequency in Hz
 * @returns {BiquadFilterNode}
 */
function createHighPassFilter(frequency) {
  const filter = audioState.context.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = frequency;
  filter.Q.value = 0.707; // Butterworth response
  return filter;
}

/**
 * Create a notch (peaking) filter for vocal frequencies
 * @param {number} frequency - Center frequency in Hz
 * @param {number} gain - Cut amount (0-1, converted to dB)
 * @param {number} q - Q factor (width of the cut)
 * @param {number} gainMult - Доп. множитель для gain-а
 * @returns {BiquadFilterNode}
 */
function createNotchFilter(frequency, gain, q, gainMult) {
  const filter = audioState.context.createBiquadFilter();
  filter.type = 'peaking';
  filter.frequency.value = frequency;
  filter.Q.value = q;
  // Convert 0-1 gain to negative dB (0 = no cut, 1 = -25dB cut)
  filter.gain.value = -gain * dbForNotchFilter * gainMult;
  return filter;
}

function createDecoderNodes() {
  // === Left output: Mid + Side ===

  // Mid contribution to Left (just passes through)
  nodes.midToLeft = audioState.context.createGain();
  nodes.midToLeft.gain.value = 1.0;

  // Side contribution to Left (just passes through)
  nodes.sideToLeft = audioState.context.createGain();
  nodes.sideToLeft.gain.value = 1.0;

  // Left summing node
  nodes.leftOutput = audioState.context.createGain();
  nodes.leftOutput.gain.value = 1.0;

  // === Right output: Mid - Side ===

  // Mid contribution to Right (just passes through)
  nodes.midToRight = audioState.context.createGain();
  nodes.midToRight.gain.value = 1.0;

  // Side contribution to Right (INVERTED for subtraction)
  nodes.sideToRightInv = audioState.context.createGain();
  nodes.sideToRightInv.gain.value = -1.0;

  // Right summing node
  nodes.rightOutput = audioState.context.createGain();
  nodes.rightOutput.gain.value = 1.0;
}

/**
 * Create a bass (low shelf) filter
 * @param {number} amount - Boost amount (0-1, converted to dB)
 * @param {number} frequency - Shelf frequency in Hz
 * @returns {BiquadFilterNode}
 */
function createBassFilter(amount, frequency) {
  const filter = audioState.context.createBiquadFilter();
  filter.type = 'lowshelf';
  filter.frequency.value = frequency;
  // Convert 0-1 to 0-18 dB boost
  filter.gain.value = amount * dbForBassEQ;
  return filter;
}

/**
 * Create a treble (high shelf) filter
 * @param {number} gainDB - Gain in dB (positive = boost, negative = cut)
 * @param {number} frequency - Shelf frequency in Hz
 * @returns {BiquadFilterNode}
 */
function createTrebleFilter(gainDB, frequency) {
  const filter = audioState.context.createBiquadFilter();
  filter.type = 'highshelf';
  filter.frequency.value = frequency;
  filter.gain.value = gainDB;
  return filter;
}

/**
 * Create a limiter using DynamicsCompressor
 * @param {number} threshold - Threshold in dB
 * @returns {DynamicsCompressorNode}
 */
function createLimiter(threshold) {
  const limiter = audioState.context.createDynamicsCompressor();
  limiter.threshold.value = threshold;
  limiter.knee.value = 0;       // Hard knee for limiting
  limiter.ratio.value = 20;     // High ratio = limiting behavior
  limiter.attack.value = 0.001; // Fast attack (1ms)
  limiter.release.value = 0.1;  // Medium release (100ms)
  return limiter;
}
//#endregion

//#region SECTION 7: NODE CONNECTIONS
/**
 * Connect all nodes in the processing chain
 */
function connectAllNodes() {
  console.log('🔌 Connecting nodes...');
  
  // Connect input stage: Source → Splitter
  audioState.source.connect(nodes.splitter);
  
  // Connect Mid signal creation: Splitter → Mid channel
  // Left channel (output 0) → leftToMid gain
  nodes.splitter.connect(nodes.leftToMid, 0);
  // Right channel (output 1) → rightToMid gain
  nodes.splitter.connect(nodes.rightToMid, 1);
  // Both feed into midChannel (they sum automatically)
  nodes.leftToMid.connect(nodes.midChannel);
  nodes.rightToMid.connect(nodes.midChannel);
  
  // Connect Side signal creation: Splitter → Side channel
  // Left channel → leftToSide gain
  nodes.splitter.connect(nodes.leftToSide, 0);
  // Right channel → rightToSideInv gain (inverted)
  nodes.splitter.connect(nodes.rightToSideInv, 1);
  // Both feed into sideChannel
  nodes.leftToSide.connect(nodes.sideChannel);
  nodes.rightToSideInv.connect(nodes.sideChannel);
  
  // Connect Mid processing chain
  // Mid → High-pass (пока решено было избавиться, см. заметки) → Notch 1 → Notch 2 → Notch 3 → Mid Gain
  nodes.midChannel.connect(nodes.vocalNotch1);
  //nodes.midChannel.connect(nodes.midHighPass);
  //nodes.midHighPass.connect(nodes.vocalNotch1);
  nodes.vocalNotch1.connect(nodes.vocalNotch2);
  nodes.vocalNotch2.connect(nodes.vocalNotch3);
  nodes.vocalNotch3.connect(nodes.midGain);
  
  // Connect Side processing chain
  // Side → High-pass (пока решено было избавиться, см. заметки) → Side Gain
  nodes.sideChannel.connect(nodes.sideGain);
  //nodes.sideChannel.connect(nodes.sideHighPass);
  //nodes.sideHighPass.connect(nodes.sideGain);
  
  // Connect M/S to L/R decoder
  // Left output = Mid + Side
  nodes.midGain.connect(nodes.midToLeft);
  nodes.sideGain.connect(nodes.sideToLeft);
  nodes.midToLeft.connect(nodes.leftOutput);
  nodes.sideToLeft.connect(nodes.leftOutput);
  // Right output = Mid - Side (side inverted)
  nodes.midGain.connect(nodes.midToRight);
  nodes.sideGain.connect(nodes.sideToRightInv);
  nodes.midToRight.connect(nodes.rightOutput);
  nodes.sideToRightInv.connect(nodes.rightOutput);
  
  // Connect output EQ
  // Left: output → bass → treble
  nodes.leftOutput.connect(nodes.leftBass);
  nodes.leftBass.connect(nodes.leftTreble);
  // Right: output → bass → treble
  nodes.rightOutput.connect(nodes.rightBass);
  nodes.rightBass.connect(nodes.rightTreble);
  
  // Connect final output stage
  // Left → volume → merger (channel 0)
  nodes.leftTreble.connect(nodes.leftVolume);
  nodes.leftVolume.connect(nodes.merger, 0, 0);

  // Right → volume → merger (channel 1)
  nodes.rightTreble.connect(nodes.rightVolume);
  nodes.rightVolume.connect(nodes.merger, 0, 1);

  // Merger → limiter → destination (speakers)
  nodes.merger.connect(nodes.limiter);
  nodes.limiter.connect(audioState.context.destination);

  console.log('✅ All nodes connected');
}

/**
 * Disconnect all nodes
 */
function disconnectAllNodes() {
  // Disconnect source
  if (audioState.source) {
    try {
      audioState.source.disconnect();
    } catch (e) {}
  }

  // Disconnect all processing nodes
  Object.values(nodes).forEach(node => {
    if (node && node.disconnect) {
      try {
        node.disconnect();
      } catch (e) {}
    }
  });
}
//#endregion

//#region SECTION 8: SETTINGS APPLICATION
/**
 * Apply current settings to all nodes with smooth transitions
 * Необходимости в if-ах для проверки каждой ноды нет, но пускай пока будет
 */
function applySettingsToNodes() {
  const ctx = audioState.context;
  const t = ctx.currentTime;
  const ramp = settings.crossfadeTime;

  // Helper function for smooth value transitions
  const smoothRamp = (param, value) => {
    param.linearRampToValueAtTime(value, t + ramp);
  };

  // Mid gain (vocal reduction)
  if (nodes.midGain) {
    smoothRamp(nodes.midGain.gain, settings.mid);
  }

  // Side gain (stereo width)
  if (nodes.sideGain) {
    smoothRamp(nodes.sideGain.gain, settings.side);
  }

  // Vocal notch 1
  if (nodes.vocalNotch1) {
    smoothRamp(nodes.vocalNotch1.frequency, settings.notch1Freq);
    smoothRamp(nodes.vocalNotch1.gain, -settings.notch1Gain * dbForNotchFilter * settings.notchesLevel);
    smoothRamp(nodes.vocalNotch1.Q, settings.notch1Q);
  }

  // Vocal notch 2
  if (nodes.vocalNotch2) {
    smoothRamp(nodes.vocalNotch2.frequency, settings.notch2Freq);
    smoothRamp(nodes.vocalNotch2.gain, -settings.notch2Gain * dbForNotchFilter * settings.notchesLevel);
    smoothRamp(nodes.vocalNotch2.Q, settings.notch2Q);
  }

  // Vocal notch 3
  if (nodes.vocalNotch3) {
    smoothRamp(nodes.vocalNotch3.frequency, settings.notch3Freq);
    smoothRamp(nodes.vocalNotch3.gain, -settings.notch3Gain * dbForNotchFilter * settings.notchesLevel);
    smoothRamp(nodes.vocalNotch3.Q, settings.notch3Q);
  }

  // High-pass filters
  // Пока решено было избавиться, см. заметки
  // if (nodes.midHighPass) {
  //   smoothRamp(nodes.midHighPass.frequency, settings.midHP);
  // }
  // if (nodes.sideHighPass) {
  //   smoothRamp(nodes.sideHighPass.frequency, settings.sideHP);
  // }

  // Bass EQ
  const bassGain = settings.bass * dbForBassEQ;
  if (nodes.leftBass) {
    smoothRamp(nodes.leftBass.gain, bassGain);
    smoothRamp(nodes.leftBass.frequency, settings.bassFreq);
  }
  if (nodes.rightBass) {
    smoothRamp(nodes.rightBass.gain, bassGain);
    smoothRamp(nodes.rightBass.frequency, settings.bassFreq);
  }

  // Treble EQ
  if (nodes.leftTreble) {
    smoothRamp(nodes.leftTreble.gain, settings.treble);
    smoothRamp(nodes.leftTreble.frequency, settings.trebleFreq);
  }
  if (nodes.rightTreble) {
    smoothRamp(nodes.rightTreble.gain, settings.treble);
    smoothRamp(nodes.rightTreble.frequency, settings.trebleFreq);
  }

  // Volume
  if (nodes.leftVolume) {
    smoothRamp(nodes.leftVolume.gain, settings.volume);
  }
  if (nodes.rightVolume) {
    smoothRamp(nodes.rightVolume.gain, settings.volume);
  }

  // Limiter
  if (nodes.limiter) {
    smoothRamp(nodes.limiter.threshold, settings.limiterThreshold);
  }
}
//#endregion

// ============================================================
// SECTION 9: UTILITY LOGGING
// ============================================================
/**
 * Log current state for debugging
 */
function logState() {
  console.group('🎛️ Audio State');
  console.log('Processing:', audioState.isProcessing);
  console.log('Context state:', audioState.context?.state);
  console.log('Settings:', settings);
  console.groupEnd();
}

// Make logState available globally for debugging
window.logAudioState = logState;