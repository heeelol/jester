// tracker.js — wraps MediaPipe HandLandmarker. One job: turn a <video> frame
// into an array of hands. Each hand = { landmarks, handedness }.
//
// landmarks: 21 points in normalized image space (0..1). That's all the rest of
// the app consumes — gestures.js and the interaction controller never see MediaPipe.

import { FilesetResolver, HandLandmarker } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export async function createHandTracker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  return {
    // Detect hands in the current video frame. `timestamp` must be monotonically
    // increasing (performance.now() works).
    detect(video, timestamp) {
      if (video.readyState < 2) return [];
      const res = landmarker.detectForVideo(video, timestamp);
      return (res.landmarks || []).map((landmarks, i) => ({
        landmarks,
        handedness: res.handednesses?.[i]?.[0]?.categoryName ?? "Unknown",
      }));
    },
  };
}
