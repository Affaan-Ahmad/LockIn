import { z } from 'zod';

/**
 * The trust boundary.
 *
 * Everything Google returns is validated here before it is allowed to become a
 * domain object. This is not defensive theatre: Classroom omits zero-valued
 * fields, omits fields the caller's scopes do not cover, returns numbers as
 * strings in places, and has changed shapes between API revisions. Letting an
 * unvalidated payload spread through the codebase means a schema surprise
 * surfaces as a corrupted assignment row months later.
 *
 * The schemas are deliberately *permissive about absence* and *strict about
 * shape*. A missing dueTime is normal and must parse. A dueTime of
 * `{hours: "seven"}` is not, and must fail loudly so the item is skipped and
 * logged rather than written as garbage.
 */

/** Google returns integers as JSON numbers here, but has used strings before. */
const looseInt = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expected an integer' });
    return z.NEVER;
  }
  return parsed;
});

const looseNumber = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expected a number' });
    return z.NEVER;
  }
  return parsed;
});

/** RFC3339 as produced by Google. Rejected rather than coerced when malformed. */
const rfc3339 = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'expected an RFC3339 timestamp',
});

export const googleDateSchema = z.object({
  year: looseInt.optional(),
  month: looseInt.optional(),
  day: looseInt.optional(),
});

export const googleTimeOfDaySchema = z.object({
  hours: looseInt.optional(),
  minutes: looseInt.optional(),
  seconds: looseInt.optional(),
  nanos: looseInt.optional(),
});

export const googleCourseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  section: z.string().optional(),
  descriptionHeading: z.string().optional(),
  description: z.string().optional(),
  room: z.string().optional(),
  courseState: z.string().optional(),
  alternateLink: z.string().optional(),
  creationTime: rfc3339.optional(),
  updateTime: rfc3339.optional(),
});

export const googleCourseListSchema = z.object({
  courses: z.array(googleCourseSchema).optional(),
  nextPageToken: z.string().optional(),
});

export const googleIndividualStudentsOptionsSchema = z.object({
  studentIds: z.array(z.string()).optional(),
});

export const googleCourseWorkSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().min(1),
  // A coursework item without a title is not something we can present to a
  // student, so it fails validation rather than becoming an untitled row.
  title: z.string().min(1),
  description: z.string().optional(),
  state: z.string().optional(),
  alternateLink: z.string().optional(),
  creationTime: rfc3339.optional(),
  updateTime: rfc3339.optional(),
  dueDate: googleDateSchema.optional(),
  dueTime: googleTimeOfDaySchema.optional(),
  scheduledTime: rfc3339.optional(),
  maxPoints: looseNumber.optional(),
  workType: z.string().optional(),
  assigneeMode: z.string().optional(),
  individualStudentsOptions: googleIndividualStudentsOptionsSchema.optional(),
  topicId: z.string().optional(),
  creatorUserId: z.string().optional(),
});

export const googleCourseWorkListSchema = z.object({
  courseWork: z.array(googleCourseWorkSchema).optional(),
  nextPageToken: z.string().optional(),
});

export const googleStudentSubmissionSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().min(1),
  courseWorkId: z.string().min(1),
  userId: z.string().optional(),
  creationTime: rfc3339.optional(),
  updateTime: rfc3339.optional(),
  state: z.string().optional(),
  late: z.boolean().optional(),
  draftGrade: looseNumber.optional(),
  assignedGrade: looseNumber.optional(),
  alternateLink: z.string().optional(),
  courseWorkType: z.string().optional(),
});

export const googleStudentSubmissionListSchema = z.object({
  studentSubmissions: z.array(googleStudentSubmissionSchema).optional(),
  nextPageToken: z.string().optional(),
});

export const googleTopicSchema = z.object({
  topicId: z.string().min(1),
  courseId: z.string().min(1),
  name: z.string().min(1),
  updateTime: rfc3339.optional(),
});

export const googleTopicListSchema = z.object({
  topic: z.array(googleTopicSchema).optional(),
  nextPageToken: z.string().optional(),
});

/** Google's standard error envelope. */
export const googleErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
    errors: z
      .array(z.object({ reason: z.string().optional(), message: z.string().optional() }))
      .optional(),
  }),
});

export const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: looseInt,
  scope: z.string().optional(),
  token_type: z.string().optional(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
});

export const googleTokenErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

export type GoogleCourse = z.infer<typeof googleCourseSchema>;
export type GoogleCourseWork = z.infer<typeof googleCourseWorkSchema>;
export type GoogleStudentSubmission = z.infer<typeof googleStudentSubmissionSchema>;
export type GoogleTopic = z.infer<typeof googleTopicSchema>;
export type GoogleTokenResponse = z.infer<typeof googleTokenResponseSchema>;
