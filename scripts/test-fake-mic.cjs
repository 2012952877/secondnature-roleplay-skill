'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const load = process.env.PLAYWRIGHT_NODE_MODULES
  ? createRequire(path.join(path.resolve(process.env.PLAYWRIGHT_NODE_MODULES), 'package.json'))
  : require;
const { chromium } = load('playwright');

function makeToneWav() {
  const sampleRate = 48000;
  const samples = sampleRate;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(0.15 * 32767 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
  }
  return wav.toString('base64');
}

async function main() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
  });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // Every request is fulfilled locally. No real training endpoint is contacted.
    await context.route('**/*', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><button id="run">Run audio test</button>',
    }));
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const fakeMicSource = fs.readFileSync(path.join(__dirname, 'fake-mic.js'), 'utf8');
    // Combine into one init script so stub-before-override ordering is explicit.
    const nativeStub = `
      window.__nativeCalls = [];
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true, writable: true,
        value: async constraints => {
          window.__nativeCalls.push(constraints);
          if (!constraints?.video) throw new TypeError('Synthetic original rejected empty media');
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 16;
          canvas.getContext('2d').fillRect(0, 0, 16, 16);
          return canvas.captureStream(1);
        },
      });
    `;
    await page.addInitScript({ content: nativeStub + '\n' + fakeMicSource });
    await page.goto('https://ocean.secondnature.ai/__skill_selftest__', { waitUntil: 'domcontentloaded' });
    const descriptor = await page.evaluate(() => {
      const property = Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getUserMedia');
      const previous = navigator.mediaDevices.getUserMedia;
      window.__wrapperCalls = 0;
      navigator.mediaDevices.getUserMedia = constraints => {
        window.__wrapperCalls++;
        return previous.call(navigator.mediaDevices, constraints);
      };
      return { writable: property.writable, configurable: property.configurable };
    });
    assert.deepEqual(descriptor, { writable: true, configurable: true });

    await page.evaluate(base64 => {
      document.querySelector('#run').onclick = () => {
        window.__testResult = (async () => {
          const first = await navigator.mediaDevices.getUserMedia({ audio: true });
          const firstTrack = first.getAudioTracks()[0];
          firstTrack.stop();
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { ideal: ['synthetic-device'] } },
          });
          const track = stream.getAudioTracks()[0];
          const chunks = [];
          const recorder = new MediaRecorder(stream);
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
          const stopped = new Promise((resolve, reject) => {
            recorder.onstop = resolve;
            recorder.onerror = event => reject(new Error(event.error?.message || 'Recording failed'));
          });
          recorder.start();
          const playback = await window.__fakeMic.playBase64(base64);
          await new Promise(resolve => setTimeout(resolve, 150));
          recorder.stop();
          await stopped;
          const decodeContext = new AudioContext();
          const buffer = await decodeContext.decodeAudioData(await new Blob(chunks).arrayBuffer());
          const samples = buffer.getChannelData(0);
          let sum = 0;
          let peak = 0;
          for (const sample of samples) {
            sum += sample * sample;
            peak = Math.max(peak, Math.abs(sample));
          }
          const result = {
            rms: Math.sqrt(sum / samples.length),
            peak,
            recordedSeconds: buffer.duration,
            playbackSeconds: playback.duration,
            playbackState: playback.state,
            firstState: firstTrack.readyState,
            nextState: track.readyState,
            distinctTrack: firstTrack.id !== track.id,
            label: track.label,
            deviceId: track.getSettings().deviceId,
          };
          await decodeContext.close();
          track.stop();

          const videoOnly = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          result.videoOnlyTracks = videoOnly.getTracks().map(item => item.kind);
          videoOnly.getTracks().forEach(item => item.stop());
          const combined = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          result.combinedTracks = combined.getTracks().map(item => item.kind).sort();
          combined.getTracks().forEach(item => item.stop());
          try { await navigator.mediaDevices.getUserMedia({ audio: false, video: false }); }
          catch (error) { result.originalError = error.message; }
          result.nativeCalls = window.__nativeCalls;
          result.wrapperCalls = window.__wrapperCalls;
          return result;
        })();
      };
    }, makeToneWav());
    await page.getByRole('button', { name: 'Run audio test' }).click({ timeout: 5000 });
    const result = await page.evaluate(() => Promise.race([
      window.__testResult,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Audio self-test timed out')), 15000)),
    ]));
    assert.ok(result.rms > 0.01, `Recorded audio is silent: RMS ${result.rms}`);
    assert.ok(result.peak > 0.03, `Recorded peak is too small: ${result.peak}`);
    assert.ok(result.recordedSeconds >= 0.9);
    assert.equal(result.playbackSeconds, 1);
    assert.equal(result.playbackState, 'running');
    assert.equal(result.firstState, 'ended');
    assert.equal(result.nextState, 'live');
    assert.equal(result.distinctTrack, true);
    assert.equal(result.label, 'Training Virtual Microphone');
    assert.equal(result.deviceId, 'synthetic-device');
    assert.deepEqual(result.videoOnlyTracks, ['video']);
    assert.deepEqual(result.combinedTracks, ['audio', 'video']);
    assert.equal(result.originalError, 'Synthetic original rejected empty media');
    assert.deepEqual(result.nativeCalls, [
      { audio: false, video: true }, { video: true }, { audio: false, video: false },
    ]);
    assert.equal(result.wrapperCalls, 5);

    // The same injected script must leave another origin untouched.
    await page.goto('https://unrelated.invalid/__skill_selftest__', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.evaluate(() => typeof window.__fakeMic), 'undefined');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      passed: true,
      checks: ['writable adapter wrapping', 'clone lifecycle', 'recorded audio',
        'device metadata', 'video passthrough', 'native rejection', 'origin isolation'],
      rms: result.rms,
      peak: result.peak,
      recordedSeconds: result.recordedSeconds,
    }, null, 2));
  } finally {
    // This browser was created solely by the test; no user browser is attached.
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
