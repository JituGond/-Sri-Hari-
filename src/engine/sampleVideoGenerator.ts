// Generates a real, multi-scene playable video file in-browser (no external URLs)
// containing active scenes, an intentional silent pause, a repeated clip, and a static filler
// so users can verify real offline detection, cutting, bilingual scripting, and export immediately.

export async function generateSampleVideoFile(
  onProgress?: (pct: number, label: string) => void
): Promise<File> {
  const width = 960;
  const height = 540;
  const fps = 24;
  const totalDurationSec = 14;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const dest = audioCtx.createMediaStreamDestination();

  // Schedule deterministic audio profile:
  // 0.0 - 3.0s: Active vocal-band melody/cadence
  // 3.0 - 5.2s: Complete silence (tests silent_section / long_pause detection)
  // 5.2 - 8.2s: Active screen-tutorial pulses
  // 8.2 - 10.6s: Repeated Scene 1 pattern + quieter tone
  // 10.6 - 12.6s: Very low static hum (tests unnecessary_scene)
  // 12.6 - 14.0s: High-energy climax chord
  const now = audioCtx.currentTime;
  const scheduleTone = (start: number, end: number, freq: number, gainVal: number) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + start + 0.05);
    gain.gain.setValueAtTime(gainVal, now + end - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + end);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now + start);
    osc.stop(now + end);
  };

  // Scene 1 tones (speech-like modulation in 350-900 Hz)
  scheduleTone(0.1, 0.7, 380, 0.25);
  scheduleTone(0.8, 1.5, 460, 0.28);
  scheduleTone(1.6, 2.3, 520, 0.26);
  scheduleTone(2.4, 2.95, 440, 0.22);

  // 3.0 - 5.2s: Silence!

  // Scene 3 tones
  scheduleTone(5.3, 6.0, 580, 0.28);
  scheduleTone(6.1, 6.9, 640, 0.30);
  scheduleTone(7.0, 8.1, 510, 0.25);

  // Scene 4 repeated clip
  scheduleTone(8.3, 9.2, 420, 0.16);
  scheduleTone(9.4, 10.4, 460, 0.15);

  // 10.6 - 12.6s: Static dark scene (silent)

  // Scene 6 climax highlight
  scheduleTone(12.65, 13.9, 720, 0.34);
  scheduleTone(12.65, 13.9, 540, 0.25);

  const canvasStream = canvas.captureStream(fps);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 2_200_000,
    audioBitsPerSecond: 128_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<File>((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const file = new File([blob], 'Screen_Recording_Android_Demo.webm', { type: mimeType });
      audioCtx.close().catch(() => {});
      resolve(file);
    };
  });

  recorder.start(250);

  const drawFrame = (t: number) => {
    // Determine scene visual state
    // Scene 1 (0..3s) & Scene 4 repeated (8.2..10.6s) share identical visual geometry so dHash flags repeat!
    const isRepeatWindow = t >= 8.2 && t < 10.6;
    if (t < 3.0 || isRepeatWindow) {
      const localT = isRepeatWindow ? t - 8.2 : t;
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#0F172A');
      grad.addColorStop(1, '#1E293B');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Moving geometric cards
      const offset = Math.sin(localT * 2.2) * 80;
      ctx.fillStyle = '#E04F16';
      ctx.beginPath();
      ctx.roundRect(120 + offset, 130, 320, 260, 24);
      ctx.fill();

      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.roundRect(480 - offset * 0.5, 160, 340, 200, 20);
      ctx.fill();

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('SCENE 01 · INTRO', 510 - offset * 0.5, 245);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText('Dynamic Opening Sequence', 510 - offset * 0.5, 285);
    } else if (t >= 3.0 && t < 5.2) {
      // Static frozen pause (same pixels every frame, zero motion, silent)
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#334155';
      ctx.fillRect(280, 220, 400, 90);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '26px sans-serif';
      ctx.fillText('... Long Silent Pause ...', 330, 274);
    } else if (t >= 5.2 && t < 8.2) {
      // Scene 3: Bright UI walkthrough motion
      const localT = t - 5.2;
      ctx.fillStyle = '#F1F5F9';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, width, 74);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('Mobile Workflow Walkthrough', 48, 46);

      const barW = 140 + ((localT * 180) % 520);
      ctx.fillStyle = '#0284C7';
      ctx.beginPath();
      ctx.roundRect(80, 140, barW, 110, 18);
      ctx.fill();

      ctx.fillStyle = '#059669';
      ctx.beginPath();
      ctx.roundRect(80, 290, 780 - barW * 0.4, 130, 18);
      ctx.fill();
    } else if (t >= 10.6 && t < 12.6) {
      // Static dark unnecessary scene
      ctx.fillStyle = '#090D16';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(60, 60, 840, 420);
    } else {
      // Scene 6: High-contrast energetic finale
      const localT = t - 12.6;
      const pulse = Math.abs(Math.sin(localT * 6));
      ctx.fillStyle = '#18181B';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = `rgb(${215 + Math.round(pulse * 35)}, 79, 22)`;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 110 + pulse * 55, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText('KEY HIGHLIGHT', width / 2 - 145, height / 2 + 12);
    }
  };

  const totalFrames = totalDurationSec * fps;
  for (let f = 0; f <= totalFrames; f++) {
    const t = f / fps;
    drawFrame(t);
    if (f % 12 === 0 && onProgress) {
      onProgress(Math.round((f / totalFrames) * 100), `Generating test clip (${t.toFixed(1)}s / ${totalDurationSec}s)`);
    }
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  recorder.stop();
  return stopped;
}
