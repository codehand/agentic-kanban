/**
 * validation/task-attributes.ts — Zod schemas for the 5 task attribute fields.
 *
 * Used by both the MCP tool schemas and the HTTP PATCH handler to validate
 * input before it reaches the repository layer.
 */
import { z } from 'zod'

export const VALID_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
export const VALID_COMPLEXITIES = ['XS', 'S', 'M', 'L', 'XL'] as const

export const prioritySchema = z.enum(VALID_PRIORITIES)
export const complexitySchema = z.enum(VALID_COMPLEXITIES)
export const estimateHoursSchema = z.number().nonnegative()
export const tagsSchema = z.array(z.string())
export const linkDocumentSchema = z.string().url()

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
