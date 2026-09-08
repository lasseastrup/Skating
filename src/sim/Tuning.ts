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

  /** Gravity turn: below this normal force (m/s²) lateral gravity starts swinging the heading
   *  downhill; full effect at zero normal force. Max heading rate from it, rad/s. */
  gravityTurnForce: 11,
  gravityTurnMaxRate: 6,
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
  pelvisCrouch: 0.4,
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

  // --- Phase 2: manifold -------------------------------------------------------------------------
  /** Max rotation of the surface frame per second. Safety clamp against torus corners flinging. */
  frameMaxRate: 20,
  /** Handoff hysteresis: a neighbour must be penetrated this deep before we switch onto it while
   *  the current surface still claims us. Seam-exact primitives never need it; overlaps do. */
  handoffPenetration: 0.05,
  /** Tolerance on a primitive's bounds margin before it stops claiming the skater. */
  boundsSlack: 0.01,
  /** Normal-force slack (m/s²) before detaching. Keeps vert walls (N ≈ 0) attached. */
  detachSlack: 0.6,
  /** Air: landing accepted when height above surface is within this window. */
  landMaxHeight: 0.09,
  landMaxPenetration: 0.6,
  /** Can't land on anything steeper than this (normal.y). Walls are entered from the ground. */
  landMinNormalY: 0.15,
  /** Fraction of lost normal velocity fed into the pelvis spring on landing. */
  landPelvisKick: 0.26,

  /** Curvature above this counts as "in a transition" for pumping. */
  pumpCurvatureMin: 0.12,
  /** Pump: accel = pumpEff · κ · factor (pumpEff in m²/s²). Work per pass = pumpEff·Δθ, a fixed
   *  energy per pass, so speed gain shrinks as you get faster and friction can balance it. */
  pumpEff: 11,
  /** Extra pump accel (m/s²) that does not scale with curvature: bigger transitions give more
   *  energy per pass (work = a · arc length), the way a long extension does for a real skater. */
  pumpBase: 0,
  /** Curvature is capped here for pumping so a tight channel doesn't hand out free energy. */
  pumpCurvatureCap: 0.45,
  /** Pump fades to zero below this speed. */
  pumpMinSpeed: 1.5,
  pumpAutoFactor: 0.7,
  pumpTimedFactor: 1.0,
  /** Button press within this window of entering the transition earns the timed factor. */
  pumpWindow: 0.15,
  /** Pelvis compresses under centripetal load: metres per m/s² of κv². */
  pelvisCurvatureCrouch: 0.012,
  /** Pushing is only allowed where curvature is below this. */
  pushMaxCurvature: 0.05,

  // --- Phase 3: air ------------------------------------------------------------------------------
  /** Ollie height at zero and full charge. Release below `tapHold` is a pump tap, not an ollie. */
  ollieMinHeight: 0.4,
  ollieMaxHeight: 1.4,
  tapHold: 0.12,
  /** Pop: the board pitches tail-down for this long before leaving the ground. */
  popDuration: 0.04,
  popPitch: (18 * Math.PI) / 180,
  /** Board pitch decays with this time constant in the air (the ollie levels out). */
  pitchDecayTau: 0.12,
  /** Upward pelvis velocity kick at pop. */
  pelvisPopKick: 4.2,
  /** Coyote time: a release this soon after leaving a lip still pops. */
  coyoteTime: 0.1,
  /** Trick rotations complete in this fraction of the predicted air time, never faster than minTrickTime. */
  trickTimeFraction: 0.8,
  minTrickTime: 0.3,
  /** Body spin while the stick is held in the air, after the trick's own spin is done. */
  heldSpinRate: (360 * Math.PI) / 180,
  /** Stick magnitude below this at takeoff selects a plain ollie. */
  trickDeadzone: 0.35,
  /** Grab: spin multiplier while holding, and pelvis tuck. */
  grabSpinDamping: 0.5,
  grabTuck: 0.28,
  /** Landing: look this far ahead and blend the frame normal onto the predicted surface. */
  landLookahead: 0.12,
  /** Heading alignment starts earlier so a held spin can finish to the nearest 0/180 in time. */
  headingLookahead: 0.25,
  /** Heading residuals beyond this at prediction time are left alone: the skater is sideways. */
  headingAssistMax: (88 * Math.PI) / 180,
  /** Heading snaps to velocity within this; beyond bailAngle we bail; between, speed is scrubbed. */
  landSnapAngle: (45 * Math.PI) / 180,
  landBailAngle: (70 * Math.PI) / 180,
  /** Fraction of absorbed normal speed converted to forward speed, scaled by how un-flat the surface is. */
  landVerticalToForward: 0.12,
  /** Bail: how long the skater is down, and speed decay per second while down. */
  bailDuration: 0.9,
  bailDecay: 4,

  // --- Phase 4: grinds ---------------------------------------------------------------------------
  /** Auto-attach: within this distance of the edge and this angle of its tangent, while descending. */
  grindSnapDistance: 0.35,
  grindSnapAngle: (35 * Math.PI) / 180,
  /** Vertical band above the edge that still counts, and the upward speed we still call "descending"
   *  (crossing a rail at the apex of an ollie should catch it). */
  grindSnapAbove: 0.45,
  grindMaxRise: 1.0,
  /** Board must be within ~50° of level to catch an edge (|tangent.y| below this). */
  grindMaxTangentY: 0.77,
  /** Blend into the constraint over this long so the snap is not visible. */
  grindBlendTime: 0.08,
  /** Hold the stick sideways this long to drop off the side, with this much lateral push. Long
   *  enough that holding a boardslide (stick sideways yaws the board) does not throw you off. */
  grindDropHold: 0.6,
  grindDropPush: 1.0,
  /** Cosmetic wobble (rad) and its frequency; the button (lock) kills it. */
  grindWobble: 0.06,
  grindWobbleHz: 2.6,
  /** Minimum time in the air before a grind can catch us again after leaving one. */
  grindReattachDelay: 0.15,
  /** A stall (|speed| below this for longer than this) ends by dropping toward the tilt side. */
  grindStallSpeed: 0.6,
  grindStallTime: 0.6,
  grindStallPush: 1.2,
  grindReattachDelayAfterStall: 0.6,

  // --- Phase 6: tricks, poses, bails -------------------------------------------------------------
  /** First part of the air that counts as the Pop animation state. */
  popAnimTime: 0.08,
  /** Impact animation state after touchdown. */
  impactTime: 0.15,
  /** A sloppy pop (low back-foot steeze) seats the back foot up to this much later. */
  catchSloppyDelay: 0.12,
  /** Manual: stick threshold, minimum speed, chase rate, board pitch, extra drag. */
  manualStick: 0.85,
  manualMinSpeed: 3,
  manualRate: 10,
  manualPitch: (18 * Math.PI) / 180,
  manualDrag: 0.12,
  /** Grind pose: stick X × yaw, stick Y × pitch, chase rate. */
  grindYawMax: Math.PI / 2,
  grindPitchMax: (25 * Math.PI) / 180,
  grindPoseRate: 8,
  /** Bail weight ramp: into ragdoll, back to posed. */
  bailRampIn: 0.15,
  bailRampOut: 0.35,

  // --- Phase 7: walls and collision mercy ---------------------------------------------------------
  /** Auto-pop over a wall you would slam if speed ≥ min + perMetre × wall height, up to maxHeight. */
  mercyMinSpeed: 2.5,
  mercySpeedPerMetre: 3.0,
  mercyMaxHeight: 1.3,
  /** Clearance above the top edge the mercy pop aims for. */
  mercyClearance: 0.12,
  /** Slamming without mercy: heading is deflected along the wall and speed scaled by this. */
  wallSlideFactor: 0.55,
} as const;
