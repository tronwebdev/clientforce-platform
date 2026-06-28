/**
 * @clientforce/events — internal event bus + typed event catalog (ARCHITECTURE.md §3c).
 */
export * from "./catalog";
export * from "./types";
export * from "./validate";
export * from "./consumers";
export * from "./redis";
export * from "./bus";
export * from "./sample-publisher";

export const EVENTS_PACKAGE = "@clientforce/events";
