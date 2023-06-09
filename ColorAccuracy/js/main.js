/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

/* global main */

'use strict';
const canvas = document.getElementById("canvas")
//var video = document.createElement('video');
var video = document.querySelector('video');
const canvasRemote = document.getElementById('canvasRemote');
const codec = document.getElementById('codec');

let pc1 = null;
let pc2 = null;
const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 1
};

var counter = 0;

let startTime;

const stream = canvas.captureStream();
console.log('Got stream from canvas');

video.addEventListener('loadedmetadata', function() {
  console.log(`Remote video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

video.onresize = () => {
  console.log(`Remote video size changed to ${video.videoWidth}x${video.videoHeight}`);
  // We'll use the first onsize callback as an indication that video has started
  // playing out.
  if (startTime) {
    // Returns all stats
    // pc2.getStats().then(stats => {
    
    // Returns only receiver stats for first receiver, happens to be video.
    pc2.getReceivers()[0].getStats().then(stats => {
    stats.forEach(report => {
      if(report.type == "inbound-rtp") {
        if (startTime) {
          var implementationName = report["decoderImplementation"];
          document.getElementById('log').innerHTML += `${implementationName}<P>`;

          console.log(`Implementation: ${implementationName}`);
          const elapsedTime = window.performance.now() - startTime;
          console.log(`Processing time: ${elapsedTime.toFixed(3)}ms`);
          startTime = null;
        }
      }
      });
      //pc1.close();
      //pc2.close();
    });
  }
};

//call("h264");

//if  Prototype code, a bit risky to assume that we can proceed with next codec after a certain amount of time.
//setTimeout(() => call("H264"), 200);
function run() {
  call(codec.value);
  setTimeout(() => play(), 500);
}

function play() {
  video.play();
  var context = canvasRemote.getContext('2d');

  var cw = Math.floor(canvasRemote.clientWidth);
  var ch = Math.floor(canvasRemote.clientHeight);
  canvasRemote.width = cw;
  canvasRemote.height = ch;
  draw(video, context, cw, ch);
}

function draw(v, c, w, h) {
  if(v.paused || v.ended) return false;
  c.drawImage(v, 0, 0, w, h);
  var remoteImgData = c.getImageData(0, 0, 200, 200);

  var ctx = canvas.getContext("2d");
  var originalImgData = ctx.getImageData(0, 0, 200, 200);
  var totalCost = 0.0;
  for(var i = 0; i < 10; i++) {
    for (var j = 0; j < 10; j++) {
      var pix = i * (10*4*20*20) + j * 20 * 4 + 10 * 4 + 10 * 4 * 20 * 10;
      console.log(`${originalImgData.data[pix]}, ${originalImgData.data[pix + 1]}, ${originalImgData.data[pix + 2]}, mapped to, ${remoteImgData.data[pix]}, ${remoteImgData.data[pix + 1]}, ${remoteImgData.data[pix + 2]}`);
      var diff = Math.sqrt(Math.pow(originalImgData.data[pix] - remoteImgData.data[pix], 2) + Math.pow(originalImgData.data[pix + 1] - remoteImgData.data[pix + 1], 2) + Math.pow(originalImgData.data[pix + 2] - remoteImgData.data[pix + 2], 2));
      totalCost = totalCost + diff; 
    }
  }
  var averageCost = totalCost / 100;
  console.log(`Average cost ${averageCost}`);
  document.getElementById('log').innerHTML += `<BR>Average pixel intensity error ${averageCost}.`;
}

function rgb2Html(red, green, blue)
{
    var decColor =0x1000000+ blue + 0x100 * green + 0x10000 *red ;
    return '#'+decColor.toString(16).substr(1);
}

function call(codec) {
  document.getElementById('log').innerHTML += `${codec}: `;
  console.log('Starting call');
  startTime = window.performance.now();
  const videoTracks = stream.getVideoTracks();
  if (videoTracks.length > 0) {
    console.log(`Using video device: ${videoTracks[0].label}`);
  }

  let init = false;
  const servers = null;
  if (pc1 == null) {
    pc1 = new RTCPeerConnection(servers);
    console.log('Created local peer connection object pc1');
    pc1.onicecandidate = e => onIceCandidate(pc1, e);
    init = true;
  }
  if (pc2 == null) {
    pc2 = new RTCPeerConnection(servers);
    console.log('Created remote peer connection object pc2');
    pc2.onicecandidate = e => onIceCandidate(pc2, e);
  }
  //pc1.oniceconnectionstatechange = e => onIceStateChange(pc1, e);
  //pc2.oniceconnectionstatechange = e => onIceStateChange(pc2, e);
  pc2.ontrack = gotRemoteStream;

  if (init) {
    stream.getTracks().forEach(
      track => {
        pc1.addTrack(
            track,
            stream
        );
      }
    );
    console.log('Added local stream to pc1');
  }

  console.log('pc1 createOffer start');
  pc1.createOffer((desc) => onCreateOfferSuccess(desc, codec), onCreateSessionDescriptionError, offerOptions);
}

function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

function onCreateOfferSuccess(desc, codec) {
  //console.log(`Offer from pc1\n${desc.sdp}`);
  console.log('pc1 setLocalDescription start');
  desc.sdp = maybePreferCodec(desc.sdp, 'video', 'send', codec);
  pc1.setLocalDescription(desc, () => onSetLocalSuccess(pc1), onSetSessionDescriptionError);
  console.log('pc2 setRemoteDescription start');
  pc2.setRemoteDescription(desc, () => onSetRemoteSuccess(pc2), onSetSessionDescriptionError);
  console.log('pc2 createAnswer start');
  // Since the 'remote' side has no media stream we need
  // to pass in the right constraints in order for it to
  // accept the incoming offer of audio and video.
  pc2.createAnswer(onCreateAnswerSuccess, onCreateSessionDescriptionError);
}

function onSetLocalSuccess(pc) {
  console.log(`${getName(pc)} setLocalDescription complete`);
}

function onSetRemoteSuccess(pc) {
  console.log(`${getName(pc)} setRemoteDescription complete`);
  if (pc == pc1) {
//    pushFrameThroughConnection();
    // Adding a delay seems to make it a bit more stable.
    setTimeout(pushFrameThroughConnection, 10);
  }
}

function pushFrameThroughConnection() {
  // Change size to make sure that onResize is called.

  //canvas.width = canvas.width + 2;
  console.log(`Push frame!`);
  var ctx = canvas.getContext("2d");
  for(var i = 0; i < 10; i++) {
    for (var j = 0; j < 10; j++) {
      var r, g, b;
      if (j == 0) {
        r = i * 25;
        g = i * 25;
        b = i * 25;
      }
      else {
        r = i * 20;
        g = (j-1) * 20;
        b = 100;
      }
      ctx.fillStyle = rgb2Html(r, g, b);
      ctx.fillRect(i*20, j*20, 20, 20);
    }
  }

  ctx.fillStyle = rgb2Html(counter, 0, 0);
  ctx.fillRect(0, 0, 1, 1);
  counter = counter + 1;
  if (counter < 20) {
    setTimeout(pushFrameThroughConnection, 30);
  }
}

function onSetSessionDescriptionError(error) {
  console.log(`Failed to set session description: ${error.toString()}`);
}

function gotRemoteStream(e) {
  if (video.srcObject !== e.streams[0]) {
    video.srcObject = e.streams[0];
    console.log('pc2 received remote stream');
  }
}

function onCreateAnswerSuccess(desc) {
  //console.log(`Answer from pc2:\n${desc.sdp}`);
  console.log('pc2 setLocalDescription start');
  pc2.setLocalDescription(desc, () => onSetLocalSuccess(pc2), onSetSessionDescriptionError);
  console.log('pc1 setRemoteDescription start');
  pc1.setRemoteDescription(desc, () => onSetRemoteSuccess(pc1), onSetSessionDescriptionError);
}

function onIceCandidate(pc, event) {
  getOtherPc(pc).addIceCandidate(event.candidate)
      .then(
          () => onAddIceCandidateSuccess(pc),
          err => onAddIceCandidateError(pc, err)
      );
  //console.log(`${getName(pc)} ICE candidate: ${event.candidate ? event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess(pc) {
  //console.log(`${getName(pc)} addIceCandidate success`);
}

function onAddIceCandidateError(pc, error) {
  //console.log(`${getName(pc)} failed to add ICE Candidate: ${error.toString()}`);
}

/*function onIceStateChange(pc, event) {
  if (pc) {
    console.log(`${getName(pc)} ICE state: ${pc.iceConnectionState}`);
    console.log('ICE state change event: ', event);
  }
}*/

function getName(pc) {
  return (pc === pc1) ? 'pc1' : 'pc2';
}

function getOtherPc(pc) {
  return (pc === pc1) ? pc2 : pc1;
}
