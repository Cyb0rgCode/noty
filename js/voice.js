export class VoiceRecorder {
  constructor() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SpeechRec;
    if (this.supported) {
      this.rec = new SpeechRec();
      this.rec.continuous = true;
      this.rec.interimResults = true;
      this.rec.lang = 'en-US';
    }
    this.isRecording = false;
    this.onInterim = null;
    this.onFinal = null;
    this.onStop = null;
    this.onError = null;
    this._finalBuffer = '';
  }

  start(lang = 'en-US') {
    if (!this.supported || this.isRecording) return;
    this.rec.lang = lang;
    this._finalBuffer = '';
    this.isRecording = true;

    this.rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          final += t;
          this._finalBuffer += t + ' ';
        } else {
          interim += t;
        }
      }
      if (interim && this.onInterim) this.onInterim(interim);
      if (final && this.onFinal) this.onFinal(final);
    };

    this.rec.onerror = (e) => {
      this.isRecording = false;
      const msg = {
        'not-allowed':   'Microphone access denied — allow it in browser settings',
        'no-speech':     'No speech detected — try speaking louder',
        'network':       'Network error — voice needs internet connection',
        'audio-capture': 'No microphone found',
        'aborted':       'Recording stopped',
      }[e.error] || `Voice error: ${e.error}`;
      if (this.onError) this.onError(msg);
      if (this.onStop) this.onStop(this._finalBuffer);
    };

    this.rec.onend = () => {
      this.isRecording = false;
      if (this.onStop) this.onStop(this._finalBuffer);
    };

    this.rec.start();
  }

  stop() {
    if (!this.supported || !this.isRecording) return;
    this.rec.stop();
    this.isRecording = false;
  }
}
