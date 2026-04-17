import { useEffect, useRef } from "react";

interface DogMascotProps {
  size?: number;
  className?: string;
  animate?: boolean;
}

/**
 * Animated lineart sniffing dog mascot — pure SVG CSS animation loop.
 * The dog sniffs the ground, tail wags, and nose twitches in a continuous loop.
 */
export function DogMascot({ size = 160, className = "", animate = true }: DogMascotProps) {
  return (
    <div
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
      aria-label="Searching dog mascot"
      role="img"
    >
      <svg
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: "100%", height: "100%" }}
      >
        <style>{`
          @keyframes sniff {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            25% { transform: translateY(-4px) rotate(-3deg); }
            50% { transform: translateY(-2px) rotate(0deg); }
            75% { transform: translateY(-5px) rotate(2deg); }
          }
          @keyframes tailWag {
            0%, 100% { transform: rotate(0deg); transform-origin: 60px 80px; }
            25% { transform: rotate(25deg); transform-origin: 60px 80px; }
            75% { transform: rotate(-20deg); transform-origin: 60px 80px; }
          }
          @keyframes noseTwitch {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          @keyframes bodyBob {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-3px); }
          }
          @keyframes earFlap {
            0%, 100% { transform: rotate(0deg); transform-origin: 130px 65px; }
            40% { transform: rotate(8deg); transform-origin: 130px 65px; }
            80% { transform: rotate(-5deg); transform-origin: 130px 65px; }
          }
          @keyframes sniffParticle {
            0% { opacity: 0; transform: translateY(0) scale(0.5); }
            50% { opacity: 0.7; transform: translateY(-8px) scale(1); }
            100% { opacity: 0; transform: translateY(-16px) scale(0.3); }
          }
          .dog-body { animation: ${animate ? "bodyBob 1.2s ease-in-out infinite" : "none"}; }
          .dog-head { animation: ${animate ? "sniff 1.2s ease-in-out infinite" : "none"}; }
          .dog-tail { animation: ${animate ? "tailWag 0.6s ease-in-out infinite" : "none"}; }
          .dog-nose { animation: ${animate ? "noseTwitch 0.8s ease-in-out infinite" : "none"}; }
          .dog-ear { animation: ${animate ? "earFlap 1.4s ease-in-out infinite" : "none"}; }
          .sniff-p1 { animation: ${animate ? "sniffParticle 1.2s ease-out infinite 0s" : "none"}; }
          .sniff-p2 { animation: ${animate ? "sniffParticle 1.2s ease-out infinite 0.4s" : "none"}; }
          .sniff-p3 { animation: ${animate ? "sniffParticle 1.2s ease-out infinite 0.8s" : "none"}; }
        `}</style>

        {/* Ground line */}
        <line x1="20" y1="155" x2="180" y2="155" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />

        {/* Dog body */}
        <g className="dog-body">
          {/* Body */}
          <ellipse cx="100" cy="130" rx="42" ry="22" stroke="currentColor" strokeWidth="2.5" fill="none" />

          {/* Front legs */}
          <line x1="120" y1="148" x2="120" y2="155" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="132" y1="148" x2="132" y2="155" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />

          {/* Back legs */}
          <line x1="72" y1="148" x2="70" y2="155" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="82" y1="150" x2="80" y2="155" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />

          {/* Tail */}
          <g className="dog-tail">
            <path d="M58 120 Q45 105 50 92 Q55 80 62 85" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </g>

          {/* Neck */}
          <path d="M130 115 Q138 108 142 100" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>

        {/* Dog head */}
        <g className="dog-head">
          {/* Head circle */}
          <circle cx="152" cy="90" r="22" stroke="currentColor" strokeWidth="2.5" fill="none" />

          {/* Ear */}
          <g className="dog-ear">
            <path d="M138 72 Q128 58 132 48 Q138 40 145 50 Q148 60 142 68" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>

          {/* Eye */}
          <circle cx="158" cy="84" r="3" fill="currentColor" />
          <circle cx="159" cy="83" r="1" fill="white" opacity="0.6" />

          {/* Snout */}
          <ellipse cx="168" cy="97" rx="8" ry="6" stroke="currentColor" strokeWidth="2" fill="none" />

          {/* Nose */}
          <g className="dog-nose">
            <ellipse cx="170" cy="95" rx="4" ry="2.5" fill="currentColor" />
          </g>

          {/* Mouth */}
          <path d="M163 101 Q168 105 173 101" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />

          {/* Sniff particles */}
          <g opacity="0.6">
            <circle className="sniff-p1" cx="178" cy="93" r="2" fill="currentColor" />
            <circle className="sniff-p2" cx="182" cy="90" r="1.5" fill="currentColor" />
            <circle className="sniff-p3" cx="175" cy="88" r="1" fill="currentColor" />
          </g>
        </g>
      </svg>
    </div>
  );
}
