const storageKeyForCurrentTabId = config.storageKeyForCurrentTabId;
const storageKeyForSettings = config.storageKeyForSettings;
const storageKeyForCustomPresets = config.storageKeyForCustomPresets;
let isEnabled = false;

//#region DOM ELEMENTS
const elements = {
  // Core
  toggleBtn: document.getElementById('toggleBtn'),
  status: document.getElementById('status'),
  currentTabTitle: document.getElementById('currentTabTitle'),
  controls: document.getElementById('controls'),

  // Main sliders
  midSlider: document.getElementById('midSlider'),
  midValue: document.getElementById('midValue'),
  
  sideSlider: document.getElementById('sideSlider'),
  sideValue: document.getElementById('sideValue'),
  
  volumeSlider: document.getElementById('volumeSlider'),
  volumeValue: document.getElementById('volumeValue'),

  // Vocal targeting
  notchesLevelSlider: document.getElementById('notchesLevelSlider'),
  notchesLevelValue: document.getElementById('notchesLevelValue'),
  
  notch1FreqSlider: document.getElementById('notch1FreqSlider'),
  notch1FreqValue: document.getElementById('notch1FreqValue'),
  
  notch1GainSlider: document.getElementById('notch1GainSlider'),
  notch1GainValue: document.getElementById('notch1GainValue'),
  
  notch1QSlider: document.getElementById('notch1QSlider'),
  notch1QValue: document.getElementById('notch1QValue'),

  notch1FreqHint: document.getElementById('notch1FreqHint'),
  
  notch2FreqSlider: document.getElementById('notch2FreqSlider'),
  notch2FreqValue: document.getElementById('notch2FreqValue'),
  
  notch2GainSlider: document.getElementById('notch2GainSlider'),
  notch2GainValue: document.getElementById('notch2GainValue'),
  
  notch2QSlider: document.getElementById('notch2QSlider'),
  notch2QValue: document.getElementById('notch2QValue'),

  notch2FreqHint: document.getElementById('notch2FreqHint'),
  
  notch3FreqSlider: document.getElementById('notch3FreqSlider'),
  notch3FreqValue: document.getElementById('notch3FreqValue'),
  
  notch3GainSlider: document.getElementById('notch3GainSlider'),
  notch3GainValue: document.getElementById('notch3GainValue'),
  
  notch3QSlider: document.getElementById('notch3QSlider'),
  notch3QValue: document.getElementById('notch3QValue'),

  notch3FreqHint: document.getElementById('notch3FreqHint'),
  
  // High-pass, пока решено было избавиться, см. заметки
  // midHPSlider: document.getElementById('midHPSlider'),
  // midHPValue: document.getElementById('midHPValue'),
  //
  // sideHPSlider: document.getElementById('sideHPSlider'),
  // sideHPValue: document.getElementById('sideHPValue'),

  // EQ
  bassSlider: document.getElementById('bassSlider'),
  bassValue: document.getElementById('bassValue'),
  
  bassFreqSlider: document.getElementById('bassFreqSlider'),
  bassFreqValue: document.getElementById('bassFreqValue'),
  
  trebleSlider: document.getElementById('trebleSlider'),
  trebleValue: document.getElementById('trebleValue'),
  
  trebleFreqSlider: document.getElementById('trebleFreqSlider'),
  trebleFreqValue: document.getElementById('trebleFreqValue'),

  // Advanced
  limiterSlider: document.getElementById('limiterSlider'),
  limiterValue: document.getElementById('limiterValue'),
  
  crossfadeSlider: document.getElementById('crossfadeSlider'),
  crossfadeValue: document.getElementById('crossfadeValue'),
  
  // Custom presets
  customPresetName: document.getElementById('customPresetName'),
  customPresetSelect: document.getElementById('customPresetSelect'),
  savePresetBtn: document.getElementById('savePresetBtn'),
  loadPresetBtn: document.getElementById('loadPresetBtn'),
  deletePresetBtn: document.getElementById('deletePresetBtn')
};
//#endregion

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  initializeSectionToggles();
  initializeSliders();
  initializePresets();
  loadSavedState();
  loadCustomPresets();
});

// SECTION TOGGLES
function initializeSectionToggles() {
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      const sectionName = header.dataset.section;
      const content = document.getElementById(`section-${sectionName}`);
      const toggle = header.querySelector('.section-toggle');

      if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        toggle.textContent = '−';
      } else {
        content.classList.add('collapsed');
        toggle.textContent = '+';
      }
    });
  });
}

//#region SLIDER SETUP
function initializeSliders() {
  // Main controls
  setupSlider('mid', '%');
  setupSlider('side', '%');
  setupSlider('volume', '%');

  setupSlider('notchesLevel', '%')
  
  // Vocal notch 1
  setupSlider('notch1Freq', '', updateNotch1Hint);
  setupSlider('notch1Gain', '%');
  setupSlider('notch1Q', '', (qValStr) => {
    updateNotch1Hint(elements.notch1FreqSlider.value);
    return formatQ(qValStr);
  });

  // Vocal notch 2
  setupSlider('notch2Freq', '', updateNotch2Hint);
  setupSlider('notch2Gain', '%');
  setupSlider('notch2Q', '', (qValStr) => {
    updateNotch2Hint(elements.notch2FreqSlider.value);
    return formatQ(qValStr);
  });

  // Vocal notch 3
  setupSlider('notch3Freq', '', updateNotch3Hint);
  setupSlider('notch3Gain', '%');
  setupSlider('notch3Q', '', (qValStr) => {
    updateNotch3Hint(elements.notch3FreqSlider.value);
    return formatQ(qValStr);
  });

  // High-pass, пока решено было избавиться, см. заметки
  // setupSlider('midHP', ' Hz');
  // setupSlider('sideHP', ' Hz');

  // EQ
  setupSlider('bass', '%');
  setupSlider('bassFreq', ' Hz');
  setupSlider('treble', ' dB');
  setupSlider('trebleFreq', ' Hz');

  // Advanced
  setupSlider('limiter', ' dB');
  setupSlider('crossfade', ' ms');
}

function setupSlider(name, suffix, formatter) {
  const slider = elements[`${name}Slider`];
  const valueDisplay = elements[`${name}Value`];

  if (!slider || !valueDisplay) return;

  slider.addEventListener('input', () => {
    const value = slider.value;

    if (formatter) {
      valueDisplay.textContent = formatter(value);
    } else {
      valueDisplay.textContent = value + suffix;
    }

    sendSettings();
    saveSettings();
  });
}

function getNormalizedNotchQValue(value){
  return value / 10
}

function formatQ(qValStr){
  const parsedQ = parseFloat(qValStr);
  return (getNormalizedNotchQValue(parsedQ)).toFixed(1);
}


function updateNotch1Hint(freqValueStr) {
  const qVal = getNormalizedNotchQValue(parseFloat(elements.notch1QSlider.value));
  let {leftFreq, rightFreq} = calculateNotchQFreqRange(parseFloat(freqValueStr), qVal);
  leftFreq = Math.max(0, leftFreq);
  rightFreq = Math.min(20000, rightFreq);
  elements.notch1FreqHint.textContent = `${leftFreq.toFixed(1)}-${rightFreq.toFixed(1)} Hz`;
  return freqValueStr;
}

function updateNotch2Hint(freqValueStr) {
  const qVal = getNormalizedNotchQValue(parseFloat(elements.notch2QSlider.value));
  let {leftFreq, rightFreq} = calculateNotchQFreqRange(parseFloat(freqValueStr), qVal);
  leftFreq = Math.max(0, leftFreq);
  rightFreq = Math.min(20000, rightFreq);
  elements.notch2FreqHint.textContent = `${leftFreq.toFixed(1)}-${rightFreq.toFixed(1)} Hz`;
  return freqValueStr;
}

function updateNotch3Hint(freqValueStr) {
  const qVal = getNormalizedNotchQValue(parseFloat(elements.notch3QSlider.value));
  let {leftFreq, rightFreq} = calculateNotchQFreqRange(parseFloat(freqValueStr), qVal);
  leftFreq = Math.max(0, leftFreq);
  rightFreq = Math.min(20000, rightFreq);
  const gain = elements.notch3GainSlider.value;
  elements.notch3FreqHint.textContent = gain > 0 ? freqValueStr + `${leftFreq.toFixed(1)}-${rightFreq.toFixed(1)} Hz` : 'Off';
  return freqValueStr;
}

// См. заметки относительно того как работает Q при вызове createBiquadFilter()
function calculateNotchQFreqRange(freq, q){
  const leftRightStep = freq / q / 2;
  return {leftFreq: freq - leftRightStep, rightFreq: freq + leftRightStep};
}
//#endregion

//#region TOGGLE BUTTON
elements.toggleBtn.addEventListener('click', async () => {
  try {
    if (!isEnabled) {
      elements.status.textContent = 'Starting...';
      elements.status.classList.remove('error', 'active');

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        throw new Error('No active tab found');
      }

      elements.currentTabTitle.textContent = tab.title;
      chrome.storage.local.set({ [storageKeyForCurrentTabId]: tab.id });

      const response = await chrome.runtime.sendMessage({
        type: 'start-karaoke',
        tabId: tab.id,
        settings: getSettings()
      });

      if (response.success) {
        setEnabledState(true);
      } else {
        throw new Error(response.error || 'Failed to start');
      }
    } 
    else {
      let tab;
      try{
        const result = await chrome.storage.local.get([storageKeyForCurrentTabId]);
        const currentTabId = result[storageKeyForCurrentTabId];
        if(currentTabId == null || currentTabId === -1) tab = null;
        else tab = await chrome.tabs.get(currentTabId);
      }
      /* Ошибку может выкинуть "chrome.tabs.get(currentTabId)" если не найдет вкладку с переданным id
         В теории это означает что вкладка была закрыта и мы выключаем караоке через UI popup-а, однако такого не может быть т.к. при закрытии вкладки background.js уже должен был обновить currentTabId на -1
      */
      catch (e){ 
        console.warn("Неожиданное исключение, читать комментарий");
        tab = null; 
      }
      
      await chrome.runtime.sendMessage({ 
        type: 'stop-karaoke',
        tabId: tab?.id,
      });
      
      elements.currentTabTitle.textContent = "-";
      chrome.storage.local.set({ [storageKeyForCurrentTabId]: -1 });
      
      setEnabledState(false);
    }
  } catch (error) {
    elements.status.textContent = 'Error: ' + error.message;
    elements.status.classList.add('error');
    console.error(error);
  }
});

function setEnabledState(enabled) {
  isEnabled = enabled;

  if (enabled) {
    elements.toggleBtn.textContent = 'Disable Karaoke';
    elements.toggleBtn.classList.add('active');
    elements.status.textContent = '🎵 Karaoke Mode Active';
    elements.status.classList.add('active');
    elements.status.classList.remove('error');
    elements.controls.classList.add('visible');
  } else {
    elements.toggleBtn.textContent = 'Enable Karaoke';
    elements.toggleBtn.classList.remove('active');
    elements.status.textContent = 'Ready';
    elements.status.classList.remove('active', 'error');
    elements.controls.classList.remove('visible');
  }
}
//#endregion

//#region SETTINGS
function getSettings() {
  return {
    // Main
    // Center channel level (0 = no center, 1 = full)
    mid: parseFloat(elements.midSlider.value) / 100,
    // Side channel level (stereo width)
    side: parseFloat(elements.sideSlider.value) / 100,
    // Master output volume
    volume: parseFloat(elements.volumeSlider.value) / 100,

    // Vocal notch filters (3 parametric EQs on the Mid channel)
    notchesLevel: parseFloat(elements.notchesLevelSlider.value) / 100,
    // Notch 1 center frequency (Hz)
    notch1Freq: parseFloat(elements.notch1FreqSlider.value),
    // Notch 1 depth (0-1, converted to -15dB max)
    notch1Gain: parseFloat(elements.notch1GainSlider.value) / 100,
    // Notch 1 width (Q factor)
    notch1Q: getNormalizedNotchQValue(parseFloat(elements.notch1QSlider.value)),
    notch2Freq: parseFloat(elements.notch2FreqSlider.value),
    notch2Gain: parseFloat(elements.notch2GainSlider.value) / 100,
    notch2Q: getNormalizedNotchQValue(parseFloat(elements.notch2QSlider.value)),
    notch3Freq: parseFloat(elements.notch3FreqSlider.value),
    notch3Gain: parseFloat(elements.notch3GainSlider.value) / 100,
    notch3Q: getNormalizedNotchQValue(parseFloat(elements.notch3QSlider.value)),

    // High-pass, пока решено было избавиться, см. заметки
    // Mid channel high-pass frequency (Hz)
    //midHP: parseFloat(elements.midHPSlider.value),
    // Side channel high-pass frequency (Hz)
    //sideHP: parseFloat(elements.sideHPSlider.value),

    // EQ
    // Bass boost amount (0-1, converted to +18dB max)
    bass: parseFloat(elements.bassSlider.value) / 100,
    // Bass shelf frequency (Hz)
    bassFreq: parseFloat(elements.bassFreqSlider.value),
    // Treble adjustment (dB, -12 to +12)
    treble: parseFloat(elements.trebleSlider.value),
    // Treble shelf frequency (Hz)
    trebleFreq: parseFloat(elements.trebleFreqSlider.value),

    // Advanced
    // Limiter threshold (dB)
    limiterThreshold: parseFloat(elements.limiterSlider.value),
    // Parameter change smoothing (seconds)
    crossfadeTime: parseFloat(elements.crossfadeSlider.value) / 1000
  };
}

function sendSettings() {
  if (!isEnabled) return;

  chrome.runtime.sendMessage({
    type: 'update-settings',
    settings: getSettings()
  });
}

function prepareSettingsObjectWithCurrentValues(){
  return settings = {
    mid: elements.midSlider.value,
    side: elements.sideSlider.value,
    volume: elements.volumeSlider.value,
    notchesLevel: elements.notchesLevelSlider.value,
    notch1Freq: elements.notch1FreqSlider.value,
    notch1Gain: elements.notch1GainSlider.value,
    notch1Q: elements.notch1QSlider.value,
    notch2Freq: elements.notch2FreqSlider.value,
    notch2Gain: elements.notch2GainSlider.value,
    notch2Q: elements.notch2QSlider.value,
    notch3Freq: elements.notch3FreqSlider.value,
    notch3Gain: elements.notch3GainSlider.value,
    notch3Q: elements.notch3QSlider.value,
    // midHP: elements.midHPSlider.value,   // пока решено было избавиться, см. заметки
    // sideHP: elements.sideHPSlider.value, // пока решено было избавиться, см. заметки
    bass: elements.bassSlider.value,
    bassFreq: elements.bassFreqSlider.value,
    treble: elements.trebleSlider.value,
    trebleFreq: elements.trebleFreqSlider.value,
    limiter: elements.limiterSlider.value,
    crossfade: elements.crossfadeSlider.value
  };
}

function saveSettings() {
  const settings = prepareSettingsObjectWithCurrentValues();
  chrome.storage.local.set({ [storageKeyForSettings]: settings });
}

/* Просто сохранять и забирать состояние караоке (включен/выключен) из Local storage не выйдет, т.к. при такой логике при включении караоке (в popup) в Local storage положится "true", а затем при закрытии и открытии браузера (но без прожатия кнопки Disable в UI караоке)
   из Local storage при первичном открытии popup-а (после перезапуска браузера) возьмется "true", что неправильно, т.к. при перезапуске браузера вся offscreen логика соотв. будет выгружена. Поэтому лучше всегда образаться к background скрипту и просить его проверить
   наличие существующих загруженных offscreen документов
*/
async function loadSavedState() {
  const response = await chrome.runtime.sendMessage({type: 'get-current-state'});
  if (response.success){
    setEnabledState(true);
    chrome.storage.local.get([storageKeyForCurrentTabId], async (result) => {
      const currentTabId = result[storageKeyForCurrentTabId];
      if(currentTabId != null && currentTabId > -1) {
        try{
          const tab = await chrome.tabs.get(currentTabId);
          elements.currentTabTitle.textContent = tab.title
        }
        /* Значит не удалось найти вкладку, и такого не должно быть, т.к. когда пользователь закрывает вкладку, background.js реагирует на событие и выключает караоке освобождая ресурсы, а соотв. "response.success" должен был вернуть false
           Такое гипотетически может быть если сразу же после открытия popup (в кот. уже включено караоке) в тот же момент закрыть текущую вкладку, тогда в теории обработка закрытия вкладки (событие) в background.js может успеть поставиться в очередь, 
           и она выполнится сразу же после того как он вернет тут true в "response.success". Как никак Service worker работает в отдельном потоке
        */
        catch(e){
          console.warn("Неожиданное исключение, читать комментарий");
          chrome.storage.local.set({ [storageKeyForCurrentTabId]: -1 });
        }
      }
    });
  }
  
  chrome.storage.local.get([storageKeyForSettings], (result) => {
    if (result.settings) {
      applySettingsToUI(result.settings);
    }
    // При самом первом открытии popup-а (и плагина в общем) когда Storage еще пустой
    else {
      applySettingsToUI(builtInPresets.default);
      saveSettings();
    }
  });
}

function applySettingsToUI(settings) {
  Object.keys(settings).forEach(key => {
    const slider = elements[`${key}Slider`];
    const value = elements[`${key}Value`];

    if (slider && value) {
      slider.value = settings[key];

      // Update display based on type
      if (key.includes('Freq') && !key.includes('bass') && !key.includes('treble')) {
        value.textContent = settings[key];
      } else if (key.includes('Q')) {
        value.textContent = (settings[key] / 10).toFixed(1);
      } else if (key.includes('HP') || key === 'bassFreq' || key === 'trebleFreq') {
        value.textContent = settings[key] + ' Hz';
      } else if (key === 'treble' || key === 'limiter') {
        value.textContent = settings[key] + ' dB';
      } else if (key === 'crossfade') {
        value.textContent = settings[key] + ' ms';
      } else {
        value.textContent = settings[key] + '%';
      }
    }
  });

  // Update hints
  updateNotch1Hint(settings.notch1Freq);
  updateNotch2Hint(settings.notch2Freq);
  updateNotch3Hint(settings.notch3Freq);
}
//#endregion

//#region BUILT-IN PRESETS
const builtInPresets = {
  default:{
    mid: 100, side: 105, volume: 100,
    notchesLevel: 100,
    notch1Freq: 1500, notch1Gain: 100, notch1Q: 15,
    notch2Freq: 3000, notch2Gain: 100, notch2Q: 15,
    notch3Freq: 5000, notch3Gain: 0, notch3Q: 15,
    // midHP: 0, sideHP: 0,  пока решено было избавиться, см. заметки
    bass: 0, bassFreq: 150, treble: 0, trebleFreq: 4000,
    limiter: -3, crossfade: 50
  },
  chineseKaraoke:{
    mid: 50, side: 100, volume: 100,
    notchesLevel: 100,
    notch1Freq: 1500, notch1Gain: 100, notch1Q: 10,
    notch2Freq: 2500, notch2Gain: 100, notch2Q: 10,
    notch3Freq: 5000, notch3Gain: 0, notch3Q: 15,
    // midHP: 0, sideHP: 0,  пока решено было избавиться, см. заметки
    bass: 50, bassFreq: 150, treble: 3, trebleFreq: 4000,
    limiter: -3, crossfade: 50
  },
  femaleVocal: {
    mid: 100, side: 105, volume: 100,
    notchesLevel: 100,
    notch1Freq: 1800, notch1Gain: 100, notch1Q: 12,
    notch2Freq: 3500, notch2Gain: 100, notch2Q: 12,
    notch3Freq: 5500, notch3Gain: 25, notch3Q: 15,
    // midHP: 130, sideHP: 80,  пока решено было избавиться, см. заметки
    bass: 0, bassFreq: 150, treble: 0, trebleFreq: 4500,
    limiter: -3, crossfade: 50
  },
  // Пресеты от Claude, весьма специфичны, пока необходимости нет 
  // karaoke: {
  //   mid: 15, side: 100, volume: 100,
  //   notchesLevel: 100,
  //   notch1Freq: 1500, notch1Gain: 30, notch1Q: 15,
  //   notch2Freq: 3000, notch2Gain: 25, notch2Q: 15,
  //   notch3Freq: 5000, notch3Gain: 0, notch3Q: 15,
  //   // midHP: 120, sideHP: 80,  пока решено было избавиться, см. заметки
  //   bass: 40, bassFreq: 150, treble: 0, trebleFreq: 4000,
  //   limiter: -3, crossfade: 50
  // },
  // softVocal: {
  //   mid: 40, side: 100, volume: 100,
  //   notchesLevel: 100,
  //   notch1Freq: 1500, notch1Gain: 15, notch1Q: 10,
  //   notch2Freq: 3000, notch2Gain: 10, notch2Q: 10,
  //   notch3Freq: 5000, notch3Gain: 0, notch3Q: 15,
  //   // midHP: 100, sideHP: 60,  пока решено было избавиться, см. заметки
  //   bass: 20, bassFreq: 150, treble: 0, trebleFreq: 4000,
  //   limiter: -3, crossfade: 50
  // },
  // hardVocal: {
  //   mid: 5, side: 110, volume: 100,
  //   notchesLevel: 100,
  //   notch1Freq: 1200, notch1Gain: 50, notch1Q: 12,
  //   notch2Freq: 2500, notch2Gain: 45, notch2Q: 12,
  //   notch3Freq: 4000, notch3Gain: 30, notch3Q: 15,
  //   // midHP: 150, sideHP: 80,  пока решено было избавиться, см. заметки
  //   bass: 55, bassFreq: 150, treble: 2, trebleFreq: 4000,
  //   limiter: -3, crossfade: 50
  // },
  // instrumental: {
  //   mid: 0, side: 120, volume: 100,
  //   notchesLevel: 100,
  //   notch1Freq: 1500, notch1Gain: 60, notch1Q: 10,
  //   notch2Freq: 3000, notch2Gain: 50, notch2Q: 10,
  //   notch3Freq: 5000, notch3Gain: 20, notch3Q: 15,
  //   // midHP: 180, sideHP: 80,  пока решено было избавиться, см. заметки
  //   bass: 60, bassFreq: 150, treble: 3, trebleFreq: 4000,
  //   limiter: -3, crossfade: 50
  // },
  // wideStereo: {
  //   mid: 50, side: 150, volume: 100,
  //   notchesLevel: 100,
  //   notch1Freq: 1500, notch1Gain: 20, notch1Q: 15,
  //   notch2Freq: 3000, notch2Gain: 15, notch2Q: 15,
  //   notch3Freq: 5000, notch3Gain: 0, notch3Q: 15,
  //   // midHP: 100, sideHP: 60,  пока решено было избавиться, см. заметки
  //   bass: 25, bassFreq: 150, treble: 2, trebleFreq: 4000,
  //   limiter: -3, crossfade: 50
  // },
  reset: {
    mid: 100, side: 100, volume: 100,
    notchesLevel: 100,
    notch1Freq: 1500, notch1Gain: 0, notch1Q: 15,
    notch2Freq: 3000, notch2Gain: 0, notch2Q: 15,
    notch3Freq: 5000, notch3Gain: 0, notch3Q: 15,
    // midHP: 20, sideHP: 20, пока решено было избавиться, см. заметки
    bass: 0, bassFreq: 150, treble: 0, trebleFreq: 4000,
    limiter: -3, crossfade: 50
  }
};

function initializePresets() {
  document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetName = btn.dataset.preset;
      const preset = builtInPresets[presetName];

      if (preset) {
        applySettingsToUI(preset);
        sendSettings();
        saveSettings();

        // Visual feedback
        btn.style.transform = 'scale(0.95)';
        setTimeout(() => {
          btn.style.transform = '';
        }, 100);
      }
    });
  });
}
//#endregion

//#region CUSTOM PRESETS
function loadCustomPresets() {
  chrome.storage.local.get([storageKeyForCustomPresets], (result) => {
    const presets = result.customPresets || {};
    updateCustomPresetDropdown(presets);
  });
}

function updateCustomPresetDropdown(presets) {
  const select = elements.customPresetSelect;
  select.innerHTML = '<option value="">-- Select Custom Preset --</option>';

  Object.keys(presets).forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
}

elements.savePresetBtn.addEventListener('click', () => {
  const name = elements.customPresetName.value.trim();

  if (!name) {
    alert('Please enter a preset name');
    return;
  }

  const currentSettings = prepareSettingsObjectWithCurrentValues();

  chrome.storage.local.get([storageKeyForCustomPresets], (result) => {
    const presets = result.customPresets || {};
    presets[name] = currentSettings;

    chrome.storage.local.set({ [storageKeyForCustomPresets]: presets }, () => {
      updateCustomPresetDropdown(presets);
      elements.customPresetName.value = '';
      elements.customPresetSelect.value = name;
    });
  });
});

elements.loadPresetBtn.addEventListener('click', () => {
  const name = elements.customPresetSelect.value;

  if (!name) {
    alert('Please select a preset to load');
    return;
  }

  chrome.storage.local.get([storageKeyForCustomPresets], (result) => {
    const presets = result.customPresets || {};
    const preset = presets[name];

    if (preset) {
      applySettingsToUI(preset);
      sendSettings();
      saveSettings();
    }
  });
});

elements.deletePresetBtn.addEventListener('click', () => {
  const name = elements.customPresetSelect.value;

  if (!name) {
    alert('Please select a preset to delete');
    return;
  }

  if (confirm(`Delete preset "${name}"?`)) {
    chrome.storage.local.get([storageKeyForCustomPresets], (result) => {
      const presets = result.customPresets || {};
      delete presets[name];

      chrome.storage.local.set({ [storageKeyForCustomPresets]: presets }, () => {
        updateCustomPresetDropdown(presets);
      });
    });
  }
});
//#endregion