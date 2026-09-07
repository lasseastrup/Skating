/**
 * Every feel constant in one place. Phase 1 values. Tune on a phone, not a keyboard.
 * Units: metres, seconds, radians. "u/s" in comments means metres per second.
 */
export const TUNING = {
  /** Skate games run at roughly 2x real gravity. Only the tangential part acts while grounded. */
  gravity: 22,

  /** Board centre sits this far above the surface along the normal. */
  rideHeight: 0.09,
  /** Ground probes: nose and tail this far from centre along the tangent. */
  probeReach: 0.4,
  /** Low-pass time constant for the surface normal. Kills probe jitter without lagging the carve. */
  normalFilterTau: 0.08,

  /** Rolling friction, fraction of speed lost per second. Low: a board coasts a long way. */
  rollFriction: 0.15,
  /** Below this speed static friction stops the board completely. */
  restSpeed: 0.05,
  /** Carve cost: speed fraction lost per second = carveDrag * yawRate². Quadratic so a gentle
   *  carve is nearly free and a tight tic-tac is not. At 1.4 rad/s that is ~10%/s. */
  carveDrag: 0.05,

  /** Yaw rate at full stick and zero speed. */
  turnRateBase: 3.0,
  /** Yaw rate halves at this speed: rate = base / (1 + speed / ref). Sharp when slow, wide arcs when fast. */
  turnSpeedRef: 6.0,
  /** Below this speed steering authority fades toward `turnMinAuthority` (tic-tac range). */
  turnAuthoritySpeed: 1.5,
  turnMinAuthority: 0.35,

  /** Stick Y (weight forward/back) adds this much acceleration at full deflection. Tiny on purpose. */
  weightShiftAccel: 0.25,

  /** Auto-push starts when speed drops under this on flat ground and the stick isn't held back. */
  pushThreshold: 5.5,
  /** Total duration of one push cycle. */
  pushDuration: 0.75,
  /** Foot-on-ground window as fractions of the cycle. Acceleration applies inside it. */
  pushContactStart: 0.22,
  pushContactEnd: 0.5,
  /** Acceleration during contact. 0.28 s * 11 = ~3 u/s per push. */
  pushAccel: 11,
  /** Gap between pushes. */
  pushCooldown: 0.25,
  /** Stick Y below this suppresses pushing so the player can coast to a stop. */
  pushSuppressStickY: -0.5,

  /** Crouch charge fills in this long on hold... */
  chargeUpTime: 0.35,
  /** ...and drains this fast on release. */
  chargeDownTime: 0.12,

  /** Pelvis height above deck standing, and how far a full crouch drops it. */
  pelvisStand: 0.92,
  pelvisCrouch: 0.34,
  /** Extra compression per u/s of speed. Fast riders sit lower. */
  pelvisSpeedCrouch: 0.006,
  /** Pelvis spring: natural frequency and damping ratio. ζ 0.7 leaves a little overshoot on purpose. */
  pelvisOmega: 16,
  pelvisZeta: 0.7,
  /** Downward velocity kick on push start, so the body reads the effort. */
  pelvisPushDip: -0.9,

  /** Lean: angle target = atan(centripetal / g_real), clamped, chased at this rate. */
  leanMax: 0.6,
  leanRate: 9,
  /** Fraction of pelvis height the pelvis shifts sideways into the carve at full lean. */
  leanShift: 0.4,
  /** Pelvis fore/aft shift at full stick Y. */
  weightShiftPelvis: 0.14,

  /** Foot goals in board space: ± along the deck, ± across it. See DEBUG.md on the numbers. */
  footAlong: 0.2,
  footAcross: 0.06,

  /** Speed at which the camera reaches its widest FOV and the controller its widest turns. */
  topSpeedRef: 14,
} as const;
