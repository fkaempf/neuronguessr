/**
 * Three.js viewer for displaying a mystery neuron skeleton in isolation.
 * The neuron is centered at the origin with no brain context.
 * Player can rotate and zoom to study its morphology.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class NeuronViewer {
    /**
     * @param {HTMLElement} container - DOM element to mount the renderer in
     */
    constructor(container) {
        this.container = container;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        // Camera
        const aspect = container.clientWidth / container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 50000);
        this.camera.position.set(0, 0, 300);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 1.5;

        // Lighting (directional lights needed for mesh shading)
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight.position.set(1, 1, 1).normalize();
        this.scene.add(dirLight);
        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
        dirLight2.position.set(-1, -0.5, -1).normalize();
        this.scene.add(dirLight2);

        // Current neuron group
        this.currentGroup = null;

        // Start animation loop
        this._animate = this._animate.bind(this);
        this._animate();

        // Handle resize
        this._resizeObserver = new ResizeObserver(() => this._onResize());
        this._resizeObserver.observe(container);
    }

    /**
     * Display a neuron from preprocessed data.
     * Uses 3D mesh if available, falls back to skeleton lines.
     * @param {Object} neuronData - {nodes, edges, centroid, soma, bounds, mesh?}
     */
    displayNeuron(neuronData) {
        // Clear previous
        if (this.currentGroup) {
            this.currentGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.scene.remove(this.currentGroup);
        }

        const group = new THREE.Group();
        const { centroid } = neuronData;

        // Random saturated color
        const hue = Math.random();
        const color = new THREE.Color().setHSL(hue, 0.85, 0.6);

        if (neuronData.mesh) {
            // Render 3D mesh
            const { vertices, indices } = neuronData.mesh;

            // Center vertices at origin
            const centered = new Float32Array(vertices.length);
            for (let i = 0; i < vertices.length; i += 3) {
                centered[i] = vertices[i] - centroid[0];
                centered[i + 1] = vertices[i + 1] - centroid[1];
                centered[i + 2] = vertices[i + 2] - centroid[2];
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(centered, 3));
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            geometry.computeVertexNormals();

            const material = new THREE.MeshPhongMaterial({
                color,
                shininess: 40,
                side: THREE.DoubleSide,
            });

            group.add(new THREE.Mesh(geometry, material));
        } else {
            // Fallback: render skeleton as line segments
            const { nodes, edges } = neuronData;
            const positions = new Float32Array(edges.length * 6);
            for (let i = 0; i < edges.length; i++) {
                const [pIdx, cIdx] = edges[i];
                const p = nodes[pIdx];
                const c = nodes[cIdx];
                positions[i * 6 + 0] = p[0] - centroid[0];
                positions[i * 6 + 1] = p[1] - centroid[1];
                positions[i * 6 + 2] = p[2] - centroid[2];
                positions[i * 6 + 3] = c[0] - centroid[0];
                positions[i * 6 + 4] = c[1] - centroid[1];
                positions[i * 6 + 5] = c[2] - centroid[2];
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color })));
        }

        // Soma marker (white sphere)
        if (neuronData.soma) {
            const somaRadius = 125 / 2;
            const somaGeo = new THREE.SphereGeometry(somaRadius, 16, 16);
            const somaMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const somaMesh = new THREE.Mesh(somaGeo, somaMat);
            somaMesh.position.set(
                neuronData.soma[0] - centroid[0],
                neuronData.soma[1] - centroid[1],
                neuronData.soma[2] - centroid[2]
            );
            group.add(somaMesh);
        }

        this.scene.add(group);
        this.currentGroup = group;
        this._fitCamera(neuronData);
    }

    _fitCamera(neuronData) {
        const { bounds, centroid } = neuronData;
        const sizeX = bounds.max[0] - bounds.min[0];
        const sizeY = bounds.max[1] - bounds.min[1];
        const sizeZ = bounds.max[2] - bounds.min[2];
        this._lastMaxDim = Math.max(sizeX, sizeY, sizeZ);

        this.camera.position.set(0, 0, this._lastMaxDim * 1.5);
        this.camera.near = this._lastMaxDim * 0.001;
        this.camera.far = this._lastMaxDim * 10;
        this.camera.updateProjectionMatrix();
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    resetCamera() {
        if (this._lastMaxDim) {
            this.camera.position.set(0, 0, this._lastMaxDim * 1.5);
            this.camera.updateProjectionMatrix();
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }

    _animate() {
        requestAnimationFrame(this._animate);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    _onResize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    dispose() {
        this._resizeObserver.disconnect();
        this.renderer.dispose();
    }
}
