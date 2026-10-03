// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sound of a spending mark passed: two short falling tones, made here so
 * no file is fetched. A browser that will not play (no sound device, sound
 * not yet allowed on the page) stays silent; the notice still says it.
 */
type AudioCtor = typeof AudioContext;

export function playSpendSound(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (Ctor === undefined) return;
    const context = new Ctor();
    const tone = (frequency: number, from: number): void => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime + from);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + from + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + from + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + from);
      oscillator.stop(context.currentTime + from + 0.24);
    };
    tone(880, 0);
    tone(660, 0.26);
    window.setTimeout(() => void context.close().catch(() => undefined), 800);
  } catch {
    // Silent: the notice is the warning, the sound only draws the eye to it.
  }
}
