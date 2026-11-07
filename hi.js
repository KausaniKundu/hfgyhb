// Application State
const state = {
  currentColor: '#22d3ee',
  brushSize: 8,
  isDrawing: false,
  lastPoint: null,
  strokes: [], // Recorded point paths for shape analysis
  currentStroke: []
};

// DOM Elements
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('paintCanvas');
const ctx = canvasElement.getContext('2d');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const brushSizeInput = document.getElementById('brushSize');
const brushSizeVal = document.getElementById('brushSizeVal');
const customColorInput = document.getElementById('customColor');
const colorBtns = document.querySelectorAll('.color-btn');
const clearBtn = document.getElementById('clearBtn');
const recognizeBtn = document.getElementById('recognizeBtn');
const resultModal = document.getElementById('resultModal');
const resultShape = document.getElementById('resultShape');
const resultConfidence = document.getElementById('resultConfidence');
const closeModalBtn = document.getElementById('closeModalBtn');

// Adjust canvas resolution dynamically to match parent box size
function resizeCanvas() {
  const rect = canvasElement.parentElement.getBoundingClientRect();
  canvasElement.width = rect.width;
  canvasElement.height = rect.height;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Initialize MediaPipe Hands
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});

hands.onResults(onResults);

// Setup Camera Stream
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 1280,
  height: 720
});

camera.start().then(() => {
  statusBadge.querySelector('span').className = "w-2 h-2 rounded-full bg-emerald-400";
  statusText.innerText = "Tracking Active";
}).catch(err => {
  console.error("Camera access error: ", err);
  statusText.innerText = "Camera Access Denied";
});

// Process Hand Landmarks
function onResults(results) {
  // Clear preview frames (draw existing persistent user strokes)
  redrawCanvas();

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    state.isDrawing = false;
    state.lastPoint = null;
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  
  // Fingertip & Joint Coordinates (Mirrored horizontally)
  const indexTip = landmarks[8];
  const indexPip = landmarks[6];
  const middleTip = landmarks[12];
  const middlePip = landmarks[10];

  const x = (1 - indexTip.x) * canvasElement.width;
  const y = indexTip.y * canvasElement.height;

  // Gestures Detection
  const isIndexUp = indexTip.y < indexPip.y;
  const isMiddleUp = middleTip.y < middlePip.y;

  // Drawing Mode: Only Index Up
  if (isIndexUp && !isMiddleUp) {
    if (!state.isDrawing) {
      state.isDrawing = true;
      state.currentStroke = [];
    }

    const currentPoint = { x, y, color: state.currentColor, size: state.brushSize };
    state.currentStroke.push(currentPoint);

    if (state.lastPoint) {
      ctx.beginPath();
      ctx.moveTo(state.lastPoint.x, state.lastPoint.y);
      ctx.lineTo(x, y);
      ctx.strokeStyle = state.currentColor;
      ctx.lineWidth = state.brushSize;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    state.lastPoint = currentPoint;

    // Draw fingertip indicator dot
    drawCursor(x, y, state.currentColor, true);
  } else {
    // If drawing stopped, push stroke to history
    if (state.isDrawing && state.currentStroke.length > 0) {
      state.strokes.push([...state.currentStroke]);
      state.currentStroke = [];
    }
    state.isDrawing = false;
    state.lastPoint = null;

    // Hover Mode Pointer: Index + Middle Finger Up
    if (isIndexUp && isMiddleUp) {
      drawCursor(x, y, '#fbbf24', false);
    }
  }
}

// Draw Fingertip Cursor Indicator
function drawCursor(x, y, color, isDrawing) {
  ctx.beginPath();
  ctx.arc(x, y, isDrawing ? state.brushSize / 2 + 4 : 8, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Redraw Saved Strokes onto Canvas
function redrawCanvas() {
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  const allStrokes = [...state.strokes, state.currentStroke];
  allStrokes.forEach(stroke => {
    if (stroke.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    ctx.strokeStyle = stroke[0].color;
    ctx.lineWidth = stroke[0].size;
    ctx.lineCap = 'round';

    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  });
}

// Controls Logic
colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    colorBtns.forEach(b => b.classList.replace('border-white', 'border-transparent'));
    btn.classList.replace('border-transparent', 'border-white');
    state.currentColor = btn.dataset.color;
    customColorInput.value = state.currentColor;
  });
});

customColorInput.addEventListener('input', (e) => {
  state.currentColor = e.target.value;
  colorBtns.forEach(b => b.classList.replace('border-white', 'border-transparent'));
});

brushSizeInput.addEventListener('input', (e) => {
  state.brushSize = parseInt(e.target.value);
  brushSizeVal.innerText = `${state.brushSize}px`;
});

clearBtn.addEventListener('click', () => {
  state.strokes = [];
  state.currentStroke = [];
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
});

// Heuristic Recognition Engine
recognizeBtn.addEventListener('click', () => {
  const points = state.strokes.flat();
  if (points.length < 10) {
    showResult('Not Enough Data', 0);
    return;
  }

  // Calculate Bounding Box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  const width = maxX - minX;
  const height = maxY - minY;
  const aspectRatio = width / height;

  // Calculate Center of Mass & Average Radius (Circularity Check)
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;
  
  let totalRadius = 0;
  points.forEach(p => {
    totalRadius += Math.hypot(p.x - centerX, p.y - centerY);
  });
  const avgRadius = totalRadius / points.length;

  let radiusVariance = 0;
  points.forEach(p => {
    radiusVariance += Math.pow(Math.hypot(p.x - centerX, p.y - centerY) - avgRadius, 2);
  });
  const stdDev = Math.sqrt(radiusVariance / points.length);
  const circularityScore = stdDev / avgRadius; // Lower value = more circular

  // Classification Logic
  let detectedShape = "Unknown Shape";
  let confidence = 75;

  if (circularityScore < 0.22 && aspectRatio > 0.75 && aspectRatio < 1.35) {
    detectedShape = "Circle";
    confidence = Math.round((1 - circularityScore) * 100);
  } else if (aspectRatio >= 0.85 && aspectRatio <= 1.15) {
    detectedShape = "Square";
    confidence = 88;
  } else if (aspectRatio > 1.4 || aspectRatio < 0.4) {
    detectedShape = "Line / Rectangle";
    confidence = 82;
  } else if (state.strokes.length === 3 || state.strokes.length === 1) {
    detectedShape = "Triangle";
    confidence = 79;
  }

  showResult(detectedShape, Math.min(confidence, 98));
});

function showResult(shape, conf) {
  resultShape.innerText = shape;
  resultConfidence.innerText = `Confidence: ${conf}%`;
  resultModal.classList.remove('hidden');
}

closeModalBtn.addEventListener('click', () => {
  resultModal.classList.add('hidden');
});