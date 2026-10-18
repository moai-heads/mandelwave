(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (n, digits = 2) => Number(n).toFixed(digits);
  const defs = {
    zoom: { label: 'Zoom', min: 0.55, max: 2.2, step: 0.01, value: 1.04, digits: 2 },
    twist: { label: 'Twist', min: 0, max: 2.8, step: 0.01, value: 0.78, digits: 2 },
    speed: { label: 'Drift', min: 0.08, max: 1.7, step: 0.01, value: 0.48, digits: 2 },
    symmetry: { label: 'Symmetry', min: 3, max: 12, step: 1, value: 7, digits: 0 },
    hue: { label: 'Palette', min: 0, max: 1, step: 0.001, value: 0.76, digits: 2 },
    glow: { label: 'Glow', min: 0.2, max: 1.35, step: 0.01, value: 0.82, digits: 2 },
  };
  const scenes = ['PRISMATIC BLOOM', 'INFINITE GARDEN', 'LIQUID WORMHOLE', 'LASER FIELD'];
  const initialParams = Object.fromEntries(Object.entries(defs).map(([key, d]) => [key, d.value]));
  const defaultAutomation = Object.fromEntries(Object.entries(defs).map(([key, d]) => [key, {
    mode: key === 'glow' ? 'high' : 'hold', min: d.min, max: d.max, period: 8,
  }]));
  const presets = [
    { name: 'Prismatic bloom', scene: 0, params: { zoom: 1.04, twist: .78, speed: .48, symmetry: 7, hue: .76, glow: .82 } },
    { name: 'Cathedral of glass', scene: 0, params: { zoom: .78, twist: 1.24, speed: .28, symmetry: 10, hue: .48, glow: 1.02 } },
    { name: 'Mandelbrot garden', scene: 1, params: { zoom: 1.18, twist: .44, speed: .22, symmetry: 6, hue: .84, glow: .72 } },
    { name: 'Liquid wormhole', scene: 2, params: { zoom: 1.21, twist: 1.4, speed: .62, symmetry: 8, hue: .93, glow: .91 } },
    { name: 'Laser geometry', scene: 3, params: { zoom: .86, twist: .34, speed: .34, symmetry: 9, hue: .33, glow: .88 } },
    { name: 'Quiet mycelium', scene: 1, params: { zoom: .68, twist: .21, speed: .13, symmetry: 5, hue: .58, glow: .58 } },
  ];

  const state = {
    scene: 0,
    params: { ...initialParams },
    automation: structuredClone(defaultAutomation),
    bands: { bass: 0, mid: 0, high: 0 },
    smoothBands: { bass: 0, mid: 0, high: 0 },
    audioContext: null,
    analyser: null,
    source: null,
    micStream: null,
    freqData: null,
    waveData: null,
    audioMode: 'none',
    audioSourceNode: null,
    mediaSourceNode: null,
    audioUrl: null,
    startedAt: performance.now(),
    lastTime: 0,
    lowMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    frameCount: 0,
    fpsStamp: performance.now(),
    fps: 60,
  };

  const glCanvas = $('#visualizer');
  const waveformCanvas = $('#waveform');
  const waveformCtx = waveformCanvas.getContext('2d');
  let gl = null;
  let uniforms = {};
  let fallbackCtx = null;
  let fallback = false;

  const vertexSource = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main(){ vUv = aPosition * .5 + .5; gl_Position = vec4(aPosition,0.0,1.0); }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec2 vUv;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uScene;
    uniform float uZoom;
    uniform float uTwist;
    uniform float uSymmetry;
    uniform float uHue;
    uniform float uGlow;
    uniform float uBass;
    uniform float uMid;
    uniform float uHigh;
    uniform float uIntensity;
    uniform vec2 uPointer;
    const float PI = 3.141592653589793;
    vec2 rot(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
    vec3 hsv(vec3 c){vec3 p=abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
    float mandel(vec2 c){vec2 z=vec2(0.);float n=0.;for(int i=0;i<32;i++){float x=z.x*z.x-z.y*z.y+c.x;float y=2.*z.x*z.y+c.y;z=vec2(x,y);if(dot(z,z)>100.)break;n+=1.;}return n/32.;}
    void main(){
      vec2 uv=(gl_FragCoord.xy-.5*uResolution)/uResolution.y;
      float t=uTime;
      float bass=uBass, mid=uMid, high=uHigh;
      vec2 p=uv/max(.4,uZoom);
      p=rot(p, t*.045 + uTwist*.18 + uPointer.x*.18);
      p += uPointer*.035;
      float n=max(3.,floor(uSymmetry+.5));
      float aa=atan(p.y,p.x), rr=length(p);
      float sector=2.*PI/n;
      float folded=abs(mod(aa+sector*.5,sector)-sector*.5);
      vec2 k=vec2(cos(folded),sin(folded))*rr;
      k += .045*vec2(sin(k.y*8.+t*.34),cos(k.x*8.-t*.29))*(.3+uTwist);
      float f=0.; float glow=0.; float hue=uHue;
      if(uScene<.5){
        float petals=sin(folded*n*1.3 + rr*7.2 - t*.44 - mid*.8);
        float rings=sin(rr*29. - sin(folded*n*2. + t*.22)*3.2 - bass*2.2);
        float lattice=sin((k.x+k.y)*17.+t*.18)*cos((k.x-k.y)*16.-t*.2);
        f=.52 + .22*petals + .16*rings + .10*lattice;
        glow=exp(-abs(rings)*2.8)+exp(-abs(petals)*3.8)*.6;
        hue += .045*sin(folded*n + t*.12) + high*.06;
      }else if(uScene<1.5){
        vec2 c=p*1.6 + vec2(-.52,.035*sin(t*.15));
        c += vec2(.035*sin(t*.09),.025*cos(t*.12));
        float m=mandel(c);
        float bands=sin(m*61. + t*.26 + high*1.2);
        f=.25+.6*m+.15*bands;
        glow=exp(-abs(bands)*2.4)*(1.-m*.55);
        hue += m*.26 + .08*sin(t*.08);
      }else if(uScene<2.5){
        float a=folded;
        float tunnel=sin(17.*a + 3.4/(rr+.15) - t*.48 - bass*2.3);
        float rings=sin(34./(rr+.22) - t*.62 + mid*2.);
        float spiral=sin(a*n + 12.*rr - t*.27 + uTwist);
        f=.46+.23*tunnel+.18*rings+.13*spiral;
        glow=exp(-abs(tunnel)*3.)+exp(-abs(rings)*3.)*.8;
        hue += .12*cos(a*n-t*.11)+high*.08;
      }else{
        vec2 q=rot(k,t*.05);
        float beam=sin((q.x*1.2+q.y*.42)*36. + sin(q.y*10.-t*.25)*2. - t*.35 - mid*2.);
        float grid=sin(q.y*25.+t*.17)*sin(q.x*15.-t*.12);
        float radial=sin(rr*24.-t*.35-bass*2.);
        f=.42+.28*beam+.16*grid+.14*radial;
        glow=exp(-abs(beam)*3.2)+exp(-abs(radial)*3.)*.7;
        hue += .07*sin(q.y*4.+t*.14)+high*.12;
      }
      float center=exp(-rr*rr*(5.5+uGlow*3.));
      float edge=1.-smoothstep(1.0,1.62,length(uv));
      float energy=clamp(f,0.,1.2);
      vec3 col=hsv(vec3(fract(hue + energy*.11 + bass*.045),.72, .16+energy*.58));
      vec3 neon=hsv(vec3(fract(hue+.36+mid*.07),.88,.8));
      col += neon*glow*(.13+uGlow*.15);
      col += hsv(vec3(fract(hue+.58),.65,1.))*center*(.16+uGlow*.2);
      float audioWave=sin(uv.x*42. + t*.9)*exp(-abs(uv.y-(.38*bass-.24*mid))*95.);
      col += hsv(vec3(fract(hue+.53),.82,1.))*audioWave*(.06+.18*high);
      float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5;
      col += grain*.018;
      col *= edge * uIntensity;
      col = pow(max(col,0.),vec3(.88));
      gl_FragColor=vec4(col,1.);
    }
  `;

  function initGL() {
    try {
      gl = glCanvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL is unavailable');
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program,'aPosition'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
      for (const name of ['uResolution','uTime','uScene','uZoom','uTwist','uSymmetry','uHue','uGlow','uBass','uMid','uHigh','uIntensity','uPointer']) uniforms[name]=gl.getUniformLocation(program,name);
      gl.clearColor(0,0,0,1);
    } catch (e) {
      console.warn('Mandelwave WebGL fallback:', e.message);
      fallback = true; fallbackCtx = glCanvas.getContext('2d');
      $('#engineLabel').textContent = 'CANVAS ENGINE / READY';
      $$('.webgl-badge').forEach(el=>el.textContent='CANVAS / 2D');
    }
    resize();
  }

  function resize() {
    const rect = glCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.65);
    glCanvas.width = Math.max(1, Math.round(rect.width*dpr));
    glCanvas.height = Math.max(1, Math.round(rect.height*dpr));
    if (gl) gl.viewport(0,0,glCanvas.width,glCanvas.height);
    const wr = waveformCanvas.getBoundingClientRect();
    waveformCanvas.width = Math.max(1, Math.round(wr.width*dpr));
    waveformCanvas.height = Math.max(1, Math.round(wr.height*dpr));
  }

  function makeControls() {
    const params = $('#parameterControls');
    const autos = $('#automationControls');
    const modeNames = { hold:'HOLD', sine:'SINE', ease:'EASE', bass:'BASS', mid:'MIDS', high:'AIR' };
    for (const [key,d] of Object.entries(defs)) {
      const row = document.createElement('label'); row.className='parameter-row';
      row.innerHTML = `<span class="parameter-label">${d.label}</span><input class="range-control base-control" type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${state.params[key]}" aria-label="${d.label}"><output class="parameter-value">${fmt(state.params[key],d.digits)}</output>`;
      const slider=$('.base-control',row), output=$('output',row);
      slider.addEventListener('input',()=>{state.params[key]=Number(slider.value);output.value=fmt(slider.value,d.digits);output.textContent=output.value;});
      params.append(row);

      const auto = state.automation[key];
      const ar = document.createElement('div'); ar.className='automation-row'; ar.dataset.key=key;
      ar.innerHTML = `<span class="auto-name">${d.label.toUpperCase()}</span><select class="auto-mode" aria-label="${d.label} modulation">${Object.entries(modeNames).map(([v,n])=>`<option value="${v}" ${auto.mode===v?'selected':''}>${n}</option>`).join('')}</select><div class="auto-range"><label class="auto-range-line"><span>LO</span><input class="range-control min-control" type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${auto.min}" aria-label="${d.label} modulation low"><output>${fmt(auto.min,d.digits)}</output></label><label class="auto-range-line"><span>HI</span><input class="range-control max-control" type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${auto.max}" aria-label="${d.label} modulation high"><output>${fmt(auto.max,d.digits)}</output></label></div><input class="auto-period" type="number" min="2" max="30" step="1" value="${auto.period}" title="Cycle period in seconds" aria-label="${d.label} cycle seconds">`;
      const mode=$('.auto-mode',ar), minCtl=$('.min-control',ar), maxCtl=$('.max-control',ar), period=$('.auto-period',ar);
      const sync = (which) => {
        let lo=Number(minCtl.value), hi=Number(maxCtl.value);
        if(lo>hi){ if(which==='min') hi=lo; else lo=hi; }
        auto.min=lo; auto.max=hi; auto.period=clamp(Number(period.value)||8,2,30);
        minCtl.value=lo; maxCtl.value=hi;
        $('output',minCtl.parentElement).textContent=fmt(lo,d.digits);
        $('output',maxCtl.parentElement).textContent=fmt(hi,d.digits);
        const hold=mode.value==='hold'; minCtl.disabled=hold; maxCtl.disabled=hold; period.disabled=hold||mode.value==='bass'||mode.value==='mid'||mode.value==='high';
      };
      mode.addEventListener('change',()=>{auto.mode=mode.value;sync();});
      minCtl.addEventListener('input',()=>sync('min')); maxCtl.addEventListener('input',()=>sync('max'));
      period.addEventListener('change',()=>sync()); sync(); autos.append(ar);
    }
    const select=$('#presetSelect');
    presets.forEach((p,i)=>{const opt=document.createElement('option');opt.value=String(i);opt.textContent=p.name;select.append(opt);});
    select.addEventListener('change',()=>applyPreset(Number(select.value)));
  }

  function applyPreset(index) {
    const preset=presets[index]; if(!preset)return;
    state.scene=preset.scene;
    for(const key of Object.keys(defs)) state.params[key]=preset.params[key];
    updateControlValues(); updateSceneUI();
  }
  function updateControlValues(){
    for(const [key,d] of Object.entries(defs)){
      const row=$$('.parameter-row')[Object.keys(defs).indexOf(key)];
      const input=$('.base-control',row),output=$('output',row);
      input.value=state.params[key]; output.value=fmt(state.params[key],d.digits); output.textContent=output.value;
    }
  }
  function updateSceneUI(){
    $$('.scene-card').forEach(b=>b.classList.toggle('selected',Number(b.dataset.scene)===state.scene));
    $('#sceneName').textContent=scenes[state.scene];$('#transportMood').textContent=scenes[state.scene];
    $('#sceneIndex').textContent=`0${state.scene+1} / 04`;
  }
  function valueFor(key,t){
    const cfg=state.automation[key]; if(!cfg||cfg.mode==='hold')return state.params[key];
    const lo=Math.min(cfg.min,cfg.max),hi=Math.max(cfg.min,cfg.max);let x=0;
    if(cfg.mode==='sine') x=.5+.5*Math.sin((t/cfg.period)*Math.PI*2);
    else if(cfg.mode==='ease') {const phase=(t/cfg.period)%1;const tri=phase<.5?phase*2:2-phase*2;x=tri*tri*(3-2*tri);}
    else x=state.smoothBands[cfg.mode]??0;
    return lo+(hi-lo)*clamp(x,0,1);
  }

  function setPanel(open){
    document.body.classList.toggle('panel-open',open);
    $('#controlToggle').setAttribute('aria-expanded',String(open));
    $('#controlPanel').setAttribute('aria-hidden',String(!open));
  }
  $('#controlToggle').addEventListener('click',()=>setPanel(!document.body.classList.contains('panel-open')));
  $('#heroOpen').addEventListener('click',()=>setPanel(true));$('#closePanel').addEventListener('click',()=>setPanel(false));$('#panelBackdrop').addEventListener('click',()=>setPanel(false));
  $$('.scene-card').forEach(card=>card.addEventListener('click',()=>{state.scene=Number(card.dataset.scene);updateSceneUI();}));

  function setupAudioContext(){
    if(!state.audioContext){
      const AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(!AudioCtx)throw new Error('Web Audio is not supported in this browser.');
      state.audioContext=new AudioCtx();state.analyser=state.audioContext.createAnalyser();state.analyser.fftSize=2048;state.analyser.smoothingTimeConstant=.72;
      state.freqData=new Uint8Array(state.analyser.frequencyBinCount);state.waveData=new Uint8Array(state.analyser.fftSize);
    }
    if(state.audioContext.state==='suspended')state.audioContext.resume();
  }
  function stopMic(){
    if(state.audioMode==='mic'){
      try{state.audioSourceNode?.disconnect();}catch{}
      state.micStream?.getTracks().forEach(t=>t.stop());state.micStream=null;state.audioSourceNode=null;
      state.audioMode='none';
    }
  }
  function connectMediaAudio(){
    setupAudioContext();
    stopMic();
    if(!state.mediaSourceNode){state.mediaSourceNode=state.audioContext.createMediaElementSource($('#audioElement'));}
    try{state.mediaSourceNode.disconnect();}catch{}
    state.mediaSourceNode.connect(state.analyser);state.analyser.connect(state.audioContext.destination);
    state.audioMode='file';
    $('#playButton').disabled=false;$('#sourceStatus').textContent='FILE AUDIO · ANALYSING';$('#inputIndicator').textContent='FILE';$('#transportSource').textContent='FILE INPUT';$('#micButton').classList.remove('active');$('#panelMicButton').classList.remove('active');$('#panelFileButton').classList.add('active');
  }
  async function startMic(){
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone input requires a secure browser context (HTTPS or localhost).');
      setupAudioContext();
      if(state.audioMode==='mic'){stopMic();updateAudioUI();return;}
      stopMic();$('#audioElement').pause();
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      state.micStream=stream;state.audioSourceNode=state.audioContext.createMediaStreamSource(stream);state.audioSourceNode.connect(state.analyser);state.audioMode='mic';
      $('#playButton').disabled=true;$('#playGlyph').textContent='▶';$('#sourceStatus').textContent='MICROPHONE · ANALYSING';$('#inputIndicator').textContent='MIC LIVE';$('#transportSource').textContent='LIVE MIC';$('#micButton').classList.add('active');$('#panelMicButton').classList.add('active');$('#panelFileButton').classList.remove('active');$('#trackName').textContent='Live microphone';$('#trackTime').textContent='Listening in this browser only';
    }catch(e){alert(e.message||'Could not connect microphone.');}
    updateAudioUI();
  }
  function updateAudioUI(){
    if(state.audioMode==='none'){
      $('#sourceStatus').textContent='NO SIGNAL · READY';$('#inputIndicator').textContent='IDLE';$('#transportSource').textContent='VISUALS RUNNING';
      $('#micButton').classList.remove('active');$('#panelMicButton').classList.remove('active');$('#panelFileButton').classList.remove('active');
    }
  }
  function loadFile(file){
    if(!file||!file.type.startsWith('audio/')){alert('Choose an audio file to feed the visualizer.');return;}
    stopMic();
    if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);
    state.audioUrl=URL.createObjectURL(file);
    const audio=$('#audioElement');audio.src=state.audioUrl;audio.load();connectMediaAudio();
    $('#trackName').textContent=file.name;$('#trackTime').textContent='Ready to play · audio stays on this device';
    audio.play().then(()=>{$('#playGlyph').textContent='Ⅱ';}).catch(()=>{$('#playGlyph').textContent='▶';});
  }
  $('#fileButton').addEventListener('click',()=>$('#audioFile').click());$('#panelFileButton').addEventListener('click',()=>$('#audioFile').click());
  $('#audioFile').addEventListener('change',e=>{loadFile(e.target.files[0]);e.target.value='';});
  $('#micButton').addEventListener('click',startMic);$('#panelMicButton').addEventListener('click',startMic);
  $('#playButton').addEventListener('click',async()=>{
    const audio=$('#audioElement');if(!audio.src)return;
    setupAudioContext(); if(audio.paused){try{await audio.play();$('#playGlyph').textContent='Ⅱ';}catch(e){console.warn(e);}}else{audio.pause();$('#playGlyph').textContent='▶';}
  });
  $('#audioElement').addEventListener('play',()=>$('#playGlyph').textContent='Ⅱ');$('#audioElement').addEventListener('pause',()=>$('#playGlyph').textContent='▶');
  $('#audioElement').addEventListener('timeupdate',()=>{
    const a=$('#audioElement');const current=Number.isFinite(a.currentTime)?a.currentTime:0;const duration=Number.isFinite(a.duration)?a.duration:0;
    const clock=n=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
    if(state.audioMode==='file')$('#trackTime').textContent=`${clock(current)} / ${clock(duration)}`;
  });
  $('#audioElement').addEventListener('ended',()=>$('#playGlyph').textContent='▶');
  $('#stage').addEventListener('dragover',e=>{e.preventDefault();$('#stage').classList.add('drag-over');});
  $('#stage').addEventListener('dragleave',e=>{if(!$('#stage').contains(e.relatedTarget))$('#stage').classList.remove('drag-over');});
  $('#stage').addEventListener('drop',e=>{e.preventDefault();$('#stage').classList.remove('drag-over');loadFile(e.dataTransfer.files[0]);});

  function measureAudio(){
    if(!state.analyser){state.bands={bass:0,mid:0,high:0};}
    else{
      state.analyser.getByteFrequencyData(state.freqData);
      const nyquist=state.audioContext.sampleRate/2;
      const band=(low,high)=>{
        const start=Math.max(0,Math.floor(low/nyquist*state.freqData.length));const end=Math.min(state.freqData.length-1,Math.ceil(high/nyquist*state.freqData.length));
        let sum=0,count=0;for(let i=start;i<=end;i++){sum+=state.freqData[i];count++;}
        const avg=count?sum/count/255:0;
        return clamp(Math.pow(avg,0.82)*1.22,0,1);
      };
      state.bands={bass:band(35,180),mid:band(180,1800),high:band(1800,10000)};
    }
    for(const key of ['bass','mid','high'])state.smoothBands[key]+=(state.bands[key]-state.smoothBands[key])*.22;
    $('#bassMeter').style.width=`${(state.smoothBands.bass*100).toFixed(1)}%`;
    $('#midMeter').style.width=`${(state.smoothBands.mid*100).toFixed(1)}%`;
    $('#highMeter').style.width=`${(state.smoothBands.high*100).toFixed(1)}%`;
    $('#bassValue').textContent=state.analyser?String(Math.round(state.smoothBands.bass*100)).padStart(2,'0'):'—';
    $('#midValue').textContent=state.analyser?String(Math.round(state.smoothBands.mid*100)).padStart(2,'0'):'—';
    $('#highValue').textContent=state.analyser?String(Math.round(state.smoothBands.high*100)).padStart(2,'0'):'—';
  }
  function drawWave(t){
    const w=waveformCanvas.width,h=waveformCanvas.height;const ctx=waveformCtx;
    ctx.clearRect(0,0,w,h);
    const grad=ctx.createLinearGradient(0,0,w,0);grad.addColorStop(0,'rgba(200,255,91,0)');grad.addColorStop(.16,'rgba(200,255,91,.72)');grad.addColorStop(.55,'rgba(255,96,189,.72)');grad.addColorStop(1,'rgba(105,231,221,0)');
    ctx.beginPath();ctx.lineWidth=Math.max(1,w/1200);ctx.strokeStyle=grad;
    const mid=h*.48;
    for(let x=0;x<w;x++){
      let sample=0;
      if(state.analyser){const idx=Math.floor(x/w*(state.waveData.length-1));sample=(state.waveData[idx]-128)/128;}
      else sample=(Math.sin(x/w*19+t*.001)*.035+Math.sin(x/w*43-t*.0007)*.018);
      const amp=state.analyser?Math.max(5,h*.4*(state.smoothBands.bass*.35+state.smoothBands.mid*.35+state.smoothBands.high*.3)):h*.22;
      const y=mid+sample*amp;
      if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.beginPath();ctx.strokeStyle='rgba(230,232,239,.11)';ctx.lineWidth=1;ctx.moveTo(0,mid);ctx.lineTo(w,mid);ctx.stroke();
  }
  function render(tms){
    const t=(tms-state.startedAt)/1000;
    const dt=state.lastTime?Math.min(.05,(tms-state.lastTime)/1000):0;state.lastTime=tms;
    measureAudio();
    if(state.analyser)state.analyser.getByteTimeDomainData(state.waveData);
    drawWave(tms);
    const p={};for(const k of Object.keys(defs))p[k]=valueFor(k,t);
    const motionFactor=state.lowMotion?.5:1;
    const time=t*motionFactor*(.35+p.speed*.75);
    if(gl&&!fallback){
      gl.useProgram(gl.getParameter(gl.CURRENT_PROGRAM));
      gl.uniform2f(uniforms.uResolution,glCanvas.width,glCanvas.height);
      gl.uniform1f(uniforms.uTime,time);gl.uniform1f(uniforms.uScene,state.scene);
      gl.uniform1f(uniforms.uZoom,p.zoom);gl.uniform1f(uniforms.uTwist,p.twist);gl.uniform1f(uniforms.uSymmetry,p.symmetry);
      gl.uniform1f(uniforms.uHue,p.hue);gl.uniform1f(uniforms.uGlow,p.glow);
      gl.uniform1f(uniforms.uBass,state.smoothBands.bass);gl.uniform1f(uniforms.uMid,state.smoothBands.mid);gl.uniform1f(uniforms.uHigh,state.smoothBands.high);
      gl.uniform1f(uniforms.uIntensity,state.lowMotion?.82:1.0);gl.uniform2f(uniforms.uPointer,0,0);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }else if(fallbackCtx){
      fallbackCtx.fillStyle='#08090e';fallbackCtx.fillRect(0,0,glCanvas.width,glCanvas.height);
      const w=glCanvas.width,h=glCanvas.height,cx=w*.56,cy=h*.48,r=Math.min(w,h)*.36*p.zoom;
      fallbackCtx.save();fallbackCtx.translate(cx,cy);fallbackCtx.rotate(time*.1);
      for(let i=0;i<30;i++){fallbackCtx.beginPath();fallbackCtx.strokeStyle=`hsla(${(p.hue*360+i*7)%360},90%,${45+i%3*10}%,${.12+i%5*.04})`;fallbackCtx.lineWidth=2+i%3;fallbackCtx.ellipse(0,0,r*(.22+i*.026),r*(.62+i*.017),Math.sin(time*.2+i)*.08,0,Math.PI*2);fallbackCtx.stroke();}
      fallbackCtx.restore();
    }
    state.frameCount++;if(tms-state.fpsStamp>1000){state.fps=Math.round(state.frameCount*1000/(tms-state.fpsStamp));state.frameCount=0;state.fpsStamp=tms;}
    requestAnimationFrame(render);
  }

  function snapshot(){
    glCanvas.toBlob(blob=>{
      if(!blob){alert('Could not capture this frame.');return;}
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`mandelwave-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    },'image/png');
  }
  $('#snapshotButton').addEventListener('click',snapshot);
  $('#presetButton').addEventListener('click',()=>{const idx=presets.findIndex(p=>p.scene===state.scene);const next=(idx+1)%presets.length;$('#presetSelect').value=String(next);applyPreset(next);});
  $('#savePreset').addEventListener('click',()=>{
    try{localStorage.setItem('mandelwave-state',JSON.stringify({scene:state.scene,params:state.params,automation:state.automation}));$('#savePreset').textContent='SAVED ✓';setTimeout(()=>$('#savePreset').textContent='SAVE CURRENT',1300);}catch{alert('Could not save in this browser.');}
  });
  $('#loadPreset').addEventListener('click',()=>{
    try{const saved=JSON.parse(localStorage.getItem('mandelwave-state'));if(!saved)throw new Error();state.scene=clamp(saved.scene|0,0,3);state.params={...initialParams,...saved.params};state.automation={...structuredClone(defaultAutomation),...saved.automation};
      for(const [key,cfg] of Object.entries(state.automation)){const row=$(`.automation-row[data-key="${key}"]`);if(!row)continue;$('.auto-mode',row).value=cfg.mode;$('.min-control',row).value=cfg.min;$('.max-control',row).value=cfg.max;$('.auto-period',row).value=cfg.period;$('.auto-mode',row).dispatchEvent(new Event('change'));}
      updateControlValues();updateSceneUI();$('#loadPreset').textContent='LOADED ✓';setTimeout(()=>$('#loadPreset').textContent='LOAD SAVED',1300);
    }catch{alert('No saved universe yet. Save a setup first.');}
  });
  $('#resetButton').addEventListener('click',()=>{state.scene=0;state.params={...initialParams};state.automation=structuredClone(defaultAutomation);makeAutomationRefresh();updateControlValues();updateSceneUI();$('#presetSelect').value='0';});
  function makeAutomationRefresh(){
    for(const [key,cfg] of Object.entries(state.automation)){const row=$(`.automation-row[data-key="${key}"]`);$('.auto-mode',row).value=cfg.mode;$('.min-control',row).value=cfg.min;$('.max-control',row).value=cfg.max;$('.auto-period',row).value=cfg.period;$('.auto-mode',row).dispatchEvent(new Event('change'));}
  }
  $('#fullscreenButton').addEventListener('click',()=>{
    if(!document.fullscreenElement)$('#stage').requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.();
  });
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,select,textarea'))return;
    if(e.key==='Escape')setPanel(false);
    if(e.key.toLowerCase()==='h')setPanel(!document.body.classList.contains('panel-open'));
    if(e.key.toLowerCase()==='f')$('#fullscreenButton').click();
    if(e.code==='Space'&&state.audioMode==='file'){e.preventDefault();$('#playButton').click();}
  });
  window.addEventListener('resize',resize);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.audioMode==='mic'){stopMic();updateAudioUI();}});

  makeControls();initGL();updateSceneUI();requestAnimationFrame(render);
})();
