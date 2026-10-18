# Mandelwave

A browser-based, real-time visual instrument: six distinct worlds of fractals, mandalas, liquid geometry, plasma and concert-scale laser light. Built with vanilla JavaScript, WebGL and the Web Audio API; no build step or JavaScript dependencies.

## Run it

Open `index.html`, or serve this folder locally:

```sh
python3 -m http.server 8080
```

Then visit `http://localhost:8080`. Microphone access requires HTTPS or localhost. Audio is analyzed locally in your browser; Mandelwave does not upload or record it.

## Use it

- Load an audio file, drag one onto the stage, or connect a microphone. The visuals animate even without an audio source.
- Open **Control Room** (or press `H`) to select one of six visual worlds. **Form**, **Twist**, **Symmetry**, and **Detail** reshape the geometry and patterns; **Drift**, **Palette**, and **Glow** change their motion and lighting.
- Set each parameter to **Hold**, **Sine**, **Ease**, **Bass**, **Mids** or **Air**. Low/high ranges define its travel; the final number is the animation cycle in seconds.
- Save a custom setup in this browser, capture a PNG, or press `F` for fullscreen visuals (press `Esc` to leave). Press `Space` to play/pause a loaded file.
- Reduced-motion preferences are respected. The renderer avoids strobing and sudden flashes; visuals may still be intense.

## Deploy

This is a static site. Publish the repository root (`/`) from `main` in GitHub Pages settings. No compilation is needed.
