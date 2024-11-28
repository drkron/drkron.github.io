'use strict';

const defaultVisibleRect = {x: 640, y: 360, width: 640, height: 360};

let cropRect;
let loggedFrameProperties;

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

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
  // Cropping from an existing video frame is supported by the API in Chrome 94+.
  // https://www.w3.org/TR/webcodecs/#videoframe-interface
  // https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/VideoFrame#visiblerect                         }
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
      postMessage({
        operation: 'exception',
        error: message,
      });
      frame.close();
      cropRect = defaultVisibleRect;
    }
}

onmessage = async (event) => {
  const {operation} = event.data;
  console.log('[Crop worker] message=' + operation);
  if (operation === 'crop') {
    loggedFrameProperties = false;
    const {readable, writable} = event.data;
    // https://developer.mozilla.org/en-US/docs/Web/API/TransformStream
    readable
        .pipeThrough(new TransformStream({transform}))
        .pipeTo(writable)
        .catch((e) => {
          console.error('[Crop worker] error:', e);
        });
  } else if (operation === 'change') {
    cropRect = event.data.cropRect;
    console.log('[Crop worker] visibleRect: ', cropRect);
  } else {
    console.error('[Crop worker] Unknown operation', operation);
  }
};