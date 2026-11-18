export function attachFpsCounter(canvas: HTMLCanvasElement): (now: number) => void {
  const counter = document.createElement('output');
  counter.textContent = 'FPS --';
  counter.setAttribute('aria-label', 'Frames per second');
  Object.assign(counter.style, {
    position: 'absolute',
    top: '10px',
    right: '12px',
    zIndex: '8',
    padding: '3px 6px',
    border: '1px solid rgba(145, 165, 190, 0.28)',
    borderRadius: '4px',
    background: 'rgba(12, 18, 28, 0.72)',
    color: '#aebed2',
    font: '9px ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: '1.2',
    letterSpacing: '0.04em',
    pointerEvents: 'none',
    fontVariantNumeric: 'tabular-nums',
  });
  const host = canvas.parentElement;
  if (!host) throw new Error('FPS counter canvas must have a parent element');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.append(counter);

  let frames = 0;
  let lastSample = 0;
  return (now: number) => {
    frames += 1;
    if (lastSample === 0) {
      lastSample = now;
      return;
    }
    const elapsed = now - lastSample;
    if (elapsed < 500) return;
    counter.textContent = `FPS ${Math.round((frames * 1000) / elapsed)}`;
    frames = 0;
    lastSample = now;
  };
}
