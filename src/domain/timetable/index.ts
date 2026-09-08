export { buildGrid, decodeEntities, parseBackgroundColours } from './grid';
export type { Grid, GridCell } from './grid.types';
export { freeRooms, occupiedUntil, roomAvailability, roomSchedule } from './free-rooms';
export type { RoomAvailability, RoomStatus } from './free-rooms';
export { CAMPUS_TIME_ZONE, toTimetableMoment, windowFrom } from './now';
export type { TimetableMoment } from './now';
export { cohortOptions, findCohort, WHOLE_COHORT_SECTION } from './cohorts';
export type { CohortOption } from './cohorts';
export { parseCohortLabel, readLegend } from './legend';
export {
  buildGridFromSheet,
  classifyDayTab,
  selectStandingWeek,
  toHexColour,
} from './grid-from-sheets';
export type {
  DayTab,
  DayTabKind,
  SheetsCell,
  SheetsColour,
  SheetsMerge,
  SheetsProperties,
  SheetsSheet,
} from './grid-from-sheets';
export { parseCellSegment, parseSectionSpec } from './cell-text';
export type { ParsedSegment } from './cell-text';
export { parseTimetableDay, parseTimetableGrid } from './parse-day';
export {
  byStartTime,
  selectForStudent,
} from './select';
export type {
  MatchConfidence,
  MatchReason,
  StudentTimetableIdentity,
  TimetableMatch,
} from './select';
export {
  containsTimeRange,
  formatMinuteOfDay,
  parseExtendedUntil,
  parseTimeRange,
  resolveMinuteOfDay,
  slotsAreChronological,
} from './time-of-day';
export type {
  Cohort,
  CohortKind,
  DiagnosticCode,
  EntryStatus,
  MinuteOfDay,
  ParseDiagnostic,
  SectionRef,
  TimeRange,
  TimeSource,
  TimetableDay,
  TimetableEntry,
  Weekday,
} from './types';
