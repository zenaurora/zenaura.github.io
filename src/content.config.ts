import { glob } from "astro/loaders"
import { defineCollection, reference } from "astro:content"
import { z } from "astro/zod"

const authors = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.md",
    base: "./src/content/authors",
  }),
  schema: z.object({
    name: z.string(),
    pronouns: z.string().optional(),
    avatar: z.url().or(z.string().startsWith("/")),
    bio: z.string().optional(),
    mail: z.email().optional(),
    socials: z.record(z.string(), z.url()).optional(),
  }),
})

const blog = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.md",
    base: "./src/content/blog",
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      date: z.coerce.date(),
      order: z.number().optional(),
      tags: z.array(z.string()).optional(),
      authors: z.array(reference("authors")),
      image: image().optional(),
      draft: z.boolean().optional(),
    }),
})

const papers = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.md",
    base: "./src/content/papers",
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      date: z.coerce.date(),
      tags: z.array(z.string()).optional(),
      authors: z.array(reference("authors")),
      image: image().optional(),
      draft: z.boolean().optional(),
    }),
})

const daily = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.md",
    base: "./src/content/daily",
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    topic: z.string(),
    sourceCount: z.number().optional(),
  }),
})

const now = defineCollection({
  loader: glob({
    pattern: "*/index.md",
    base: "./src/content/now",
  }),
  schema: z.object({
    plans: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          addedAt: z.coerce.date(),
          finishedAt: z.coerce.date().optional(),
          deliverable: z
            .object({
              url: z.url().or(z.string().startsWith("/")),
              kind: z.enum(["post", "paper", "project", "external"]),
            })
            .optional(),
          reflection: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      )
      .default([]),
  }),
})

const projects = defineCollection({
  loader: glob({
    pattern: "**/[^_]*.md",
    base: "./src/content/projects",
  }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      description: z.string(),
      link: z.url(),
      tags: z.array(z.string()).optional(),
      image: image().optional(),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
    }),
})

export const collections = { blog, papers, authors, projects, daily, now }
