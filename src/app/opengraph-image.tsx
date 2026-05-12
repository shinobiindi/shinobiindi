import { ImageResponse } from "next/og";

export const alt = "SHINOBI INDI | Discipline. Precision. Profit.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 18,
          background: "linear-gradient(145deg, #020617 0%, #0b1225 55%, #1e3a8a 100%)",
          color: "#e2e8f0",
          fontFamily: "JetBrains Mono, ui-monospace, Menlo, Monaco, Consolas, monospace",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: 72, fontWeight: 800, letterSpacing: -2, color: "#3b82f6" }}>
          SHINOBI INDI
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#cbd5e1" }}>
          Discipline. Precision. Profit.
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 12 }}>
          <div style={{ display: "flex", padding: "10px 16px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.5)", color: "#93c5fd" }}>XAUUSD</div>
          <div style={{ display: "flex", padding: "10px 16px", borderRadius: 999, border: "1px solid rgba(16,185,129,0.55)", color: "#34d399" }}>Realtime Signals</div>
          <div style={{ display: "flex", padding: "10px 16px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.45)", color: "#cbd5e1" }}>Risk Planner</div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}