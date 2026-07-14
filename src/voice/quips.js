// quips.js — canned J.E.S.T.E.R. one-liners spoken locally (no API call), so the
// comedy is instant and works even if the network or OpenAI hiccups mid-demo.
// Used for the voice fallback and for event reactions (grab / over-scale / dismiss).

export const QUIPS = {
  fallback: [
    "Well, that was graceful. Something broke, sir.",
    "I'd blame the network, but we both know it was you.",
    "That went about as smoothly as your last idea, sir.",
    "Error four-oh-embarrassing. Do try again.",
  ],
  grab: [
    "Careful with that one, sir.",
    "Ah, hands-on management. How brave.",
    "You break it, you buy it.",
  ],
  overscale: [
    "Compensating for something, sir?",
    "Bigger is not always better. But go off.",
    "At this size it barely fits in the room. Or the ego.",
  ],
  dismiss: [
    "Gone. Like your patience.",
    "Poof. You're welcome.",
    "Dismissed. If only meetings were this easy.",
  ],
  spawn: [
    "Ta-da. Try to contain your excitement.",
    "One hologram, freshly rendered. Mind the edges.",
    "Behold. I do good work, sir.",
  ],
};

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
