import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { applyInterpolated } from '../../core/Interp';
import { AnimState, SkateState, type SkateWorld } from '../../sim/SkateWorld';
import { TUNING as T } from '../../sim/Tuning';
import { quatFromDirFront, solveTwoBone } from './IK';
import { RIG } from './RigSpec';
import { SkaterSkeleton } from './Skeleton';
import { Particle } from './Verlet';
import { grindStyle, makePose, manualPose, sampleTrickPose, scalePose, smoothstep, zeroPose } from './Poses';

const BODY_MAT = new MeshLambertMaterial({ color: 0xc8c8c8 });
const DECK_MAT = new MeshLambertMaterial({ color: 0x3a3a3a });
const TRUCK_MAT = new MeshLambertMaterial({ color: 0x9a9a9a });
const WHEEL_MAT = new MeshLambertMaterial({ color: 0xe0e0e0 });

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const WHEEL_RADIUS = 0.028;

/**
 * The skater, built procedurally on the board. Everything below is solved in the body frame
 * (X right, Y up, Z back, origin at the board centre) at `characterHz` and written to the bones
 * as local rotations plus a pelvis offset. Each display frame the whole pose is hung off the
 * interpolated body frame, so the body rides the board smoothly while its pose steps.
 *
 *  Layer 1  pelvis spring (in the sim) → pelvis height, everything hangs off it
 *  Layer 2  Verlet chest and hands → anticipation and follow-through
 *  Layer 3  lean scalar → pelvis roll, chest counter-roll, arm swing bias
 *  Layer 4  gated head look-at
 *  Layer 5  the board: trucks, wheels, deck flex
 * Legs and arms: closed-form two-bone IK. No clips anywhere.
 */
export class SkaterRig {
  readonly group = new Group();
  readonly board = new Group();
  readonly skeleton: SkaterSkeleton;
  /** Pose sample rate, Hz. 0 = every frame. Try 8 / 12 / 15 / 24 on device. */
  characterHz: number = RIG.characterHz;
  readonly triangles: number;

  private readonly deck: Mesh;
  private readonly trucks: [Mesh, Mesh];
  private readonly wheels: Mesh[] = [];
  private wheelAngle = 0;

  // Stepped pose state (body frame).
  private poseClock = 0;
  private readonly pelvisLocal = new Vector3(0, T.pelvisStand, 0);
  private readonly pelvisLocalQ = new Quaternion();
  private readonly lookDir = new Vector3(1, 0, 0);
  private overreach = [false, false];
  /** Per-foot IK position weight: 0 = foot off the board (hangs from the body), 1 = on the goal. */
  private footPosWeight = [1, 1];
  /** Six body-group weights, 1 = posed, 0 = ragdoll (Verlet + spring only). */
  readonly groupWeight = { legs: 1, pelvis: 1, torso: 1, armL: 1, armR: 1, head: 1 };
  private readonly pose = makePose();

  // Verlet particles (body frame).
  private readonly chest = new Particle();
  private readonly handL = new Particle();
  private readonly handR = new Particle();
  private primed = false;

  // Scratch.
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly qInv = new Quaternion();
  private readonly gravityLocal = new Vector3();
  private readonly worldUpLocal = new Vector3();
  private readonly pelvisUp = new Vector3();
  private readonly hip = new Vector3();
  private readonly ankle = new Vector3();
  private readonly toe = new Vector3();
  private readonly knee = new Vector3();
  private readonly end = new Vector3();
  private readonly pole = new Vector3();
  private readonly tmp = new Vector3();
  private readonly anchor = new Vector3();
  private readonly torsoDir = new Vector3();
  private readonly chestFront = new Vector3();
  private readonly chestUp = new Vector3();
  private readonly chestSide = new Vector3();
  private readonly shoulder = new Vector3();
  private readonly elbow = new Vector3();
  private readonly target = new Vector3();
  private readonly footGoal = [new Vector3(), new Vector3()];
  private readonly spineA = new Vector3();
  private readonly spineB = new Vector3();
  private readonly chestOrigin = new Vector3();
  private readonly neckOrigin = new Vector3();
  private readonly neckTop = new Vector3();
  private readonly headTop = new Vector3();
  private readonly clavOrigin = new Vector3();
  private readonly handDir = new Vector3();
  private readonly aimDir = new Vector3();
  private readonly boneQ = new Map<string, Quaternion>();

  constructor(private readonly world: SkateWorld) {
    this.skeleton = new SkaterSkeleton(BODY_MAT);
    this.group.add(this.skeleton.mesh);
    for (const name of Object.keys(this.skeleton.bones)) this.boneQ.set(name, new Quaternion());

    // Board: deck, two trucks, four wheels. Separate children so Layer 5 can move them.
    this.deck = new Mesh(new BoxGeometry(0.21, 0.018, 0.82), DECK_MAT);
    this.deck.castShadow = true;
    this.board.add(this.deck);
    const truckGeo = new BoxGeometry(0.16, 0.035, 0.05);
    this.trucks = [new Mesh(truckGeo, TRUCK_MAT), new Mesh(truckGeo, TRUCK_MAT)];
    this.trucks[0].position.set(0, -0.03, -0.3);
    this.trucks[1].position.set(0, -0.03, 0.3);
    for (const t of this.trucks) this.board.add(t);
    const wheelGeo = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.035, 10, 1);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const z of [-0.3, 0.3]) {
      for (const x of [-0.11, 0.11]) {
        const w = new Mesh(wheelGeo, WHEEL_MAT);
        w.position.set(x, -0.05, z);
        this.board.add(w);
        this.wheels.push(w);
      }
    }
    this.group.add(this.board);
    this.triangles = this.skeleton.triangles + 12 + 24 + 4 * 40;
  }

  /** Per display frame. `dt` is render dt in seconds. */
  sync(alpha: number, dt: number): void {
    const w = this.world;
    applyInterpolated(w.board, this.board, alpha);
    this.layerBoard(dt);

    // Stepped pose sampling.
    const period = this.characterHz > 0 ? 1 / this.characterHz : 0;
    this.poseClock += dt;
    if (!this.primed || period === 0 || this.poseClock >= period) {
      const solveDt = this.primed && period > 0 ? Math.min(this.poseClock, 0.25) : Math.max(dt, 1 / 60);
      this.poseClock = period > 0 ? this.poseClock % period : 0;
      this.solvePose(solveDt);
      this.primed = true;
    }

    // Hang the stepped pose off the smooth body frame.
    const fb = w.frame;
    const root = this.skeleton.bones.pelvis;
    this.tmp.lerpVectors(fb.prev.pos, fb.curr.pos, alpha);
    this.q.slerpQuaternions(fb.prev.rot, fb.curr.rot, alpha);
    root.position.copy(this.pelvisLocal).applyQuaternion(this.q).add(this.tmp);
    root.quaternion.copy(this.q).multiply(this.pelvisLocalQ);
  }

  // --- Layer 5: the board ----------------------------------------------------------------------
  private layerBoard(dt: number): void {
    const w = this.world;
    // Trucks steer with the carve, opposite to each other, ±12°.
    const steer = Math.max(-1, Math.min(1, w.yawRate / 2.0)) * 0.21;
    this.trucks[0].rotation.y = steer;
    this.trucks[1].rotation.y = -steer;
    // Wheels roll with distance.
    this.wheelAngle += (w.speed * dt) / WHEEL_RADIUS;
    for (const wh of this.wheels) wh.rotation.x = this.wheelAngle;
    // Deck flex: the spring's compression sags the deck a little.
    const load = Math.max(0, T.pelvisStand - w.pelvisH);
    this.deck.position.y = -Math.min(0.012, load * 0.03);
    this.deck.scale.y = 1 - Math.min(0.25, load * 0.5);
  }

  // --- The pose, in the body frame ------------------------------------------------------------
  private solvePose(dt: number): void {
    const w = this.world;
    const inAir = w.state === SkateState.Air || w.state === SkateState.Pop;
    const bailed = w.state === SkateState.Bailed;
    const grinding = w.state === SkateState.Grinding;

    // Frame-local world up and gravity (the body knows which way is down even on a wall).
    this.qInv.copy(w.frame.curr.rot).invert();
    this.worldUpLocal.copy(Y).applyQuaternion(this.qInv);
    this.gravityLocal.copy(this.worldUpLocal).multiplyScalar(-RIG.verletGravity);

    // Layer 1 + 3: pelvis from the spring height, lean roll and shift, weight fore/aft.
    const lean = w.lean;
    const h = w.pelvisH;
    this.pelvisLocal.set(-Math.sin(lean) * h * T.leanShift, h * Math.cos(lean), -w.weight * T.weightShiftPelvis);
    this.pelvisLocalQ.setFromAxisAngle(Z, lean);
    this.pelvisUp.copy(Y).applyQuaternion(this.pelvisLocalQ);

    // --- Pose library sample for this moment (offsets on top of the procedural base) ------------
    const pose = zeroPose(this.pose);
    const anim = w.animState;
    if (anim === AnimState.Setup || anim === AnimState.BeginPop) {
      sampleTrickPose(w.trick, 0, w.steezeL, w.steezeR, pose);
      if (anim === AnimState.Setup) scalePose(pose, 0.6 * w.charge);
    } else if (inAir) {
      const t01 = Math.min(1, w.airTime / Math.max(0.3, w.airPredicted));
      sampleTrickPose(w.trick, t01, w.steezeL, w.steezeR, pose);
      if (w.grabbing) scalePose(pose, 0.4);
    } else if (anim === AnimState.Impact) {
      sampleTrickPose(w.trick, 1, w.steezeL, w.steezeR, pose);
      scalePose(pose, Math.max(0, 1 - w.simTime * 0) * 0.8);
    } else if (grinding) {
      grindStyle(w.grindName, pose);
      if (w.animState === AnimState.EnterCoping) scalePose(pose, 0.5);
    } else if (anim === AnimState.Manual) {
      manualPose(w.manual, pose);
    }

    // --- Bail: six body-group weights ramp toward ragdoll, staggered so it cascades ----------
    const ramp = w.bailRamp;
    const gw = this.groupWeight;
    gw.legs = 1 - smoothstep(ramp / 0.7);
    gw.pelvis = 1 - smoothstep((ramp - 0.05) / 0.7);
    gw.torso = 1 - smoothstep((ramp - 0.1) / 0.7);
    gw.armL = 1 - smoothstep((ramp - 0.15) / 0.7);
    gw.armR = 1 - smoothstep((ramp - 0.2) / 0.7);
    gw.head = 1 - smoothstep((ramp - 0.3) / 0.7);

    // Pelvis pose offset (board space) and bail pitch: the body pitches forward and falls back
    // behind the board as its weight drops out.
    this.pelvisLocal.x += pose.pelvis[0];
    this.pelvisLocal.y += pose.pelvis[1];
    this.pelvisLocal.z += pose.pelvis[2] + 0.35 * (1 - gw.pelvis);
    if (gw.pelvis < 1) {
      this.q2.setFromAxisAngle(Z, -0.9 * (1 - gw.pelvis));
      this.pelvisLocalQ.multiply(this.q2);
      this.pelvisUp.copy(Y).applyQuaternion(this.pelvisLocalQ);
    }

    // Foot goals in board space (the whole design). Front = left = -Z.
    const fl = this.footGoal[0].set(-T.footAcross, RIG.ankleHeight, -T.footAlong);
    const fr = this.footGoal[1].set(T.footAcross, RIG.ankleHeight, T.footAlong);
    if (inAir) {
      // Legs tuck a little in the air; more in a grab. Mid-trick the deck flips away under them.
      const tuck = 0.06 + (w.grabbing ? 0.12 : 0);
      fl.y += tuck;
      fr.y += tuck;
    }
    const pushing = w.pushPhase > 0;
    if (pushing) this.pushStroke(fr, w.pushPhase);
    // Per-foot position weight: 0 while the foot is off the flipping board, back to 1 on catch.
    // Rotation weight stays 1 throughout (the toe direction below never blends), so the feet
    // leave the board but stay oriented with it. Catch is per foot.
    const caught = [w.caughtL, w.caughtR];
    for (let i = 0; i < 2; i++) {
      const target = caught[i] ? 1 : 0;
      const rate = target > this.footPosWeight[i] ? dt / 0.06 : dt / 0.03;
      this.footPosWeight[i] += Math.max(-rate, Math.min(rate, target - this.footPosWeight[i]));
    }
    for (let i = 0; i < 2; i++) {
      const g = this.footGoal[i];
      const side = i === 0 ? -1 : 1;
      const off = i === 0 ? pose.fL : pose.fR;
      const pw = this.footPosWeight[i];
      if (pw < 1) {
        // Off the board: the foot hangs from its hip with the knee bent, plus the pose flick.
        this.hip.set(0, -RIG.hipDrop, side * RIG.hipHalfWidth).applyQuaternion(this.pelvisLocalQ).add(this.pelvisLocal);
        this.tmp.copy(this.hip).addScaledVector(this.pelvisUp, -(RIG.upperLeg + RIG.lowerLeg) * 0.82);
        g.lerp(this.tmp, 1 - pw);
      }
      g.x += off[0];
      g.y += off[1];
      g.z += off[2];
    }
    // Ragdoll legs: feet trail behind and up, like a trip.
    if (gw.legs < 1) {
      this.tmp.set(fl.x - 0.1, fl.y + 0.25, fl.z + 0.45);
      fl.lerp(this.tmp, 1 - gw.legs);
      this.tmp.set(fr.x + 0.15, fr.y + 0.15, fr.z + 0.4);
      fr.lerp(this.tmp, 1 - gw.legs);
    }
    // The pushing (or flailing) back foot may hover short of its goal; it must not drag the
    // pelvis down after it. Only feet that carry the body get to tilt the pelvis.
    const canTilt = [this.footPosWeight[0] >= 1 && !bailed, !pushing && !bailed && this.footPosWeight[1] >= 1];

    // Legs: hips from the pelvis, two-bone solve, knees over the toes. Over-reach tilts the pelvis.
    for (let pass = 0; pass < 2; pass++) {
      let shifted = false;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        this.hip.set(0, -RIG.hipDrop, side * RIG.hipHalfWidth).applyQuaternion(this.pelvisLocalQ).add(this.pelvisLocal);
        const reach = (RIG.upperLeg + RIG.lowerLeg) * RIG.maxReach;
        const d = this.hip.distanceTo(this.footGoal[i]);
        const excess = d - reach;
        if (excess > RIG.overreachOn) this.overreach[i] = true;
        else if (excess < RIG.overreachOff) this.overreach[i] = false;
        if (canTilt[i] && this.overreach[i] && excess > 0 && pass === 0) {
          // Never stretch the limb: move the pelvis toward the goal instead.
          this.tmp.subVectors(this.footGoal[i], this.hip).normalize();
          this.pelvisLocal.addScaledVector(this.tmp, excess);
          shifted = true;
        }
      }
      if (!shifted) break;
    }
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const legNames = i === 0 ? (['upperLegL', 'lowerLegL', 'footL'] as const) : (['upperLegR', 'lowerLegR', 'footR'] as const);
      this.hip.set(0, -RIG.hipDrop, side * RIG.hipHalfWidth).applyQuaternion(this.pelvisLocalQ).add(this.pelvisLocal);
      const angle = (i === 0 ? RIG.frontFootAngle + pose.yawL : RIG.backFootAngle + pose.yawR);
      this.toe.set(Math.cos(angle), 0, -Math.sin(angle));
      this.pole.copy(this.toe).addScaledVector(Y, 0.45);
      solveTwoBone(this.hip, this.footGoal[i], RIG.upperLeg, RIG.lowerLeg, this.pole, RIG.maxReach, this.knee, this.ankle);
      this.aim(legNames[0], this.hip, this.knee, this.toe);
      this.aim(legNames[1], this.knee, this.ankle, this.toe);
      this.tmp.copy(this.ankle).add(this.toe);
      this.aim(legNames[2], this.ankle, this.tmp, Y);
    }

    // Layer 2: torso. The chest is a particle pulled toward a target that pitches forward with
    // crouch, speed and grabs, and counter-rolls halfway back toward world up against the lean.
    this.anchor.set(0, 0.06, 0).applyQuaternion(this.pelvisLocalQ).add(this.pelvisLocal);
    this.torsoDir.copy(this.pelvisUp).lerp(this.worldUpLocal, 0.5).normalize();
    let pitch = 0.45 * w.charge + 0.22 * Math.min(1, Math.abs(w.speed) / 12) + (w.grabbing ? 0.45 : 0) + (grinding ? 0.15 : 0) + pose.chestPitch;
    if (inAir && !w.grabbing) pitch -= 0.1;
    // Ragdoll torso: as the weight drops the chest target slumps forward and the spring stiffness
    // falls away, so gravity and the distance constraint take over (a faceplant, in practice).
    pitch += 1.2 * (1 - gw.torso);
    // Pitch about the body's left-right axis (Z): forward is +X.
    this.q2.setFromAxisAngle(Z, -pitch);
    this.torsoDir.applyQuaternion(this.q2);
    const torsoLen = RIG.spine * 3;
    this.target.copy(this.anchor).addScaledVector(this.torsoDir, torsoLen);
    if (!this.primed) {
      this.chest.reset(this.target);
    }
    this.verlet(this.chest, this.target, dt, gw.torso);
    this.chest.constrainDistance(this.anchor, torsoLen);

    // Chest frame: up along the torso, front toward +X twisted a little toward the nose with speed.
    this.chestUp.subVectors(this.chest.pos, this.anchor).normalize();
    // Twist: shoulders open toward the nose with speed, plus the pose's twist (spins, boardslides).
    const twist = 0.35 * Math.min(1, Math.abs(w.speed) / 10) * Math.sign(w.speed || 1) + pose.chestTwist;
    this.chestFront.set(Math.cos(twist), 0, -Math.sin(twist));
    this.chestFront.addScaledVector(this.chestUp, -this.chestFront.dot(this.chestUp)).normalize();
    this.chestSide.crossVectors(this.chestFront, this.chestUp).normalize(); // body left-right (≈ ±Z)
    // Spine bones share the torso direction; a real spine would curve, this is enough at 12 fps.
    this.spineA.copy(this.anchor).addScaledVector(this.chestUp, RIG.spine);
    this.spineB.copy(this.spineA).addScaledVector(this.chestUp, RIG.spine);
    this.chestOrigin.copy(this.spineB).addScaledVector(this.chestUp, RIG.spine);
    this.neckOrigin.copy(this.chestOrigin).addScaledVector(this.chestUp, RIG.chest);
    this.aim('spine1', this.anchor, this.spineA, this.chestFront);
    this.aim('spine2', this.spineA, this.spineB, this.chestFront);
    this.aim('chest', this.spineB, this.chestOrigin, this.chestFront);
    const chestOrigin = this.chestOrigin;

    // Arms: shoulders rigid on the chest; hands are particles; two-bone with elbows back and out.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1; // left = -Z side (front for regular)
      const names = i === 0 ? (['clavL', 'upperArmL', 'foreArmL', 'handL'] as const) : (['clavR', 'upperArmR', 'foreArmR', 'handR'] as const);
      const hand = i === 0 ? this.handL : this.handR;
      // Clavicle origin and shoulder point, in the chest frame.
      const clavOrigin = this.clavOrigin.copy(chestOrigin).addScaledVector(this.chestUp, RIG.chest - RIG.clavicleDrop).addScaledVector(this.chestSide, side * 0.04);
      this.shoulder.copy(chestOrigin).addScaledVector(this.chestUp, RIG.chest - RIG.clavicleDrop).addScaledVector(this.chestSide, side * RIG.shoulderHalfWidth);
      this.aim(names[0], clavOrigin, this.shoulder, this.chestFront);

      // Hand target: relaxed by default, out and up in the air, back when winding up, on the
      // tail for a grab, swung against the lean for balance.
      this.target.copy(this.shoulder);
      if (w.grabbing && i === 1) {
        this.target.set(0.04, 0.02, 0.36); // tail of the deck in board space
      } else if (bailed) {
        // Hands go forward to break the fall; the ramp then hands them to gravity.
        this.target.addScaledVector(this.chestSide, side * 0.3).addScaledVector(this.chestFront, 0.45).addScaledVector(this.chestUp, -0.1);
      } else if (inAir) {
        this.target.addScaledVector(this.chestSide, side * 0.38).addScaledVector(this.chestUp, 0.12).addScaledVector(this.chestFront, 0.05);
      } else {
        this.target.addScaledVector(this.chestUp, -0.3).addScaledVector(this.chestFront, 0.1).addScaledVector(this.chestSide, side * 0.14);
        this.target.addScaledVector(this.chestFront, -0.18 * w.charge); // wind-up
        this.target.addScaledVector(X, -0.25 * lean).addScaledVector(Y, 0.2 * Math.abs(lean)); // balance
        if (grinding) this.target.addScaledVector(this.chestSide, side * 0.15).addScaledVector(this.chestUp, 0.15);
      }
      const ho = i === 0 ? pose.hL : pose.hR;
      this.target.addScaledVector(this.chestFront, ho[0]).addScaledVector(this.chestUp, ho[1]).addScaledVector(this.chestSide, ho[2]);
      if (!this.primed) hand.reset(this.target);
      this.verlet(hand, this.target, dt, i === 0 ? gw.armL : gw.armR);
      hand.constrainRange(this.shoulder, 0.18, (RIG.upperArm + RIG.foreArm) * RIG.maxReach);

      this.pole.copy(this.chestFront).multiplyScalar(-0.6).addScaledVector(this.chestUp, -0.5).addScaledVector(this.chestSide, side * 0.4);
      solveTwoBone(this.shoulder, hand.pos, RIG.upperArm, RIG.foreArm, this.pole, RIG.maxReach, this.elbow, this.end);
      this.aim(names[1], this.shoulder, this.elbow, this.chestFront);
      this.aim(names[2], this.elbow, this.end, this.chestFront);
      this.handDir.subVectors(this.end, this.elbow).normalize().add(this.end);
      this.aim(names[3], this.end, this.handDir, this.chestFront);
    }

    // Layer 4: head. Neck follows the chest; the head looks where the line goes, gated off
    // during flips, shuvs, grabs and bails, when it just follows the chest.
    this.neckTop.copy(this.neckOrigin).addScaledVector(this.chestUp, RIG.neck);
    this.aim('neck', this.neckOrigin, this.neckTop, this.chestFront);
    const midTrick = !w.caughtL || !w.caughtR;
    const lookAllowed = !midTrick && !w.grabbing && !bailed && gw.head > 0.99;
    this.target.copy(this.chestFront);
    if (lookAllowed) {
      // Where the line goes: along the nose (or tail when fakie), level, from over the front
      // shoulder; grinds look down the edge. The pose's head yaw adds on top.
      this.target.set(0.55, 0.05, -Math.sign(w.speed || 1) * 0.85).normalize();
      if (pose.headYaw !== 0) {
        this.q2.setFromAxisAngle(this.chestUp, pose.headYaw);
        this.target.applyQuaternion(this.q2);
      }
      // Clamp to head limits relative to the chest.
      const yaw = Math.atan2(-this.target.z * this.chestFront.x + this.target.x * this.chestFront.z, this.target.dot(this.chestFront));
      const yawC = Math.max(-RIG.headYawMax, Math.min(RIG.headYawMax, yaw));
      this.q2.setFromAxisAngle(this.chestUp, yawC);
      this.target.copy(this.chestFront).applyQuaternion(this.q2);
    }
    if (gw.head < 1) {
      // Ragdoll head: droops with the chest.
      this.tmp.copy(this.chestFront).addScaledVector(this.chestUp, -0.8 * (1 - gw.head)).normalize();
      this.target.lerp(this.tmp, 1 - gw.head);
    }
    this.lookDir.lerp(this.target, Math.min(1, dt * 8)).normalize();
    this.headTop.copy(this.neckTop).addScaledVector(this.chestUp, RIG.head);
    this.aim('head', this.neckTop, this.headTop, this.lookDir);
  }

  /** Back-foot push stroke: lift, stroke along the ground beside the deck, return. */
  private pushStroke(goal: Vector3, phase: number): void {
    const lift = smooth01(phase / 0.22);
    const stroke = smooth01((phase - 0.22) / 0.28);
    const ret = smooth01((phase - 0.5) / 0.5);
    const onGround = Math.min(lift, 1 - ret);
    // Foot beside the deck on the toe side, stroking from just ahead of the hip to behind it.
    this.tmp.set(0.27, -T.rideHeight + RIG.ankleHeight, -0.2 + 0.55 * stroke);
    goal.lerp(this.tmp, onGround);
    // Lift the foot a little between deck and ground while moving.
    goal.y += 0.06 * Math.sin(Math.PI * onGround) * (1 - onGround);
  }

  /** Substep at 60 Hz for stability regardless of the sample rate. `weight` scales the pull toward
   *  the target: 1 = posed, 0 = ragdoll (gravity and constraints only). */
  private verlet(p: Particle, target: Vector3, dt: number, weight = 1): void {
    const n = Math.max(1, Math.round(dt * 60));
    const sub = dt / n;
    const k = RIG.verletStiffness * (0.02 + 0.98 * weight);
    for (let i = 0; i < n; i++) p.step(target, this.gravityLocal, k, RIG.verletDrag * (weight > 0.5 ? 1 : 0.4), sub);
  }

  /**
   * Set a bone's rotation so it runs from `from` to `to` with its +X toward `front`, all in the
   * body frame; stored as a parent-relative local rotation.
   */
  private aim(name: keyof typeof this.skeleton.bones, from: Vector3, to: Vector3, front: Vector3): void {
    const bone = this.skeleton.bones[name];
    const def = this.skeleton.defs[name];
    const q = this.boneQ.get(name)!;
    this.aimDir.subVectors(to, from).normalize();
    quatFromDirFront(this.aimDir, front, q);
    if (def.parent) {
      const pq = def.parent === 'pelvis' ? this.pelvisLocalQ : this.boneQ.get(def.parent)!;
      bone.quaternion.copy(pq).invert().multiply(q);
    }
  }

  dispose(): void {
    this.skeleton.mesh.geometry.dispose();
    this.deck.geometry.dispose();
    this.trucks[0].geometry.dispose();
    this.wheels[0].geometry.dispose();
  }
}

function smooth01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}
