'use strict';

/**
 * TODO: Ensure that a device selection is maintained after a device is added or removed.
 * TODO: Check that a device can be changed while recording is ongoing.
 */

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

import { logi, logw, prettyJson } from './utils.js';

// Set to true if at least one output device is detected.
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

document.addEventListener('DOMContentLoaded', async (event) => {
  gdmAudio.tag = 'gDM';  
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
    
      if (audioTrack.readyState != 'ended') {  
        // The `autoplay` attribute of the audio tag is not set.
        gdmAudio.srcObject = gdmStream;
        updateSourceLabel(gdmAudio);
        if (gdmPlayAudioButton.checked) {
          await gdmAudio.play();
        }
        gdmAnimationFrameId = startLevelMeter(gdmStream, gdmCanvas);      
      }
      else {
        logi('Audio track ended');
      }
      
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


