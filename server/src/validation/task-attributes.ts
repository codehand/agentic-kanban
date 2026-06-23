/**
 * validation/task-attributes.ts — Zod schemas for the 5 task attribute fields.
 *
 * Used by both the MCP tool schemas and the HTTP PATCH handler to validate
 * input before it reaches the repository layer.
 */
import { z } from 'zod'

export const VALID_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
export const VALID_COMPLEXITIES = ['1', '2', '3', '5', '8', '13', '21'] as const

/**
 * True only for URLs whose scheme is http(s). Rejects javascript:, data:,
 * file:, etc. — the source of the stored-XSS finding (link_document / mr_url
 * rendered as a live <a href>). Shared by every validation path.
 */
export function isHttpUrl(u: string): boolean {
  try {
    return /^https?:$/.test(new URL(u).protocol)
  } catch {
    return false
  }
}

export const prioritySchema = z.enum(VALID_PRIORITIES)
export const complexitySchema = z.enum(VALID_COMPLEXITIES)
export const estimateHoursSchema = z.number().finite().nonnegative()
export const tagsSchema = z.array(z.string())
export const linkDocumentSchema = z.string().url().refine(isHttpUrl, {
  message: 'Must be an http(s) URL',
})
// pr_url mirrors REST PATCH validation: an http(s) URL string, or null to
// clear it. Rejects javascript:/data:/file: the same way isHttpUrl does.
export const prUrlSchema = z.string().url().refine(isHttpUrl, {
  message: 'Must be an http(s) URL',
}).nullable()

export const taskAttributesSchema = z.object({
  priority: prioritySchema.nullable().optional(),
  complexity: complexitySchema.nullable().optional(),
  estimate_hours: estimateHoursSchema.nullable().optional(),
  tags: tagsSchema.optional(),
  link_document: linkDocumentSchema.nullable().optional(),
}).strict()

export type TaskAttributesInput = z.infer<typeof taskAttributesSchema>

/**
 * Validate a patch of task attributes. Throws ZodError on invalid input.
 */
export function validateTaskAttributes(input: unknown): TaskAttributesInput {
  return taskAttributesSchema.parse(input)
}
