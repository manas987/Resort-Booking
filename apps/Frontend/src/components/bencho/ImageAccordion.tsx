

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from 'wouter';

// Generic enough for any API-backed room card — the original imported the now-deleted static
// `data/rooms.ts` catalog; the panel only ever needed these three fields.
export type AccordionRoom = { slug: string; name: string; coverPhotoUrl: string };

/* ── inlined from lab/spring ──────────────────────── */
/* ── one spring, for everything that settles ───────────────
   The maths was already on this bench twice, copied by hand:
   Humidity's wheel and Brightness's column both accumulate
   velocity toward a target, damp it, and snap when both the
   delta and the velocity fall under 0.02. Two copies is a
   coincidence; five would be a policy, so it comes out here
   before the elastic blocks are written against it.

   The two shipped copies are deliberately NOT refactored onto
   this. They work, they are tuned, and rewriting the innards
   of two live components to prove a point about duplication
   is how a good afternoon becomes a bad one. This is the one
   new code uses.

   Frames, not milliseconds. `dt` is expressed in sixtieths of
   a second and the damping is RAISED to it rather than
   multiplied by it, so a dropped frame decays the same amount
   of energy as the two frames it replaced. Multiplying is the
   version that makes a spring behave differently on a busy
   page, which is the hardest kind of bug to see.

   The loop parks itself the moment the value has settled.
   CLAUDE.md is not complimentary about the one permanent
   requestAnimationFrame already on this bench and there is no
   case for five more. */

/* 0..100 into the two numbers a spring actually has.

   50 is what Humidity and Brightness were tuned at, which is
   the rule every elastic knob on this bench follows — see
   lab/motion. Turn the panel to the middle and nothing has
   changed.

   Both ends have to be usable, which is what fixes the range:
   at 0 it is slow and heavy and still arrives, at 100 it is
   quick with a visible overshoot, and nowhere in between does
   it ring for longer than it takes to read. */
/* The pair is chosen by DAMPING RATIO and then written back
   as stiffness and decay, because the ratio is the thing a
   person is actually setting and the two numbers on their own
   do not say what they add up to.

     zeta = -ln(d) / (2 * sqrt(k))

   The first version of this ran 0.06..0.26 stiffness against
   0.93..0.74 decay, which reads as a sensible spread and is
   not one: it puts zeta between 0.15 and 0.16 across the
   WHOLE range, so every setting overshot by about sixty per
   cent and the knob only changed how fast it did it. Pull's
   return went 130px past its own resting position and lifted
   the content off the top of the card.

     0   → zeta ~0.85, heavy, arrives without a ring
     50  → zeta ~0.41, near where Humidity and Brightness sit
     100 → zeta ~0.20, lively, two visible rebounds

   Both ends shippable, which is the constraint that fixed the
   numbers rather than taste. */
const springOf = (tune: number) => ({
  /* stiffness: how hard it is pulled toward the target */
  k: 0.08 + (tune / 100) * 0.16,
  /* decay, per frame: how much of the velocity survives */
  d: 0.62 + (tune / 100) * 0.2,
});

/* Units matter. The snap threshold is absolute, so a caller
   works in pixels or in 0..100 — a spring driven over 0..1
   would be "settled" before it had visibly moved. */
function useSpring(target: number, tune = 50, instant = false) {
  const [at, setAt] = useState(target);
  const cur = useRef(target);
  const vel = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    if (instant) {
      cur.current = target;
      vel.current = 0;
      raf.current = requestAnimationFrame(() => setAt(target));
      return () => cancelAnimationFrame(raf.current);
    }
    const { k, d } = springOf(tune);
    let prev = 0;
    const tick = (t: number) => {
      const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
      prev = t;
      vel.current += (target - cur.current) * k * dt;
      vel.current *= Math.pow(d, dt);
      cur.current += vel.current * dt;
      if (Math.abs(target - cur.current) < 0.02 && Math.abs(vel.current) < 0.02) {
        cur.current = target;
        vel.current = 0;
        setAt(target);
        raf.current = 0;
        return;
      }
      setAt(cur.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    /* `tune` sits here beside `target` for the reason
       Brightness spells out: the loop closes over it, so
       without it a knob turned mid-flight would do nothing
       until something else restarted the effect. Restarting
       picks up from the refs, so it continues rather than
       snapping. */
  }, [target, tune, instant]);

  return at;
}

/* Read once, the way the wheel and the pill nav do. A
   preference, not a live input. */
const stillness = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;


// Adapted from Bencho's supplied MIT source; full comments retained in original-source.txt.
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lift = (open: number) => 0.4 + (clamp(open, 0, 100) / 100) * 2.8;
const fall = (d: number, reach: number) => {
  const s = 0.35 + (clamp(reach, 0, 100) / 100) * 0.9;
  return Math.exp(-((d / s) ** 2));
};

function ImagePanel({ room, index, active, onActivate, href, children }: { room: AccordionRoom; index: number; active: number; onActivate: () => void; href: string; children: ReactNode }) {
  // One spring per panel, no stagger: all panels divide the same fixed width.
  const swell = useSpring(fall(Math.abs(index - active), 15) * 100, 10, stillness());
  return <article className="acc-cell" data-open={active === index || undefined} style={{ flexGrow: 1 + lift(100) * swell / 100 }} onPointerEnter={(e) => { if (e.pointerType !== 'touch') onActivate(); }} onFocus={onActivate}>
    <img src={room.coverPhotoUrl} alt={room.name} draggable={false} />
    <Link className="acc-activate" href={href} aria-label={`View ${room.name} details`} />
    <span className="acc-number">0{index + 1}</span>
    <div className="acc-caption"><span className="acc-room-label">{room.name}</span>{active === index && children}</div>
  </article>;
}

export function ImageAccordion({ rooms, roomHref, renderActions }: { rooms: AccordionRoom[]; roomHref: (room: AccordionRoom) => string; renderActions: (room: AccordionRoom) => ReactNode }) {
  const [active, setActive] = useState(0);
  return <div className="acc">{rooms.map((room, index) => <ImagePanel key={room.slug} room={room} index={index} active={active} onActivate={() => setActive(index)} href={roomHref(room)}>{renderActions(room)}</ImagePanel>)}</div>;
}
