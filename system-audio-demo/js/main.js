'use strict';

/**
 * TODO: Ensure that a device selection is maintained after a device is added or removed.
 * TODO: Check that a device can be changed while recording is ongoing.
 */

const audioOutputSelect = document.getElementById('audio-output');
const gdmOptionsDiv = document.getElementById('gdm-options');
const gdmTrackDiv = document.getElementById('gdm-track');
const gdmButton = document.getElementById('gdm');
const gdmLocalAudioPlaybackCheckbox = document.getElementById('gdm-local-audio-playback');
const gdmSystemAudioCheckbox = document.getElementById('gdm-system-audio');
const gdmRestrictOwnAudioCheckbox = document.getElementById('gdm-restrict-own-audio');
const gdmStopButton = document.getElementById('gdm-stop');
const gdmMuteCheckbox = document.getElementById('gdm-mute');
const gdmAudio = document.getElementById('gdm-audio');
const gdmPlayAudioButton = document.getElementById('gdm-play-audio');
const gdmRecordedAudio = document.getElementById('gdm-recorded-audio');
const gdmRecordButton = document.getElementById('gdm-record');
const gdmRecordedDiv = document.getElementById('gdm-recorded');
const errorElement = document.getElementById('error-message');
const gdmCanvas = document.getElementById('gdm-level-meter');
const pcAudio = document.getElementById('pc-audio-destination');

import { logi, logw, prettyJson } from './utils.js';

// Set to true if at least one output device is detected.
let hasSpeaker = false;
let htmlAudio;
let audioContext;
let gdmStream;
let gdmMediaRecorder;
let gdmRecordedBlobs;
let gdmAnimationFrameId;

gdmStopButton.disabled = true;
gdmMuteCheckbox.disabled = false;
gdmLocalAudioPlaybackCheckbox.disabled = false;
gdmSystemAudioCheckbox.disabled = false;
gdmRestrictOwnAudioCheckbox.disabled = false;

const selectors = [audioOutputSelect];

class TrackedAudioContext extends AudioContext {
  constructor() {
    super();
    this.activeConnections = 0;
  }

  trackConnect(source, destination) {
    source.connect(destination);
    this.activeConnections++;
    console.log(`[WebAudio] Connected: ${this.activeConnections} active sources`);
  }

  trackDisconnect(source, destination) {
    source.disconnect(destination);
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    console.log(`[WebAudio] Disconnected: ${this.activeConnections} active sources`);

    // Automatically suspend when no sources are active
    // if (this.activeConnections === 0) {
    //  this.suspend().then(() => console.log("AudioContext suspended"));
    // }
  }
}

const loge = (error) => {
  if (typeof error === 'object' && error !== null && 'name' in error && 'message' in error) {
    errorElement.textContent = `DOMException: ${error.name} [${error.message}]`;
  } else {
    errorElement.textContent = error === '' ? '' : `ERROR: ${error}`;
  }
  if (error !== '') {
    console.error(error);
  }
};

function getSupportedMimeType() {
  const mimeTypes = [
    'audio/webm; codecs=pcm',
    'audio/webm; codecs=opus',
    'audio/webm',
    'audio/ogg; codecs=opus',
    'audio/ogg',
  ];

  for (const mimeType of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null; // No supported mimeType found
}

function updateSourceLabel(element) {
  let stream;
  if (element.tag === 'gDM') {
    stream = gdmStream;
  }
  
  // Get the label of the source currently attached to the audio element.
  let source;
  if (element.srcObject && stream) {
    const [track] = stream.getAudioTracks();
    source = track.label;
  } else if (element.src) {
    source = element.src;
  } else if (element.currentSrc) {
    source = element.currentSrc;
  }
  element.currentSourceLabel = source;
}

/** Extend the audio element with three extra properties. */
function updateAudioElement(element, sinkId, label) {
  updateSourceLabel(element);
  // Extend the audio element with custom properties for logging purposes.
  element.currentSinkId = sinkId;
  element.currentSinkLabel = label;
}


const insertStereoSupportForOpus = (sdp) => {
  // Early exit if Opus codec is not present
  if (!sdp.includes("a=rtpmap:111 opus/48000")) {
    logw("Opus codec (111) not found in SDP. Stereo support not added.");
    return sdp;
  }
  
  // Split SDP into lines
  const lines = sdp.split('\r\n');

  // Map through each line, find the target line, and append stereo support.
  const newSdp = lines.map((line) => {
    if (line.startsWith("a=fmtp:111")) {
      if (!line.includes("stereo=1")) {
        return `${line};stereo=1`;
      }
    }
    return line;
  });

  // Join the lines back into a string with proper line breaks.
  return newSdp.join("\r\n");
};


document.addEventListener('DOMContentLoaded', async (event) => {
  await enumerateDevices();
    
  htmlAudio = document.getElementById('html-audio');
  htmlAudio.volume = 0.3;
  htmlAudio.tag = 'HTML';
   
  htmlAudio.addEventListener('play', (event) => {
    logi('<audio> playout starts ' +
      `[source: ${htmlAudio.currentSourceLabel}][sink: ${htmlAudio.currentSinkLabel}]`);
  });
  
  // Event listener to update audio source when the selection changes
  document.getElementById('audio-file-select').addEventListener('change', async (event) => {
    const selectedFile = document.getElementById('audio-file-select').value;
    
    const wasPlaying = !htmlAudio.paused && htmlAudio.currentTime > 0;
    logi('Audio was playing before change: ', wasPlaying);
    
    htmlAudio.src = selectedFile;
    htmlAudio.currentSourceLabel = htmlAudio.src;
    
    async function playWhenReady() {
      // Remove the listener to prevent multiple runs.
      htmlAudio.removeEventListener('canplay', playWhenReady);

      if (wasPlaying) {
        try {
          await htmlAudio.play();
        } catch (e) {
          loge(e);
        }
      }
    }
    
    htmlAudio.addEventListener('canplay', playWhenReady);
  });
  
  gdmAudio.tag = 'gDM';
  
  // Set default sink and source for all audio elements and the audio context.
  changeAudioOutput();
});


function clearGdmInfoContainer() {
  const container = document.querySelector('.gdm-info-container');
  const divsToClear = container.querySelectorAll('div');
  divsToClear.forEach(div => {
    div.textContent = '';
  });
};

/**
 * TODO: figure out why MediaStreamTrack: getSettings() does not include `systemAudio`.
 * Note that the track will have "label: 'System Audio'" when sharing the screen.
 */
function printGdmAudioSettings(settings, options) {
  const propertiesToPrint = [
    'deviceId',
    'suppressLocalAudioPlayback',
    'echoCancellation',
    'autoGainControl',
    'noiseSuppression',
    'sampleRate',
    'voiceIsolation',
    'restrictOwnAudio'
  ];
  
  // MediaStreamTrack: getSettings is the current configuration of the track's constraints.
  let filteredSettings = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = settings[prop];
    return obj;
  }, {});
  // Adding more properties manually from the supplied options.
  filteredSettings.systemAudio = options.systemAudio;
  filteredSettings.preferCurrentTab = options.preferCurrentTab;
  filteredSettings.selfBrowserSurface = options.selfBrowserSurface;
  filteredSettings.surfaceSwitching = options.surfaceSwitching;
  filteredSettings.monitorTypeSurfaces = options.monitorTypeSurfaces;
  gdmOptionsDiv.textContent = '[gDM] Active options:\n' + prettyJson(filteredSettings);    
};

function printGdmAudioTrack(track) {
  const propertiesToPrint = [
    'label',
    'id',
    'kind',
    'enabled',
    'muted',
    'readyState'
  ];
  const filteredTrack = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = track[prop];
    return obj;
  }, {});
  gdmTrackDiv.textContent = '[gDM] MediaStreamTrack:\n' + prettyJson(filteredTrack);
};

function printGdmMediaRecorder(recorder) {
  const propertiesToPrint = [
    'mimeType',
    'state'
  ];
  const filteredRecorder = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = recorder[prop];
    return obj;
  }, {});
  gdmRecordedDiv.textContent = '[gDM] MediaRecorder:\n' + prettyJson(filteredRecorder);
};

gdmAudio.addEventListener('play', (event) => {
  logi('<audio> playout starts ' +
    `[source: ${gdmAudio.currentSourceLabel}][sink: ${gdmAudio.currentSinkLabel}]`);
});

gdmAudio.addEventListener('pause', (event) => {
  logi('<audio> playout stops ' +
    `[source: ${gdmAudio.currentSourceLabel}][sink: ${gdmAudio.currentSinkLabel}]`);
});


function updateDevices(listElement, devices) {
  listElement.innerHTML = '';
  devices.map(device => {
    const deviceOption = document.createElement('option');
    deviceOption.value = device.deviceId;
    deviceOption.label = device.label;
    deviceOption.text = device.label;
    listElement.appendChild(deviceOption);
  });
};

function getSelectedDevice(select) {
  const options = select.options;
  if (options.length == 0) {
    return '';
  }
  const deviceLabel = options[options.selectedIndex].label;
  return deviceLabel;
};

/**
 * Enumerate all devices and  deliver results (internally) as `MediaDeviceInfo` objects.
 * TODO: ensure that a device selection is maintained after a device is added or removed.
 */
async function enumerateDevices() {
  logi('enumerateDevices()');
  hasSpeaker = false;
  
  // Store currently selected devices.
  const selectedValues = selectors.map(select => select.value);
  
  try {
    // MediaDevices: enumerateDevices()
    // 
    // Returns an array of `MediaDeviceInfo` objects. Each object in the array
    // describes one of the available media input and output devices.
    // The order is significant — the default capture devices will be listed first.
    //
    // Other than default devices, only devices for which permission has been granted are "available".
    // 
    // If the media device is an input device, an `InputDeviceInfo` object will be returned instead.
    // See also: https://guidou.github.io/enumdemo4.html
    // Chrome issue: https://g-issues.chromium.org/issues/390333516
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    // Filter out array of MediaDeviceInfo objects.
    const deviceInfosOutput = devices.filter(device => device.kind === 'audiooutput');
    hasSpeaker = deviceInfosOutput.length > 0;
    logi(deviceInfosOutput);
    // Clear all select elements and add the latest input and output devices.
    updateDevices(audioOutputSelect, deviceInfosOutput);
    
    // Check if any <option> element inside the <select> element has a value matching
    // selectedValues[selectorIndex]. If a match is found, assigns the value to select.value which
    // selects the correct option. This approach ensures that a previously selected device is
    // maintained as selection even after device changes (assuming that the old selection was not
    // removed).
    selectors.forEach((select, selectorIndex) => {
      // The spread operator (...) converts the select.options HTMLCollection into a standard array.
      if ([...select.options].some(option => option.value === selectedValues[selectorIndex])) {
        select.value = selectedValues[selectorIndex];
      }
    });
    
  } catch (e) {
    loge(e);
  }
};

/**
 * Call HTMLMediaElement: setSinkId() on all available audio elements.
 */
async function changeAudioOutput() {
  if (!hasSpeaker) {
    return;
  }
  // Read device ID and device label from the select options.
  const options = audioOutputSelect.options;
  const deviceId = audioOutputSelect.value;
  const deviceLabel = options[options.selectedIndex].label;
  
  // Set sink ID on these six audio elements using the spreading operator (...). 
  const audioElements = [htmlAudio, gdmAudio];
  await Promise.all(audioElements.map(element => attachSinkId(element, deviceId, deviceLabel)));
  if (audioContext) {
    // await audioCtx.setSinkId({ type : 'none' });
    if (deviceId !== 'default') {
      await audioContext.setSinkId(deviceId);
      logi('[WebAudio] playout sets audio ouput ' +
        `[source: ${webAudioElement.currentSrc}][sink: ${getSelectedDevice(audioOutputSelect)}]`);
    }
  }
}

/** 
 * Attach audio output device to audio/video element using device/sink ID.
 * See also https://developer.chrome.com/blog/audiocontext-setsinkid.
 * Demo: https://sinkid.glitch.me/
 */
async function attachSinkId(element, sinkId, label) {
  if (typeof element.sinkId == 'undefined') {
    logw('Browser does not support output device selection.');
    return;
  }
  
  try {
    /**
     * HTMLMediaElement: setSinkId()
     * Set the ID of the audio device to use for output.
     * The output device is set even if the element has no source to prepare for when it gets one.
     */
    await element.setSinkId(sinkId);
    updateAudioElement(element, sinkId, label);
    logi(`<${element.tag}> playout sets audio output [source: ${element.currentSourceLabel}]` +
      `[sink: ${element.currentSinkLabel}]`);
  } catch (e) {
     // Jump back to first output device in the list as it's the default.
     audioOutputSelect.selectedIndex = 0;
    loge(e);
  }
}

/** 
 * Encapsulates a level meter given a specified canvas object.
 * @param canvas The canvas object on which the level meter is rendered.
 * @return Returns the frame ID from `requestAnimationFrame` so the animation can be stopped.
 */

async function startLevelMeter(stream, canvas) {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  // An FFT size of 256 is sufficient for our purposes. Results in 128 frequency bins. 
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.9;
  source.connect(analyser);
  
  const canvasCtx = canvas.getContext('2d');
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  let animationFrameId;
  function drawLevelMeter() {
    // Schedule the drawLevelMeter() function to run on the next animation frame.
    // requestAnimationFrame ensures the drawLevelMeter() function runs once per display refresh
    // (e.g., 60Hz = ~16.67ms interval).
    // The ID is assigned directly to `animationFrameId`.
    animationFrameId = requestAnimationFrame(drawLevelMeter);

    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    canvasCtx.fillStyle = 'lime';
    canvasCtx.fillRect(0, 0, (average / 256) * canvas.width, canvas.height);
  }

  drawLevelMeter();
  
  // Wait for one frame to be rendered to ensure a valid `animationFrameId`.
  await new Promise(resolve => requestAnimationFrame(resolve));
  return animationFrameId;
};

/** Set sink ID for all audio elements based on the latest output device selection. */
audioOutputSelect.onchange = async () => {
  const deviceLabel = getSelectedDevice(audioOutputSelect);
  logi(`Selected output device: ${deviceLabel}`); 
  await changeAudioOutput();
};

function startGdmRecording() {
  if (!gdmStream) {
    return;
  }
  
  gdmRecordedAudio.src = '';
  gdmRecordedAudio.disabled = true;
  
  gdmRecordedBlobs = [];
  // Get the best possible mime type given what the browser supports.
  const mimeType = getSupportedMimeType();
  const options = {mimeType};
  if (!mimeType) {
    console.error(`MediaRecorder only support very few mime types`);
    return;
  }
  
  try {
    // Start by cutting out the audio track part of the `gdmStream`.
    const [audioTrack] = gdmStream.getAudioTracks();
    // Next, create a new MediaStream which only contains the gDM audio track
    const gdmAudioOnlyStream = new MediaStream([audioTrack])
    // Now we can create a MediaRecorder which records audio only.
    gdmMediaRecorder = new MediaRecorder(gdmAudioOnlyStream, options);
    gdmRecordButton.textContent = 'Stop Recording';
    
    gdmMediaRecorder.onstart = (event) => {
      printGdmMediaRecorder(gdmMediaRecorder);
    };
    
    gdmMediaRecorder.onstop = (event) => {
      const superBuffer = new Blob(gdmRecordedBlobs, {type: mimeType});
      gdmRecordedAudio.src = '';
      gdmRecordedAudio.srcObject = null;
      gdmRecordedAudio.src = URL.createObjectURL(superBuffer);
      updateSourceLabel(gdmRecordedAudio);
      printGdmMediaRecorder(gdmMediaRecorder);
      gdmRecordedDiv.textContent += '\nrecorded blob size: ' + superBuffer.size;
    };
    
    gdmMediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        gdmRecordedBlobs.push(event.data);
      }
    };
    
    gdmMediaRecorder.start();
  } catch (e) {
    loge(e); 
  }
};

function stopGdmRecording() {
  if (gdmMediaRecorder) {
    gdmMediaRecorder.stop();
  }
};

gdmRecordButton.onclick = () => {
  if (gdmRecordButton.textContent === 'Start Recording') {
    startGdmRecording();
  } else {
    stopGdmRecording();
    gdmRecordButton.textContent = 'Start Recording';
  }
};

/**
 * startGdm()
 */
async function startGdm() {
  // Close existing streams.
  stopGdm();
  
  /** 
   * MediaDevices: getDisplayMedia(options)
   *   audio.suppressLocalAudioPlayback = true => device_id	"loopbackWithMute"
   *   audio.suppressLocalAudioPlayback = false => device_id	"loopback"
   *   systemAudio = 'include' => "Also share system audio" in picker
   *   systemAudio = 'exlude' => Audio sharing option in picker is disabled
   * TypeError is thown if the specified options include values that are not permitted.
   * For example a video property set to false, or if any specified MediaTrackConstraints are not
     permitted. min and exact values are not permitted in constraints used in getDisplayMedia() calls.
   * https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints#instance_properties_of_shared_screen_tracks
   * See https://screen-sharing-controls.glitch.me/ for an example.
   * See also https://developer.chrome.com/docs/web-platform/screen-sharing-controls/.
   */
  try {
    loge('');
    let options = {
      video: true,
      audio: {
        suppressLocalAudioPlayback: !gdmLocalAudioPlaybackCheckbox.checked,
        restrictOwnAudio: gdmRestrictOwnAudioCheckbox.checked,
      },
      systemAudio: (gdmSystemAudioCheckbox.checked ? 'include' : 'exclude'),
      monitorTypeSurfaces: 'include',
    };
    logi('requested options to getDisplayMedia: ', prettyJson(options));
    
    /** 
     * MediaDevices: getDisplayMedia()
     */
    gdmStream = await navigator.mediaDevices.getDisplayMedia(options);
    const [audioTrack] = gdmStream.getAudioTracks();
    if (audioTrack) {
      const settings = audioTrack.getSettings();
      logi(settings);
      printGdmAudioSettings(settings, options);
      printGdmAudioTrack(audioTrack);
    
      audioTrack.onmute = (event) => {
        logi('[gDM] MediaStreamTrack.onunmute: ' + audioTrack.label);
        printGdmAudioTrack(audioTrack);
      }
      audioTrack.onunmute = (event) => {
        logi('[gDM] MediaStreamTrack.onunmute: ' + audioTrack.label);
        printGdmAudioTrack(audioTrack);
      };
      audioTrack.addEventListener('ended', () => {
        logi('[gDM] MediaStreamTrack.ended: ' + audioTrack.label);
        stopGdm();
      });
      
      // The `autoplay` attribute of the audio tag is not set.
      gdmAudio.srcObject = gdmStream;
      updateSourceLabel(gdmAudio);
      if (gdmPlayAudioButton.checked) {
        await gdmAudio.play();
      }
      
      gdmAnimationFrameId = startLevelMeter(gdmStream, gdmCanvas);
      
      gdmButton.disabled = true;
      gdmStopButton.disabled = false;
      gdmLocalAudioPlaybackCheckbox.disabled = true;
      gdmSystemAudioCheckbox.disabled = true;
      gdmRestrictOwnAudioCheckbox.disabled = true;
      gdmMuteCheckbox.disabled = false;
      gdmRecordButton.disabled = false;
    } else {
      let deviceId;
      const [videoTrack] = gdmStream.getVideoTracks();
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        deviceId = settings.deviceId;
        videoTrack.stop();
        gdmStream = null;
      }
      loge(`No audio track exists for the selected source: ${deviceId}`);
    }
  } catch (e) {
    loge(e);
  }
}  

gdmButton.onclick = async () => {
  await startGdm();
};

function stopGdm() {
  if (gdmStream) {
    const [track] = gdmStream.getAudioTracks();
    if (track) {
      track.stop();
    }
    gdmStream = null;
    gdmAudio.srcObject = null;
    gdmButton.disabled = false;
    gdmStopButton.disabled = true;
    gdmLocalAudioPlaybackCheckbox.disabled = false;
    gdmSystemAudioCheckbox.disabled = false;
    gdmRestrictOwnAudioCheckbox.disabled = false;
    gdmMuteCheckbox.disabled = true;
    gdmRecordButton.textContent = 'Start Recording';
    gdmRecordButton.disabled = true;
    clearGdmInfoContainer();
    updateSourceLabel(gdmAudio);
    if (gdmAnimationFrameId) {
      cancelAnimationFrame(gdmAnimationFrameId);
      const canvasCtx = gdmCanvas.getContext('2d');
      canvasCtx.clearRect(0, 0, gdmCanvas.width, gdmCanvas.height);
    }
  }
};

gdmStopButton.onclick = () => {
  stopGdm();
};

gdmMuteCheckbox.onclick = () => {
  if (gdmStream) {
    const [track] = gdmStream.getAudioTracks();
    track.enabled = !checkbox;
    printGdmAudioTrack(track, index);
  }
};

gdmPlayAudioButton.onclick = async () => {
  if (gdmPlayAudioButton.checked) {
    if (gdmAudio.srcObject && gdmAudio.paused) {
      await gdmAudio.play();
    }
  } else {
    if (gdmAudio.srcObject && !gdmAudio.paused) {
      await gdmAudio.pause();
    }
  }
};


