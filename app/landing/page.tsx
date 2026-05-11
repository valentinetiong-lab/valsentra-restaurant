import Link from "next/link";

const telemetry = [
  ["Protected", "RM 1,240"],
  ["At risk", "RM 620"],
  ["Recovered", "78%"],
];

const modes = [
  {
    label: "Guard",
    copy: "Deposits, payment verification, and staff release rules lock around exposed bookings before service begins.",
  },
  {
    label: "Read",
    copy: "Each table, appointment, or order is scored as safe, exposed, or critical with quiet operational clarity.",
  },
  {
    label: "Recover",
    copy: "Cancelled slots and failed orders move into a waitlist recovery flow instead of disappearing after hours.",
  },
];

export default function LandingPage() {
  return (
    <main className="luxury-shell">
      <style>{styles}</style>

      <nav className="topbar" aria-label="Primary navigation">
        <Link href="/" className="brand-mark" aria-label="Valsentra home">
          Valsentra
        </Link>
        <div className="nav-links">
          <a href="#calibre">Calibre</a>
          <a href="#control">Control</a>
          <Link href="/restaurant">Staff View</Link>
        </div>
      </nav>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Revenue Protection System / Calibre R-01</p>
          <h1 id="hero-title">
            Every reservation has a pulse. Valsentra keeps it alive.
          </h1>
          <p className="lede">
            A precise control interface for businesses where missed time,
            unpaid orders, and cancellations quietly become lost revenue.
          </p>
          <div className="hero-actions" aria-label="Product entry points">
            <Link href="/restaurant/owner">Owner Console</Link>
            <Link href="/restaurant">Staff Workflow</Link>
          </div>
        </div>

        <div className="instrument-stage" id="calibre" aria-label="Valsentra calibre interface">
          <div className="orbital-readout">
            <span>Live Risk</span>
            <strong>03</strong>
          </div>

          <div className="watch" aria-hidden="true">
            <div className="bezel">
              <span className="tick t1" />
              <span className="tick t2" />
              <span className="tick t3" />
              <span className="tick t4" />
              <div className="dial">
                <div className="inner-ring" />
                <div className="subdial subdial-left">
                  <span />
                </div>
                <div className="subdial subdial-right">
                  <span />
                </div>
                <div className="hand hand-long" />
                <div className="hand hand-short" />
                <div className="pinion" />
                <p className="dial-title">R-01</p>
                <p className="dial-caption">Protected Revenue</p>
              </div>
            </div>
          </div>

          <div className="side-readout">
            <span>Deposit Lock</span>
            <strong>Armed</strong>
          </div>
        </div>
      </section>

      <section className="precision-strip" aria-label="Live telemetry">
        {telemetry.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="editorial" id="control">
        <div>
          <p className="eyebrow">No noise. No guesswork.</p>
          <h2>Operational risk, reduced to a single decision surface.</h2>
        </div>
        <p>
          Valsentra gives owners and staff a measured signal before a booking is
          released, blocked, protected, or recovered. The interface stays dark,
          sparse, and deliberate because the work is urgent enough already.
        </p>
      </section>

      <section className="mode-rail" aria-label="Valsentra modes">
        {modes.map((mode, index) => (
          <article key={mode.label} className="mode">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{mode.label}</h3>
            <p>{mode.copy}</p>
          </article>
        ))}
      </section>

      <section className="closing">
        <p className="eyebrow">For restaurants, beauty studios, and time-based operators</p>
        <h2>Designed like an instrument. Used like a safeguard.</h2>
        <Link href="/restaurant/owner">Enter the console</Link>
      </section>
    </main>
  );
}

const styles = `
:root {
  color-scheme: dark;
  --black: #030303;
  --ink: #f4efe7;
  --muted: rgba(244, 239, 231, 0.58);
  --line: rgba(244, 239, 231, 0.14);
  --gold: #c6a15b;
  --danger: #8f332f;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--black);
}

.luxury-shell {
  min-height: 100vh;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 18rem),
    radial-gradient(circle at 50% 24rem, rgba(198, 161, 91, 0.09), transparent 34rem),
    #030303;
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.topbar {
  position: fixed;
  z-index: 20;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem clamp(1.25rem, 4vw, 4.5rem);
  color: rgba(244, 239, 231, 0.72);
  mix-blend-mode: difference;
}

.brand-mark,
.nav-links a,
.hero-actions a,
.closing a {
  color: inherit;
  text-decoration: none;
}

.brand-mark {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.nav-links {
  display: flex;
  gap: clamp(1rem, 3vw, 2.25rem);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(24rem, 1.05fr);
  min-height: 100vh;
  align-items: center;
  gap: clamp(2rem, 5vw, 5rem);
  padding: 7rem clamp(1.25rem, 5vw, 5rem) 4rem;
}

.hero:after {
  position: absolute;
  right: 0;
  bottom: 2rem;
  left: 0;
  height: 1px;
  content: "";
  background: linear-gradient(90deg, transparent, var(--line), transparent);
}

.hero-copy {
  max-width: 52rem;
}

.eyebrow {
  margin: 0;
  color: var(--gold);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

h1,
h2 {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 400;
  letter-spacing: 0;
}

h1 {
  max-width: 13ch;
  margin-top: 1.4rem;
  font-size: clamp(4.4rem, 10vw, 10.8rem);
  line-height: 0.85;
}

.lede {
  max-width: 38rem;
  margin: 2rem 0 0;
  color: var(--muted);
  font-size: clamp(1rem, 1.6vw, 1.3rem);
  line-height: 1.8;
}

.hero-actions {
  display: flex;
  gap: 1rem;
  margin-top: 2.5rem;
}

.hero-actions a,
.closing a {
  display: inline-flex;
  min-height: 2.8rem;
  align-items: center;
  border-bottom: 1px solid rgba(198, 161, 91, 0.7);
  color: var(--ink);
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.instrument-stage {
  position: relative;
  display: grid;
  min-height: min(58vw, 43rem);
  place-items: center;
}

.watch {
  position: relative;
  width: min(72vw, 38rem);
  aspect-ratio: 1;
  animation: float 9s ease-in-out infinite;
}

.bezel,
.dial,
.inner-ring,
.subdial {
  position: absolute;
  border-radius: 50%;
}

.bezel {
  inset: 4%;
  border: 1px solid rgba(244, 239, 231, 0.2);
  background:
    radial-gradient(circle at 34% 24%, rgba(255, 255, 255, 0.22), transparent 0.55rem),
    conic-gradient(from 220deg, #080808, #27231d, #080808, #15120e, #080808);
  box-shadow:
    inset 0 0 5rem rgba(255, 255, 255, 0.05),
    0 4rem 8rem rgba(0, 0, 0, 0.88);
}

.bezel:before {
  position: absolute;
  inset: 5%;
  content: "";
  border: 1px solid rgba(198, 161, 91, 0.24);
  border-radius: inherit;
}

.dial {
  inset: 12%;
  overflow: hidden;
  border: 1px solid rgba(244, 239, 231, 0.16);
  background:
    linear-gradient(120deg, rgba(255, 255, 255, 0.08), transparent 42%),
    repeating-conic-gradient(from 0deg, rgba(244, 239, 231, 0.055) 0deg 1deg, transparent 1deg 8deg),
    radial-gradient(circle, #161411, #050505 68%);
}

.inner-ring {
  inset: 18%;
  border: 1px solid rgba(244, 239, 231, 0.1);
  animation: rotateSlow 30s linear infinite;
}

.subdial {
  top: 55%;
  width: 25%;
  aspect-ratio: 1;
  border: 1px solid rgba(198, 161, 91, 0.32);
  background: rgba(0, 0, 0, 0.34);
}

.subdial-left {
  left: 18%;
}

.subdial-right {
  right: 18%;
}

.subdial span,
.hand {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1px;
  transform-origin: 50% 100%;
  background: var(--gold);
}

.subdial span {
  height: 34%;
  animation: sweep 8s linear infinite;
}

.hand-long {
  height: 37%;
  animation: sweep 16s linear infinite;
}

.hand-short {
  height: 27%;
  background: rgba(244, 239, 231, 0.74);
  animation: sweep 48s linear infinite;
}

.pinion {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0.7rem;
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--gold);
  transform: translate(-50%, -50%);
}

.dial-title,
.dial-caption {
  position: absolute;
  left: 0;
  right: 0;
  margin: 0;
  text-align: center;
}

.dial-title {
  top: 28%;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.7rem, 4vw, 3.2rem);
  letter-spacing: 0.08em;
}

.dial-caption {
  top: 41%;
  color: rgba(244, 239, 231, 0.46);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.tick {
  position: absolute;
  left: 50%;
  top: 2.2%;
  width: 1px;
  height: 9%;
  background: rgba(198, 161, 91, 0.58);
  transform-origin: 50% 535%;
}

.t2 {
  transform: rotate(90deg);
}

.t3 {
  transform: rotate(180deg);
}

.t4 {
  transform: rotate(270deg);
}

.orbital-readout,
.side-readout {
  position: absolute;
  z-index: 2;
  width: 10rem;
  border-top: 1px solid var(--line);
  padding-top: 0.85rem;
  backdrop-filter: blur(8px);
}

.orbital-readout {
  left: 5%;
  top: 17%;
}

.side-readout {
  right: 2%;
  bottom: 20%;
}

.orbital-readout span,
.side-readout span,
.precision-strip span,
.mode span {
  display: block;
  color: rgba(244, 239, 231, 0.48);
  font-size: 0.66rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.orbital-readout strong,
.side-readout strong {
  display: block;
  margin-top: 0.45rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 2.2rem;
  font-weight: 400;
}

.precision-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  margin: 0 clamp(1.25rem, 5vw, 5rem);
}

.precision-strip div {
  min-height: 8rem;
  padding: 1.5rem 0;
}

.precision-strip div + div {
  border-left: 1px solid var(--line);
  padding-left: clamp(1rem, 3vw, 3rem);
}

.precision-strip strong {
  display: block;
  margin-top: 1rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2.2rem, 5vw, 4.8rem);
  font-weight: 400;
}

.editorial {
  display: grid;
  grid-template-columns: 1fr 0.65fr;
  gap: clamp(2rem, 7vw, 7rem);
  padding: clamp(6rem, 13vw, 12rem) clamp(1.25rem, 5vw, 5rem);
}

.editorial h2,
.closing h2 {
  max-width: 13ch;
  margin-top: 1.1rem;
  font-size: clamp(3rem, 7vw, 8rem);
  line-height: 0.92;
}

.editorial > p {
  align-self: end;
  max-width: 34rem;
  margin: 0;
  color: var(--muted);
  font-size: clamp(1rem, 1.6vw, 1.2rem);
  line-height: 1.9;
}

.mode-rail {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 0 clamp(1.25rem, 5vw, 5rem);
  background: var(--line);
}

.mode {
  min-height: 21rem;
  padding: clamp(1.4rem, 4vw, 3rem);
  background: #050505;
}

.mode h3 {
  margin: 4rem 0 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2.5rem, 5vw, 5.5rem);
  font-weight: 400;
}

.mode p {
  max-width: 24rem;
  margin: 1.3rem 0 0;
  color: var(--muted);
  line-height: 1.8;
}

.closing {
  min-height: 80vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: clamp(5rem, 11vw, 10rem) clamp(1.25rem, 5vw, 5rem);
}

.closing h2 {
  max-width: 11ch;
}

.closing a {
  width: max-content;
  margin-top: 2.5rem;
}

@keyframes sweep {
  from {
    transform: translate(-50%, -100%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -100%) rotate(360deg);
  }
}

@keyframes rotateSlow {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0) rotate(-2deg);
  }
  50% {
    transform: translateY(-1.2rem) rotate(1.5deg);
  }
}

@media (max-width: 900px) {
  .topbar {
    position: absolute;
    mix-blend-mode: normal;
  }

  .nav-links {
    display: none;
  }

  .hero,
  .editorial,
  .mode-rail {
    grid-template-columns: 1fr;
  }

  .hero {
    min-height: auto;
    padding-top: 6rem;
  }

  h1 {
    font-size: clamp(4rem, 18vw, 6.8rem);
  }

  .instrument-stage {
    min-height: 31rem;
  }

  .watch {
    width: min(88vw, 31rem);
  }

  .precision-strip {
    grid-template-columns: 1fr;
  }

  .precision-strip div + div {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding-left: 0;
  }

  .orbital-readout,
  .side-readout {
    width: 8rem;
  }

  .mode {
    min-height: 17rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *:before,
  *:after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}
`;
