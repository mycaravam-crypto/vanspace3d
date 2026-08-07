import { scene, camera, renderer } from './scene.js';
import { initUI } from './ui.js';
import { orbitControls } from './controls.js';
import { version } from '../package.json';

// Wires all UI bindings and builds the van — either from a saved project
// (localStorage) or from the default vanState if nothing was saved.
initUI();

const versionEl = document.getElementById('app-version');
if (versionEl) versionEl.textContent = `v${version}`;

// ==========================================
// RENDER LOOP
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    orbitControls.update(); // needed for damping
    renderer.render(scene, camera);
}
animate();
