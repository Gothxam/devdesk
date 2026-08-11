/**
 * Stage 5C — Ambient Desktop Wallpaper Component
 * Wallpaper-aware depth, ambient light spheres, and wallpaper grid texture.
 */

export function Wallpaper(): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 35%, #181b2c 0%, #0d0e16 60%, #050609 100%)',
        overflow: 'hidden',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      {/* Background ambient lighting orbs */}
      <div
        style={{
          position: 'absolute',
          top: '-15%',
          left: '25%',
          width: '55vw',
          height: '55vh',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.09) 0%, rgba(0, 0, 0, 0) 70%)',
          filter: 'blur(70px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-10%',
          right: '20%',
          width: '45vw',
          height: '45vh',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.06) 0%, rgba(0, 0, 0, 0) 70%)',
          filter: 'blur(60px)',
        }}
      />

      {/* Subtle wallpaper grid texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          opacity: 0.45,
        }}
      />
    </div>
  );
}
