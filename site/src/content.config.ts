import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection, z } from "astro:content";

/**
 * Every page carries an honesty label. The label is not decoration: it tells a
 * reader whether the thing described runs today, whether it is a teaching model
 * with no chain behind it, whether it is something an operator has to supply,
 * or whether it is a separate system this repository only talks to.
 */
export const STAGES = [
  "protocol",
  "implemented",
  "demonstration",
  "operator",
  "external",
  "inactive",
  "planned",
] as const;

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        /** Short label above the page title. */
        eyebrow: z.string().optional(),
        /** Honesty label rendered next to the page title. */
        stage: z.enum(STAGES).optional(),
        /** One sentence describing what the reader walks away with. */
        takeaway: z.string().optional(),
        /** Marks a page as a numbered step in the guided journey. */
        journey: z.number().int().min(1).max(9).optional(),
      }),
    }),
  }),
};
