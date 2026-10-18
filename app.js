(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (n, digits = 2) => Number(n).toFixed(digits);
  const defs = {
    morph: { label: 'Form', min: 0.05, max: 1.6, step: 0.01, value: 0.92, digits: 2 },
    twist: { label: 'Twist', min: 0, max: 2.8, step: 0.01, value: 0.92, digits: 2 },
    speed: { label: 'Drift', min: 0.08, max: 1.7, step: 0.01, value: 0.62, digits: 2 },
    symmetry: { label: 'Symmetry', min: 3, max: 12, step: 1, value: 7, digits: 0 },
    detail: { label: 'Detail', min: 0.15, max: 1.5, step: 0.01, value: 0.82, digits: 2 },
    hue: { label: 'Palette', min: 0, max: 1, step: 0.001, value: 0.76, digits: 2 },
    glow: { label: 'Glow', min: 0.2, max: 1.35, step: 0.01, value: 0.95, digits: 2 },
  };
  const scenes = ['PRISMATIC BLOOM', 'MANDELBROT DRIFT', 'INFINITE WORMHOLE', 'LASER CATHEDRAL', 'CHROMA PLASMA', 'LIQUID TAPESTRY'];
  const initialParams = Object.fromEntries(Object.entries(defs).map(([key, d]) => [key, d.value]));
  const defaultAutomation = Object.fromEntries(Object.entries(defs).map(([key, d]) => [key, {
    mode: key === 'glow' ? 'high' : 'hold', min: d.min, max: d.max, period: 8,
  }]));
  const presets = [
    { name: 'Prismatic bloom', scene: 0, params: { morph: .92, twist: .92, speed: .62, symmetry: 7, detail: .82, hue: .76, glow: .95 } },
    { name: 'Cathedral of glass', scene: 0, params: { morph: 1.38, twist: 1.54, speed: .46, symmetry: 10, detail: 1.18, hue: .48, glow: 1.18 } },
    { name: 'Mandelbrot garden', scene: 1, params: { morph: .72, twist: .54, speed: .32, symmetry: 6, detail: 1.3, hue: .84, glow: .78 } },
    { name: 'Liquid wormhole', scene: 2, params: { morph: 1.24, twist: 1.72, speed: .8, symmetry: 8, detail: 1.05, hue: .93, glow: 1.12 } },
    { name: 'Laser geometry', scene: 3, params: { morph: 1.1, twist: .82, speed: .7, symmetry: 9, detail: .94, hue: .33, glow: 1.2 } },
    { name: 'Quiet mycelium', scene: 5, params: { morph: .56, twist: .34, speed: .2, symmetry: 5, detail: .56, hue: .58, glow: .66 } },
    { name: 'Chroma storm', scene: 4, params: { morph: 1.48, twist: 2.1, speed: 1.12, symmetry: 11, detail: 1.4, hue: .08, glow: 1.3 } },
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
    fileName: '',
    startedAt: performance.now(),
    lastTime: 0,
    lowMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    pointer: { x: 0, y: 0 },
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
    precision highp float;
    varying vec2 vUv;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uScene;
    uniform float uMorph;
    uniform float uTwist;
    uniform float uSymmetry;
    uniform float uDetail;
    uniform float uHue;
    uniform float uGlow;
    uniform float uBass;
    uniform float uMid;
    uniform float uHigh;
    uniform float uIntensity;
    uniform vec2 uPointer;
    const float PI = 3.141592653589793;
    vec2 rot(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
    vec3 spectrum(float h){return .52+.48*cos(6.28318*(h+vec3(0.,.33,.67)));}
    float mandel(vec2 c,float form){
      vec2 z=c*clamp((form-.05)/1.55,0.,.85);float n=0.;float r2=0.;
      for(int i=0;i<48;i++){z=vec2(z.x*z.x-z.y*z.y+c.x,2.*z.x*z.y+c.y);r2=dot(z,z);if(r2>256.)break;n+=1.;}
      if(n>=47.)return 0.;
      float smoothN=n+1.-log2(max(.001,log2(max(1.001,sqrt(r2)))));
      return clamp(smoothN/48.,0.,1.);
    }
    void main(){
      vec2 uv=(gl_FragCoord.xy-.5*uResolution)/uResolution.y;
      uv += uPointer*.07;
      float t=uTime;
      float form=uMorph, twist=uTwist, detail=uDetail, n=max(3.,floor(uSymmetry+.5));
      float bass=uBass, mid=uMid, high=uHigh;
      float r=length(uv), a=atan(uv.y,uv.x);
      vec2 p=uv;
      float field=0., lines=0., h=uHue;
      if(uScene<.5){
        float sector=2.*PI/n;
        float bend=twist*(.26*sin(r*5.-t*1.35)+.13*sin(a*n*.5+t*.72));
        float warpedA=a+bend+.12*form*sin(a*n-t*1.05+r*6.);
        float folded=abs(mod(warpedA+sector*.5,sector)-sector*.5);
        float petalR=r*(1.+.24*form*cos(n*a-t*.86))+form*.075*sin(n*warpedA+r*8.-t*1.25);
        float petal=sin(folded*n*1.35+petalR*(12.+detail*12.)-t*1.8-mid*1.8);
        float ring=sin(petalR*(23.+detail*24.)-sin(warpedA*n*2.+t)*2.5-t*2.4-bass*2.8);
        float cells=sin((p.x+p.y)*(17.+detail*28.)+t*1.25)*cos((p.x-p.y)*(19.+detail*24.)-t*1.1);
        field=.5+.26*petal+.19*ring+.13*cells;
        lines=exp(-abs(petal)*3.8)+.75*exp(-abs(ring)*3.3)+.35*exp(-abs(cells)*5.);
        h+=.12*sin(warpedA*n+t*.55)+high*.1+field*.18;
      }else if(uScene<1.5){
        float cam=exp2(.34*sin(t*.28)+.18*sin(t*.11+mid));
        vec2 q=rot(uv/(.42+.22*form)*cam,t*(.13+twist*.09));
        q+=vec2(.12*sin(t*.22),.09*cos(t*.19))*(.3+form);
        vec2 c=q*1.18+vec2(-.48+.12*sin(t*.17),.035*cos(t*.23));
        c=rot(c,twist*.18*sin(t*.2));
        float m=mandel(c,form);
        float contour=sin(m*(75.+detail*100.)-t*1.9+high*4.);
        float orbit=sin((c.x*c.x+c.y*c.y)*(28.+detail*18.)+atan(c.y,c.x)*n-t*1.5);
        field=.12+.76*m+.12*contour;
        lines=exp(-abs(contour)*3.2)*(1.-m*.55)+exp(-abs(orbit)*4.)*.52;
        h+=m*.62+contour*.035+high*.16;
      }else if(uScene<2.5){
        float warpedA=a+twist*.52*sin(r*4.-t*1.25)+.18*sin(a*n+t*.65);
        float warpedR=max(.035,r+form*.095*sin(warpedA*n-t*1.65)+.035*sin(warpedA*5.+t));
        float depth=1./(warpedR+.105);
        float spokes=sin(warpedA*n*1.5+depth*2.4-t*2.3-mid*4.);
        float rings=sin(depth*(11.+detail*6.)-t*3.2-bass*5.);
        float spiral=sin(warpedA*n+depth*(4.5+form*4.)-t*2.);
        field=.48+.24*spokes+.2*rings+.12*spiral;
        lines=exp(-abs(spokes)*3.4)+exp(-abs(rings)*3.)*.9+exp(-abs(spiral)*4.)*.5;
        h+=.15*cos(warpedA*n-t*.6)+depth*.025+high*.13;
      }else if(uScene<3.5){
        vec2 q=rot(uv,twist*.18*sin(t*.52));
        q.x+=.06*form*sin(q.y*12.-t*1.3);
        float beams=0., haze=0.;
        for(int i=0;i<12;i++){
          float fi=float(i);
          if(fi<n){
            float spread=(fi/(max(2.,n-1.))-.5)*2.1;
            float angle=spread+.56*sin(t*.72+fi*1.71+mid);
            float d=abs(q.x-tan(angle)*(q.y+.48));
            float width=.008+.005*(.5+.5*sin(t*1.8+fi));
            float beam=exp(-d/(width+.004))*(.52+.48*sin(t*2.1+fi*1.31+high*4.));
            beams=max(beams,beam);
            haze+=exp(-d*.7)*.045;
          }
        }
        float cross=sin((q.x+q.y*.5)*(20.+detail*18.)-t*2.2)*sin((q.x-q.y)*(13.+detail*12.)+t*1.5);
        float star=exp(-length(q-vec2(.02,.08))*(8.+detail*12.));
        field=.14+.65*beams+.16*cross+.32*star;
        lines=beams+haze+star*.7+exp(-abs(cross)*4.)*.25;
        h+=q.x*.16+q.y*.12+high*.22;
      }else if(uScene<4.5){
        vec2 q=rot(uv,twist*.22*sin(t*.35));
        float warp=sin(q.y*(5.+detail*6.)+t*1.4)*.23*form+cos(q.x*4.-t*.9)*.2*form;
        q+=vec2(warp,warp*.7);
        float f1=sin(q.x*(9.+detail*7.)+sin(q.y*7.-t)*2.3+t*1.55+bass*3.);
        float f2=cos(q.y*(11.+detail*9.)+sin(q.x*6.+t*.8)*2.+t*1.1+mid*2.);
        float f3=sin(length(q)*17.-t*2.2+sin(atan(q.y,q.x)*n+t)*2.);
        field=.5+.24*f1+.2*f2+.12*f3;
        lines=exp(-abs(f1)*3.)+exp(-abs(f2)*3.)*.8+exp(-abs(f3)*3.5)*.6;
        h+=.15*f1+.16*f2+high*.2;
      }else{
        float sector=2.*PI/n;
        float aa=a+twist*.42*sin(r*3.2-t*1.1)+.15*sin(a*3.-t*.6);
        float fold=abs(mod(aa+sector*.5,sector)-sector*.5);
        float ribbonR=r+.16*form*sin(aa*n+sin(r*5.-t)*2.-t*1.15);
        float ribbon=sin(fold*n*1.7+(ribbonR*(18.+detail*18.))-t*2.1);
        float contour=sin((ribbonR+form*.08*sin(aa*n-t))* (31.+detail*26.)-t*1.55);
        float mesh=sin(aa*n*2.+r*15.-t)*sin(r*18.+aa*n-t*1.4);
        field=.5+.28*ribbon+.2*contour+.11*mesh;
        lines=exp(-abs(ribbon)*3.6)+exp(-abs(contour)*3.)*.75+exp(-abs(mesh)*4.)*.38;
        h+=fold*n*.055+contour*.08+high*.12;
      }
      float audioPulse=1.+bass*.46*sin(t*2.4);
      float concert=0.;
      for(int i=0;i<4;i++){
        float fi=float(i);
        float angle=-1.05+fi*.7+.58*sin(t*.58+fi*1.7+mid*.7);
        float beamDist=abs(uv.x-tan(angle)*(uv.y+.62));
        float beamWidth=.007+high*.009;
        concert=max(concert,exp(-beamDist/beamWidth)*(.68+.32*sin(t*.82+fi*1.4)));
      }
      float center=exp(-r*r*(3.4+form*2.))* (.18+uGlow*.25);
      float edge=1.-smoothstep(1.15,1.8,length(uv));
      float energy=clamp(field+concert*.1,0.,1.35);
      vec3 base=spectrum(fract(h+energy*.12));
      vec3 neon=spectrum(fract(h+.22+lines*.055+mid*.08));
      vec3 col=base*(.11+energy*.68)+neon*lines*(.13+uGlow*.28);
      col+=spectrum(fract(h+.12+t*.025+high*.1))*concert*(.18+uGlow*.34);
      col+=spectrum(fract(h+.55+high*.15))*center*audioPulse;
      col*=mix(.5,1.,edge)*uIntensity;
      col=pow(max(col,0.),vec3(.78));
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
      for (const name of ['uResolution','uTime','uScene','uMorph','uTwist','uSymmetry','uDetail','uHue','uGlow','uBass','uMid','uHigh','uIntensity','uPointer']) uniforms[name]=gl.getUniformLocation(program,name);
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
    for(const key of Object.keys(defs)) if(Number.isFinite(preset.params[key])) state.params[key]=preset.params[key];
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
    $('#sceneIndex').textContent=`${String(state.scene+1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}`;
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
    updateAudioUI();
  }
  async function startMic(){
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone input requires a secure browser context (HTTPS or localhost).');
      setupAudioContext();
      if(state.audioMode==='mic'){stopMic();state.audioMode=$('#audioElement').src?'file':'none';updateAudioUI();return;}
      stopMic();$('#audioElement').pause();
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      state.micStream=stream;state.audioSourceNode=state.audioContext.createMediaStreamSource(stream);state.audioSourceNode.connect(state.analyser);state.audioMode='mic';
      $('#playButton').disabled=true;$('#playGlyph').textContent='▶';$('#sourceStatus').textContent='MICROPHONE · ANALYSING';$('#inputIndicator').textContent='MIC LIVE';$('#transportSource').textContent='LIVE MIC';$('#micButton').classList.add('active');$('#panelMicButton').classList.add('active');$('#panelFileButton').classList.remove('active');$('#trackName').textContent='Live microphone';$('#trackTime').textContent='Listening in this browser only';
    }catch(e){alert(e.message||'Could not connect microphone.');}
    updateAudioUI();
  }
  function updateAudioUI(){
    const audio=$('#audioElement');
    if(state.audioMode==='mic'){
      $('#sourceStatus').textContent='MICROPHONE · ANALYSING';$('#inputIndicator').textContent='MIC LIVE';$('#transportSource').textContent='LIVE MIC';
      $('#playButton').disabled=true;$('#micButton').classList.add('active');$('#panelMicButton').classList.add('active');$('#panelFileButton').classList.remove('active');
    }else if(state.audioMode==='file'){
      $('#sourceStatus').textContent=audio.paused?'FILE AUDIO · READY':'FILE AUDIO · ANALYSING';$('#inputIndicator').textContent='FILE';$('#transportSource').textContent=audio.paused?'FILE READY':'FILE INPUT';
      $('#playButton').disabled=false;$('#micButton').classList.remove('active');$('#panelMicButton').classList.remove('active');$('#panelFileButton').classList.add('active');
      if(state.fileName)$('#trackName').textContent=state.fileName;
    }else{
      $('#sourceStatus').textContent='NO SIGNAL · READY';$('#inputIndicator').textContent='IDLE';$('#transportSource').textContent='VISUALS RUNNING';
      $('#playButton').disabled=true;$('#micButton').classList.remove('active');$('#panelMicButton').classList.remove('active');$('#panelFileButton').classList.remove('active');
    }
  }
  function loadFile(file){
    if(!file||!file.type.startsWith('audio/')){alert('Choose an audio file to feed the visualizer.');return;}
    stopMic();
    if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);
    state.audioUrl=URL.createObjectURL(file);
    const audio=$('#audioElement');audio.src=state.audioUrl;audio.load();connectMediaAudio();
    state.fileName=file.name;$('#trackName').textContent=file.name;$('#trackTime').textContent='Ready to play · audio stays on this device';
    audio.play().then(()=>{$('#playGlyph').textContent='Ⅱ';}).catch(()=>{$('#playGlyph').textContent='▶';});
  }
  $('#fileButton').addEventListener('click',()=>$('#audioFile').click());$('#panelFileButton').addEventListener('click',()=>$('#audioFile').click());
  $('#audioFile').addEventListener('change',e=>{loadFile(e.target.files[0]);e.target.value='';});
  $('#micButton').addEventListener('click',startMic);$('#panelMicButton').addEventListener('click',startMic);
  $('#playButton').addEventListener('click',async()=>{
    const audio=$('#audioElement');if(!audio.src)return;
    setupAudioContext(); if(audio.paused){try{await audio.play();$('#playGlyph').textContent='Ⅱ';}catch(e){console.warn(e);}}else{audio.pause();$('#playGlyph').textContent='▶';}
  });
  $('#audioElement').addEventListener('play',()=>{$('#playGlyph').textContent='Ⅱ';if(state.audioMode==='file')updateAudioUI();});$('#audioElement').addEventListener('pause',()=>{$('#playGlyph').textContent='▶';if(state.audioMode==='file')updateAudioUI();});
  $('#audioElement').addEventListener('timeupdate',()=>{
    const a=$('#audioElement');const current=Number.isFinite(a.currentTime)?a.currentTime:0;const duration=Number.isFinite(a.duration)?a.duration:0;
    const clock=n=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
    if(state.audioMode==='file')$('#trackTime').textContent=`${clock(current)} / ${clock(duration)}`;
  });
  $('#audioElement').addEventListener('ended',()=>$('#playGlyph').textContent='▶');
  $('#stage').addEventListener('pointermove',e=>{const r=glCanvas.getBoundingClientRect();state.pointer.x=clamp((e.clientX-r.left)/r.width-.5,-.5,.5);state.pointer.y=clamp(.5-(e.clientY-r.top)/r.height,-.5,.5);});
  $('#stage').addEventListener('pointerleave',()=>{state.pointer.x=0;state.pointer.y=0;});
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
    const motionFactor=state.lowMotion ? .72 : 1;
    const time=t*motionFactor*(.3+p.speed*1.55);
    if(gl&&!fallback){
      gl.useProgram(gl.getParameter(gl.CURRENT_PROGRAM));
      gl.uniform2f(uniforms.uResolution,glCanvas.width,glCanvas.height);
      gl.uniform1f(uniforms.uTime,time);gl.uniform1f(uniforms.uScene,state.scene);
      gl.uniform1f(uniforms.uMorph,p.morph);gl.uniform1f(uniforms.uTwist,p.twist);gl.uniform1f(uniforms.uSymmetry,p.symmetry);gl.uniform1f(uniforms.uDetail,p.detail);
      gl.uniform1f(uniforms.uHue,p.hue);gl.uniform1f(uniforms.uGlow,p.glow);
      gl.uniform1f(uniforms.uBass,state.smoothBands.bass);gl.uniform1f(uniforms.uMid,state.smoothBands.mid);gl.uniform1f(uniforms.uHigh,state.smoothBands.high);
      gl.uniform1f(uniforms.uIntensity,state.lowMotion ? .82 : 1.0);gl.uniform2f(uniforms.uPointer,state.pointer.x,state.pointer.y);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }else if(fallbackCtx){
      fallbackCtx.fillStyle='#08090e';fallbackCtx.fillRect(0,0,glCanvas.width,glCanvas.height);
      const w=glCanvas.width,h=glCanvas.height,cx=w*.56,cy=h*.48,r=Math.min(w,h)*(.2+p.morph*.22);
      fallbackCtx.save();fallbackCtx.translate(cx,cy);fallbackCtx.rotate(time*.32*p.twist);
      if(state.scene===3){
        for(let i=0;i<13;i++){const a=-1.2+i*.2+Math.sin(time*.8+i)*.35;fallbackCtx.beginPath();fallbackCtx.moveTo(0,h*.48);fallbackCtx.lineTo(Math.tan(a)*h*.8,-h*.65);fallbackCtx.strokeStyle=`hsla(${(p.hue*360+i*25+time*28)%360},100%,65%,.62)`;fallbackCtx.lineWidth=1+i%3;fallbackCtx.shadowBlur=16;fallbackCtx.shadowColor=fallbackCtx.strokeStyle;fallbackCtx.stroke();}
      }else{
        for(let i=0;i<Math.round(18+p.detail*28);i++){fallbackCtx.beginPath();fallbackCtx.strokeStyle=`hsla(${(p.hue*360+i*11+time*18)%360},100%,${52+i%3*12}%,${.24+i%5*.08})`;fallbackCtx.lineWidth=1+i%3;fallbackCtx.ellipse(0,0,r*(.18+i*.018),r*(.6+i*.018),Math.sin(time*.65+i)*.15,0,Math.PI*2);fallbackCtx.stroke();}
      }
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
    try{const saved=JSON.parse(localStorage.getItem('mandelwave-state'));if(!saved)throw new Error();state.scene=clamp(saved.scene|0,0,scenes.length-1);state.params={...initialParams,...saved.params};
      for(const key of Object.keys(defs)){Object.assign(state.automation[key],defaultAutomation[key],saved.automation?.[key]||{});const cfg=state.automation[key];const row=$(`.automation-row[data-key="${key}"]`);if(!row)continue;$('.auto-mode',row).value=cfg.mode;$('.min-control',row).value=cfg.min;$('.max-control',row).value=cfg.max;$('.auto-period',row).value=cfg.period;$('.auto-mode',row).dispatchEvent(new Event('change'));}
      updateControlValues();updateSceneUI();$('#loadPreset').textContent='LOADED ✓';setTimeout(()=>$('#loadPreset').textContent='LOAD SAVED',1300);
    }catch{alert('No saved universe yet. Save a setup first.');}
  });
  $('#resetButton').addEventListener('click',()=>{state.scene=0;state.params={...initialParams};for(const key of Object.keys(defs))Object.assign(state.automation[key],defaultAutomation[key]);makeAutomationRefresh();updateControlValues();updateSceneUI();$('#presetSelect').value='0';});
  function makeAutomationRefresh(){
    for(const [key,cfg] of Object.entries(state.automation)){const row=$(`.automation-row[data-key="${key}"]`);$('.auto-mode',row).value=cfg.mode;$('.min-control',row).value=cfg.min;$('.max-control',row).value=cfg.max;$('.auto-period',row).value=cfg.period;$('.auto-mode',row).dispatchEvent(new Event('change'));}
  }
  $('#fullscreenButton').addEventListener('click',()=>{
    if(!document.fullscreenElement)$('#stage').requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.();
  });
  document.addEventListener('fullscreenchange',resize);
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,select,textarea'))return;
    if(e.key==='Escape')setPanel(false);
    if(e.key.toLowerCase()==='h')setPanel(!document.body.classList.contains('panel-open'));
    if(e.key.toLowerCase()==='f')$('#fullscreenButton').click();
    if(e.code==='Space'&&state.audioMode==='file'){e.preventDefault();$('#playButton').click();}
  });
  window.addEventListener('resize',resize);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.audioMode==='mic'){stopMic();state.audioMode=$('#audioElement').src?'file':'none';updateAudioUI();}});

  makeControls();initGL();updateSceneUI();requestAnimationFrame(render);
})();
