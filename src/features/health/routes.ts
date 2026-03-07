import type { FastifyPluginAsync } from "fastify"

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/health",
    {
      schema: {
        description: "Health check",
        tags: ["health"],
      },
    },
    async () => {
      return { status: "ok" }
    },
  )
}
