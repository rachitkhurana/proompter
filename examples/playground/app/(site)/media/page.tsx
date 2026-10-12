"use client";

import { useEffect, useRef } from "react";

// Served at /media?origin=http://localhost:3106. A cross-origin <video> and a canvas tainted by a cross-origin image,
// both from a server that sends no CORS headers (scripts/e2e-servers.mjs), inside a fixed-size card. html-to-image's
// toDataURL() on either throws a SecurityError; the snapshot must still come out with grey placeholders (D17).
export default function Page() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const origin = new URLSearchParams(window.location.search).get("origin");
    if (!origin) return;
    if (video.current) video.current.src = `${origin}/clip.webm`;
    const img = new Image(); // no crossOrigin attribute: drawing it taints the canvas
    img.onload = () => canvas.current?.getContext("2d")?.drawImage(img, 0, 0, 160, 90);
    img.src = `${origin}/pic.svg`;
  }, []);
  return (
    <main style={{ padding: 40, minHeight: 1200, fontFamily: "system-ui, sans-serif" }}>
      <div data-testid="media-card" style={{ position: "relative", width: 420, height: 360, background: "#fff", color: "#111", border: "2px solid #36c" }}>
        <h2 style={{ margin: 12 }}>Clip of the day</h2>
        <video
          ref={video}
          data-testid="media-video"
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          style={{ position: "absolute", left: 20, top: 60, width: 240, height: 135, background: "#0a0" }}
        />
        <canvas
          ref={canvas}
          data-testid="media-canvas"
          width={160}
          height={90}
          style={{ position: "absolute", left: 20, top: 220, width: 160, height: 90, background: "#0a0" }}
        />
        <p style={{ position: "absolute", left: 280, top: 60, width: 120, margin: 0 }}>Normal text beside the media.</p>
      </div>
    </main>
  );
}
