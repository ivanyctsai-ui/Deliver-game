/**
 * mouse_fx.js — Circuit-board cursor particle effects (standalone, no game deps)
 */
"use strict";

(function initMouseFx() {
  const canvas = document.getElementById("mouse-canvas");
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const COLOR_TRAIL = "#06b6d4";
  const COLOR_BURST = "#ec4899";
  const BG_FADE = "rgba(15, 23, 42, 0.1)";
  const MAX_PARTICLES = 600;

  /** @type {HTMLCanvasElement} */
  const cvs = canvas;
  /** @type {CanvasRenderingContext2D} */
  const context = ctx;

  let width = 0;
  let height = 0;
  let mouseX = -1000;
  let mouseY = -1000;
  let isDragging = false;

  /** @type {Array<{x: number, y: number, vx: number, vy: number, life: number, decay: number, size: number, color: string}>} */
  const particles = [];

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    cvs.width = width;
    cvs.height = height;
  }

  function pushParticle(particle) {
    if (particles.length >= MAX_PARTICLES) {
      particles.shift();
    }
    particles.push(particle);
  }

  function spawnTrail(x, y, intensity = 1) {
    const count = Math.max(1, Math.floor(2 * intensity));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 0.9;
      pushParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.018 + Math.random() * 0.022,
        size: 1.5 + Math.random() * 2.5,
        color: COLOR_TRAIL,
      });
    }
  }

  function spawnBurst(x, y) {
    const count = 32;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 2.5 + Math.random() * 4.5;
      pushParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.012 + Math.random() * 0.012,
        size: 2.5 + Math.random() * 4,
        color: COLOR_BURST,
      });
    }
  }

  function spawnDragStream(x, y) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 3.5;
      pushParticle({
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 18,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 2.5,
        vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 2.5,
        life: 1,
        decay: 0.01 + Math.random() * 0.014,
        size: 3.5 + Math.random() * 5,
        color: Math.random() > 0.4 ? COLOR_BURST : COLOR_TRAIL,
      });
    }
  }

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (isDragging) {
      spawnDragStream(mouseX, mouseY);
    } else {
      spawnTrail(mouseX, mouseY, 1);
    }
  }

  function onMouseDown(e) {
    isDragging = true;
    mouseX = e.clientX;
    mouseY = e.clientY;
    spawnBurst(mouseX, mouseY);
    spawnDragStream(mouseX, mouseY);
  }

  function onMouseUp() {
    isDragging = false;
  }

  function tick() {
    context.fillStyle = BG_FADE;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life -= p.decay;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      const radius = p.size * (0.35 + p.life * 0.65);
      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.fillStyle = p.color;
      context.globalAlpha = p.life * 0.9;
      context.shadowBlur = 14;
      context.shadowColor = p.color;
      context.fill();
    }

    context.globalAlpha = 1;
    context.shadowBlur = 0;
    context.globalCompositeOperation = "source-over";
    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mouseleave", onMouseUp);

  resize();
  requestAnimationFrame(tick);
})();
