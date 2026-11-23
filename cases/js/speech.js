// speechSynthesis wrapper: play, pause, resume, stop, speed.
// Text is always passed to onCaption first, so the words are on screen even when speech is off or unavailable.

export function createSpeech({ onCaption = () => {}, onState = () => {} } = {}) {
  const synth = globalThis.speechSynthesis;
  const supported = !!(synth && globalThis.SpeechSynthesisUtterance);
  let rate = 1, enabled = true, voice = null, last = '';
  let queue = [], current = null, state = 'idle';

  const set = s => { state = s; onState(s); };

  function pickVoice() {
    if (!supported) return;
    const voices = synth.getVoices();
    voice = voices.find(v => v.default && /^en/i.test(v.lang)) || voices.find(v => /^en(-|_)?(US|GB)/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
  }
  if (supported) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }

  // Long utterances stop early in some browsers, so text is read in sentence-sized chunks.
  function chunks(text) {
    const parts = String(text).match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) || [String(text)];
    const out = [];
    let buf = '';
    for (const p of parts.map(x => x.trim()).filter(Boolean)) {
      if ((buf + ' ' + p).length > 180 && buf) { out.push(buf); buf = p; }
      else buf = buf ? `${buf} ${p}` : p;
    }
    if (buf) out.push(buf);
    return out;
  }

  function next() {
    current = queue.shift() || null;
    if (!current) { set('idle'); return; }
    const u = new SpeechSynthesisUtterance(current.text);
    u.rate = rate;
    if (voice) u.voice = voice;
    u.onstart = () => { onCaption(current?.caption ?? '', true); set('speaking'); };
    u.onend = u.onerror = () => next();
    synth.speak(u);
  }

  return {
    supported,
    get state() { return state; },
    get rate() { return rate; },
    get enabled() { return enabled; },
    /** Queue text to be read. Always captioned. */
    speak(text) {
      if (!text) return;
      last = text;
      onCaption(text, false);
      if (!supported || !enabled) return;
      for (const c of chunks(text)) queue.push({ text: c, caption: text });
      if (state === 'idle') next();
    },
    replay() { if (last) { this.stop(); this.speak(last); } },
    pause() { if (supported && state === 'speaking') { synth.pause(); set('paused'); } },
    resume() { if (supported && state === 'paused') { synth.resume(); set('speaking'); } },
    stop() { queue = []; current = null; if (supported) synth.cancel(); set('idle'); },
    setRate(r) { rate = Math.min(2, Math.max(0.5, +r || 1)); },
    setEnabled(on) { enabled = !!on; if (!enabled) this.stop(); }
  };
}
