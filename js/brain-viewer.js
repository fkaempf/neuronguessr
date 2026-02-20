/**
 * Three.js viewer for the 3D brain model.
 * Loads brain + VNC PLY meshes, with individual ROI OBJs as toggle option.
 * Player clicks to place guess markers via raycasting.
 * Shows answer reveal with neuron in brain context after submission.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// Y-axis is inverted in EM coordinate space - flip it
const Y_FLIP = -1;

// PLY meshes are in nanometers, neuron data is in 8nm voxel units
const PLY_TO_VOXEL = 1 / 8;

export class BrainViewer {
    /**
     * @param {HTMLElement} container
     * @param {Function} onGuessPlaced - callback([x, y, z]) in original coords
     */
    constructor(container, onGuessPlaced) {
        this.container = container;
        this.onGuessPlaced = onGuessPlaced;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0f0f23);

        // Cameras (perspective + orthographic, togglable)
        const w = container.clientWidth;
        const h = container.clientHeight;
        const aspect = w / h;
        this._perspCamera = new THREE.PerspectiveCamera(50, aspect, 10, 1000000);
        this._orthoCamera = new THREE.OrthographicCamera(
            -1, 1, 1, -1, -500000, 500000
        );
        this.isOrtho = true;
        this.camera = this._orthoCamera;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.panSpeed = 0.4;
        // Prevent camera from flipping upside down (causes inverted controls)
        this.controls.minPolarAngle = 0.05;
        this.controls.maxPolarAngle = Math.PI - 0.05;

        // Lighting
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight.position.set(1, 1, 1).normalize();
        this.scene.add(dirLight);
        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
        dirLight2.position.set(-1, -0.5, -1).normalize();
        this.scene.add(dirLight2);

        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // State
        this.roiMeshes = [];        // for raycasting
        this.roiGroups = [];        // ROI Object3Ds (for toggling)
        this.brainMeshGroup = null; // brain + VNC group
        this.guessMarker = null;
        this.answerMarker = null;
        this.answerLine = null;
        this.neuronGroup = null;
        this.guessEnabled = true;
        this.showIndividualRois = false; // default: fused mesh

        // Depth control: scalar depth along fixed line direction (set on click)
        this._guessSurfacePoint = null;  // surface hit point (anchor)
        this._guessLineDir = null;       // fixed direction set at click time
        this._guessDepth = 0;            // scalar distance from surface along line
        this._guessDepthTarget = 0;      // target depth (for smooth lerp)
        this._depthGuideLine = null;     // dotted line showing depth axis

        // Click-vs-drag detection: only place guess on clean clicks, not drags
        this._pointerDownPos = null;

        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            this._pointerDownPos = { x: e.clientX, y: e.clientY };
        });
        this.renderer.domElement.addEventListener('pointerup', (e) => {
            if (!this._pointerDownPos) return;
            const dx = e.clientX - this._pointerDownPos.x;
            const dy = e.clientY - this._pointerDownPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            this._pointerDownPos = null;
            if (dist < 5) {
                this._onClick(e);
            }
        });

        // Scroll handler for depth adjustment
        this.renderer.domElement.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

        // Animate
        this._animate = this._animate.bind(this);
        this._animate();

        // Resize - observe canvas element itself since it moves between containers
        this._resizeObserver = new ResizeObserver(() => this._onResize());
        this._resizeObserver.observe(this.renderer.domElement);
    }

    /**
     * Convert a position from data coords to display coords (flip Y).
     */
    _toDisplay(x, y, z) {
        return new THREE.Vector3(x, y * Y_FLIP, z);
    }

    /**
     * Convert a display position back to data coords.
     */
    _toData(vec3) {
        return [vec3.x, vec3.y * Y_FLIP, vec3.z];
    }

    /**
     * Load the brain and VNC PLY meshes.
     * PLY coordinates are in nanometers; scale by 1/8 to match voxel units.
     */
    async loadFusedBrain() {
        const plyLoader = new PLYLoader();
        const group = new THREE.Group();

        const meshConfigs = [
            { url: 'data/brain/JRCFIB2022M_brain.ply', color: 0x6688aa },
            { url: 'data/brain/JRCFIB2022M_vnc.ply', color: 0x7788aa },
        ];

        for (const { url, color } of meshConfigs) {
            try {
                const geometry = await new Promise((resolve, reject) => {
                    plyLoader.load(url, resolve, undefined, reject);
                });

                // Scale from nanometers to voxel units
                const pos = geometry.attributes.position;
                for (let i = 0; i < pos.count; i++) {
                    pos.setX(i, pos.getX(i) * PLY_TO_VOXEL);
                    pos.setY(i, pos.getY(i) * PLY_TO_VOXEL * Y_FLIP);
                    pos.setZ(i, pos.getZ(i) * PLY_TO_VOXEL);
                }
                pos.needsUpdate = true;
                geometry.computeVertexNormals();
                geometry.computeBoundingBox();
                geometry.computeBoundingSphere();

                const material = new THREE.MeshPhongMaterial({
                    color,
                    transparent: true,
                    opacity: 0.18,
                    side: THREE.FrontSide,
                    depthWrite: false,
                    shininess: 30,
                });

                const mesh = new THREE.Mesh(geometry, material);
                group.add(mesh);
                this.roiMeshes.push(mesh);
            } catch (err) {
                console.warn(`Failed to load ${url}`, err);
            }
        }

        this.brainMeshGroup = group;
        this.scene.add(group);
    }

    /**
     * Load individual ROI meshes (kept as option, hidden by default).
     * @param {Object} neuropilConfig - from neuropils.json
     * @param {Function} loadOBJTextFn - async fn(path) => string
     */
    async loadIndividualRois(neuropilConfig, loadOBJTextFn) {
        const objLoader = new OBJLoader();

        for (const roi of neuropilConfig.rois) {
            try {
                const objText = await loadOBJTextFn(`brain/${roi.file}`);
                const obj = objLoader.parse(objText);
                const color = new THREE.Color(roi.color);

                obj.traverse((child) => {
                    if (child.isMesh) {
                        child.material = new THREE.MeshPhongMaterial({
                            color,
                            transparent: true,
                            opacity: 0.10,
                            side: THREE.DoubleSide,
                            depthWrite: false,
                        });
                        // OBJ ROIs are already in 8nm voxel units - just flip Y
                        const pos = child.geometry.attributes.position;
                        for (let i = 0; i < pos.count; i++) {
                            pos.setY(i, pos.getY(i) * Y_FLIP);
                        }
                        pos.needsUpdate = true;
                        child.geometry.computeBoundingBox();
                        child.geometry.computeBoundingSphere();
                        child.userData.roiName = roi.name;
                    }
                });

                obj.visible = this.showIndividualRois;
                this.roiGroups.push(obj);
                this.scene.add(obj);
            } catch (err) {
                // Silently skip individual ROIs that fail
            }
        }
    }

    /**
     * Toggle between fused brain and individual ROI view.
     */
    toggleRoiMode() {
        this.showIndividualRois = !this.showIndividualRois;

        // Keep brain shell always visible; dim it when showing ROIs
        if (this.brainMeshGroup) {
            this.brainMeshGroup.traverse((child) => {
                if (child.isMesh) {
                    child.material.opacity = this.showIndividualRois ? 0.06 : 0.18;
                }
            });
        }
        for (const g of this.roiGroups) {
            g.visible = this.showIndividualRois;
        }

        // Update raycasting targets - always include brain shell for clicking
        this.roiMeshes = [];
        if (this.brainMeshGroup) {
            this.brainMeshGroup.traverse((child) => {
                if (child.isMesh) this.roiMeshes.push(child);
            });
        }
        if (this.showIndividualRois) {
            for (const g of this.roiGroups) {
                g.traverse((child) => {
                    if (child.isMesh) this.roiMeshes.push(child);
                });
            }
        }
    }

    /**
     * Handle click to place guess (only on clean clicks, not drags).
     * Always places on the nearest mesh surface using DoubleSide raycasting.
     */
    _onClick(event) {
        if (!this.guessEnabled) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Temporarily force DoubleSide so we can raycast from any angle
        const savedSides = [];
        for (const mesh of this.roiMeshes) {
            savedSides.push(mesh.material.side);
            mesh.material.side = THREE.DoubleSide;
        }
        const intersects = this.raycaster.intersectObjects(this.roiMeshes);
        // Restore original side settings
        for (let i = 0; i < this.roiMeshes.length; i++) {
            this.roiMeshes[i].material.side = savedSides[i];
        }

        if (intersects.length > 0) {
            const point = intersects[0].point.clone();

            // Store surface point and lock the depth line direction at click time
            this._guessSurfacePoint = point.clone();
            this._guessLineDir = new THREE.Vector3()
                .subVectors(this.controls.target, this.camera.position)
                .normalize();
            this._guessDepth = 0;
            this._guessDepthTarget = 0;

            // Snap marker directly to surface on click
            this._placeGuessMarker(point);
            if (this.guessMarker) {
                this.guessMarker.material.opacity = 1.0;
                this.guessMarker.material.transparent = false;
            }
            if (this.onGuessPlaced) {
                this.onGuessPlaced(this._toData(point));
            }
        }
    }

    /**
     * Shift+scroll adjusts guess depth along the current camera view direction.
     * Normal scroll (without Shift) passes through to OrbitControls for zoom.
     *
     * Sets a target position; the marker glides toward it smoothly in _animate.
     * Uses continuous scroll delta (not rastered steps) so the dot can be anywhere.
     */
    _onWheel(event) {
        if (!event.shiftKey) return; // normal scroll = zoom
        if (!this.guessEnabled) return;
        if (!this._guessSurfacePoint || !this._guessLineDir) return;
        if (!this.guessMarker || !this.guessMarker.visible) return;

        event.preventDefault();

        // macOS swaps deltaX/deltaY when Shift is held; use whichever is larger
        const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
            ? event.deltaX : event.deltaY;

        this.adjustDepth(rawDelta * 15);
    }

    /**
     * Adjust depth by a delta amount along the fixed line direction.
     * Returns true if depth was adjusted, false if no guess is active.
     */
    adjustDepth(delta) {
        if (!this.guessEnabled || !this._guessSurfacePoint || !this._guessLineDir) return false;
        if (!this.guessMarker || !this.guessMarker.visible) return false;
        this._guessDepthTarget += delta;

        // Report projected position immediately for responsive coordinate display
        if (this.onGuessPlaced) {
            const pos = this._guessSurfacePoint.clone()
                .addScaledVector(this._guessLineDir, this._guessDepthTarget);
            this.onGuessPlaced(this._toData(pos));
        }
        return true;
    }

    _placeGuessMarker(position) {
        if (!this.guessMarker) {
            const geo = new THREE.SphereGeometry(500, 16, 16);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
            this.guessMarker = new THREE.Mesh(geo, mat);
            this.scene.add(this.guessMarker);
        }
        this.guessMarker.position.copy(position);
        this.guessMarker.visible = true;
    }

    /**
     * Show the correct answer: neuron in brain, answer marker, line from guess.
     * If midlineX is provided and the mirrored position was used, the neuron
     * skeleton is also mirrored so it visually matches the scored answer.
     * @param {number[]} answerPos - [x, y, z] in data coords (may be mirrored)
     * @param {Object} neuronData - {nodes, edges, ...}
     * @param {number} [midlineX] - brain midline X for mirroring the skeleton
     */
    showAnswer(answerPos, neuronData, midlineX) {
        this.guessEnabled = false;

        // Detect if the answer was mirrored by comparing to original
        const origAnswer = neuronData.answer;
        const isMirrored = midlineX != null &&
            Math.abs(answerPos[0] - origAnswer[0]) > 1;

        const answerDisplay = this._toDisplay(answerPos[0], answerPos[1], answerPos[2]);

        // Red answer marker
        const ansGeo = new THREE.SphereGeometry(600, 16, 16);
        const ansMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
        this.answerMarker = new THREE.Mesh(ansGeo, ansMat);
        this.answerMarker.position.copy(answerDisplay);
        this.scene.add(this.answerMarker);

        // White dashed line from guess to answer
        if (this.guessMarker && this.guessMarker.visible) {
            const points = [
                this.guessMarker.position.clone(),
                answerDisplay.clone(),
            ];
            const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
            const lineMat = new THREE.LineDashedMaterial({
                color: 0xffffff,
                dashSize: 800,
                gapSize: 400,
                linewidth: 2,
            });
            this.answerLine = new THREE.Line(lineGeo, lineMat);
            this.answerLine.computeLineDistances();
            this.scene.add(this.answerLine);
        }

        // Show the neuron skeleton in brain context (mirrored if needed)
        this._showNeuronInContext(neuronData, isMirrored ? midlineX : null);
    }

    _showNeuronInContext(neuronData, mirrorMidlineX) {
        if (neuronData.mesh) {
            this._showMeshInContext(neuronData.mesh, mirrorMidlineX);
        } else {
            this._showSkeletonInContext(neuronData, mirrorMidlineX);
        }
    }

    _showMeshInContext(mesh, mirrorMidlineX) {
        const { vertices, indices } = mesh;
        const verts = new Float32Array(vertices.length);

        for (let i = 0; i < vertices.length; i += 3) {
            let x = vertices[i];
            if (mirrorMidlineX != null) x = 2 * mirrorMidlineX - x;
            verts[i] = x;
            verts[i + 1] = vertices[i + 1] * Y_FLIP;
            verts[i + 2] = vertices[i + 2];
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geo.setIndex(new THREE.BufferAttribute(indices, 1));
        geo.computeVertexNormals();

        const mat = new THREE.MeshPhongMaterial({
            color: 0xffaa00,
            shininess: 30,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
        });

        this.neuronGroup = new THREE.Mesh(geo, mat);
        this.scene.add(this.neuronGroup);
    }

    _showSkeletonInContext(neuronData, mirrorMidlineX) {
        const { nodes, edges } = neuronData;
        const positions = new Float32Array(edges.length * 6);

        for (let i = 0; i < edges.length; i++) {
            const [pIdx, cIdx] = edges[i];
            const p = nodes[pIdx];
            const c = nodes[cIdx];
            let px = p[0], cx = c[0];
            if (mirrorMidlineX != null) {
                px = 2 * mirrorMidlineX - px;
                cx = 2 * mirrorMidlineX - cx;
            }
            positions[i * 6 + 0] = px;
            positions[i * 6 + 1] = p[1] * Y_FLIP;
            positions[i * 6 + 2] = p[2];
            positions[i * 6 + 3] = cx;
            positions[i * 6 + 4] = c[1] * Y_FLIP;
            positions[i * 6 + 5] = c[2];
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color: 0xffaa00 });
        this.neuronGroup = new THREE.LineSegments(geo, mat);
        this.scene.add(this.neuronGroup);
    }

    /**
     * Show all round guesses and answers on the brain at once (final overview).
     * @param {Array} roundScores - from gameState.roundScores
     */
    showAllRounds(roundScores) {
        this.clearGuess();
        this.guessEnabled = false;
        this._overviewObjects = [];

        for (let i = 0; i < roundScores.length; i++) {
            const r = roundScores[i];
            const guessDisplay = this._toDisplay(r.guess[0], r.guess[1], r.guess[2]);
            const answerDisplay = this._toDisplay(r.answer[0], r.answer[1], r.answer[2]);

            // Green guess marker
            const gGeo = new THREE.SphereGeometry(400, 12, 12);
            const gMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
            const gMesh = new THREE.Mesh(gGeo, gMat);
            gMesh.position.copy(guessDisplay);
            this.scene.add(gMesh);
            this._overviewObjects.push(gMesh);

            // Red answer marker
            const aGeo = new THREE.SphereGeometry(400, 12, 12);
            const aMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
            const aMesh = new THREE.Mesh(aGeo, aMat);
            aMesh.position.copy(answerDisplay);
            this.scene.add(aMesh);
            this._overviewObjects.push(aMesh);

            // Dashed line connecting guess to answer
            const lineGeo = new THREE.BufferGeometry().setFromPoints([
                guessDisplay.clone(), answerDisplay.clone()
            ]);
            const lineMat = new THREE.LineDashedMaterial({
                color: 0xffffff, opacity: 0.4, transparent: true,
                dashSize: 600, gapSize: 300,
            });
            const line = new THREE.Line(lineGeo, lineMat);
            line.computeLineDistances();
            this.scene.add(line);
            this._overviewObjects.push(line);
        }
    }

    /**
     * Clear the final overview objects.
     */
    clearOverview() {
        if (!this._overviewObjects) return;
        for (const obj of this._overviewObjects) {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        }
        this._overviewObjects = null;
    }

    /**
     * Show/update a dotted line from the marker through the camera view direction
     * so the player can see which axis Shift+scroll will move along.
     * Only shown in perspective mode.
     */
    _updateDepthGuide() {
        if (!this.guessEnabled || !this.guessMarker || !this.guessMarker.visible) {
            this._hideDepthGuide();
            return;
        }

        if (this.isOrtho) {
            this._hideDepthGuide();
            return;
        }

        if (!this._guessLineDir || !this._guessSurfacePoint) {
            this._hideDepthGuide();
            return;
        }

        // Line uses the fixed direction set at click time — never changes
        // Short behind surface (toward camera), long into brain
        const anchor = this._guessSurfacePoint;
        const start = anchor.clone().addScaledVector(this._guessLineDir, -10000000);
        const end = anchor.clone().addScaledVector(this._guessLineDir, 10000000);

        // Lazy-init shared material
        if (!this._depthGuideMat) {
            this._depthGuideMat = new THREE.LineDashedMaterial({
                color: 0x00ff88,
                opacity: 0.3,
                transparent: true,
                dashSize: 400,
                gapSize: 300,
            });
        }

        // Recreate line geometry each frame so direction always matches camera
        if (this._depthGuideLine) {
            this.scene.remove(this._depthGuideLine);
            this._depthGuideLine.geometry.dispose();
        }
        const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
        this._depthGuideLine = new THREE.Line(geo, this._depthGuideMat);
        this._depthGuideLine.computeLineDistances();
        this.scene.add(this._depthGuideLine);
    }

    _hideDepthGuide() {
        if (this._depthGuideLine) {
            this.scene.remove(this._depthGuideLine);
            this._depthGuideLine.geometry.dispose();
            this._depthGuideLine = null;
        }
    }

    /**
     * Clear all guess/answer visuals for a new round.
     */
    clearGuess() {
        if (this.guessMarker) {
            this.guessMarker.visible = false;
        }
        this._hideDepthGuide();
        if (this.answerMarker) {
            this.scene.remove(this.answerMarker);
            this.answerMarker.geometry.dispose();
            this.answerMarker.material.dispose();
            this.answerMarker = null;
        }
        if (this.answerLine) {
            this.scene.remove(this.answerLine);
            this.answerLine.geometry.dispose();
            this.answerLine.material.dispose();
            this.answerLine = null;
        }
        if (this.neuronGroup) {
            this.scene.remove(this.neuronGroup);
            this.neuronGroup.geometry.dispose();
            this.neuronGroup.material.dispose();
            this.neuronGroup = null;
        }
        this.guessEnabled = true;
        this._guessSurfacePoint = null;
        this._guessLineDir = null;
        this._guessDepth = 0;
        this._guessDepthTarget = 0;
    }

    _fitCameraToBrain() {
        const box = new THREE.Box3();
        for (const mesh of this.roiMeshes) {
            box.expandByObject(mesh);
        }
        if (box.isEmpty()) {
            this.camera.position.set(0, 0, 50000);
            return;
        }

        this._brainCenter = box.getCenter(new THREE.Vector3());
        this._brainSize = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(this._brainSize.x, this._brainSize.y, this._brainSize.z);

        // Position camera looking from front (anterior view)
        this.camera.position.set(
            this._brainCenter.x, this._brainCenter.y,
            this._brainCenter.z + maxDim * 1.2
        );

        if (this.camera.isPerspectiveCamera) {
            this.camera.near = 10;
            this.camera.far = maxDim * 100;
        }
        if (this.camera.isOrthographicCamera) {
            this._updateOrthoFrustum();
        }
        this.camera.updateProjectionMatrix();
        this.controls.target.copy(this._brainCenter);
        this.controls.update();
    }

    /**
     * Update orthographic frustum to fit the brain at current aspect ratio.
     */
    _updateOrthoFrustum() {
        if (!this._brainSize) return;
        const parent = this.renderer.domElement.parentElement;
        if (!parent) return;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (w === 0 || h === 0) return;
        const aspect = w / h;
        const maxDim = Math.max(this._brainSize.x, this._brainSize.y, this._brainSize.z);
        const halfH = maxDim * 0.7;
        const halfW = halfH * aspect;
        this._orthoCamera.left = -halfW;
        this._orthoCamera.right = halfW;
        this._orthoCamera.top = halfH;
        this._orthoCamera.bottom = -halfH;
        this._orthoCamera.near = -500000;
        this._orthoCamera.far = 500000;
        this._orthoCamera.updateProjectionMatrix();
    }

    /**
     * Toggle between perspective and orthographic camera.
     */
    toggleProjection() {
        const oldCam = this.camera;
        this.isOrtho = !this.isOrtho;

        if (this.isOrtho) {
            // Copy view state to ortho camera
            this._orthoCamera.position.copy(oldCam.position);
            this._orthoCamera.quaternion.copy(oldCam.quaternion);
            this._updateOrthoFrustum();
            this.camera = this._orthoCamera;
        } else {
            // Copy view state to perspective camera
            this._perspCamera.position.copy(oldCam.position);
            this._perspCamera.quaternion.copy(oldCam.quaternion);
            const parent = this.renderer.domElement.parentElement;
            if (parent) {
                this._perspCamera.aspect = parent.clientWidth / parent.clientHeight;
            }
            this._perspCamera.updateProjectionMatrix();
            this.camera = this._perspCamera;
        }

        // Rewire controls to new camera
        this.controls.object = this.camera;
        this.controls.update();
    }

    /**
     * Reset camera to the default brain overview.
     */
    resetCamera() {
        this._fitCameraToBrain();
    }

    _animate() {
        requestAnimationFrame(this._animate);
        this.controls.update();

        // Compute marker position: surfacePoint + depth * lineDir (always on the fixed line)
        if (this.guessMarker && this.guessMarker.visible
            && this._guessSurfacePoint && this._guessLineDir) {
            // Smooth depth lerp
            this._guessDepth += (this._guessDepthTarget - this._guessDepth) * 0.18;

            // Position marker along the fixed line
            const targetPos = this._guessSurfacePoint.clone()
                .addScaledVector(this._guessLineDir, this._guessDepth);
            this.guessMarker.position.copy(targetPos);

            // Constant bright green, constant size
            this.guessMarker.material.color.setRGB(0, 1, 0.53);
            this.guessMarker.material.opacity = 1.0;
            this.guessMarker.material.transparent = false;
            this.guessMarker.scale.setScalar(1.0);

            // Depth guide line in perspective mode: dotted line along view direction
            this._updateDepthGuide();
        } else {
            this._hideDepthGuide();
        }

        this.renderer.render(this.scene, this.camera);
    }

    _onResize() {
        // Use the canvas's current parent as the size reference
        // (canvas may move between containers)
        const parent = this.renderer.domElement.parentElement;
        if (!parent) return;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (w === 0 || h === 0) return;

        if (this.camera.isPerspectiveCamera) {
            this.camera.aspect = w / h;
        }
        if (this.camera.isOrthographicCamera) {
            this._updateOrthoFrustum();
        }
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    dispose() {
        this._resizeObserver.disconnect();
        this.renderer.dispose();
    }
}
