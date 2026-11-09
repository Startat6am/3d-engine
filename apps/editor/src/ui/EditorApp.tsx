import { useEffect, useRef, useState } from 'react';
import { createBoxGeometry } from '@engine/geometry';
import { ThreeWebGLRendererAdapter } from '@engine/renderer';

export function EditorApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ThreeWebGLRendererAdapter | null>(null);
  const [selected, setSelected] = useState('Box');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: ThreeWebGLRendererAdapter;
    try {
      renderer = new ThreeWebGLRendererAdapter(canvas);
    } catch (error) {
      canvas.dataset.rendererError = error instanceof Error ? error.message : String(error);
      console.error('WebGL2 renderer initialization failed', error);
      return;
    }
    canvas.dataset.renderer = renderer.capabilities.backend;
    rendererRef.current = renderer;
    renderer.setMeshes([{ geometry: createBoxGeometry(), color: 0x6ea8fe }]);
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      renderer.resize(bounds.width, bounds.height);
      renderer.render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => {
      observer.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  return (
    <main className="editor-shell">
      <header className="topbar">
        <div className="brand-mark">◇</div>
        <strong>UNIVERSAL ENGINE</strong>
        <span className="crumb">/ Untitled World</span>
        <span className="spacer" />
        <span className="status">
          <i /> EDITOR FOUNDATION
        </span>
      </header>
      <div className="workspace">
        <aside className="panel hierarchy">
          <div className="panel-heading">
            HIERARCHY <button aria-label="Add entity">＋</button>
          </div>
          <div className="tree-row active">
            ▣ <span>Untitled World</span>
          </div>
          <button className="tree-row selected" onClick={() => setSelected('Box')}>
            ◈ <span>Box</span>
          </button>
          <div className="tree-row muted">
            ◉ <span>Perspective Camera</span>
          </div>
          <div className="panel-foot">2 ENTITIES · SCENE 01</div>
        </aside>
        <section className="viewport">
          <div className="viewport-label">
            SCENE VIEW <span>WEBGL2</span>
          </div>
          <canvas ref={canvasRef} aria-label="3D scene viewport" />
          <div className="axis">
            X <b>Y</b> Z
          </div>
          <div className="viewport-help">
            Orbit · Pan · Zoom <span>Viewport adapter online</span>
          </div>
        </section>
        <aside className="panel inspector">
          <div className="panel-heading">INSPECTOR</div>
          <div className="inspector-title">
            ◈ <strong>{selected}</strong>
          </div>
          <label>TRANSFORM</label>
          <div className="property">
            <span>Position</span>
            <code>0.00&nbsp; 0.00&nbsp; 0.00</code>
          </div>
          <div className="property">
            <span>Rotation</span>
            <code>0.00&nbsp; 0.00&nbsp; 0.00</code>
          </div>
          <div className="property">
            <span>Scale</span>
            <code>1.00&nbsp; 1.00&nbsp; 1.00</code>
          </div>
          <label>COMPONENTS</label>
          <div className="component">
            ◈ <span>Mesh Renderer</span>
            <small>›</small>
          </div>
          <div className="component">
            ▧ <span>Box Geometry</span>
            <small>›</small>
          </div>
          <button className="add-component">＋ Add Component</button>
          <div className="panel-foot">FOUNDATION BUILD · 0.1.0</div>
        </aside>
      </div>
      <footer className="bottombar">
        <span>● READY</span>
        <span>WebGL2 · Three.js adapter</span>
        <span className="spacer" />
        No project saved
      </footer>
    </main>
  );
}
