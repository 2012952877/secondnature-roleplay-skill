/* Inject with page.addInitScript before the target application initializes. */
(() => {
  'use strict';

  if (location.origin !== 'https://ocean.secondnature.ai') return;
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices || window.__fakeMic) return;

  const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
  let audioContext;
  let destination;
  let oscillator;
  let silentGain;
  let playing = false;

  function ensureAudioGraph() {
    if (audioContext) return;
    audioContext = new AudioContext({ sampleRate: 48000 });
    destination = audioContext.createMediaStreamDestination();
    oscillator = audioContext.createOscillator();
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    oscillator.connect(silentGain).connect(destination);
    oscillator.start();
  }

  async function resumeAudio() {
    if (audioContext.state === 'running') return;
    let timer;
    try {
      await Promise.race([
        audioContext.resume(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            'AudioContext is suspended. Click the target page, then retry playback.'
          )), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function deviceIdFrom(constraints) {
    const requested = typeof constraints.deviceId === 'string'
      ? constraints.deviceId
      : constraints.deviceId?.exact ?? constraints.deviceId?.ideal;
    return (Array.isArray(requested) ? requested[0] : requested) || 'default';
  }

  Object.defineProperty(mediaDevices, 'getUserMedia', {
    configurable: true,
    // The application's media adapter must be able to wrap this method.
    writable: true,
    value: async function getUserMedia(constraints) {
      if (!constraints?.audio) return originalGetUserMedia(constraints);
      ensureAudioGraph();
      // Creating a stream must not hang while waiting for an autoplay gesture.
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});

      const audioConstraints = constraints.audio === true ? {} : { ...constraints.audio };
      const track = destination.stream.getAudioTracks()[0].clone();
      const originalSettings = track.getSettings.bind(track);
      Object.defineProperties(track, {
        label: { configurable: true, get: () => 'Training Virtual Microphone' },
        getSettings: {
          configurable: true,
          writable: true,
          value: () => ({
            ...originalSettings(),
            deviceId: deviceIdFrom(audioConstraints),
            groupId: 'training-audio',
            sampleRate: audioContext.sampleRate,
          }),
        },
        getConstraints: {
          configurable: true,
          writable: true,
          value: () => ({ ...audioConstraints }),
        },
      });

      const stream = new MediaStream([track]);
      try {
        if (constraints.video) {
          const videoStream = await originalGetUserMedia({ video: constraints.video });
          for (const videoTrack of videoStream.getVideoTracks()) stream.addTrack(videoTrack);
        }
        return stream;
      } catch (error) {
        track.stop();
        throw error;
      }
    },
  });

  // Keep the public helper limited to audio playback; no course/protocol actions.
  window.__fakeMic = Object.freeze({
    async playBase64(base64) {
      if (playing) throw new Error('Audio playback is already in progress.');
      playing = true;
      let source;
      try {
        ensureAudioGraph();
        await resumeAudio();
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const buffer = await audioContext.decodeAudioData(bytes.buffer);
        source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);
        await new Promise((resolve, reject) => {
          source.onended = resolve;
          try { source.start(); } catch (error) { reject(error); }
        });
        return { duration: buffer.duration, state: audioContext.state };
      } finally {
        source?.disconnect();
        playing = false;
      }
    },
  });
})();
