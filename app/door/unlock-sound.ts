// A short two-tone click, made with Web Audio so there is no file to ship.
// It must start inside the tap handler: iOS only lets a page start audio from
// a gesture, so the home-screen auto-open stays silent.
export function playUnlockSound() {
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Context) return
  const audio = new Context()
  const start = audio.currentTime
  const click = (
    at: number,
    frequency: number,
    length: number,
    gain: number
  ) => {
    const tone = audio.createOscillator()
    const volume = audio.createGain()
    tone.type = "square"
    tone.frequency.value = frequency
    volume.gain.setValueAtTime(0.0001, at)
    volume.gain.exponentialRampToValueAtTime(gain, at + 0.004)
    volume.gain.exponentialRampToValueAtTime(0.0001, at + length)
    tone.connect(volume).connect(audio.destination)
    tone.start(at)
    tone.stop(at + length + 0.02)
  }
  click(start, 1800, 0.035, 0.25)
  click(start + 0.09, 900, 0.07, 0.35)
  setTimeout(() => audio.close().catch(() => {}), 600)
}
