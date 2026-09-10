# Multi-Track Region Cropping Demo

An interactive demonstration of the W3C **Region Capture** API (`CropTarget` and `MediaStreamTrack.prototype.cropTo()`) with support for dynamic multi-track cloning.

## Features

1. **Live Animated Source Area**:
   - **Greater Region**: Outer rectangular frame with an animated background shifting hue at 10 FPS (100ms interval).
   - **Inner Region 1**: Nested rectangular element with an independent animated background updating at 10 FPS.
   - **Inner Region 2**: Nested rectangular element featuring an incrementing 1-second counter and progress bar.

2. **CropTarget Production**:
   - Tags DOM elements as crop targets using `CropTarget.fromElement(element)` (or legacy `navigator.mediaDevices.produceCropTarget(element)`).

3. **Multi-Track Cloning (`clone()`) & Independent Cropping**:
   - Captures the tab via `navigator.mediaDevices.getDisplayMedia()`.
   - Allows dynamically cloning the captured video track with `track.clone()`.
   - Each cloned track has its own preview `<video>` player and independent crop selector buttons:
     - **🔲 Uncropped (Full Tab/Screen)**: `track.cropTo(undefined)`
     - **🟧 Greater Area**: `track.cropTo(targetGreater)`
     - **🎨 Inner Region 1 (Color)**: `track.cropTo(targetInner1)`
     - **⏱️ Inner Region 2 (Counter)**: `track.cropTo(targetInner2)`
   - Dynamically updates the crop boundaries while capture is active.
   - **Track Actions**:
     - **Clone this**: Clones the track with `track.clone()`, retaining the current crop target.
     - **Clone & cropTo(null)**: Clones and uncrops the track with `track2 = track1.clone(); track2.cropTo(null);`.

4. **Dynamic Layout & Resize Resilience**:
   - Includes a "Toggle Resize" control to demonstrate that `cropTo()` automatically tracks element layout changes (resizing, repositioning, zooming) without distortion or mis-cropping.

## Running Locally

Because `getDisplayMedia` and `CropTarget` require a secure context (HTTPS or `localhost`), serve the directory using any local web server:

```bash
# Using Python 3:
python3 -m http.server 8000

# Or using Node.js:
npx serve .
```

Open `http://localhost:8000` in Google Chrome or Chromium (version 104+ recommended).
