# Основные заметки:
  Нормально работающая имплементация Pitch shifter-а довольно сложна, при этом данное расширение без проблем работает с другими Pitch shifter расширениями (к прим. https://chromewebstore.google.com/detail/transpose-▲▼-pitch-▹-spee/ioimlbgefgadofblnajllknopjboejda)
  Хорошее видео объясняющее более простую и более сложную имплементацию Pitch shifter-а: https://www.youtube.com/watch?v=PjKlMXhxtTM
  Ниже приведен код и объяснение кода от Claude-opus-4-5-20251101-thinking-32k, имплементация использует похожий подход на тот что объясняется в первой половине видео (т.е. фактически упрощенный подход до момента обсуждения DTF, т.е. преобразования Фурье).



# Вопрос: I have my own chrome browser extension for karaoke. How can I using Web Audio API implement "transposition of pitch by semitones"? Can you please write for me core functionality?

# Ответ:
# Web Audio API Pitch Transposition for Karaoke

Here's a complete implementation for pitch shifting by semitones using the Web Audio API with a **granular synthesis** approach (Phase Vocoder style).

## Project Structure

```
extension/
├── manifest.json
├── audio/
│   ├── pitch-shifter-processor.js  (AudioWorklet)
│   ├── pitch-shifter.js            (Main controller)
│   └── karaoke-audio-manager.js    (Integration)
```

---

## 1. AudioWorklet Processor (pitch-shifter-processor.js)

```javascript
/**
 * PitchShifterProcessor - Granular synthesis based pitch shifter
 * Uses overlapping grains with resampling for pitch shifting
 */
class PitchShifterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Parameters
    this.pitchRatio = 1.0;
    this.grainSize = 2048;
    this.overlapRatio = 0.5;
    
    // Buffers
    this.inputBuffer = new Float32Array(this.grainSize * 4);
    this.outputBuffer = new Float32Array(this.grainSize * 4);
    this.grainWindow = this.createHannWindow(this.grainSize);
    
    // Positions
    this.inputWritePos = 0;
    this.outputWritePos = 0;
    this.outputReadPos = 0;
    
    // Phase accumulator for resampling
    this.readPosition = 0;
    
    // Listen for parameter changes from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'setPitchRatio') {
        this.pitchRatio = event.data.value;
      } else if (event.data.type === 'setSemitones') {
        this.pitchRatio = Math.pow(2, event.data.value / 12);
      }
    };
  }

  createHannWindow(size) {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || !input[0]) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];
    const blockSize = inputChannel.length;

    // Write input samples to circular buffer
    for (let i = 0; i < blockSize; i++) {
      this.inputBuffer[this.inputWritePos] = inputChannel[i];
      this.inputWritePos = (this.inputWritePos + 1) % this.inputBuffer.length;
    }

    // Process and read output samples
    for (let i = 0; i < blockSize; i++) {
      outputChannel[i] = this.processGranular();
    }

    // Copy to other channels if stereo
    for (let channel = 1; channel < output.length; channel++) {
      output[channel].set(outputChannel);
    }

    return true;
  }

  processGranular() {
    const hopSize = Math.floor(this.grainSize * (1 - this.overlapRatio));
    
    // Check if we need to create a new grain
    if (this.outputWritePos % hopSize === 0) {
      this.synthesizeGrain();
    }

    // Read from output buffer with interpolation
    const readIndex = Math.floor(this.readPosition);
    const fraction = this.readPosition - readIndex;
    const bufferLength = this.outputBuffer.length;
    
    const sample1 = this.outputBuffer[readIndex % bufferLength];
    const sample2 = this.outputBuffer[(readIndex + 1) % bufferLength];
    const outputSample = sample1 + fraction * (sample2 - sample1);

    // Advance read position based on pitch ratio
    this.readPosition += 1;
    this.outputWritePos++;

    return outputSample;
  }

  synthesizeGrain() {
    const hopSize = Math.floor(this.grainSize * (1 - this.overlapRatio));
    const bufferLength = this.inputBuffer.length;
    const outputBufferLength = this.outputBuffer.length;
    
    // Calculate read position with pitch shift
    const readOffset = Math.floor(this.grainSize / this.pitchRatio);
    
    for (let i = 0; i < this.grainSize; i++) {
      // Calculate source position with resampling
      const sourcePos = i * this.pitchRatio;
      const sourceIndex = Math.floor(sourcePos);
      const sourceFraction = sourcePos - sourceIndex;
      
      // Read from input buffer with linear interpolation
      const readPos = (this.inputWritePos - this.grainSize + sourceIndex + bufferLength) % bufferLength;
      const readPosNext = (readPos + 1) % bufferLength;
      
      const sample1 = this.inputBuffer[readPos];
      const sample2 = this.inputBuffer[readPosNext];
      const interpolatedSample = sample1 + sourceFraction * (sample2 - sample1);
      
      // Apply window and overlap-add to output buffer
      const windowedSample = interpolatedSample * this.grainWindow[i];
      const outputPos = (this.outputWritePos + i) % outputBufferLength;
      
      if (i < hopSize) {
        // Overlap region - add to existing
        this.outputBuffer[outputPos] += windowedSample;
      } else {
        // New region - overwrite
        this.outputBuffer[outputPos] = windowedSample;
      }
    }
  }
}

registerProcessor('pitch-shifter-processor', PitchShifterProcessor);
```

---

## 2. Main Pitch Shifter Controller (pitch-shifter.js)

```javascript
/**
 * PitchShifter - Main controller for pitch transposition
 * Supports semitone-based pitch shifting for karaoke applications
 */
class PitchShifter {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.workletNode = null;
    this.inputNode = null;
    this.outputNode = null;
    this.isInitialized = false;
    this.currentSemitones = 0;
    this.bypass = false;
    
    // Dry/wet mix
    this.dryGain = null;
    this.wetGain = null;
    this.mixRatio = 1.0; // 1.0 = full wet (pitch shifted)
  }

  /**
   * Initialize the pitch shifter
   * Must be called before use
   */
  async initialize(workletPath = 'audio/pitch-shifter-processor.js') {
    if (this.isInitialized) return;

    try {
      // Load the AudioWorklet module
      await this.audioContext.audioWorklet.addModule(workletPath);
      
      // Create the pitch shifter worklet node
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        'pitch-shifter-processor',
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        }
      );

      // Create input/output gain nodes for routing
      this.inputNode = this.audioContext.createGain();
      this.outputNode = this.audioContext.createGain();
      
      // Create dry/wet mix nodes
      this.dryGain = this.audioContext.createGain();
      this.wetGain = this.audioContext.createGain();
      
      // Set initial mix (full wet)
      this.dryGain.gain.value = 0;
      this.wetGain.gain.value = 1;

      // Connect the signal chain
      // Input -> Dry path -> Output
      this.inputNode.connect(this.dryGain);
      this.dryGain.connect(this.outputNode);
      
      // Input -> Pitch Shifter -> Wet path -> Output
      this.inputNode.connect(this.workletNode);
      this.workletNode.connect(this.wetGain);
      this.wetGain.connect(this.outputNode);

      this.isInitialized = true;
      console.log('PitchShifter initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize PitchShifter:', error);
      throw error;
    }
  }

  /**
   * Set pitch shift in semitones
   * @param {number} semitones - Number of semitones to shift (-12 to +12 typical range)
   */
  setSemitones(semitones) {
    if (!this.isInitialized) {
      console.warn('PitchShifter not initialized');
      return;
    }

    // Clamp to reasonable range
    semitones = Math.max(-24, Math.min(24, semitones));
    this.currentSemitones = semitones;

    // Send to worklet
    this.workletNode.port.postMessage({
      type: 'setSemitones',
      value: semitones
    });

    console.log(`Pitch shifted by ${semitones} semitones`);
  }

  /**
   * Set pitch ratio directly
   * @param {number} ratio - Pitch ratio (0.5 = octave down, 2.0 = octave up)
   */
  setPitchRatio(ratio) {
    if (!this.isInitialized) {
      console.warn('PitchShifter not initialized');
      return;
    }

    // Clamp to reasonable range
    ratio = Math.max(0.25, Math.min(4, ratio));
    this.currentSemitones = 12 * Math.log2(ratio);

    // Send to worklet
    this.workletNode.port.postMessage({
      type: 'setPitchRatio',
      value: ratio
    });
  }

  /**
   * Shift pitch up by given semitones from current
   */
  shiftUp(semitones = 1) {
    this.setSemitones(this.currentSemitones + semitones);
  }

  /**
   * Shift pitch down by given semitones from current
   */
  shiftDown(semitones = 1) {
    this.setSemitones(this.currentSemitones - semitones);
  }

  /**
   * Reset pitch to original (no shift)
   */
  reset() {
    this.setSemitones(0);
  }

  /**
   * Set dry/wet mix
   * @param {number} wetAmount - 0 = original, 1 = fully shifted
   */
  setMix(wetAmount) {
    wetAmount = Math.max(0, Math.min(1, wetAmount));
    this.mixRatio = wetAmount;
    
    if (this.dryGain && this.wetGain) {
      this.dryGain.gain.setValueAtTime(1 - wetAmount, this.audioContext.currentTime);
      this.wetGain.gain.setValueAtTime(wetAmount, this.audioContext.currentTime);
    }
  }

  /**
   * Toggle bypass mode
   */
  toggleBypass() {
    this.bypass = !this.bypass;
    this.setMix(this.bypass ? 0 : this.mixRatio);
    return this.bypass;
  }

  /**
   * Get the input node for connecting audio sources
   */
  getInputNode() {
    return this.inputNode;
  }

  /**
   * Get the output node for connecting to destination
   */
  getOutputNode() {
    return this.outputNode;
  }

  /**
   * Connect an audio source to the pitch shifter
   */
  connectSource(sourceNode) {
    sourceNode.connect(this.inputNode);
  }

  /**
   * Connect the pitch shifter to a destination
   */
  connectDestination(destinationNode) {
    this.outputNode.connect(destinationNode);
  }

  /**
   * Get current semitones value
   */
  getCurrentSemitones() {
    return this.currentSemitones;
  }

  /**
   * Get current pitch ratio
   */
  getCurrentPitchRatio() {
    return Math.pow(2, this.currentSemitones / 12);
  }

  /**
   * Dispose and clean up resources
   */
  dispose() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.inputNode) {
      this.inputNode.disconnect();
      this.inputNode = null;
    }
    if (this.outputNode) {
      this.outputNode.disconnect();
      this.outputNode = null;
    }
    if (this.dryGain) {
      this.dryGain.disconnect();
      this.dryGain = null;
    }
    if (this.wetGain) {
      this.wetGain.disconnect();
      this.wetGain = null;
    }
    this.isInitialized = false;
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PitchShifter;
}
```

---

## 3. Karaoke Audio Manager (karaoke-audio-manager.js)

```javascript
/**
 * KaraokeAudioManager - Complete audio management for karaoke extension
 * Handles media element capture and pitch shifting
 */
class KaraokeAudioManager {
  constructor() {
    this.audioContext = null;
    this.pitchShifter = null;
    this.mediaElementSource = null;
    this.currentMediaElement = null;
    this.isActive = false;
  }

  /**
   * Initialize the audio manager
   */
  async initialize() {
    // Create AudioContext
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Handle suspended context (Chrome autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Initialize pitch shifter
    this.pitchShifter = new PitchShifter(this.audioContext);
    await this.pitchShifter.initialize();

    // Connect pitch shifter to destination
    this.pitchShifter.connectDestination(this.audioContext.destination);

    console.log('KaraokeAudioManager initialized');
  }

  /**
   * Attach to a media element (audio or video)
   * @param {HTMLMediaElement} mediaElement - The audio/video element
   */
  attachToMediaElement(mediaElement) {
    if (!this.audioContext || !this.pitchShifter) {
      console.error('AudioManager not initialized');
      return false;
    }

    // Disconnect previous source if exists
    if (this.mediaElementSource) {
      this.mediaElementSource.disconnect();
    }

    try {
      // Create media element source
      this.mediaElementSource = this.audioContext.createMediaElementSource(mediaElement);
      this.currentMediaElement = mediaElement;

      // Connect to pitch shifter
      this.pitchShifter.connectSource(this.mediaElementSource);

      this.isActive = true;
      console.log('Attached to media element');
      return true;
      
    } catch (error) {
      console.error('Failed to attach to media element:', error);
      return false;
    }
  }

  /**
   * Auto-detect and attach to video/audio elements on page
   */
  autoAttach() {
    // Find video elements (YouTube, Vimeo, etc.)
    const video = document.querySelector('video');
    if (video) {
      return this.attachToMediaElement(video);
    }

    // Find audio elements
    const audio = document.querySelector('audio');
    if (audio) {
      return this.attachToMediaElement(audio);
    }

    console.warn('No media element found on page');
    return false;
  }

  /**
   * Set pitch in semitones
   */
  setPitch(semitones) {
    if (this.pitchShifter) {
      this.pitchShifter.setSemitones(semitones);
    }
  }

  /**
   * Increase pitch by semitones
   */
  pitchUp(semitones = 1) {
    if (this.pitchShifter) {
      this.pitchShifter.shiftUp(semitones);
    }
  }

  /**
   * Decrease pitch by semitones
   */
  pitchDown(semitones = 1) {
    if (this.pitchShifter) {
      this.pitchShifter.shiftDown(semitones);
    }
  }

  /**
   * Reset pitch to original
   */
  resetPitch() {
    if (this.pitchShifter) {
      this.pitchShifter.reset();
    }
  }

  /**
   * Get current pitch in semitones
   */
  getCurrentPitch() {
    return this.pitchShifter ? this.pitchShifter.getCurrentSemitones() : 0;
  }

  /**
   * Toggle bypass
   */
  toggleBypass() {
    return this.pitchShifter ? this.pitchShifter.toggleBypass() : false;
  }

  /**
   * Dispose all resources
   */
  dispose() {
    if (this.mediaElementSource) {
      this.mediaElementSource.disconnect();
      this.mediaElementSource = null;
    }
    if (this.pitchShifter) {
      this.pitchShifter.dispose();
      this.pitchShifter = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.isActive = false;
  }
}
```

---

## 4. Usage Example (content-script.js)

```javascript
// Content script for Chrome extension
let karaokeManager = null;

// Initialize on page load
async function initKaraoke() {
  karaokeManager = new KaraokeAudioManager();
  await karaokeManager.initialize();
  karaokeManager.autoAttach();
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'init':
      initKaraoke().then(() => sendResponse({ success: true }));
      return true; // async response
      
    case 'setPitch':
      karaokeManager?.setPitch(message.semitones);
      sendResponse({ pitch: karaokeManager?.getCurrentPitch() });
      break;
      
    case 'pitchUp':
      karaokeManager?.pitchUp(message.semitones || 1);
      sendResponse({ pitch: karaokeManager?.getCurrentPitch() });
      break;
      
    case 'pitchDown':
      karaokeManager?.pitchDown(message.semitones || 1);
      sendResponse({ pitch: karaokeManager?.getCurrentPitch() });
      break;
      
    case 'reset':
      karaokeManager?.resetPitch();
      sendResponse({ pitch: 0 });
      break;
      
    case 'getPitch':
      sendResponse({ pitch: karaokeManager?.getCurrentPitch() || 0 });
      break;
  }
});
```

---

## 5. Popup UI (popup.html)

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      width: 280px;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      text-align: center;
    }
    .pitch-display {
      font-size: 48px;
      font-weight: bold;
      text-align: center;
      margin: 20px 0;
      color: #1a73e8;
    }
    .pitch-label {
      text-align: center;
      color: #666;
      margin-bottom: 16px;
    }
    .controls {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .btn {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: none;
      font-size: 24px;
      cursor: pointer;
      transition: transform 0.1s;
    }
    .btn:active {
      transform: scale(0.95);
    }
    .btn-down { background: #ff6b6b; color: white; }
    .btn-up { background: #51cf66; color: white; }
    .btn-reset {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background: #868e96;
      color: white;
      cursor: pointer;
      font-size: 14px;
    }
    .slider-container {
      margin: 16px 0;
    }
    .slider {
      width: 100%;
      height: 8px;
      -webkit-appearance: none;
      background: #e9ecef;
      border-radius: 4px;
      outline: none;
    }
    .slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 20px;
      height: 20px;
      background: #1a73e8;
      border-radius: 50%;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="title">🎤 Karaoke Pitch</div>
  
  <div class="pitch-display" id="pitchValue">0</div>
  <div class="pitch-label">semitones</div>
  
  <div class="controls">
    <button class="btn btn-down" id="btnDown">−</button>
    <button class="btn btn-up" id="btnUp">+</button>
  </div>
  
  <div class="slider-container">
    <input type="range" class="slider" id="pitchSlider" 
           min="-12" max="12" value="0" step="1">
  </div>
  
  <button class="btn-reset" id="btnReset">Reset to Original Key</button>

  <script src="popup.js"></script>
</body>
</html>
```

---

## 6. Popup Script (popup.js)

```javascript
document.addEventListener('DOMContentLoaded', () => {
  const pitchDisplay = document.getElementById('pitchValue');
  const pitchSlider = document.getElementById('pitchSlider');
  const btnUp = document.getElementById('btnUp');
  const btnDown = document.getElementById('btnDown');
  const btnReset = document.getElementById('btnReset');

  // Get current tab and send message
  function sendMessage(action, data = {}) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action, ...data }, (response) => {
        if (response && response.pitch !== undefined) {
          updateDisplay(response.pitch);
        }
      });
    });
  }

  function updateDisplay(pitch) {
    pitchDisplay.textContent = pitch > 0 ? `+${pitch}` : pitch;
    pitchSlider.value = pitch;
    
    // Color coding
    if (pitch > 0) {
      pitchDisplay.style.color = '#51cf66';
    } else if (pitch < 0) {
      pitchDisplay.style.color = '#ff6b6b';
    } else {
      pitchDisplay.style.color = '#1a73e8';
    }
  }

  // Initialize
  sendMessage('init');
  sendMessage('getPitch');

  // Event listeners
  btnUp.addEventListener('click', () => {
    sendMessage('pitchUp', { semitones: 1 });
  });

  btnDown.addEventListener('click', () => {
    sendMessage('pitchDown', { semitones: 1 });
  });

  btnReset.addEventListener('click', () => {
    sendMessage('reset');
  });

  pitchSlider.addEventListener('input', (e) => {
    sendMessage('setPitch', { semitones: parseInt(e.target.value) });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      sendMessage('pitchUp', { semitones: 1 });
    } else if (e.key === 'ArrowDown') {
      sendMessage('pitchDown', { semitones: 1 });
    } else if (e.key === 'r' || e.key === 'R') {
      sendMessage('reset');
    }
  });
});
```

---

## 7. Manifest (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "Karaoke Pitch Shifter",
  "version": "1.0.0",
  "description": "Transpose pitch for karaoke by semitones",
  "permissions": ["activeTab", "scripting"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icon.png"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "audio/pitch-shifter.js",
        "audio/karaoke-audio-manager.js",
        "content-script.js"
      ]
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["audio/pitch-shifter-processor.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

---

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Semitone to Ratio** | `ratio = 2^(semitones/12)` |
| **Granular Synthesis** | Splits audio into small grains, resamples them |
| **AudioWorklet** | Runs DSP code in dedicated thread |
| **Overlap-Add** | Smoothly combines processed grains |
| **Hann Window** | Prevents clicks/artifacts at grain boundaries |

This implementation provides real-time pitch shifting without changing the tempo, which is essential for karaoke applications!





# Вопрос: Can you please explain all details of how logic works in simple words but with technical details?

# Ответ:
# Pitch Shifting Explained: From Theory to Code

## 1. What is Pitch Shifting?

### The Problem
When you play audio **faster**, the pitch goes **up** (like a chipmunk).
When you play audio **slower**, the pitch goes **down** (like a monster).

```
Normal speed:     🎵 Hello World 🎵
2x faster:        🎵 Hello World 🎵 (high pitch, chipmunk)
0.5x slower:      🎵 Hello World 🎵 (low pitch, monster)
```

### The Goal
We want to change pitch **WITHOUT** changing speed. This is called **pitch shifting**.

```
Original:         🎵 Hello World 🎵  (normal pitch, normal speed)
Pitch shifted:    🎵 Hello World 🎵  (higher pitch, SAME speed!)
```

---

## 2. The Math: Semitones to Frequency Ratio

### Musical Scale
In music, an **octave** has **12 semitones**. Each semitone is one piano key.

```
Piano Keys:  C  C#  D  D#  E  F  F#  G  G#  A  A#  B   C
Semitones:   0   1  2   3  4  5   6  7   8  9  10  11  12
                                                        ↑
                                                    One octave up
```

### The Formula

```javascript
pitchRatio = 2 ^ (semitones / 12)
```

### Examples

| Semitones | Calculation | Pitch Ratio | Meaning |
|-----------|-------------|-------------|---------|
| +12 | 2^(12/12) = 2^1 | 2.0 | One octave UP (double frequency) |
| +7 | 2^(7/12) | 1.498 | Perfect fifth UP |
| +1 | 2^(1/12) | 1.059 | One semitone UP |
| 0 | 2^(0/12) = 2^0 | 1.0 | No change |
| -1 | 2^(-1/12) | 0.944 | One semitone DOWN |
| -12 | 2^(-12/12) = 2^-1 | 0.5 | One octave DOWN (half frequency) |

### In Code

```javascript
// User wants +5 semitones
const semitones = 5;
const pitchRatio = Math.pow(2, semitones / 12);
// pitchRatio = 1.335 (play 1.335x faster to get higher pitch)
```

---

## 3. The Core Technique: Granular Synthesis

### The Idea
Instead of processing the whole audio at once, we:
1. **Cut** audio into tiny pieces called "grains"
2. **Process** each grain (make it faster/slower)
3. **Glue** them back together with overlap

```
Original Audio:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1 - Cut into grains:
[  Grain 1  ][  Grain 2  ][  Grain 3  ][  Grain 4  ]

Step 2 - Process each grain (resample):
[ Grain 1' ][ Grain 2' ][ Grain 3' ][ Grain 4' ]

Step 3 - Overlap and add:
[  Grain 1'  ]
      [  Grain 2'  ]
            [  Grain 3'  ]
                  [  Grain 4'  ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    Final Output
```

### Why Grains?
- If we just speed up audio, duration changes
- By using small grains with overlap, we maintain original duration
- Each grain is pitch-shifted, but we control how often we create new grains

---

## 4. Understanding the Buffers

### What is a Buffer?
A buffer is just an **array that stores audio samples**.

```javascript
// Audio is just numbers between -1.0 and +1.0
const audioBuffer = [0.0, 0.2, 0.5, 0.8, 0.5, 0.2, 0.0, -0.2, -0.5, ...];
```

### Circular Buffer
We use a **circular buffer** - when we reach the end, we wrap around to the beginning.

```
Imagine a clock:
                    12
               11        1
            10              2
            9                3
            8                4
               7         5
                    6

Writing position moves like clock hand:
Write at 0, 1, 2, 3... 11, then back to 0, 1, 2...
```

### In Code

```javascript
// Buffer of size 8
const buffer = new Float32Array(8);
let writePosition = 0;

function writeToBuffer(sample) {
    buffer[writePosition] = sample;
    writePosition = (writePosition + 1) % buffer.length;
    //              ↑ This wraps around: 7 + 1 = 8 % 8 = 0
}

// Writing 10 samples into buffer of size 8:
// Position: 0, 1, 2, 3, 4, 5, 6, 7, 0, 1 (wraps around!)
```

### Our Two Buffers

```
┌─────────────────────────────────────────────────────────┐
│                    INPUT BUFFER                         │
│  Stores incoming audio samples from microphone/file     │
│  [sample][sample][sample][sample][sample][sample]...    │
│     ↑                                                   │
│     New samples come in here                            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼ (Processing happens)
┌─────────────────────────────────────────────────────────┐
│                   OUTPUT BUFFER                         │
│  Stores processed (pitch-shifted) samples               │
│  [sample][sample][sample][sample][sample][sample]...    │
│                                           ↑             │
│                          We read from here to speakers  │
└─────────────────────────────────────────────────────────┘
```

---

## 5. The Hann Window: Preventing Clicks

### The Problem
When you cut audio abruptly, you get **clicks** and **pops**.

```
Audio wave:          /\    /\    /\
                    /  \  /  \  /  \
Cut here:          |    \/    \/    |
                   ↑                ↑
               CLICK!           CLICK!
    (sudden jump from 0 to middle of wave)
```

### The Solution: Fade In and Fade Out
We multiply each grain by a **window function** that smoothly fades in and out.

```
Hann Window Shape:
                    ╭────────╮
                  ╱            ╲
                ╱                ╲
              ╱                    ╲
            ╱                        ╲
──────────╱                            ╲──────────
         0                              1
      (start)                        (end)

Value at start: 0 (silent)
Value at middle: 1 (full volume)
Value at end: 0 (silent)
```

### The Math

```javascript
function createHannWindow(size) {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        // Cosine curve from 0 → 1 → 0
        window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
}
```

### Visual Example

```
Original grain:     ████████████████████████
                    ↑ Sudden start    Sudden end ↑

Hann window:        ▁▂▃▅▆███████████████▆▅▃▂▁
                    ↑ Fade in        Fade out ↑

After windowing:    ▁▂▃▅▆███████████████▆▅▃▂▁
                    Smooth!          Smooth!
```

---

## 6. Overlap-Add: Seamless Reconstruction

### The Problem with Windows
After applying the Hann window, the edges of each grain are quiet. If we just place grains end-to-end, we get volume dips:

```
Grain 1:    ▁▂▃▅▆███▆▅▃▂▁
Grain 2:                   ▁▂▃▅▆███▆▅▃▂▁
                       ↑
                   Volume dip! (both grains are quiet here)
```

### The Solution: Overlap
We overlap grains by 50% so when one grain fades out, another fades in:

```
Grain 1:    ▁▂▃▅▆███▆▅▃▂▁
Grain 2:          ▁▂▃▅▆███▆▅▃▂▁
Grain 3:                ▁▂▃▅▆███▆▅▃▂▁
            ─────────────────────────────
Sum:        ▂▄▆████████████████████████▆▄▂
            (Constant volume in the middle!)
```

### The Math
With 50% overlap and Hann windows:
```
Window1(t) + Window2(t) = 1.0 (constant!)
```

This is called **Constant Overlap-Add (COLA)**.

### In Code

```javascript
const grainSize = 2048;           // Size of each grain in samples
const overlapRatio = 0.5;         // 50% overlap
const hopSize = grainSize * (1 - overlapRatio);  // = 1024

// hopSize = how many samples between each new grain
// With 50% overlap: hopSize = grainSize / 2
```

---

## 7. Resampling: The Actual Pitch Shift

### The Key Idea
To change pitch without changing duration:
- **Read** from input buffer at a different speed
- **Write** to output buffer at normal speed

### Example: Pitch UP by 2x (one octave)

```
Input buffer (original):    [A][B][C][D][E][F][G][H]
                             0  1  2  3  4  5  6  7

Reading at 2x speed:
- Position 0: Read A
- Position 1: Read C (skip B)
- Position 2: Read E (skip D)  
- Position 3: Read G (skip F)

Output (higher pitch):      [A][C][E][G]

But wait! Now output is half the length!
```

### Fixing the Length Problem
We use the grain/overlap technique to maintain length:
1. Read grain at 2x speed (half the samples)
2. Stretch it back using overlap-add
3. Result: same length, higher pitch

### Linear Interpolation
What if we need to read at position 1.5 (between samples)?

```
Buffer:     [A][B][C][D]
Position:    0  1  2  3

We want value at position 1.5:
- Sample at 1: B = 0.3
- Sample at 2: C = 0.7
- Interpolated: 0.3 + 0.5 × (0.7 - 0.3) = 0.5
```

### In Code

```javascript
function interpolate(buffer, position) {
    const index = Math.floor(position);      // Integer part: 1
    const fraction = position - index;        // Decimal part: 0.5
    
    const sample1 = buffer[index];            // Value at position 1
    const sample2 = buffer[index + 1];        // Value at position 2
    
    // Linear interpolation formula
    return sample1 + fraction * (sample2 - sample1);
}

// Example:
// interpolate([0.1, 0.3, 0.7, 0.9], 1.5)
// = 0.3 + 0.5 * (0.7 - 0.3)
// = 0.3 + 0.5 * 0.4
// = 0.3 + 0.2
// = 0.5
```

---

## 8. The Complete Process: Step by Step

### Audio Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                        AUDIO PIPELINE                            │
└──────────────────────────────────────────────────────────────────┘

     ┌─────────┐      ┌─────────────┐      ┌─────────────┐
     │  Input  │      │   Pitch     │      │   Output    │
     │  Audio  │ ───▶ │   Shifter   │ ───▶ │   Audio     │
     │ (song)  │      │  Processor  │      │ (speakers)  │
     └─────────┘      └─────────────┘      └─────────────┘
                             │
                             ▼
                    ┌───────────────────┐
                    │  Inside Processor │
                    ├───────────────────┤
                    │ 1. Store input    │
                    │ 2. Create grains  │
                    │ 3. Resample       │
                    │ 4. Apply window   │
                    │ 5. Overlap-add    │
                    │ 6. Output result  │
                    └───────────────────┘
```

### Each Process Call (128 samples at a time)

```javascript
process(inputs, outputs) {
    // Browser gives us 128 samples at a time
    
    for (let i = 0; i < 128; i++) {
        // Step 1: Store incoming sample in input buffer
        this.inputBuffer[this.writePos] = inputs[0][0][i];
        this.writePos = (this.writePos + 1) % this.inputBuffer.length;
        
        // Step 2: Generate one output sample
        outputs[0][0][i] = this.generateOutputSample();
    }
    
    return true; // Keep processor alive
}
```

### Generating a Grain

```javascript
synthesizeGrain() {
    // For each sample in the grain...
    for (let i = 0; i < this.grainSize; i++) {
        
        // Step 1: Calculate where to READ from (with pitch shift)
        const sourcePosition = i * this.pitchRatio;
        // If pitchRatio = 2: read positions 0, 2, 4, 6... (skipping)
        // If pitchRatio = 0.5: read positions 0, 0.5, 1, 1.5... (interpolating)
        
        // Step 2: Read sample with interpolation
        const sample = this.interpolate(this.inputBuffer, sourcePosition);
        
        // Step 3: Apply Hann window
        const windowedSample = sample * this.hannWindow[i];
        
        // Step 4: Add to output buffer (overlap-add)
        const outputPosition = (this.outputWritePos + i) % this.outputBuffer.length;
        this.outputBuffer[outputPosition] += windowedSample;
    }
}
```

---

## 9. Visual Timeline Example

### Shifting UP by 2 semitones

```
Time:           0ms    10ms    20ms    30ms    40ms    50ms

INPUT AUDIO:    ▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃
                (Original wave - let's say 440 Hz = Note A)

GRAIN 1:        [▁▃▅▇█▇▅▃▁▃▅▇]
                 Read at 1.12x ──▶ [compressed grain]
                 Apply window  ──▶ [▁▂▅██▇▅▃▂▁]
                 
GRAIN 2:              [▁▃▅▇█▇▅▃▁▃▅▇]
                       Read at 1.12x ──▶ [compressed grain]
                       Apply window  ──▶ [▁▂▅██▇▅▃▂▁]
                       
OVERLAP-ADD:    [▁▂▅██▇▅▃▂▁]
                      [▁▂▅██▇▅▃▂▁]
                            [▁▂▅██▇▅▃▂▁]
                ─────────────────────────────────────────
OUTPUT AUDIO:   ▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃
                (Same duration, but now 493.88 Hz = Note B!)
                
RESULT:         Pitch increased by 2 semitones (A → B)
                Duration unchanged!
```

---

## 10. Parameter Tuning

### Grain Size

| Size | Pros | Cons | Best For |
|------|------|------|----------|
| Small (512) | Less latency | More artifacts | Real-time voice |
| Medium (2048) | Balanced | Balanced | General music |
| Large (4096) | Better quality | More latency | Offline processing |

### Overlap Ratio

| Ratio | Hop Size | Quality | CPU Usage |
|-------|----------|---------|-----------|
| 0.25 | 75% of grain | Lower | Lower |
| 0.50 | 50% of grain | Good | Medium |
| 0.75 | 25% of grain | Best | Higher |

---

## 11. Common Issues and Solutions

### Problem 1: "Metallic" or "Robotic" Sound

```
Cause:    Grain size too small
Solution: Increase grain size

this.grainSize = 4096; // Instead of 2048
```

### Problem 2: Audio Delay (Latency)

```
Cause:    Grain size too large
Solution: Decrease grain size, accept some quality loss

this.grainSize = 1024; // For lower latency
```

### Problem 3: Volume Fluctuations

```
Cause:    Improper overlap ratio
Solution: Use 50% overlap with Hann window

this.overlapRatio = 0.5;
// Hann windows at 50% overlap sum to constant volume
```

### Problem 4: Clicks and Pops

```
Cause:    Missing or incorrect window function
Solution: Verify Hann window is applied correctly

// WRONG - no window
outputBuffer[i] = inputSample;

// CORRECT - with window
outputBuffer[i] = inputSample * hannWindow[i];
```

---

## 12. Summary Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                    PITCH SHIFTING SUMMARY                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   INPUT                    PROCESSING                    OUTPUT        │
│   ─────                    ──────────                    ──────        │
│                                                                        │
│   Audio    ──────▶   ┌──────────────────────┐   ──────▶   Audio       │
│   Samples           │  1. Fill input buffer  │            Samples     │
│                     │  2. Extract grain       │                        │
│   44100             │  3. Resample by ratio   │            44100       │
│   samples/sec       │  4. Apply Hann window   │            samples/sec │
│                     │  5. Overlap-add output  │                        │
│                     │  6. Read output sample  │                        │
│                     └──────────────────────┘                          │
│                                                                        │
│   ┌─────────────────────────────────────────────────────────────┐     │
│   │                      KEY FORMULA                             │     │
│   │                                                              │     │
│   │         pitchRatio = 2 ^ (semitones / 12)                   │     │
│   │                                                              │     │
│   │   Examples:                                                  │     │
│   │   • +12 semitones = 2.0x (one octave up)                    │     │
│   │   • +1 semitone   = 1.059x                                  │     │
│   │   • -12 semitones = 0.5x (one octave down)                  │     │
│   └─────────────────────────────────────────────────────────────┘     │
│                                                                        │
│   ┌─────────────────────────────────────────────────────────────┐     │
│   │                    WHY IT WORKS                              │     │
│   │                                                              │     │
│   │   • Resampling changes pitch but also changes duration      │     │
│   │   • Granular synthesis: process tiny chunks independently   │     │
│   │   • Overlap-add: reconstruct without changing total time    │     │
│   │   • Hann window: smooth transitions, no clicks              │     │
│   └─────────────────────────────────────────────────────────────┘     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

This is how karaoke machines let you change the key of any song to match your vocal range!


