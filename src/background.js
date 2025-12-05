importScripts("config.js")

const offscreenDocPath = 'src/offscreen.html';

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const result = await chrome.storage.local.get([config.storageKeyForCurrentTabId]);
  console.log("Background: On tab closing");
  console.log("Closing tab: ", tabId, "Cached tab in storage: ", result);
  const currentTabId = result[config.storageKeyForCurrentTabId];
  if (currentTabId != null && currentTabId === tabId) {
    await chrome.storage.local.set({ [config.storageKeyForCurrentTabId]: -1 });
    await handleStopKaraoke();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'start-karaoke') {
    handleStartKaraoke(message.tabId, message.settings)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'stop-karaoke') {
    handleStopKaraoke(message.tabId)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.type === 'update-settings') {
    // Forward to offscreen
    chrome.runtime.sendMessage(message);
    sendResponse({ success: true });
    return false;
  }
  
  // Проверка на наличие уже существующих/созданных offscreen документов
  if (message.type === 'get-current-state'){
    const existingContexts = chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    existingContexts
        .then(existingContexts => {sendResponse({success: existingContexts.length > 0})})
        .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  return false;
});

async function handleStartKaraoke(tabId, settings) {
  try {
    // Get stream ID for the tab
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });
    
    // Create offscreen document if needed
    await setupOffscreenDocument();
    
    // Start processing in offscreen document
    const response = await chrome.runtime.sendMessage({
      type: 'start-processing',
      target: 'offscreen',
      streamId: streamId,
      settings: settings
    });
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to start processing');
    }
    
    // Mute the original tab audio
    await chrome.tabs.update(tabId, { muted: true });
    
    return { success: true };
  } catch (error) {
    console.error('Start karaoke error:', error);
    throw error;
  }
}

/** @param {value|null} tabId */
async function handleStopKaraoke(tabId) {
  try {
    // Stop processing
    await chrome.runtime.sendMessage({
      type: 'stop-processing',
      target: 'offscreen'
    });
    
    if(tabId != null){
      await chrome.tabs.update(tabId, { muted: false });
    }

    try{ await chrome.offscreen.closeDocument(); }
    catch(e){}  // если созданного документа нет, выдастся ошибка
    
    return { success: true };
  } catch (error) {
    console.error('Stop karaoke error:', error);
    throw error;
  }
}

async function setupOffscreenDocument() {
  // Check if already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  
  if (existingContexts.length > 0) {return;}
  
  // Create offscreen document
  await chrome.offscreen.createDocument({
    url: offscreenDocPath,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Process tab audio for karaoke vocal removal'
  });
}