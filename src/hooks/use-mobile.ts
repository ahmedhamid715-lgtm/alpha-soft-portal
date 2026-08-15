import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Rewritten from the shadcn CLI's generated version (which called setState
// synchronously inside useEffect — flagged by this project's
// react-hooks/set-state-in-effect rule) to useSyncExternalStore, the
// correct primitive for subscribing to an external browser API. Also
// fixes a latent SSR/hydration mismatch the original had: the snapshot
// functions below give an explicit, distinct server value instead of
// leaving `isMobile` undefined until the first effect run.
function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
