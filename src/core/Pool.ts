import { Quaternion, Vector3 } from 'three';

/**
 * Module-level scratch objects for the simulation. The sim loop must not allocate,
 * so every temporary Vector3/Quaternion comes from here. Never hold a reference
 * across a step; treat these as registers.
 */
export const v0 = new Vector3();
export const v1 = new Vector3();
export const v2 = new Vector3();
export const v3 = new Vector3();
export const v4 = new Vector3();
export const v5 = new Vector3();
export const v6 = new Vector3();
export const v7 = new Vector3();

export const q0 = new Quaternion();
export const q1 = new Quaternion();
export const q2 = new Quaternion();
export const q3 = new Quaternion();

export const UP = Object.freeze(new Vector3(0, 1, 0)) as Vector3;
export const FORWARD = Object.freeze(new Vector3(0, 0, -1)) as Vector3;
export const RIGHT = Object.freeze(new Vector3(1, 0, 0)) as Vector3;
