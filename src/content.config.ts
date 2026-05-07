import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const baseSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  date: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  placeholder: z.boolean().default(false),
})

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: baseSchema,
})

const wiki = defineCollection({
  loader: glob({ base: './src/content/wiki', pattern: '**/*.{md,mdx}' }),
  schema: baseSchema,
})

const tools = defineCollection({
  loader: glob({ base: './src/content/tools', pattern: '**/*.{md,mdx}' }),
  schema: baseSchema,
})

export const collections = { blog, wiki, tools }
