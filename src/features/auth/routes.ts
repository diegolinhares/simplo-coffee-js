import type { FastifyPluginAsync } from "fastify"

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.route({
    method: ["GET", "POST"],
    url: "/*",
    async handler(request, reply) {
      const url = new URL(
        request.url,
        `http://${request.headers.host ?? "localhost"}`,
      )

      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (value) headers.append(key, String(value))
      }

      const fetchRequest = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      })

      const response = await fastify.auth.handler(fetchRequest)

      reply.status(response.status)
      for (const [key, value] of response.headers) {
        reply.header(key, value)
      }

      const body = await response.text()
      reply.send(body || null)
    },
  })
}
