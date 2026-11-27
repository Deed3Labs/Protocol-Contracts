export type HapticStyle = "light" | "medium" | "heavy";

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function vibrateForStyle(style: HapticStyle): void {
  // Keep patterns short to feel like "tap" feedback.
  const ms = style === "heavy" ? 25 : style === "medium" ? 15 : 8;
  try {
    navigator.vibrate(ms);
  } catch {
    // Ignore.
  }
}

// iOS/Safari: no Vibration API. We can only provide a best-effort fallback.
// This uses a very short, quiet click via WebAudio, which is allowed on user gestures.
let audioCtx: AudioContext | undefined;
function safariClickFallback(style: HapticStyle): void {
  if (typeof window === "undefined") return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;

  try {
    audioCtx ??= new AC();
    const ctx = audioCtx;

    // Some browsers suspend until first gesture; pointerdown qualifies.
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const freq = style === "heavy" ? 180 : style === "medium" ? 220 : 260;
    osc.frequency.value = freq;
    osc.type = "square";

    // Keep amplitude extremely low; this is a "tap" cue, not an audible sound.
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.00001, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.015);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.02);

    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // Ignore.
      }
    };
  } catch {
    // Ignore.
  }
}

export function hapticTap(style: HapticStyle = "light"): void {
  if (canVibrate()) {
    vibrateForStyle(style);
    return;
  }

  // Best-effort fallback for Safari/iOS.
  safariClickFallback(style);
}

