/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as academics from "../academics.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as enrolments from "../enrolments.js";
import type * as helpers from "../helpers.js";
import type * as migrations from "../migrations.js";
import type * as people from "../people.js";
import type * as proximity from "../proximity.js";
import type * as ratelimit from "../ratelimit.js";
import type * as reports from "../reports.js";
import type * as reps from "../reps.js";
import type * as scancode from "../scancode.js";
import type * as staff from "../staff.js";
import type * as station from "../station.js";
import type * as timetable from "../timetable.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  academics: typeof academics;
  attendance: typeof attendance;
  auth: typeof auth;
  crons: typeof crons;
  enrolments: typeof enrolments;
  helpers: typeof helpers;
  migrations: typeof migrations;
  people: typeof people;
  proximity: typeof proximity;
  ratelimit: typeof ratelimit;
  reports: typeof reports;
  reps: typeof reps;
  scancode: typeof scancode;
  staff: typeof staff;
  station: typeof station;
  timetable: typeof timetable;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
