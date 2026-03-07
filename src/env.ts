import "dotenv/config"
import { z } from "zod/v4"

const envSchema = z.object({
  DATABASE_URL: z.string(),
  BETTER_AUTH_SECRET: z.string(),
  BETTER_AUTH_URL: z.string().url(),
  SIMPLO_API_KEY: z.string(),
  SIMPLO_BASE_URL: z.string().url().default("https://besimplo.com"),
  WEBHOOK_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
})

export const env = envSchema.parse(process.env)
