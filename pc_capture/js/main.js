/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
const applyButton = document.getElementById('applyButton');

callButton.disabled = true;
hangupButton.disabled = true;
startButton.addEventListener('click', start);
callButton.addEventListener('click', call);
hangupButton.addEventListener('click', hangup);
applyButton.addEventListener('click', apply);

const useSimulcastCheck = document.getElementById('useSimulcast');
const resolutionCheck = document.getElementById('resolutionCheck');
const resWidth = document.getElementById('resWidth');
const resHeight = document.getElementById('resHeight');
const framerateCheck = document.getElementById('framerateCheck');
const minFramerateInput = document.getElementById('minFramerate');
const maxFramerateInput = document.getElementById('maxFramerate');
resWidth.oninput = resHeight.oninput = minFramerateInput.oninput = maxFramerateInput.oninput = displayRangeValue;

const localTrackStatsDiv = document.querySelector('div#localTrackStats');
const mediaSourceStatsDiv = document.querySelector('div#mediaSourceStats');
const senderStatsDiv = document.querySelector('div#senderStats');
const receiverStatsDiv = document.querySelector('div#receiverStats');
const transportStatsDiv = document.querySelector('div#transportStats');

const localVideoFpsDiv = document.querySelector('div#localVideoFramerate');
const remoteVideoFpsDiv = document.querySelector('div#remoteVideoFramerate');

let startTime;
const localVideo = document.querySelector('div#localVideo video');
const remoteVideo = document.querySelector('div#remoteVideo video');
const localVideoSizeDiv = document.querySelector('div#localVideo div');
const remoteVideoSizeDiv = document.querySelector('div#remoteVideo div'); 


const prettyJson = (obj) => JSON.stringify(obj, null, 2);

localVideo.addEventListener('loadedmetadata', function() {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

remoteVideo.addEventListener('loadedmetadata', function() {
  console.log(`Remote video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

remoteVideo.addEventListener('resize', () => {
  console.log(`Remote video size changed to ${remoteVideo.videoWidth}x${remoteVideo.videoHeight} - Time since pageload ${performance.now().toFixed(0)}ms`);
  // We'll use the first onsize callback as an indication that video has started
  // playing out.
  if (startTime) {
    const elapsedTime = window.performance.now() - startTime;
    console.log('Setup time: ' + elapsedTime.toFixed(3) + 'ms');
    startTime = null;
  }
});

function displayRangeValue(e) {
  const span = e.target.parentElement.querySelector('span');
  span.textContent = e.target.value;
}


let localStream;
let pc1;
let pc2;
let videoTrack;
let videoSettings;
let transceiver;

let prevStats = null;
let prevOutStats = null;
let prevInStats = null;
let numInboundRtpReports = 0;
let totalCaptureToEncodeDelay = 0;
let totalEncodeDelay = 0;
let totalPacketizationDelay = 0;
let totalPacerDelay = 0;
let totalPacketReceiveDelay = 0;
let totalJitterBufferDelay = 0;
let totalDecodeDelay = 0;
let totalE2EDelay = 0;
let oldReportTimeMs = 0;

let oldTimestampMs = 0;
let oldLocalFrames = 0;
let localFps = 30;
let oldRemoteFrames = 0;
let remoteFps = 30;

const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 1
};

function videoFullscreen(e) {
  console.log(e);
  const videoPlayer = e.closest("div.VideoPlayer");
  const videoElement = videoPlayer.querySelector("video");
  videoElement.requestFullscreen();
}

function getName(pc) {
  return (pc === pc1) ? 'pc1' : 'pc2';
}

function getOtherPc(pc) {
  return (pc === pc1) ? pc2 : pc1;
}

async function start() {
  console.log('Requesting local stream');
  startButton.disabled = true;

  const options = {audio: false, video: true, selfBrowserSurface: "include"};
  navigator.mediaDevices.getDisplayMedia(options)
      .then(handleSuccess, handleError);
}

function handleSuccess(stream) {
  startButton.disabled = true;

  localVideo.srcObject = stream;
  localStream = stream;
  callButton.disabled = false;

  // demonstrates how to detect that the user has stopped
  // sharing the screen via the browser UI.
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    errorMsg('The user has ended sharing the screen');
    startButton.disabled = false;
  });

  videoTrack = stream.getVideoTracks()[0];
  videoSettings = videoTrack.getSettings();
  console.log(videoSettings.displaySurface);
}

function handleError(error) {
  errorMsg(`getDisplayMedia error: ${error.name}`, error);
}

function errorMsg(msg, error) {
  console.log(msg);
  if (typeof error !== 'undefined') {
    console.error(error);
  }
}

async function apply() {
  var constraints = {};
  if (framerateCheck.checked) {
    constraints['frameRate'] = {min: minFramerateInput.value, max: maxFramerateInput.value};
  }
  if (resolutionCheck.checked) {
    constraints['width'] = {exact: resWidth.value};
    constraints['height'] = {exact: resHeight.value};
  }
  console.log(JSON.stringify(constraints, null, 3)); 
  await videoTrack.applyConstraints(constraints);
}

async function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  console.log('Starting call');
  startTime = window.performance.now();
  const videoTracks = localStream.getVideoTracks();
  const audioTracks = localStream.getAudioTracks();
  if (videoTracks.length > 0) {
    console.log(`Using video device: ${videoTracks[0].label}`);
  }
  if (audioTracks.length > 0) {
    console.log(`Using audio device: ${audioTracks[0].label}`);
  }
  const configuration = {};
  console.log('RTCPeerConnection configuration:', configuration);
  pc1 = new RTCPeerConnection(configuration);
  console.log('Created local peer connection object pc1');
  pc1.addEventListener('icecandidate', e => onIceCandidate(pc1, e));
  pc2 = new RTCPeerConnection(configuration);
  console.log('Created remote peer connection object pc2');
  pc2.addEventListener('icecandidate', e => onIceCandidate(pc2, e));
  pc1.addEventListener('iceconnectionstatechange', e => onIceStateChange(pc1, e));
  pc2.addEventListener('iceconnectionstatechange', e => onIceStateChange(pc2, e));
  pc2.addEventListener('track', gotRemoteStream);

  const maxBitrate = document.getElementById('maxBitrate').valueAsNumber;
  var encodings = [];
  if (useSimulcastCheck.checked) {
    encodings = [{rid: "one", maxBitrate: maxBitrate, maxFramerate: maxFramerateInput.value, scalabilityMode: "L1T2", scaleResolutionDownBy: 1.0} ];
  }
  else {  
    encodings = [{maxBitrate: maxBitrate}];
  }

  transceiver = pc1.addTransceiver(videoTracks[0], {
              streams: [localStream],
              sendEncodings: encodings,
          });

  // Move the desired codecs in front
  const wantedCodecs = RTCRtpReceiver.getCapabilities("video").codecs.filter((c) => c.mimeType.includes(codec.value));
  const otherCodecs = RTCRtpReceiver.getCapabilities("video").codecs.filter((c) => !c.mimeType.includes(codec.value));
  transceiver.setCodecPreferences(wantedCodecs.concat(otherCodecs));
  console.log('Added local stream to pc1');

  try {
    console.log('pc1 createOffer start');
    const offer = await pc1.createOffer(offerOptions);
    await onCreateOfferSuccess(offer);
  } catch (e) {
    onCreateSessionDescriptionError(e);
  }
}

function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

async function onCreateOfferSuccess(desc) {
  console.log(`Offer from pc1\n${desc.sdp}`);
  console.log('pc1 setLocalDescription start');
  try {
    await pc1.setLocalDescription(desc);
    onSetLocalSuccess(pc1);
  } catch (e) {
    onSetSessionDescriptionError();
  }

  console.log('pc2 setRemoteDescription start');
  try {
    await pc2.setRemoteDescription(desc);
    onSetRemoteSuccess(pc2);
  } catch (e) {
    onSetSessionDescriptionError();
  }

  console.log('pc2 createAnswer start');
  // Since the 'remote' side has no media stream we need
  // to pass in the right constraints in order for it to
  // accept the incoming offer of audio and video.
  try {
    const answer = await pc2.createAnswer();
    await onCreateAnswerSuccess(answer);
  } catch (e) {
    onCreateSessionDescriptionError(e);
  }
}

function onSetLocalSuccess(pc) {
  console.log(`${getName(pc)} setLocalDescription complete`);
}

function onSetRemoteSuccess(pc) {
  console.log(`${getName(pc)} setRemoteDescription complete`);
}

function onSetSessionDescriptionError(error) {
  console.log(`Failed to set session description: ${error.toString()}`);
}

function gotRemoteStream(e) {
  if (remoteVideo.srcObject !== e.streams[0]) {
    remoteVideo.srcObject = e.streams[0];
    console.log('pc2 received remote stream');
  }
}

async function onCreateAnswerSuccess(desc) {
  console.log(`Answer from pc2:\n${desc.sdp}`);
  console.log('pc2 setLocalDescription start');
  try {
    await pc2.setLocalDescription(desc);
    onSetLocalSuccess(pc2);
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
  console.log('pc1 setRemoteDescription start');
  try {
    await pc1.setRemoteDescription(desc);
    onSetRemoteSuccess(pc1);
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
}

async function onIceCandidate(pc, event) {
  try {
    await (getOtherPc(pc).addIceCandidate(event.candidate));
    onAddIceCandidateSuccess(pc);
  } catch (e) {
    onAddIceCandidateError(pc, e);
  }
  console.log(`${getName(pc)} ICE candidate:\n${event.candidate ? event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess(pc) {
  console.log(`${getName(pc)} addIceCandidate success`);
}

function onAddIceCandidateError(pc, error) {
  console.log(`${getName(pc)} failed to add ICE Candidate: ${error.toString()}`);
}

function onIceStateChange(pc, event) {
  if (pc) {
    console.log(`${getName(pc)} ICE state: ${pc.iceConnectionState}`);
    console.log('ICE state change event: ', event);
  }
}

function hangup() {
  console.log('Ending call');
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
}

function updateMaxBitrate() {
  let params = transceiver.sender.getParameters();
  const maxBitrate = document.getElementById('maxBitrate').valueAsNumber;
  for (let i = 0; i < params.encodings.length; ++i) {
    params.encodings[i].maxBitrate = maxBitrate;
  }
  transceiver.sender.setParameters(params);  
}

// Display statistics
function showLocalStats(report) {
  report.forEach(stats => {
    const partialStats = {};
    if (stats.type === 'media-source') {
      partialStats.frames = stats.frames;
      // The number of encoded frames during the last second.
      partialStats.framesPerSecond = stats.framesPerSecond;
      partialStats.height = stats.height;
      partialStats.width = stats.width;
      mediaSourceStatsDiv.textContent = `${stats.type}:\n` + prettyJson(partialStats);
    } else if (stats.type === 'outbound-rtp') {
      // https://w3c.github.io/webrtc-stats/#outboundrtpstats-dict*
      const currOutStats = stats;
      partialStats.contentType = currOutStats.contentType;
      const mimeType = report.get(currOutStats.codecId).mimeType;
      partialStats.codec = mimeType.split('/')[1];
      partialStats.encoderImplementation = currOutStats.encoderImplementation;
      partialStats.powerEfficientEncoder = currOutStats.powerEfficientEncoder;
      partialStats.scalabilityMode = currOutStats.scalabilityMode;
      partialStats.framesSent = currOutStats.framesSent;
      partialStats.framesPerSecond = currOutStats.framesPerSecond;
      partialStats.framesEncoded = currOutStats.framesEncoded;
      partialStats.qualityLimitationDurations = currOutStats.qualityLimitationDurations;
      // A record of the total time, in seconds, that this stream has spent in each quality
      // limitation state.
      partialStats.qualityLimitationReason = currOutStats.qualityLimitationReason;
      partialStats.firCount = stats.firCount;
      partialStats.pliCount = stats.pliCount;
      
      if (prevOutStats == null)
        prevOutStats = currOutStats;
      
      const deltaEncodeTime = currOutStats.totalEncodeTime - prevOutStats.totalEncodeTime;
      // The total number of seconds that packets have spent buffered locally before being
      // transmitted onto the network. The time is measured from when a packet is emitted from the
      // RTP packetizer until it is handed over to the OS network socket.
      const deltaPacketSendDelay = currOutStats.totalPacketSendDelay - prevOutStats.totalPacketSendDelay;
      const deltaPacketsSent = currOutStats.packetsSent - prevOutStats.packetsSent;
      const deltaFramesEncoded = currOutStats.framesEncoded - prevOutStats.framesEncoded;
      const deltaqpSum = currOutStats.qpSum - prevOutStats.qpSum;
      const deltaQualityLimitNone = currOutStats.qualityLimitationDurations.none - prevOutStats.qualityLimitationDurations.none;
      const deltaQualityLimitCpu = currOutStats.qualityLimitationDurations.cpu - prevOutStats.qualityLimitationDurations.cpu;
      
      const deltaOutStats =
          Object.assign(partialStats,
                        {"[qpSum/framesEncoded]": (deltaqpSum / deltaFramesEncoded).toFixed(1)},
                        {ms:{"[totalEncodeTime/framesEncoded]": (1000 * deltaEncodeTime / deltaFramesEncoded).toFixed(1),
                             "[totalPacketSendDelay/packetsSent]": (1000 * deltaPacketSendDelay / deltaPacketsSent).toFixed(1)}},
                        {fps:{framesEncoded: currOutStats.framesEncoded - prevOutStats.framesEncoded,
                              framesSent: currOutStats.framesSent - prevOutStats.framesSent}},
                        {"%":{"qualityLimitationDurations.cpu": Math.min(100, (100 * deltaQualityLimitCpu).toFixed(1))}});
      
      senderStatsDiv.textContent = `${currOutStats.type}:\n` + prettyJson(deltaOutStats);
      prevOutStats = currOutStats;
    }
  });
}

function showRemoteStats(report) {
  
  if (oldReportTimeMs == 0)
    oldReportTimeMs = performance.now();
  const now = performance.now();
  const deltaReportTimeMs = now - oldReportTimeMs;
  oldReportTimeMs = now;
  // console.log(deltaReportTimeMs);
  
  report.forEach(stats => {
    const partialStats = {};
    if (stats.type === 'transport') {
        // const candidatePair = report.get(stats.selectedCandidatePairId);
        // if (candidatePair) {
        //  partialStats.currentRoundTripTime = candidatePair.currentRoundTripTime;
        //  transportStatsDiv.textContent = `${stats.type}:\n` + prettyJson(partialStats);
        // }
    } else if (stats.type === 'inbound-rtp') {
      if (stats.remoteId != undefined) {
        const remoteOutboundRtp = stats.get(report.remoteId);
        console.log(remoteOutboundRtp);
      }
      // partialStats.decoderImplementation = stats.decoderImplementation;
      // partialStats.powerEfficientDecoder = stats.powerEfficientDecoder;
      partialStats.framesDecoded = stats.framesDecoded;
      // The total number of frames dropped prior to decode or dropped because the frame missed its
      // display deadline for this receiver's track.
      partialStats.framesDropped = stats.framesDropped;
      // The number of decoded frames in the last second
      partialStats.decodedFramesPerSecond = stats.framesPerSecond;
      // Represents the total number of complete frames received on this RTP stream.
      partialStats.framesReceived = stats.framesReceived;
      partialStats.freezeCount = stats.freezeCount;
      // Count the total number of Full Intra Request (FIR) packets sent by this receiver.
      partialStats.firCount = stats.firCount;
      // Counts the total number of Picture Loss Indication (PLI) packets.
      partialStats.pliCount = stats.pliCount;
      
      const timingFrameInfo = stats.googTimingFrameInfo;
      let infos = [];
      let currentE2Edelay = 0;
      if (timingFrameInfo != undefined) { 
        const infos = timingFrameInfo.split(',');
        if (infos[1] >= 0 && infos[2] >= 0 && infos[3] >= 0
            && infos[4] >= 0 && infos[5] >= 0 && infos[6] >= 0
            && infos[7] >= 0) {
          numInboundRtpReports++;
          totalCaptureToEncodeDelay += infos[2] - infos[1];
          totalEncodeDelay += infos[3] - infos[2];
          totalPacketizationDelay += infos[4] - infos[3];
          totalPacerDelay += infos[5] - infos[4];
          totalPacketReceiveDelay += infos[9] - infos[8];
          totalJitterBufferDelay += infos[10] - infos[9];
          totalDecodeDelay += infos[11] - infos[10];
          const e2e = infos[11] - infos[1];
          totalE2EDelay += e2e;
          currentE2Edelay = e2e;
        }
      } 
      
      if (prevInStats == null)
        prevInStats = stats;
      
      // It is the sum of the time, in seconds, each video frame takes from the time the first RTP
      // packet is received and to the time the corresponding sample or frame is decoded.
      const deltaProcessingDelay = stats.totalProcessingDelay - prevInStats.totalProcessingDelay;
      const deltaDecodeTime = stats.totalDecodeTime - prevInStats.totalDecodeTime;
      // The average jitter buffer delay can be calculated by dividing the jitterBufferDelay with
      // the jitterBufferEmittedCount.
      const deltaJitterBufferDelay = stats.jitterBufferDelay - prevInStats.jitterBufferDelay;
      const deltaJitterBufferEmittedCount = stats.jitterBufferEmittedCount - prevInStats.jitterBufferEmittedCount;
      const deltaAssemblyTime = stats.totalAssemblyTime - prevInStats.totalAssemblyTime;
      const deltaFramesAssembledFromMultiplePackets = stats.framesAssembledFromMultiplePackets - prevInStats.framesAssembledFromMultiplePackets;
      
      const deltaFramesDecoded = stats.framesDecoded - prevInStats.framesDecoded;
      const deltaqpSum = stats.qpSum - prevInStats.qpSum;  
      
      const deltaInStats =
          Object.assign(partialStats,
                        {"[qpSum/framesDecoded]": (deltaqpSum / deltaFramesDecoded).toFixed(1)},
                        {ms:{"[totalProcessingDelay/framesDecoded]": (1000 * deltaProcessingDelay / deltaFramesDecoded).toFixed(1),
                             "[jitterBufferDelay/jitterBufferEmittedCount]": (1000 * deltaJitterBufferDelay / deltaJitterBufferEmittedCount).toFixed(1),
                             "[totalDecodeTimeTime/framesDecoded]": (1000 * deltaDecodeTime / deltaFramesDecoded).toFixed(1),
                             "[totalAssemblyTime/framesAssembledFromMultiplePackets]": (1000 * deltaAssemblyTime / deltaFramesAssembledFromMultiplePackets).toFixed(1),
                             // Packet Jitter measured in seconds for this SSRC. Calculated as defined in section 6.4.1. of [RFC3550].
                             jitter: (1000 * stats.jitter).toFixed(1),
                             currentE2Edelay: currentE2Edelay}},
                        {fps:{framesDecoded: stats.framesDecoded - prevInStats.framesDecoded,
                              framesReceived: stats.framesReceived - prevInStats.framesReceived}},
                        {"[TX mean] ms":{captureToEncodeDelay: (totalCaptureToEncodeDelay / numInboundRtpReports).toFixed(1),
                                encodeDelay: (totalEncodeDelay / numInboundRtpReports).toFixed(1),
                                packetizationDelay: (totalPacketizationDelay / numInboundRtpReports).toFixed(1),
                                pacerDelay: (totalPacerDelay / numInboundRtpReports).toFixed(1)}},
                        {"[RX mean] ms":{packetReceiveDelay: (totalPacketReceiveDelay / numInboundRtpReports).toFixed(1),
                                jitterBufferDelay: (totalJitterBufferDelay / numInboundRtpReports).toFixed(1),
                                decodeDelay: (totalDecodeDelay / numInboundRtpReports).toFixed(1)}},
                        {"[E2E mean] ms":{E2Edelay: (totalE2EDelay / numInboundRtpReports).toFixed(1)}});
      
      receiverStatsDiv.textContent = 'remote ' + `${stats.type}:\n` + prettyJson(deltaInStats);
      prevInStats = stats;
    }
  });
}


setInterval(() => {
  if (localStream) {
    const [track] = localStream.getTracks();
    if (track.stats != undefined) {
      const currStats = track.stats.toJSON();
      currStats.droppedFrames = currStats.totalFrames - currStats.deliveredFrames - currStats.discardedFrames;
      if (prevStats == null)
        prevStats = currStats;
      const deltaStats =
        Object.assign(currStats,
                    {fps:{delivered: currStats.deliveredFrames - prevStats.deliveredFrames,
                          discarded: currStats.discardedFrames - prevStats.discardedFrames,
                            dropped: currStats.droppedFrames - prevStats.droppedFrames,
                            total: currStats.totalFrames - prevStats.totalFrames}});
      localTrackStatsDiv.textContent = 'track.stats:\n' + prettyJson(deltaStats);
      // localTrackStatsDiv.innerHTML = prettyJson(deltaStats).replaceAll(' ', '&nbsp;').replaceAll('\n', '<br/>');
      prevStats = currStats;
    }
  }
  if (pc1 && pc2) {
    pc1
        .getStats(null)
        .then(showLocalStats, err => console.log(err));
    pc2
        .getStats(null)
        .then(showRemoteStats, err => console.log(err));
  }
  if (localVideo.videoWidth) {
    const width = localVideo.videoWidth;
    const height = localVideo.videoHeight;
    localVideoSizeDiv.innerHTML = `<strong>Local video dimensions:</strong> ${width}x${height}px`;
    localVideoFpsDiv.innerHTML = `<strong>Local video framerate:</strong> ${localFps.toFixed(1)} fps`;
  }
  if (remoteVideo.videoWidth) {
    const width = remoteVideo.videoWidth;
    const height = remoteVideo.videoHeight;
    remoteVideoSizeDiv.innerHTML = `<strong>Remote video dimensions:</strong> ${width}x${height}px`;
    remoteVideoFpsDiv.innerHTML = `<strong>Remote video framerate:</strong> ${remoteFps.toFixed(1)} fps`;
  }
}, 1000);


const updateVideoFps = () => {
  const now = performance.now();
  const periodMs = now - oldTimestampMs;
  oldTimestampMs = now;
  
  if (localVideo.getVideoPlaybackQuality()) {
    let newFps;
    const newFrames = localVideo.getVideoPlaybackQuality().totalVideoFrames;
    const framesSinceLast = newFrames - oldLocalFrames;
    oldLocalFrames = newFrames;
    if (framesSinceLast >= 0) {
      newFps = 1000 * framesSinceLast / periodMs;
      localFps = 0.7 * localFps + 0.3 * newFps;
    }
  }
 
  if (remoteVideo.getVideoPlaybackQuality()) {
    let newFps;
    const newFrames = remoteVideo.getVideoPlaybackQuality().totalVideoFrames;
    const framesSinceLast = newFrames - oldRemoteFrames;
    oldRemoteFrames = newFrames;
    if (framesSinceLast >= 0) {
      newFps = 1000 * framesSinceLast / periodMs;
      remoteFps = 0.7 * remoteFps + 0.3 * newFps;
    }
  }
 
  setTimeout(updateVideoFps, 500);
}

setTimeout(updateVideoFps, 500);
