# Mandelwave

A browser-based, real-time visual instrument: fractals, mandalas, liquid tunnels and laser geometry shaped by live audio. Built with vanilla JavaScript, WebGL and the Web Audio API; no build step or JavaScript dependencies.

## Run it

Open `index.html`, or serve this folder locally:

```sh
python3 -m http.server 8080
```

Then visit `http://localhost:8080`. Microphone access requires HTTPS or localhost. Audio is analyzed locally in your browser; Mandelwave does not upload or record it.

## Use it

- Load an audio file, drag one onto the stage, or connect a microphone.
- Open **Control Room** (or press `H`) to select one of four visual worlds and tune zoom, twist, drift, symmetry, palette and glow.
- Set each parameter to **Hold**, **Sine**, **Ease**, **Bass**, **Mids** or **Air**. The low/high range sliders set its travel; the final number is the animation cycle in seconds.
- Save one custom setup in this browser, capture a PNG, toggle fullscreen (`F`), or press `Space` to play/pause a loaded file.
- Reduced-motion preferences are respected. The renderer avoids strobing and sudden flashes; visuals may still be intense.

## Deploy

This is a static site. Publish the repository root (`/`) from `main` in GitHub Pages settings. No compilation is needed.
