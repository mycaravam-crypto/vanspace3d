import { scene, camera, renderer } from './scene.js';
import { initUI } from './ui.js';
import { orbitControls } from './controls.js';

// Wires all UI bindings and builds the van — either from a saved project
// (localStorage) or from the default vanState if nothing was saved.
initUI();

// ==========================================
// RENDER LOOP
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    orbitControls.update(); // needed for damping
    renderer.render(scene, camera);
}
animate();
