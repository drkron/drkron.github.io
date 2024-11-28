'use strict';

if (typeof MediaStreamTrackProcessor === 'undefined' ||
    typeof MediaStreamTrackGenerator === 'undefined') {
  alert(
      'Your browser does not support the experimental MediaStreamTrack API ');
}

const originalVideo = document.getElementById('original');
const localVideo = document.getElementById('local');
const encodedVideo = document.getElementById('encoded');
const pauseCheckbox = document.getElementById('pause');
const pipeCheckbox = document.getElementById('pipe');
const gumButton = document.getElementById('gum');
const callButton = document.getElementById('call');
const stopButton = document.getElementById('stop');
const cropMethod = document.getElementById('crop');
const statsDiv = document.getElementById('stats');
const trackDiv = document.getElementById('track');
const videoSizeDiv = document.getElementById('videoSize');
const constraintsDiv = document.getElementById('constraints');
const renderCheckbox = document.getElementById('renderEncoded');
const getStatsCheckbox = document.getElementById('getStats');
const codecSelect = document.getElementById('codec');
const scalabilityModeSelect = document.getElementById('scalabilityMode');
const inputs = document.getElementsByTagName('input');
const errorElement = document.getElementById('error-message');

pauseCheckbox.disabled = true;
stopButton.disabled = true;
callButton.disabled = true;
getStatsCheckbox.disabled = true;
codecSelect.disabled = false;

let stream;
let remoteStream;
let canvasStream;
let context2d;
let intervalId;
let getStatsIntervalId;
let trackStatsIntervalId;
let oldTrackStats = null;
let loggedFrameProperties;

let canvas;
let canvasVideo;

let worker;
let processor;
let generator;

let pc1;
let pc2;

let activeSourceStream;

let cropRect = {};

const rateFps = 30;

const defaultVisibleRect = {x: 640, y: 360, width: 640, height: 360};

const hdConstraints = {
  video: {width: {exact: 1280}, height: {exact: 720}, frameRate: { exact: 30 }}
};

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

const loge = (error) => {
  errorElement.textContent = `DOMException: ${error.name} [${error.message}]`;
  console.error(error);
};

const logFrameProperties = (videoFrame, stage) => {
  if (loggedFrameProperties) {
    return;
  }
  // TODO(henrika): figure out why we need this copy to be able to see all
  // essential properties in the debug console.
  const internalFrame = {};
  internalFrame.format = videoFrame.format;
  internalFrame.visibleRect = videoFrame.visibleRect;
  internalFrame.codedWidth = videoFrame.codedWidth;
  internalFrame.codedHeight = videoFrame.codedHeight;
  internalFrame.colorSpace = videoFrame.colorSpace;
  internalFrame.displayHeight = videoFrame.displayHeight;
  internalFrame.displayWidth = videoFrame.displayWidth;
  console.log(`[${stage}] Video Frame: ` + prettyJson(internalFrame));
  if (stage === 'after') {
    loggedFrameProperties = true;
  }
};

function transform(frame, controller) {
  try {
    logFrameProperties(frame, 'before');
    const newFrame = new VideoFrame(frame, {
        visibleRect: cropRect,
        displayWidth: 1280,
        displayHeight: 720,
      });
    logFrameProperties(newFrame, 'after');
    controller.enqueue(newFrame);
    frame.close();
  } catch (e) {
    const message = `DOMException: ${e.name} [${e.message}]`; 
    console.error(message);
    frame.close();
    cropRect = defaultVisibleRect;
  }
};

function getCropRect() {
  const inputValues = {};
  for (const input of inputs) {
    if (input.type === 'number') {
      const inputId = input.id;
      const inputValue = input.value;
      inputValues[inputId] = inputValue;
    }
  }
  return inputValues;
};

function handleInputChange() {
  cropRect = getCropRect();
  if (worker) {
    worker.postMessage({
      operation: 'change',
      cropRect: cropRect,
    });
  }
};

gumButton.onclick = async () => {
  try {
    const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
    // console.log(prettyJson(supportedConstraints));
    stream = await navigator.mediaDevices.getUserMedia(hdConstraints);
    originalVideo.srcObject = stream;
    const [videoTrack] = stream.getVideoTracks();
    console.log('videoTrack:', videoTrack);
    constraintsDiv.textContent = 'constraints:\n' + prettyJson(videoTrack.getConstraints());
    
    localVideo.addEventListener('resize', function() {
      let videoSize = {};
      videoSize.videoWidth = this.videoWidth;
      videoSize.videoHeight = this.videoHeight;
      videoSize.offsetWidth = this.offsetWidth;
      videoSize.offsetHeight = this.offsetHeight;
      videoSizeDiv.textContent = 'local video:\n' + prettyJson(videoSize);
    });
    
    await activateSelectedCropMethod();
    
    for (const input of inputs) {
      if (input.type === 'number') {
        input.addEventListener('change', handleInputChange);
      }
    }
    
    startTrackStats();
       
    gumButton.disabled = true;
    pauseCheckbox.disabled = false;
    stopButton.disabled = false;
    callButton.disabled = false;
    getStatsCheckbox.disabled = false;
  } catch (e) {
    loge(e);
  }
};

function startCropAndScaleTimer() {
  intervalId = setInterval(() => {
    // Cut out a section of the source image, then scale and draw it on our canvas.
    // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Using_images#slicing
    context2d.drawImage(
        canvasVideo,
        cropRect.x, cropRect.y, cropRect.width, cropRect.height,
        0, 0, canvas.width, canvas.height);
    // Pass through without cropping.
    // context2d.drawImage(canvasVideo, 0, 0);
    if (canvasStream) {
      const [track] = canvasStream.getVideoTracks();
      if (track) {
        // Send the current state of the canvas as a frame to the stream.
        track.requestFrame();
      }
    }
  }, 1000 / rateFps);
  return intervalId;
};

pauseCheckbox.onchange = () => {
  if (pause.checked) {
    if (!localVideo.paused) {
      localVideo.pause();
    }
    if (!encodedVideo.paused) {
      encodedVideo.pause();
    }
  } else {
    if (localVideo.paused) {
      localVideo.play();
    }
    if (encodedVideo.paused) {
      encodedVideo.play();
    }
  }
};

renderCheckbox.onchange = () => {
  if (renderEncoded.checked) {
    if (remoteStream) {
      encodedVideo.srcObject = remoteStream;
    }
  } else {
    if (encodedVideo.srcObject) {
      encodedVideo.pause();
      encodedVideo.srcObject = null;
    }
  }
};

getStatsCheckbox.onchange = () => {
  if (getStats.checked) {
    startGetStats();
  } else {
    stopGetStats();
  }
};

crop.onchange = async () => {
  await activateSelectedCropMethod();
};

pipeCheckbox.onchange = async () => {
  await activateSelectedCropMethod();
}

scalabilityModeSelect.onchange = async () => {
  await setVideoParameters(scalabilityModeSelect.value);
};

const activateSelectedCropMethod = async () => {
  console.log('Selected crop method is: ' + crop.value);
  await clearActiveCropping();
  
  if (crop.value === 'passthrough') {
    activatePassthrough();
  } else if (crop.value === 'canvas') {
    await activateCanvas();
  } else if (crop.value === 'bbworker') {
    activateBreakoutBoxWorker();
  } else if (crop.value === 'bbWebGlPassWorker') {
    activateBreakoutBoxWebGLPassthroughWorker();
  } else if (crop.value === 'bbmain') {
    activateBreakoutBoxMain(); 
  } else if (crop.value === 'bbWebGlCropAndScaleWorker') {
    activateBreakoutBoxWebGLCropAndScaleWorker();
  } else {
    console.log('[ERROR] Invalid selection');
  }
  
  if (activeSourceStream) {
    console.log('Restarting peerconnection using latest source...'); 
    closePeerConnection();
    await setupPeerConnection();
  }
};

const activatePassthrough = () => {
  console.log('activatePassthrough');
  if (!stream) {
    return;
  }
  localVideo.srcObject = stream;
};

const activateCanvas = async () => {
  console.log('activateCanvas');
  if (!stream) {
    console.log('No MediaStreamTrack exists yet');
    return;
  }
  try {
    canvasVideo = document.createElement('video');
    canvas = document.createElement('canvas');
    canvasVideo.srcObject = stream;
    canvasVideo.play();
    
    let resolvePromise;
    const promise = new Promise(r => resolvePromise = r);
    
    // TODO(henrika): do we need removeEventListener?
    canvasVideo.addEventListener('loadedmetadata', function() {
      // The duration and dimensions of the media tracks are now known.
      console.log(`Canvas video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
      console.log(`Canvas video offsetWidth: ${this.offsetWidth}px,  videoHeight: ${this.offsetHeight}px`);      
      try {
        cropRect = getCropRect();
        console.log(`Crop and scale: {x=${cropRect.x}, y=${cropRect.y}, width=${cropRect.width}, height=${cropRect.height}}`);
        context2d = canvas.getContext('2d');
        context2d.imageSmoothingQuality = 'medium';
        canvas.width = canvasVideo.videoWidth;
        canvas.height = canvasVideo.videoHeight;
        console.log(`Canvas: width=${canvas.width}, height=${canvas.height}`);
      
        canvasStream = canvas.captureStream(0);
        localVideo.srcObject = canvasStream;
        console.log(canvasStream.getVideoTracks());
      
        intervalId = startCropAndScaleTimer();
        resolvePromise();
      } catch (e) {
        log(e);
      }
    });
    
    await promise;
  } catch (e) {
    loge(e);
  }  
};

const activateBreakoutBoxWorker = () => {
  console.log('activateBreakoutBoxWorker');
  if (!stream) {
    console.log('No MediaStreamTrack exists yet');
    return;
  }
  if (worker) {
    console.log('[ERROR] worker is still active');
    return;
  }
  try {
    worker = new Worker('./js/worker.js', {name: 'Crop worker'});
     
    // Worker will post back if/when we fail to construct a VideoFrame.
    worker.onmessage = async (event) => {
      const {operation, error} = event.data;
      console.log('[main] message=' + operation);
    };
    
    const [track] = stream.getVideoTracks();
    processor = new MediaStreamTrackProcessor({track});
    const {readable} = processor;

    // Creates a WritableStream that acts as a MediaStreamTrack source.
    // The object consumes a stream of video frames as input.
    generator = new MediaStreamTrackGenerator({kind: 'video'});
    const {writable} = generator;
    localVideo.srcObject = new MediaStream([generator]);
    
    cropRect = getCropRect();

    // Crop and scale using visibleRect.
    worker.postMessage({
      operation: 'crop',
      readable,
      writable,
    }, [readable, writable]);
    
    worker.postMessage({
      operation: 'change',
      cropRect: cropRect,
    });
  } catch (e) {
    loge(e);
  }
};

const activateBreakoutBoxWebGLPassthroughWorker = () => {
  console.log('activateBreakoutBoxWebGLPassthroughWorker');
  if (!stream) {
    console.log('No MediaStreamTrack exists yet');
    return;
  }
  if (worker) {
    console.log('[ERROR] worker is still active');
    return;
  }
  try {
    worker = new Worker('./js/webgl-passthrough-worker.js', {name: 'WebGL passthrough worker'});
    
    // Initialize the WebGL context. 
    worker.postMessage({
      operation: 'init',
    }); 
    
    const [track] = stream.getVideoTracks();
    processor = new MediaStreamTrackProcessor({track});
    const {readable} = processor;

    // Creates a WritableStream that acts as a MediaStreamTrack source.
    // The object consumes a stream of video frames as input.
    generator = new MediaStreamTrackGenerator({kind: 'video'});
    const {writable} = generator;
    localVideo.srcObject = new MediaStream([generator]);
    
    const mode = pipe.checked ? 'pipe-transform' : 'no-pipe-transform'; 

    // Transform using WebGL.
    worker.postMessage({
      operation: mode,
      readable,
      writable,
    }, [readable, writable]);
  } catch (e) {
    loge(e);
  }
};

const activateBreakoutBoxMain = () => {
  console.log(`activateBreakoutBoxMain()`);
  if (!stream) {
    console.log('No MediaStreamTrack exists yet');
    return;
  }
  
  try {
    const [track] = stream.getVideoTracks();
    processor = new MediaStreamTrackProcessor({track});
    const {readable} = processor;
    
    generator = new MediaStreamTrackGenerator({kind: 'video'});
    const {writable} = generator;
    localVideo.srcObject = new MediaStream([generator]);
    
    cropRect = getCropRect();
    
    readable
        .pipeThrough(new TransformStream({transform}))
        .pipeTo(writable)
        .catch((e) => {
          loge(e)
        });
  } catch (e) {
    loge(e);
  }
};

const activateBreakoutBoxWebGLCropAndScaleWorker = () => {
  console.log('activateBreakoutBoxWebGLCropAndScaleWorker');
  if (!stream) {
    console.log('No MediaStreamTrack exists yet');
    return;
  }
  if (worker) {
    console.log('[ERROR] worker is still active');
    return;
  }
  try {
    worker = new Worker('./js/webgl-crop-worker.js', {name: 'WebGL crop worker'});
    
    // Initialize the WebGL context. 
    worker.postMessage({
      operation: 'init',
    }); 
    
    const [track] = stream.getVideoTracks();
    processor = new MediaStreamTrackProcessor({track});
    const {readable} = processor;

    // Creates a WritableStream that acts as a MediaStreamTrack source.
    // The object consumes a stream of video frames as input.
    generator = new MediaStreamTrackGenerator({kind: 'video'});
    const {writable} = generator;
    localVideo.srcObject = new MediaStream([generator]);
    
    const mode = pipe.checked ? 'pipe-transform' : 'no-pipe-transform';

    // Transform using WebGL.
    worker.postMessage({
      operation: mode,
      readable,
      writable,
    }, [readable, writable]);
  } catch (e) {
    loge(e);
  }
};

const clearActiveCropping = async () => {
  console.log('clearActiveCropping');
  try {
    if (intervalId) {
      clearInterval(intervalId);
    }
    if (context2d) {
      context2d.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (canvasStream) {
      for (const track of canvasStream.getVideoTracks()) {
        track.stop();
      }
      canvasStream = null;
    }
    if (worker) {
      console.log('Cleaning up after BB worker');
      worker.terminate();
      processor = null;
      generator = null;
      worker = null;
    }
    if (processor) {
      console.log('Cleaning up after BB main');
      processor = null;
      generator = null;
    }
  } catch (e) {
    loge(e);
  }
}  

stopButton.onclick = async () => {
  await clearActiveCropping();
  try {
    stopTrackStats();
    stopGetStats();
    if (stream) {
      for (const track of stream.getVideoTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (remoteStream) {
      for (const track of remoteStream.getVideoTracks()) {
        track.stop();
      }
      remoteStream = null;
    }
    if (localVideo.srcObject) {
      localVideo.srcObject = null;
    }
    if (encodedVideo.srcObject) {
      encodedVideo.srcObject = null;
    }
    if (worker) {
      worker.terminate();
      worker = null;
    }
    for (const input of inputs) {
      if (input.type === 'number') {
        input.value = defaultVisibleRect[input.id];
      }
    }
    crop.value = 'none';
    codec.value = 'VP9';
  } catch (e) {
    loge(e);
  }
  oldTrackStats = null;
  errorElement.textContent = "";
  statsDiv.textContent = "";
  videoSizeDiv.textContent = "";
  constraintsDiv.textContent = "";
  closePeerConnection();
  gumButton.disabled = false;
  callButton.disabled = true;
  getStatsCheckbox.disabled = true;
  stopButton.disabled = true;
  pauseCheckbox.disabled = true;
  codecSelect.disabled = false;
};

callButton.onclick = async () => {
  try {
    await setupPeerConnection();
    callButton.disabled = true;
    codecSelect.disabled = true;

    if (getStats.checked) {
      startGetStats();
    }
  } catch (e) {
    loge(e);
  }
};

const startTrackStats = () => {
  trackStatsIntervalId = setInterval(async () => {
    if (stream) {
      const [track] = stream.getVideoTracks();
      if (track.stats != undefined) {
        const trackStats = track.stats.toJSON();
        trackStats.droppedFrames =
            trackStats.totalFrames - trackStats.deliveredFrames - trackStats.discardedFrames;
        if (oldTrackStats == null)
          oldTrackStats = trackStats;
        const deltaStats =
        Object.assign(trackStats,
    									{fps:{delivered: trackStats.deliveredFrames - oldTrackStats.deliveredFrames,
    									      discarded: trackStats.discardedFrames - oldTrackStats.discardedFrames,
                            dropped: trackStats.droppedFrames - oldTrackStats.droppedFrames,
                            total: trackStats.totalFrames - oldTrackStats.totalFrames}});
        trackDiv.textContent = 'local track.stats:\n' + prettyJson(deltaStats);
        oldTrackStats = trackStats;
      }
    }
  }, 1000);
};

const stopTrackStats = () => {
  if (trackStatsIntervalId) {
    clearInterval(trackStatsIntervalId);
  }
  trackDiv.textContent = '';
};

const startGetStats = () => {
  // https://w3c.github.io/webrtc-stats/#outboundrtpstats-dict*
  getStatsIntervalId = setInterval(async () => {
    if (pc1) {
      const report = await pc1.getStats();
      for (const stats of report.values()) {
        if (stats.type === 'outbound-rtp') {
          const partialStats = {};
          partialStats.contentType = stats.contentType;
          partialStats.frameWidth = stats.frameWidth;
          partialStats.frameHeight = stats.frameHeight;
          const mimeType = report.get(stats.codecId).mimeType;
          partialStats.codec = mimeType.split('/')[1];
          partialStats.encoderImplementation = stats.encoderImplementation;
          partialStats.powerEfficientEncoder = stats.powerEfficientEncoder;
          partialStats.scalabilityMode= stats.scalabilityMode;
          partialStats.framesPerSecond = stats.framesPerSecond;
          partialStats.qualityLimitationReason = stats.qualityLimitationReason;
          statsDiv.textContent = `${stats.type}:\n` + prettyJson(partialStats);
        }
      }
    }
  }, 1000);
};

const stopGetStats = () => {
  if (getStatsIntervalId) {
    clearInterval(getStatsIntervalId);
  }
  statsDiv.textContent = '';
};

async function setVideoParameters(scalabilityMode) {
  if (!pc1) {
    return;
  }
  if (scalabilityMode === 'none') {
    return;
  }
  const [sender] = pc1.getSenders();
  const parameters = sender.getParameters();
  parameters.encodings[0].scalabilityMode = scalabilityMode;
  console.log('sender parameters: ', parameters);
  try {
    await sender.setParameters(parameters);
  } catch (e) {
    loge(e);
  }
}

const setupPeerConnection = async () => {
  console.log('setupPeerConnection');
  if (canvasStream) {
    console.log('Using canvas stream as source to PC');
  } else if (worker) {
    console.log('Using breakout-box stream as source to PC');
  } else {
    console.log('Using local stream from gUM as source to PC');
  }
  activeSourceStream = localVideo.srcObject;
  console.log('activeSourceStream:', activeSourceStream);
  
  pc1 = new RTCPeerConnection();
  pc2 = new RTCPeerConnection();
  const [localTrack] = activeSourceStream.getVideoTracks();
  let remoteTrack = null;
   
  pc1.addTrack(localTrack, activeSourceStream);
  await setVideoParameters(scalabilityModeSelect.value);
  
  pc2.ontrack = (e) => {
    remoteTrack = e.track;
    remoteStream = e.streams[0];
    if (renderEncoded.checked) {
      encodedVideo.srcObject = remoteStream;
    }
  };
  exchangeIceCandidates(pc1, pc2);
  
  pc1.oniceconnectionstatechange = (e) => {
    console.log('pc1 ICE state: ' + pc1.iceConnectionState)
  }
  
  pc2.oniceconnectionstatechange = (e) => {
    console.log('pc2 ICE state: ' + pc2.iceConnectionState)
  }
  
  // TODO(henrika): We should also include all of the following, otherwise we'd
  // turn off features like RTX etc:
  // mimeType == 'video/ulpfec' || mimeType == 'video/red' || mimeType == 'video/rtx'.
  // See https://jsfiddle.net/henbos/c2zqb1yw/.
  const transceiver = pc1.getTransceivers()[0];
  if (transceiver.setCodecPreferences) {
    const codecs = RTCRtpReceiver.getCapabilities('video').codecs.filter(
      (c) => c.mimeType.includes(codec.value),
    );
    transceiver.setCodecPreferences(codecs);
  }
  
  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  console.log('pc1 offer: ', offer.sdp);
  
  const answer = await pc2.createAnswer();
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);
  // console.log('pc2 answer: ', answer.sdp);
  
  // TODO(henrika): improve logs for active connection.
};

const closePeerConnection = () => {
  console.log('closePeerConnection');
  if (pc1) {
    pc1.close();
    pc1 = null;
  }
  if (pc2) {
    // remoteVideo.srcObject = null;
    pc2.close();
    pc2 = null;
  }
  activeSourceStream = null;
};

const exchangeIceCandidates = (pc1, pc2) => {
  function doExchange(localPc, remotePc) {
    localPc.addEventListener('icecandidate', event => {
      const { candidate } = event;
      if (candidate && remotePc.signalingState !== 'closed') {
        remotePc.addIceCandidate(candidate);
      }
    });
  }
  doExchange(pc1, pc2);
  doExchange(pc2, pc1);
};
