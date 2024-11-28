'use strict';

let canvas_ = null;
let gl_ = null;
let sampler_ = null;
let program_ = null;
let texture_ = null;

function init() {
  console.log('[WebGL crop worker] Initializing WebGL');
  canvas_ = new OffscreenCanvas(1, 1);
  let gl = canvas_.getContext('webgl2');
  if (!gl) {
    gl = canvas_.getContext('webgl');
  }
  if (!gl) {
    alert(
        'Failed to create WebGL context. Check that WebGL is supported ' +
        'by your browser and hardware.');
    return;
  }
  gl_ = gl;
  
  const vertexShader = loadShader_(gl.VERTEX_SHADER, `
    precision lowp float;
    attribute vec3 g_Position;
    attribute vec2 g_TexCoord;
    varying vec2 texCoord;
    void main() {
      gl_Position = vec4(g_Position, 1.0);
      texCoord = g_TexCoord;
    }`);
    
  const fragmentShader = loadShader_(gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec2 texCoord;
    uniform sampler2D inSampler;

    void main(void) {
      vec2 cropSize = vec2(0.5, 0.5);  // half the input size (cropped area is a quarter)
      // Calculate half the crop size (normalized coordinates)
      vec2 halfCropSize = cropSize / 2.0;
      // Adjust cropRect based on half size to position the center at the bottom-right corner
      vec2 cropRect = vec2(1.0, 0.5) - halfCropSize;  // (1.0, 0.5) is bottom-right corner
      // Calculate the UV coordinates within the crop area based on the fragment's texCoord
      vec2 uvInCrop = texCoord * cropSize + cropRect - cropSize * 0.5;
      // Sample the texture using the coordinates within the crop area
      vec4 color = texture2D(inSampler, uvInCrop);
      gl_FragColor = color; 
    }`);
    if (!vertexShader || !fragmentShader) return;
    
    // Create the program object
    const programObject = gl.createProgram();
    gl.attachShader(programObject, vertexShader);
    gl.attachShader(programObject, fragmentShader);
    // Link the program
    gl.linkProgram(programObject);
    // Check the link status
    const linked = gl.getProgramParameter(programObject, gl.LINK_STATUS);
    if (!linked) {
      const infoLog = gl.getProgramInfoLog(programObject);
      gl.deleteProgram(programObject);
      throw new Error(`Error linking program:\n${infoLog}`);
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    sampler_ = gl.getUniformLocation(programObject, 'inSampler');
    program_ = programObject;
    // Bind attributes
    const vertices = [1.0, -1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0];
    // Pass-through.
    const txtcoords = [1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0];
    // Mirror horizonally.
    // const txtcoords = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
    attributeSetFloats_('g_Position', 2, vertices);
    attributeSetFloats_('g_TexCoord', 2, txtcoords);
    // Initialize input texture
    texture_ = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture_);
    const pixel = new Uint8Array([0, 0, 255, 255]); // opaque blue
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    console.log(
        '[WebGL crop worker] WebGL initialized: ', `canvas_ =`,
        canvas_, `gl_ =`, gl_);
};

/**
 * Creates and compiles a WebGLShader from the provided source code.
 * @param {number} type either VERTEX_SHADER or FRAGMENT_SHADER
 * @param {string} shaderSrc
 * @return {!WebGLShader}
 * @private
 */
function loadShader_(type, shaderSrc) {
  const gl = gl_;
  const shader = gl.createShader(type);
  // Load the shader source
  gl.shaderSource(shader, shaderSrc);
  // Compile the shader
  gl.compileShader(shader);
  // Check the compile status
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const infoLog = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Error compiling shader:\n${infoLog}`);
  }
  return shader;
};

/**
 * Sets a floating point shader attribute to the values in arr.
 * @param {string} attrName the name of the shader attribute to set
 * @param {number} vsize the number of components of the shader attribute's
 *   type
 * @param {!Array<number>} arr the values to set
 * @private
 */
function attributeSetFloats_(attrName, vsize, arr) {
  const gl = gl_;
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
  const attr = gl.getAttribLocation(program_, attrName);
  gl.enableVertexAttribArray(attr);
  gl.vertexAttribPointer(attr, vsize, gl.FLOAT, false, 0, 0);
};

async function transform(frame, controller) {
  const gl = gl_;
  if (!gl || !canvas_) {
    frame.close();
    return;
  }
  
  // Resize canvas and viewport (if necessary).
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  if (canvas_.width !== width || canvas_.height !== height) {
    canvas_.width = width;
    canvas_.height = height;
    gl.viewport(0, 0, width, height);
    console.log(`[WebGL crop worker] canvas_.width=${width}, canvas_.height=${height}`);
  }
  
  // Upload texture from VideoFrame using the original timestamp.
  const timestamp = frame.timestamp;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture_);
  // Flip the texture vertically (needed for webcam/video textures).
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  frame.close();
  
  // Render using WebGL.
  gl.useProgram(program_);
  gl.uniform1i(sampler_, 0);
  // Draw a full-screen quad (using gl.TRIANGLE_STRIP) to render the texture.
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindTexture(gl.TEXTURE_2D, null);
  
  // alpha: 'discard' is needed in order to send frames to a PeerConnection.
  controller.enqueue(new VideoFrame(canvas_, {timestamp, alpha: 'discard'}));
}

async function noPipeTransform(frame) {
  const gl = gl_;
  if (!gl || !canvas_) {
    frame.close();
    return;
  }
  
  // Resize canvas and viewport (if necessary).
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  if (canvas_.width !== width || canvas_.height !== height) {
    canvas_.width = width;
    canvas_.height = height;
    gl.viewport(0, 0, width, height);
    console.log(`[WebGL crop worker] canvas_.width=${width}, canvas_.height=${height}`);
  }
  
  // Upload texture from VideoFrame using the original timestamp.
  const timestamp = frame.timestamp;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture_);
  // Flip the texture vertically (needed for webcam/video textures).
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  frame.close();
  
  // Render using WebGL.
  gl.useProgram(program_);
  gl.uniform1i(sampler_, 0);
  // Draw a full-screen quad (using gl.TRIANGLE_STRIP) to render the texture.
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

onmessage = async (event) => {
  const {operation} = event.data;
  console.log('[WebGL crop worker] message=' + operation);
  if (operation === 'init') {
    init();
  } else if (operation === 'pipe-transform') {
    const {readable, writable} = event.data;
    readable
        .pipeThrough(new TransformStream({transform}))
        .pipeTo(writable)
        .catch((e) => {
          console.error('[WebGL crop worker] error:', e);
        });
  } else if (operation === 'no-pipe-transform') {
    const {readable, writable} = event.data;
    const source = readable.getReader();
    const sink = writable.getWriter();
    console.log('[WebGL crop worker] source:', source);
    console.log('[WebGL crop worker] sink:', sink);
    try {
      while (true) {
        const { value: videoFrame, done: isStreamFinished } = await source.read();
        if (isStreamFinished) break;
        
        const timestamp = videoFrame.timestamp;
        noPipeTransform(videoFrame);
        
        const newFrame = new VideoFrame(canvas_, {timestamp, alpha: 'discard'});
        
        await sink.write(newFrame);
      }
      source.releaseLock();
    } catch (e) {
      const message = `DOMException: ${e.name} [${e.message}]`; 
      console.error(message);
    }
  } else {
    console.error('[WebGL crop worker] Unknown operation', operation);
  }
};