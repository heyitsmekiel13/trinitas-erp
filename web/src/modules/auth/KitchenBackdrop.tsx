import {
  Beef,
  CakeSlice,
  ChefHat,
  Cookie,
  CookingPot,
  Croissant,
  CupSoda,
  Flame,
  Microwave,
  Refrigerator,
  Salad,
  Scale,
  Soup,
  Thermometer,
  Timer,
  Utensils,
  UtensilsCrossed,
  Wheat,
  type LucideIcon,
} from 'lucide-react'

/**
 * Drifting kitchen & bakery equipment behind the sign-in card.
 *
 * The layout is organised and the motion is not, which is the combination that
 * reads as calm: icons are spread evenly so nothing clumps, then each one
 * wanders its own slow path with its own duration, so the field never falls
 * into step with itself.
 *
 * Positions come from a fixed seed rather than `Math.random()`, so the scatter
 * looks arbitrary but never reshuffles between renders.
 */

const ICONS: LucideIcon[] = [
  ChefHat,
  CookingPot,
  Utensils,
  Microwave,
  Croissant,
  Refrigerator,
  Soup,
  Wheat,
  UtensilsCrossed,
  CakeSlice,
  Flame,
  Thermometer,
  CupSoda,
  Scale,
  Timer,
  Cookie,
  Salad,
  Beef,
]

function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0
    return a / 4294967296
  }
}

type Waypoint = { x: number; y: number; r: number }

type FloatingIcon = {
  Icon: LucideIcon
  left: number
  top: number
  size: number
  rotate: number
  minOpacity: number
  maxOpacity: number
  duration: number
  delay: number
  fadeDuration: number
  fadeDelay: number
  path: [Waypoint, Waypoint, Waypoint]
}

/**
 * Scatter across a 6x4 grid with jitter inside each cell — an even spread
 * without the clumping that pure randomness produces. The middle columns of
 * the middle rows are skipped so nothing crowds the card.
 */
function buildScatter(): FloatingIcon[] {
  const random = seeded(0x7a1c)
  const cols = 6
  const rows = 4
  const out: FloatingIcon[] = []
  let index = 0

  // A drift wide enough to be noticed and small enough never to reveal that
  // the icons are on a loop.
  const wander = (spread: number) => -spread + random() * spread * 2

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const centreBand = row === 1 || row === 2
      const centreCol = col === 2 || col === 3
      if (centreBand && centreCol) continue

      const rotate = -22 + random() * 44
      // Visible enough that the movement registers without competing with the
      // form. Below about 0.06 the icon is too faint for any travel to read.
      const minOpacity = 0.07 + random() * 0.05
      // How far each icon wanders from where it sits. At 30px the drift was
      // technically animating and looked like a still image; this is far enough
      // that the eye catches it in peripheral vision while someone types.
      const spread = 90 + random() * 100

      out.push({
        Icon: ICONS[index % ICONS.length]!,
        left: (col / cols) * 100 + random() * (100 / cols) * 0.7 + 2,
        top: (row / rows) * 100 + random() * (100 / rows) * 0.7 + 3,
        size: 30 + Math.round(random() * 50),
        rotate,
        minOpacity,
        maxOpacity: minOpacity + 0.05 + random() * 0.07,
        // Roughly half what it was. A full circuit now completes while somebody
        // fills the form rather than long after they have gone, which is the
        // difference between "it moves" and "it looks still".
        // Deliberately uneven: durations sharing a factor drift back into step
        // and the field starts pulsing together.
        duration: 9 + random() * 11,
        delay: -random() * 20,
        fadeDuration: 7 + random() * 9,
        fadeDelay: -random() * 12,
        // Three intermediate waypoints, each rotating further, so the return to
        // the start is a wander home rather than a snap back.
        path: [
          { x: wander(spread), y: wander(spread), r: rotate + wander(16) },
          { x: wander(spread), y: wander(spread), r: rotate + wander(16) },
          { x: wander(spread), y: wander(spread), r: rotate + wander(16) },
        ],
      })
      index++
    }
  }
  return out
}

const SCATTER = buildScatter()

export function KitchenBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* No tinted blooms here on purpose. The page is white, and the drifting
          icons are the only texture it needs — a wash behind them would put
          back the coloured background this screen was moved away from, and it
          is what made an uploaded logo's white plate show as a rectangle. */}

      {SCATTER.map((item, i) => {
        const { Icon, path } = item
        return (
          <span
            key={i}
            // The two motions run on separate elements so they can keep their
            // own clocks instead of one overriding the other. Both animations
            // are declared in CSS — see .drift-cell / .drift-icon — because an
            // inline `animation` cannot be overridden by the reduced-motion
            // rule that has to un-freeze them.
            className="drift-cell absolute block"
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              ['--d-fade-dur' as string]: `${item.fadeDuration}s`,
              ['--d-fade-delay' as string]: `${item.fadeDelay}s`,
              ['--d-o-min' as string]: item.minOpacity,
              ['--d-o-max' as string]: item.maxOpacity,
            }}
          >
            <Icon
              className="drift-icon block text-brand-900 dark:text-white"
              style={{
                width: item.size,
                height: item.size,
                strokeWidth: 1.25,
                ['--d-dur' as string]: `${item.duration}s`,
                ['--d-delay' as string]: `${item.delay}s`,
                ['--d-r0' as string]: `${item.rotate}deg`,
                ['--d-x1' as string]: `${path[0].x}px`,
                ['--d-y1' as string]: `${path[0].y}px`,
                ['--d-r1' as string]: `${path[0].r}deg`,
                ['--d-x2' as string]: `${path[1].x}px`,
                ['--d-y2' as string]: `${path[1].y}px`,
                ['--d-r2' as string]: `${path[1].r}deg`,
                ['--d-x3' as string]: `${path[2].x}px`,
                ['--d-y3' as string]: `${path[2].y}px`,
                ['--d-r3' as string]: `${path[2].r}deg`,
              }}
            />
          </span>
        )
      })}
    </div>
  )
}
