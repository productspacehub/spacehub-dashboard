"use client";

import { useEffect, useRef } from "react";

// Every error banner in the booking admin forms renders at the top of the
// page (consistent with the rest of the app), but the form itself can be
// long enough that the submit button sits well below the fold — so a
// validation or conflict error (a required field, "Ruang ini sudah
// dibooking…") pops into existence off-screen, above whatever the admin was
// looking at when they clicked submit. From their side nothing visibly
// happens; it reads as the button being stuck. Scrolling the banner into
// view whenever an error appears fixes that without moving the banner out
// of its established position.
export function useScrollToError<T extends HTMLElement>(error: string | null) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [error]);
  return ref;
}
