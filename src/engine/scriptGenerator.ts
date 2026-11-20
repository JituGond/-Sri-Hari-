import {
  AnalysisSummary,
  BilingualScript,
  SceneBeat,
  TimelineSegment,
  VideoCategory,
} from '../types/hanuman';

function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function cleanTopicFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const tokens = base
    .replace(/[_-]+/g, ' ')
    .replace(/\b(screen|recording|vid|video|img|mov|mp4|webm|android|demo|clip|copy|final|edited)\b/gi, '')
    .replace(/\d{6,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return tokens.length >= 3 ? tokens : 'this visual walkthrough';
}

function inferCategory(
  requested: VideoCategory,
  summary: AnalysisSummary,
  segments: TimelineSegment[]
): Exclude<VideoCategory, 'auto_detect'> {
  if (requested !== 'auto_detect') return requested;
  const lower = summary.fileName.toLowerCase();
  if (lower.includes('screen') || lower.includes('tutorial') || lower.includes('how') || lower.includes('app')) {
    return 'tutorial_screen';
  }
  if (lower.includes('review') || lower.includes('unbox') || lower.includes('product')) {
    return 'product_review';
  }
  if (summary.visualProfile.aspect === 'portrait' && summary.editedDurationSec <= 65) {
    return 'motivational_reel';
  }
  const hasHighMotion = segments.some((s) => s.action === 'keep' && s.motionScore > 0.08);
  return hasHighMotion ? 'vlog_story' : 'educational';
}

export function generateOfflineBilingualScript(
  summary: AnalysisSummary,
  segments: TimelineSegment[],
  requestedCategory: VideoCategory
): BilingualScript {
  const category = inferCategory(requestedCategory, summary, segments);
  const topic = cleanTopicFromFilename(summary.fileName);
  const kept = segments.filter((s) => s.action === 'keep');
  const firstPeak = summary.peakMoments[0]?.timeSec ?? (kept[0]?.startSec ?? 0);
  const mainClimax = summary.peakMoments[summary.peakMoments.length - 1]?.timeSec ?? (kept[kept.length - 1]?.startSec ?? 0);
  const origDur = formatTimestamp(summary.durationSec);
  const editDur = formatTimestamp(summary.editedDurationSec);
  const savedPct = Math.round(summary.savedPercent);
  const cutCount = segments.filter((s) => s.action === 'cut').length;

  const pacingWordEn =
    summary.visualProfile.pacing === 'dynamic'
      ? 'fast-paced, high-energy'
      : summary.visualProfile.pacing === 'moderate'
      ? 'steady, crisp'
      : 'calm, focused';

  const pacingWordHi =
    summary.visualProfile.pacing === 'dynamic'
      ? 'तेज़ और ऊर्जावान'
      : summary.visualProfile.pacing === 'moderate'
      ? 'संतुलित और स्पष्ट'
      : 'शांत और गहन';

  // Build scene-by-scene beats grounded in actual kept EDL segments
  const sceneBeats: SceneBeat[] = kept.slice(0, 12).map((seg, idx) => {
    const tRange = `${formatTimestamp(seg.startSec)} – ${formatTimestamp(seg.endSec)}`;
    const isOpening = idx === 0;
    const isClosing = idx === kept.length - 1 && kept.length > 1;
    const isHighlight = seg.reason === 'highlight' || seg.motionScore > 0.065;

    let visualCue = '';
    let englishLine = '';
    let hindiLine = '';

    if (isOpening) {
      visualCue = `Opening visual (${tRange}) · Brightness: ${summary.visualProfile.brightness}, Motion: ${seg.motionScore.toFixed(2)}`;
      englishLine =
        category === 'tutorial_screen'
          ? `Look closely at the screen right here—most people waste minutes before spotting what actually works in ${topic}.`
          : `Stop scrolling for three seconds. What happens in this opening frame sets up the sharpest moment of ${topic}.`;
      hindiLine =
        category === 'tutorial_screen'
          ? `ज़रा स्क्रीन पर ध्यान से देखिए—यहीं से असली फर्क शुरू होता है, जिसे ज़्यादातर लोग ${topic} में नज़रअंदाज़ कर देते हैं।`
          : `सिर्फ़ तीन सेकंड रुकिए! शुरुआती फ़्रेम में जो दिख रहा है, वही इस पूरे वीडियो की सबसे ख़ास कहानी शुरू करता है।`;
    } else if (isClosing) {
      visualCue = `Closing payoff (${tRange}) · Audio peak: ${seg.avgAudioDb.toFixed(0)} dB`;
      englishLine = `And that brings everything together in just ${editDur}. Save this cut and compare it with your first attempt—you will notice the difference immediately.`;
      hindiLine = `और इसी के साथ सिर्फ़ ${editDur} में पूरी बात साफ़ हो जाती है। इस वीडियो को सेव कर लें और अगली बार इसे आज़माकर फर्क खुद देखें।`;
    } else if (isHighlight) {
      visualCue = `Peak moment #${idx + 1} (${tRange}) · High action/audio energy`;
      englishLine = `Now watch this key shift right at ${formatTimestamp(seg.startSec)}—this is the turning point where pace and clarity lock in.`;
      hindiLine = `अब ${formatTimestamp(seg.startSec)} पर होने वाले इस ख़ास बदलाव को देखिए—यही वह मोड़ है जहाँ पूरा दृश्य और संदेश सबसे असरदार बन जाता है।`;
    } else {
      visualCue = `Story beat #${idx + 1} (${tRange}) · Clean kept cut`;
      englishLine = `Notice how the flow stays tight as we move straight into step ${idx + 1} without any dead air or repetition.`;
      hindiLine = `बिना किसी रुकावट या दोहराव के अब हम सीधे अगले मुख्य हिस्से की तरफ़ बढ़ते हैं, ताकि दर्शकों की पकड़ बनी रहे।`;
    }

    return {
      id: seg.id,
      startSec: seg.startSec,
      endSec: seg.endSec,
      visualCue,
      englishLine,
      hindiLine,
    };
  });

  // Category-specific hooks, storytelling, transitions & endings (English + Hindi)
  const enHook = (() => {
    switch (category) {
      case 'tutorial_screen':
        return `"You don't need a complicated setup to master ${topic}—watch the first ${Math.min(5, Math.max(2, Math.round(summary.editedDurationSec * 0.15)))} seconds carefully and skip the trial-and-error."`;
      case 'product_review':
        return `"Before you spend anything on ${topic}, look at what actually shows up at ${formatTimestamp(firstPeak)}—no hype, just real footage."`;
      case 'motivational_reel':
        return `"Most people quit right before the shift you are about to see at ${formatTimestamp(mainClimax)}. Watch this ${editDur} breakdown till the final frame."`;
      case 'educational':
        return `"What usually takes ${origDur} to explain just got distilled into ${editDur} of pure signal. Here is the one detail that makes it click."`;
      default:
        return `"I cut ${savedPct}% of dead air out of ${topic}—what's left is the raw, ${pacingWordEn} story from ${formatTimestamp(kept[0]?.startSec ?? 0)} to the payoff."`;
    }
  })();

  const hiHook = (() => {
    switch (category) {
      case 'tutorial_screen':
        return `"${topic} को समझने के लिए आपको लंबे इंतज़ार की ज़रूरत नहीं है—बस शुरुआती कुछ सेकंड ध्यान से देखिए और पूरा तरीका आसान बनाइए।"`;
      case 'product_review':
        return `"कोई भी फ़ैसला लेने से पहले ${formatTimestamp(firstPeak)} पर दिखने वाले असली नतीजे को देखिए—बिना किसी दिखावे के, सीधी सच्चाई।"`;
      case 'motivational_reel':
        return `"ज़्यादातर लोग ठीक उस मोड़ से पहले हार मान लेते हैं जो ${formatTimestamp(mainClimax)} पर दिखने वाला है। आख़िरी सेकंड तक ज़रूर देखिए।"`;
      case 'educational':
        return `"जो बात समझने में अक्सर ${origDur} लग जाते हैं, उसे अब हमने सिर्फ़ ${editDur} के सटीक सार में समेट दिया है।"`;
      default:
        return `"हमने बेकार के ठहराव और दोहराव हटाकर ${topic} की ${pacingWordHi} कहानी को ${editDur} में तैयार किया है—शुरू से अंत तक जुड़े रहिए।"`;
    }
  })();

  const enStorytelling = [
    `Opening Context (${formatTimestamp(kept[0]?.startSec ?? 0)}): Establish the core visual immediately. Ground the viewer in what is visible on screen (${summary.visualProfile.aspect} framing, ${summary.visualProfile.brightness} lighting) so they understand the stakes within 3 seconds.`,
    `Rising Momentum (${formatTimestamp(firstPeak)}): Lean into the natural peak detected in the footage. Because ${cutCount} pauses and repeated frames were removed automatically, speak with brisk, conversational confidence.`,
    `Core Payoff (${formatTimestamp(mainClimax)}): Deliver the primary insight or reveal cleanly while the strongest visual sequence plays out—let the visuals breathe without clutter.`,
  ].join('\n\n');

  const hiStorytelling = [
    `शुरुआती जुड़ाव (${formatTimestamp(kept[0]?.startSec ?? 0)}): पहले ही सेकंड से दर्शक को मुख्य विषय से जोड़ें। स्क्रीन पर दिख रहे दृश्य (${summary.visualProfile.aspect} फ़्रेम, ${summary.visualProfile.brightness} लाइटिंग) के साथ अपनी बात सीधे शुरू करें।`,
    `कहानी की रफ़्तार (${formatTimestamp(firstPeak)}): वीडियो के सबसे ऊर्जावान हिस्से के साथ अपनी आवाज़ में आत्मविश्वास रखें। चूँकि ${cutCount} अनचाहे ठहराव और दोहराए गए हिस्से अपने-आप हट चुके हैं, आपकी बात तेज़ और असरदार लगेगी।`,
    `मुख्य निष्कर्ष (${formatTimestamp(mainClimax)}): सबसे मज़बूत दृश्य के समय अपना मुख्य संदेश दें—कम शब्दों में साफ़ और यादगार बात कहें।`,
  ].join('\n\n');

  const enTransitions = [
    `Cut Jump Bridge #1: "Wait—here is where most people miss the real step..."`,
    `Cut Jump Bridge #2: "Now watch what happens the moment we strip out the delay..."`,
    `Pre-Climax Retention Hook: "Hold on for this next frame—this single detail changes the entire outcome."`,
  ];

  const hiTransitions = [
    `ट्रांज़िशन लाइन #1: "रुकिए—यहीं पर ज़्यादातर लोग असली बारीकी को चूक जाते हैं..."`,
    `ट्रांज़िशन लाइन #2: "अब देखिए, जैसे ही बीच की रुकावट हटती है, तस्वीर कैसे बदलती है..."`,
    `क्लाइमेक्स से पहले हुक: "अगले फ़्रेम पर नज़र टिकाए रखिए—यही एक बदलाव पूरा नतीजा पलट देता है।"`,
  ];

  const enEnding = `"That is the complete ${editDur} transformation—trimmed from ${origDur} without losing a single key moment. If that helped you see ${topic} clearly, watch the opening frame again right now and notice how every detail connects."`;

  const hiEnding = `"तो यह था ${origDur} से सिमटकर बना ${editDur} का सटीक और दमदार सफ़र—एक भी ज़रूरी पल खोए बिना। अगर आपको यह प्रस्तुति पसंद आई, तो वीडियो के पहले दृश्य को दोबारा देखिए—अब हर कड़ी अपने-आप जुड़ती नज़र आएगी।"`;

  const enPlain = [
    `HANUMAN AI — ENGLISH VIDEO SCRIPT (SEPARATE FROM VIDEO OVERLAYS)`,
    `Topic: ${topic} | Edited Length: ${editDur} (Saved ${savedPct}%)`,
    ``,
    `[01. POWERFUL HOOK]`,
    enHook,
    ``,
    `[02. STORYTELLING STRUCTURE]`,
    enStorytelling,
    ``,
    `[03. ENGAGING TRANSITIONS]`,
    ...enTransitions.map((t) => `• ${t}`),
    ``,
    `[04. RETENTION ENDING]`,
    enEnding,
    ``,
    `[05. SCENE-BY-SCENE VOICEOVER BEATS]`,
    ...sceneBeats.map((b) => `[${formatTimestamp(b.startSec)} - ${formatTimestamp(b.endSec)}] ${b.englishLine}`),
  ].join('\n');

  const hiPlain = [
    `हनुमान AI — हिंदी वीडियो स्क्रिप्ट (वीडियो से पूर्णतः पृथक)`,
    `विषय: ${topic} | संपादित अवधि: ${editDur} (${savedPct}% समय की बचत)`,
    ``,
    `[01. दमदार हुक (Hook)]`,
    hiHook,
    ``,
    `[02. कहानी का प्रवाह (Storytelling)]`,
    hiStorytelling,
    ``,
    `[03. आकर्षक ट्रांज़िशन (Transitions)]`,
    ...hiTransitions.map((t) => `• ${t}`),
    ``,
    `[04. प्रभावशाली अंत (Engaging Ending)]`,
    hiEnding,
    ``,
    `[05. दृश्य-दर-दृश्य वॉइसओवर (Scene Beats)]`,
    ...sceneBeats.map((b) => `[${formatTimestamp(b.startSec)} - ${formatTimestamp(b.endSec)}] ${b.hindiLine}`),
  ].join('\n');

  return {
    category,
    generatedAt: Date.now(),
    isolatedFromVideo: true,
    english: {
      title: `English Retention Script — ${topic}`,
      hook: enHook,
      storytelling: enStorytelling,
      transitions: enTransitions,
      ending: enEnding,
      fullPlainText: enPlain,
    },
    hindi: {
      title: `हिंदी रिटेंशन स्क्रिप्ट — ${topic}`,
      hook: hiHook,
      storytelling: hiStorytelling,
      transitions: hiTransitions,
      ending: hiEnding,
      fullPlainText: hiPlain,
    },
    sceneBeats,
  };
}
